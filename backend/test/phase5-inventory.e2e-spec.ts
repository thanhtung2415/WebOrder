import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { IngredientStatus, InventoryTransactionType, Prisma, StocktakeStatus, UnitDimension } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 5 inventory", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const authByToken = new Map<string, AuthContext>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseJwtVerifierService)
      .useValue({
        verify: jest.fn((token: string) => Promise.resolve(authByToken.get(token) ?? createAuthContext()))
      })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await app.init();
  });

  beforeEach(async () => {
    authByToken.clear();
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it("imports with conversion snapshots and persistent idempotency", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, "g", "Gram", "g", UnitDimension.MASS);
    const kilogram = await createUnit(setup.branchId, "kg", "Kilogram", "kg", UnitDimension.MASS);
    const milliliter = await createUnit(setup.branchId, "ml", "Milliliter", "ml", UnitDimension.VOLUME);
    const bottle = await createUnit(setup.branchId, "bottle", "Bottle", "bottle", UnitDimension.PACKAGE);
    const coffee = await createIngredient(setup.branchId, "coffee", "Coffee", gram.id);
    const syrup = await createIngredient(setup.branchId, "syrup", "Syrup", milliliter.id);
    await allowUnit(setup.branchId, coffee.id, kilogram.id, "1000");
    await allowUnit(setup.branchId, syrup.id, bottle.id, "750");

    const coffeePayload = {
      ingredientId: coffee.id,
      type: InventoryTransactionType.IMPORT,
      inputQuantity: "2.000",
      inputUnitId: kilogram.id,
      unitCost: "120000.00",
      reason: "Initial coffee import"
    };
    const firstImport = await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "coffee-import-1")
      .send(coffeePayload)
      .expect(201);
    expect(dataOf<InventoryTransactionResponse>(firstImport.body)).toMatchObject({
      type: "IMPORT",
      quantityDelta: "2000.000",
      inputQuantity: "2.000",
      conversionFactor: "1000.000000",
      convertedBaseQuantity: "2000.000"
    });

    const replay = await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "coffee-import-1")
      .send(coffeePayload)
      .expect(201);
    expect(dataOf<InventoryTransactionResponse>(replay.body).id).toBe(dataOf<InventoryTransactionResponse>(firstImport.body).id);

    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "coffee-import-1")
      .send({ ...coffeePayload, inputQuantity: "3.000" })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "IDEMPOTENCY_KEY_REUSED"));

    await allowUnit(setup.branchId, coffee.id, kilogram.id, "900");
    const storedImport = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: dataOf<InventoryTransactionResponse>(firstImport.body).id } });
    expect(storedImport.conversionFactor?.toFixed(6)).toBe("1000.000000");
    expect(storedImport.convertedBaseQuantity?.toFixed(3)).toBe("2000.000");

    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "syrup-import-1")
      .send({
        ingredientId: syrup.id,
        type: InventoryTransactionType.IMPORT,
        inputQuantity: "3.000",
        inputUnitId: bottle.id,
        reason: "Syrup bottles"
      })
      .expect(201)
      .expect((response) => {
        expect(dataOf<InventoryTransactionResponse>(response.body).convertedBaseQuantity).toBe("2250.000");
      });

    const balances = await request(app.getHttpServer()).get("/api/v1/inventory").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).expect(200);
    const coffeeBalance = dataOf<InventoryListResponse>(balances.body).items.find((item) => item.ingredient.id === coffee.id);
    expect(coffeeBalance?.physicalQuantity).toBe("2000.000");
    expect(await prisma.inventoryTransaction.count({ where: { inventory: { ingredientId: coffee.id }, type: InventoryTransactionType.IMPORT } })).toBe(1);
  });

  it("rejects invalid balances and computes low stock from available quantity", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, "g", "Gram", "g", UnitDimension.MASS);
    const coffee = await createIngredient(setup.branchId, "coffee", "Coffee", gram.id);
    await prisma.inventory.create({
      data: {
        branchId: setup.branchId,
        ingredientId: coffee.id,
        physicalQuantity: new Prisma.Decimal("1000.000"),
        reservedQuantity: new Prisma.Decimal("800.000"),
        minimumQuantity: new Prisma.Decimal("300.000")
      }
    });

    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ ingredientId: coffee.id, type: InventoryTransactionType.ADJUSTMENT, quantityDelta: "-1500.000", reason: "Bad count" })
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INVENTORY_WOULD_BE_NEGATIVE"));

    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ ingredientId: coffee.id, type: InventoryTransactionType.WASTE, quantity: "300.000", reason: "Spilled" })
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INSUFFICIENT_INVENTORY"));

    const response = await request(app.getHttpServer()).get("/api/v1/inventory?lowStockOnly=true").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).expect(200);
    const lowStockItem = dataOf<InventoryListResponse>(response.body).items.find((item) => item.ingredient.id === coffee.id);
    expect(lowStockItem).toMatchObject({ availableQuantity: "200.000", minimumQuantity: "300.000", lowStock: true });
  });

  it("serializes concurrent waste mutations and writes ledger, audit and outbox atomically", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, "g", "Gram", "g", UnitDimension.MASS);
    const coffee = await createIngredient(setup.branchId, "coffee", "Coffee", gram.id);
    const inventory = await prisma.inventory.create({
      data: { branchId: setup.branchId, ingredientId: coffee.id, physicalQuantity: new Prisma.Decimal("1000.000") }
    });

    const payload = { ingredientId: coffee.id, type: InventoryTransactionType.WASTE, quantity: "600.000", reason: "Spill race" };
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/inventory-transactions").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", "waste-race-a").send(payload),
      request(app.getHttpServer()).post("/api/v1/inventory-transactions").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", "waste-race-b").send(payload)
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 422]);
    const reloaded = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    expect(reloaded.physicalQuantity.toFixed(3)).toBe("400.000");
    expect(await prisma.inventoryTransaction.count({ where: { inventoryId: inventory.id, type: InventoryTransactionType.WASTE } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { branchId: setup.branchId, action: "ADJUST_INVENTORY", entityId: inventory.id } })).toBe(1);
    expect(await prisma.realtimeOutbox.count({ where: { branchId: setup.branchId, aggregateId: inventory.id, eventType: "INVENTORY_CHANGED" } })).toBe(1);
  });

  it("supports stocktake open count complete cancel and completion guards", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, "g", "Gram", "g", UnitDimension.MASS);
    const coffee = await createIngredient(setup.branchId, "coffee", "Coffee", gram.id);
    const inventory = await prisma.inventory.create({
      data: { branchId: setup.branchId, ingredientId: coffee.id, physicalQuantity: new Prisma.Decimal("5000.000") }
    });

    const opened = await request(app.getHttpServer()).post("/api/v1/stocktakes").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ code: "STK-001" }).expect(201);
    const stocktake = dataOf<StocktakeResponse>(opened.body);
    expect(stocktake.status).toBe(StocktakeStatus.DRAFT);
    expect(stocktake.items[0]).toMatchObject({ expectedQuantity: "5000.000", countedQuantity: "5000.000" });

    await request(app.getHttpServer())
      .patch(`/api/v1/stocktakes/${stocktake.id}/items/${stocktake.items[0].id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ countedQuantity: "4800.000", note: "Counted lower" })
      .expect(200)
      .expect((response) => {
        expect(dataOf<StocktakeResponse>(response.body).items[0].difference).toBe("-200.000");
      });

    await request(app.getHttpServer())
      .post(`/api/v1/stocktakes/${stocktake.id}/completion`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "stocktake-complete-1")
      .send({ note: "Done" })
      .expect(201)
      .expect((response) => {
        expect(dataOf<StocktakeResponse>(response.body).status).toBe(StocktakeStatus.COMPLETED);
      });
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).physicalQuantity.toFixed(3)).toBe("4800.000");
    expect((await prisma.inventoryTransaction.findFirstOrThrow({ where: { inventoryId: inventory.id, type: InventoryTransactionType.STOCKTAKE } })).quantityDelta.toFixed(3)).toBe("-200.000");

    await request(app.getHttpServer())
      .patch(`/api/v1/stocktakes/${stocktake.id}/items/${stocktake.items[0].id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ countedQuantity: "4700.000" })
      .expect(409);
    await request(app.getHttpServer()).post(`/api/v1/stocktakes/${stocktake.id}/cancellation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(409);

    const cancellable = dataOf<StocktakeResponse>(
      (await request(app.getHttpServer()).post("/api/v1/stocktakes").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ code: "STK-002" }).expect(201)).body
    );
    await request(app.getHttpServer()).post(`/api/v1/stocktakes/${cancellable.id}/cancellation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(201);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).physicalQuantity.toFixed(3)).toBe("4800.000");

    await prisma.inventory.update({ where: { id: inventory.id }, data: { reservedQuantity: new Prisma.Decimal("100.000") } });
    const blocked = dataOf<StocktakeResponse>(
      (await request(app.getHttpServer()).post("/api/v1/stocktakes").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ code: "STK-003" }).expect(201)).body
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/stocktakes/${blocked.id}/items/${blocked.items[0].id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ countedQuantity: "50.000" })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/stocktakes/${blocked.id}/completion`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", "stocktake-complete-blocked")
      .send({})
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INSUFFICIENT_INVENTORY"));

    await prisma.inventory.update({ where: { id: inventory.id }, data: { reservedQuantity: new Prisma.Decimal("0.000") } });
    const race = dataOf<StocktakeResponse>(
      (await request(app.getHttpServer()).post("/api/v1/stocktakes").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ code: "STK-004" }).expect(201)).body
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/stocktakes/${race.id}/items/${race.items[0].id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ countedQuantity: "4700.000" })
      .expect(200);
    const [firstCompletion, secondCompletion] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/stocktakes/${race.id}/completion`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", "stocktake-race-a").send({}),
      request(app.getHttpServer()).post(`/api/v1/stocktakes/${race.id}/completion`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", "stocktake-race-b").send({})
    ]);
    expect([firstCompletion.status, secondCompletion.status].sort()).toEqual([201, 409]);
  });

  it("enforces branch scope and inventory permissions", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, "g", "Gram", "g", UnitDimension.MASS);
    const coffee = await createIngredient(setup.branchId, "coffee", "Coffee", gram.id);
    await prisma.inventory.create({ data: { branchId: setup.branchId, ingredientId: coffee.id, physicalQuantity: new Prisma.Decimal("10.000") } });
    const otherBranch = await prisma.branch.create({ data: { code: "OTHER", name: "Other Branch", timezone: "Asia/Ho_Chi_Minh" } });
    await registerAndApprove("waiter-token", setup.branchId, "WAITER");

    await request(app.getHttpServer()).get("/api/v1/inventory").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).expect(200);
    await request(app.getHttpServer()).get("/api/v1/inventory").set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", otherBranch.id)
      .set("Idempotency-Key", randomUUID())
      .send({ ingredientId: coffee.id, type: InventoryTransactionType.ADJUSTMENT, quantityDelta: "1.000", reason: "Bad branch" })
      .expect(403);
    await request(app.getHttpServer()).post("/api/v1/stocktakes").set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).send({ code: "BAD" }).expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/inventory-transactions")
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ ingredientId: coffee.id, type: InventoryTransactionType.WASTE, quantity: "1.000", reason: "No permission" })
      .expect(403);
  });

  async function setupAdmin(token: string): Promise<{ branchId: string; adminUserId: string }> {
    const auth = createAuthContext({ email: `${token}@example.com`, displayName: "Owner" });
    authByToken.set(token, auth);
    const response = await request(app.getHttpServer()).post("/api/v1/setup").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", randomUUID()).send(createSetupDto()).expect(201);
    return { branchId: dataOf<SetupResponse>(response.body).branch.id, adminUserId: dataOf<SetupResponse>(response.body).admin.id };
  }

  async function createUnit(branchId: string, code: string, name: string, symbol: string, dimension: UnitDimension): Promise<UnitResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/units").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name, symbol, dimension }).expect(201);
    return dataOf<UnitResponse>(response.body);
  }

  async function createIngredient(branchId: string, code: string, name: string, baseUnitId: string): Promise<IngredientResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/ingredients").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name, baseUnitId, status: IngredientStatus.ACTIVE }).expect(201);
    return dataOf<IngredientResponse>(response.body);
  }

  async function allowUnit(branchId: string, ingredientId: string, unitId: string, conversionFactor: string): Promise<void> {
    await request(app.getHttpServer()).put(`/api/v1/ingredients/${ingredientId}/units/${unitId}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ conversionFactor, isActive: true }).expect(200);
  }

  async function registerAndApprove(token: string, branchId: string, roleCode: string): Promise<void> {
    const auth = createAuthContext();
    authByToken.set(token, auth);
    await request(app.getHttpServer()).post("/api/v1/auth/registrations").set("Authorization", `Bearer ${token}`).send({}).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { authUserId: auth.authUserId } });
    const roleResponse = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).expect(200);
    const role = dataOf<RoleListResponse>(roleResponse.body).items.find((item) => item.code === roleCode);
    if (!role) {
      throw new Error(`Missing role ${roleCode}`);
    }
    await request(app.getHttpServer()).post(`/api/v1/staff/${user.id}/approval`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ roleIds: [role.id] }).expect(201);
  }
});

interface ApiEnvelope<T> {
  data: T;
}

interface SetupResponse {
  branch: { id: string };
  admin: { id: string };
}

interface UnitResponse {
  id: string;
}

interface IngredientResponse {
  id: string;
}

interface InventoryTransactionResponse {
  id: string;
  type: string;
  quantityDelta: string;
  inputQuantity: string | null;
  conversionFactor: string | null;
  convertedBaseQuantity: string | null;
}

interface InventoryListResponse {
  items: Array<{
    ingredient: { id: string };
    physicalQuantity: string;
    availableQuantity: string;
    minimumQuantity: string;
    lowStock: boolean;
  }>;
}

interface StocktakeResponse {
  id: string;
  status: StocktakeStatus;
  items: Array<{
    id: string;
    expectedQuantity: string;
    countedQuantity: string;
    difference: string;
  }>;
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

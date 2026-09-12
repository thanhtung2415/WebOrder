import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  AccountStatus,
  CartStatus,
  OptionGroupType,
  Prisma,
  ProcessingArea,
  RecipeType,
  ReservationStatus,
  SessionStatus,
  UnitDimension
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { CartService } from "../src/modules/cart/cart.service";
import { SetupService } from "../src/modules/setup/setup.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 7 cart inventory reservation", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cartService: CartService;
  let setupService: SetupService;
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
    cartService = moduleRef.get(CartService);
    setupService = moduleRef.get(SetupService);
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

  it("creates a QR scoped cart and sets a 10 minute item reservation TTL without refreshing it on read", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "ttl", "5.000");
    const session = await createQrSession(setup.branchId, "T01");

    const before = Date.now();
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 2 });
    const after = Date.now();
    const item = cart.items[0];

    expect(item.reservationStatus).toBe("ACTIVE");
    expect(new Date(item.reservationExpiresAt!).getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000 - 2_000);
    expect(new Date(item.reservationExpiresAt!).getTime()).toBeLessThanOrEqual(after + 10 * 60_000 + 2_000);
    await expectReservedQuantity(catalog.inventoryId, "2.000");

    const expiryBeforeRead = item.reservationExpiresAt;
    const read = await getCart(session.qrSessionToken, cart.token);
    expect(read.items[0].reservationExpiresAt).toBe(expiryBeforeRead);
  });

  it("resets only recipe-changing item TTL and keeps note-only TTL unchanged", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "update", "20.000", { withLargeOption: true });
    const session = await createQrSession(setup.branchId, "T02");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const second = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 }, cart.token);
    const [firstItem, secondItem] = second.items;

    await setItemReservationExpiry(firstItem.id, new Date(Date.now() + 60_000));
    await setItemReservationExpiry(secondItem.id, new Date(Date.now() + 120_000));
    const firstOldExpiry = (await getActiveReservation(firstItem.id)).expiresAt.toISOString();
    const secondOldExpiry = (await getActiveReservation(secondItem.id)).expiresAt.toISOString();

    const updated = await updateItem(session.qrSessionToken, firstItem.id, { quantity: 2, optionValueIds: [catalog.largeProductOptionValueId!] });
    const updatedFirst = updated.items.find((item) => item.id === firstItem.id)!;
    const untouchedSecond = updated.items.find((item) => item.id === secondItem.id)!;
    expect(new Date(updatedFirst.reservationExpiresAt!).getTime()).toBeGreaterThan(new Date(firstOldExpiry).getTime());
    expect(untouchedSecond.reservationExpiresAt).toBe(secondOldExpiry);
    await expectReservedQuantity(catalog.inventoryId, "5.000");

    const expiryBeforeNote = updatedFirst.reservationExpiresAt;
    const noteOnly = await updateItem(session.qrSessionToken, firstItem.id, { note: "less sweet" });
    expect(noteOnly.items.find((item) => item.id === firstItem.id)!.reservationExpiresAt).toBe(expiryBeforeNote);
  });

  it("releases reservations when deleting an item and hides it from the active cart", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "delete", "5.000");
    const session = await createQrSession(setup.branchId, "T03");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 3 });
    const itemId = cart.items[0].id;

    const afterDelete = await deleteItem(session.qrSessionToken, itemId);
    expect(afterDelete.items).toHaveLength(0);
    await expectReservedQuantity(catalog.inventoryId, "0.000");
    await expect(prisma.inventoryReservation.count({ where: { cartItemId: itemId, status: ReservationStatus.RELEASED } })).resolves.toBe(1);
    await expect(prisma.cartItem.findUniqueOrThrow({ where: { id: itemId }, include: { cart: true } })).resolves.toMatchObject({
      cart: { status: CartStatus.ABANDONED }
    });
  });

  it("does not revive expired reservations and checks stock again on recipe-changing update", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "expired", "2.000");
    const session = await createQrSession(setup.branchId, "T04");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const itemId = cart.items[0].id;
    await setItemReservationExpiry(itemId, new Date(Date.now() - 60_000));

    await request(app.getHttpServer())
      .patch(`/api/v1/cart/items/${itemId}`)
      .set("Authorization", `Bearer ${session.qrSessionToken}`)
      .send({ note: "too late" })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "RESERVATION_EXPIRED"));
    await expectReservedQuantity(catalog.inventoryId, "0.000");

    const refreshed = await updateItem(session.qrSessionToken, itemId, { quantity: 1 });
    expect(refreshed.items).toHaveLength(1);
    expect(refreshed.items[0].id).not.toBe(itemId);
    expect(refreshed.items[0].reservationStatus).toBe("ACTIVE");
    await expectReservedQuantity(catalog.inventoryId, "1.000");
  });

  it("allows only one customer to reserve the final stock and never over-reserves", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "race", "1.000");
    const session = await createQrSession(setup.branchId, "T05");

    const responses = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/cart/items").set("Authorization", `Bearer ${session.qrSessionToken}`).send({ productId: catalog.productId, quantity: 1 }),
      request(app.getHttpServer()).post("/api/v1/cart/items").set("Authorization", `Bearer ${session.qrSessionToken}`).send({ productId: catalog.productId, quantity: 1 })
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    await expectReservedQuantity(catalog.inventoryId, "1.000");
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: catalog.inventoryId } });
    expect(inventory.reservedQuantity.lte(inventory.physicalQuantity)).toBe(true);
  });

  it("handles concurrent update, delete and expiration without double release or double reserve", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "concurrent", "5.000");
    const session = await createQrSession(setup.branchId, "T06");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const itemId = cart.items[0].id;
    await setItemReservationExpiry(itemId, new Date(Date.now() - 60_000));

    const results = await Promise.allSettled([
      request(app.getHttpServer()).patch(`/api/v1/cart/items/${itemId}`).set("Authorization", `Bearer ${session.qrSessionToken}`).send({ quantity: 2 }),
      request(app.getHttpServer()).delete(`/api/v1/cart/items/${itemId}`).set("Authorization", `Bearer ${session.qrSessionToken}`),
      cartService.expireDueReservations(10)
    ]);

    expect(results).toHaveLength(3);
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: catalog.inventoryId } });
    const activeTotal = await prisma.inventoryReservation.aggregate({
      where: { inventoryId: catalog.inventoryId, status: ReservationStatus.ACTIVE },
      _sum: { quantity: true }
    });
    expect(inventory.reservedQuantity.toFixed(3)).toBe((activeTotal._sum.quantity ?? new Prisma.Decimal("0.000")).toFixed(3));
    expect(inventory.reservedQuantity.gte(new Prisma.Decimal("0.000"))).toBe(true);
    expect(inventory.reservedQuantity.lte(inventory.physicalQuantity)).toBe(true);
  });

  it("prevents another QR table session from reading a cart", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "scope", "5.000");
    const first = await createQrSession(setup.branchId, "T07");
    const second = await createQrSession(setup.branchId, "T08");
    const cart = await addItem(first.qrSessionToken, { productId: catalog.productId, quantity: 1 });

    await request(app.getHttpServer())
      .get("/api/v1/cart")
      .set("Authorization", `Bearer ${second.qrSessionToken}`)
      .set("X-Cart-Token", cart.token)
      .expect(404)
      .expect((response) => expectErrorCode(response.body, "CART_NOT_FOUND"));
  });

  it("enforces staff branch isolation and order creation permission", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "staff", "5.000");
    const session = await createQrSession(setup.branchId, "T09");
    await registerAndApprove("waiter-token", setup.branchId, "WAITER");
    await registerAndApprove("bar-token", setup.branchId, "BAR");
    const otherBranch = await prisma.branch.create({ data: { code: "OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });

    await request(app.getHttpServer())
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .set("X-Table-Session-Id", session.session.id)
      .send({ productId: catalog.productId, quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", otherBranch.id)
      .set("X-Table-Session-Id", session.session.id)
      .send({ productId: catalog.productId, quantity: 1 })
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/cart/items")
      .set("Authorization", "Bearer bar-token")
      .set("X-Branch-Id", setup.branchId)
      .set("X-Table-Session-Id", session.session.id)
      .send({ productId: catalog.productId, quantity: 1 })
      .expect(403);
  });

  async function setupAdmin(token: string): Promise<{ branchId: string; adminUserId: string }> {
    const auth = createAuthContext({ email: `${token}@example.com`, displayName: "Owner" });
    authByToken.set(token, auth);
    const response = await setupService.completeSetup(createSetupDto(), auth, randomUUID());
    return { branchId: response.branch.id, adminUserId: response.admin.id };
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
    await prisma.user.update({ where: { id: user.id }, data: { status: AccountStatus.ACTIVE } });
  }

  async function createQrSession(branchId: string, tableCode: string): Promise<QrSessionResponse> {
    const tableResponse = await request(app.getHttpServer())
      .post("/api/v1/tables")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ code: tableCode, displayName: tableCode })
      .expect(201);
    const table = dataOf<TableResponse>(tableResponse.body);
    const qrResponse = await request(app.getHttpServer()).post(`/api/v1/tables/${table.id}/qr-rotation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({}).expect(201);
    const qr = dataOf<QrResponse>(qrResponse.body);
    const scan = await request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken: qr.token }).expect(201);
    return dataOf<QrSessionResponse>(scan.body);
  }

  async function createCatalog(branchId: string, code: string, physicalQuantity: string, options: { withLargeOption?: boolean } = {}): Promise<CatalogSeed> {
    const unit = await prisma.unit.create({ data: { code: `${code}_g`, name: `${code} Gram`, symbol: "g", dimension: UnitDimension.MASS } });
    const ingredient = await prisma.ingredient.create({
      data: {
        code: `${code}_bean`,
        name: `${code} Bean`,
        baseUnitId: unit.id,
        ingredientUnits: { create: { unitId: unit.id, isDefault: true, isActive: true } }
      }
    });
    const category = await prisma.category.create({ data: { branchId, code: `${code}_cat`, name: `${code} Category` } });
    const product = await prisma.product.create({
      data: {
        branchId,
        categoryId: category.id,
        code: `${code}_drink`,
        name: `${code} Drink`,
        basePrice: new Prisma.Decimal("30000.00"),
        processingArea: ProcessingArea.BAR
      }
    });
    const recipe = await prisma.recipe.create({
      data: {
        productId: product.id,
        type: RecipeType.BASE,
        name: `${code} base`,
        items: { create: { ingredientId: ingredient.id, quantity: new Prisma.Decimal("1.000") } }
      }
    });
    const inventory = await prisma.inventory.create({
      data: {
        branchId,
        ingredientId: ingredient.id,
        physicalQuantity: new Prisma.Decimal(physicalQuantity)
      }
    });

    let largeProductOptionValueId: string | undefined;
    if (options.withLargeOption) {
      const optionGroup = await prisma.optionGroup.create({ data: { branchId, code: `${code}_size`, name: `${code} Size`, type: OptionGroupType.SIZE } });
      const largeValue = await prisma.optionValue.create({ data: { optionGroupId: optionGroup.id, code: `${code}_large`, name: "Large" } });
      const productOptionGroup = await prisma.productOptionGroup.create({
        data: { productId: product.id, optionGroupId: optionGroup.id, isRequired: false, minSelections: 0, maxSelections: 1 }
      });
      const productOptionValue = await prisma.productOptionValue.create({
        data: {
          productOptionGroupId: productOptionGroup.id,
          optionValueId: largeValue.id,
          priceDelta: new Prisma.Decimal("5000.00")
        }
      });
      await prisma.recipe.create({
        data: {
          productId: product.id,
          productOptionValueId: productOptionValue.id,
          type: RecipeType.SIZE,
          name: `${code} large delta`,
          items: { create: { ingredientId: ingredient.id, quantity: new Prisma.Decimal("1.000") } }
        }
      });
      largeProductOptionValueId = productOptionValue.id;
    }

    return { productId: product.id, recipeId: recipe.id, inventoryId: inventory.id, largeProductOptionValueId };
  }

  async function addItem(qrToken: string, body: CartItemRequest, cartToken?: string): Promise<CartResponse> {
    const call = request(app.getHttpServer()).post("/api/v1/cart/items").set("Authorization", `Bearer ${qrToken}`).send(body);
    if (cartToken) {
      call.set("X-Cart-Token", cartToken);
    }
    const response = await call.expect(201);
    return dataOf<CartResponse>(response.body);
  }

  async function updateItem(qrToken: string, itemId: string, body: Partial<CartItemRequest>): Promise<CartResponse> {
    const response = await request(app.getHttpServer()).patch(`/api/v1/cart/items/${itemId}`).set("Authorization", `Bearer ${qrToken}`).send(body).expect(200);
    return dataOf<CartResponse>(response.body);
  }

  async function deleteItem(qrToken: string, itemId: string): Promise<CartResponse> {
    const response = await request(app.getHttpServer()).delete(`/api/v1/cart/items/${itemId}`).set("Authorization", `Bearer ${qrToken}`).expect(200);
    return dataOf<CartResponse>(response.body);
  }

  async function getCart(qrToken: string, cartToken?: string): Promise<CartResponse> {
    const call = request(app.getHttpServer()).get("/api/v1/cart").set("Authorization", `Bearer ${qrToken}`);
    if (cartToken) {
      call.set("X-Cart-Token", cartToken);
    }
    const response = await call.expect(200);
    return dataOf<CartResponse>(response.body);
  }

  async function getActiveReservation(cartItemId: string): Promise<{ expiresAt: Date }> {
    return prisma.inventoryReservation.findFirstOrThrow({
      where: { cartItemId, status: ReservationStatus.ACTIVE },
      select: { expiresAt: true }
    });
  }

  async function setItemReservationExpiry(cartItemId: string, expiresAt: Date): Promise<void> {
    await prisma.$executeRaw`
      UPDATE inventory_reservations
      SET created_at = ${new Date(expiresAt.getTime() - 60_000)}, expires_at = ${expiresAt}, updated_at = now()
      WHERE cart_item_id = ${cartItemId}::uuid AND status = 'ACTIVE'::reservation_status
    `;
  }

  async function expectReservedQuantity(inventoryId: string, quantity: string): Promise<void> {
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(inventory.reservedQuantity.toFixed(3)).toBe(quantity);
    expect(inventory.reservedQuantity.lte(inventory.physicalQuantity)).toBe(true);
  }
});

interface ApiEnvelope<T> {
  data: T;
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

interface TableResponse {
  id: string;
}

interface QrResponse {
  token: string;
}

interface SessionResponse {
  id: string;
  status: SessionStatus;
}

interface QrSessionResponse {
  qrSessionToken: string;
  session: SessionResponse;
}

interface CatalogSeed {
  productId: string;
  recipeId: string;
  inventoryId: string;
  largeProductOptionValueId?: string;
}

interface CartItemRequest {
  productId: string;
  quantity: number;
  optionValueIds?: string[];
  note?: string;
  isTakeaway?: boolean;
}

interface CartResponse {
  id: string;
  token: string;
  branchId: string;
  tableSessionId: string;
  status: CartStatus;
  items: CartItemResponse[];
  subtotal: string;
}

interface CartItemResponse {
  id: string;
  quantity: number;
  note: string | null;
  reservationStatus: "ACTIVE" | "EXPIRED" | "RELEASED" | "UNAVAILABLE";
  reservationExpiresAt: string | null;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

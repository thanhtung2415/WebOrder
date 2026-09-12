import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  AccountStatus,
  CartStatus,
  InventoryTransactionType,
  OptionGroupType,
  OrderItemStatus,
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
import { OrdersService } from "../src/modules/orders/orders.service";
import { SetupService } from "../src/modules/setup/setup.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 8 order bar kitchen realtime", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
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
    ordersService = moduleRef.get(OrdersService);
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

  it("confirms a cart once, consumes active reservations, decrements inventory and replays the idempotent response", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "confirm", "4.000");
    const session = await createQrSession(setup.branchId, "P8-T01");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 2 });

    const first = await confirmOrder(session.qrSessionToken, cart.token, "confirm-once");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      productId: catalog.productId,
      productNameSnapshot: "confirm Drink",
      processingArea: ProcessingArea.BAR,
      quantity: 2,
      status: OrderItemStatus.NEW
    });

    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.inventoryReservation.count({ where: { cartItemId: cart.items[0].id, status: ReservationStatus.CONSUMED, orderItemId: first.items[0].id } })).resolves.toBe(1);
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: catalog.inventoryId } });
    expect(inventory.physicalQuantity.toFixed(3)).toBe("2.000");
    expect(inventory.reservedQuantity.toFixed(3)).toBe("0.000");
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: first.items[0].id, type: InventoryTransactionType.ORDER_CONSUMPTION } })).resolves.toBe(1);
    await expect(prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).resolves.toMatchObject({ status: CartStatus.ORDERED });

    const replay = await confirmOrder(session.qrSessionToken, cart.token, "confirm-once");
    expect(replay.id).toBe(first.id);
    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: first.items[0].id, type: InventoryTransactionType.ORDER_CONSUMPTION } })).resolves.toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${session.qrSessionToken}`)
      .set("X-Cart-Token", cart.token)
      .set("Idempotency-Key", "confirm-once")
      .send({ clientRequestId: "changed" })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "IDEMPOTENCY_KEY_REUSED"));
  });

  it("rejects expired and invalid reservations without partial order, inventory, ledger or realtime effects", async () => {
    const setup = await setupAdmin("admin-token");
    const expiredCatalog = await createCatalog(setup.branchId, "expired-order", "3.000");
    const invalidCatalog = await createCatalog(setup.branchId, "invalid-order", "3.000");
    const expiredSession = await createQrSession(setup.branchId, "P8-T02");
    const invalidSession = await createQrSession(setup.branchId, "P8-T03");

    const expiredCart = await addItem(expiredSession.qrSessionToken, { productId: expiredCatalog.productId, quantity: 1 });
    await setItemReservationExpiry(expiredCart.items[0].id, new Date(Date.now() - 30_000));
    await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${expiredSession.qrSessionToken}`)
      .set("X-Cart-Token", expiredCart.token)
      .set("Idempotency-Key", "expired-confirm")
      .send({})
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "RESERVATION_EXPIRED"));

    const invalidCart = await addItem(invalidSession.qrSessionToken, { productId: invalidCatalog.productId, quantity: 1 });
    await prisma.inventoryReservation.updateMany({ where: { cartItemId: invalidCart.items[0].id, status: ReservationStatus.ACTIVE }, data: { status: ReservationStatus.RELEASED, terminalAt: new Date() } });
    await request(app.getHttpServer())
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${invalidSession.qrSessionToken}`)
      .set("X-Cart-Token", invalidCart.token)
      .set("Idempotency-Key", "invalid-confirm")
      .send({})
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "ORDER_ALREADY_CONFIRMED"));

    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.inventoryTransaction.count()).resolves.toBe(0);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "ORDER_CREATED" } })).resolves.toBe(0);
    await expectInventory(expiredCatalog.inventoryId, "3.000", "1.000");
    await expectInventory(invalidCatalog.inventoryId, "3.000", "0.000");
  });

  it("preserves order snapshots after product and option changes", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "snapshot", "5.000", ProcessingArea.BAR, { withLargeOption: true });
    const session = await createQrSession(setup.branchId, "P8-T04");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1, optionValueIds: [catalog.largeProductOptionValueId!] });
    const order = await confirmOrder(session.qrSessionToken, cart.token, "snapshot-confirm");

    await prisma.product.update({ where: { id: catalog.productId }, data: { code: "CHANGED", name: "Changed Product", basePrice: new Prisma.Decimal("99999.00"), processingArea: ProcessingArea.KITCHEN } });
    await prisma.optionValue.update({ where: { id: catalog.largeOptionValueId! }, data: { name: "Changed Option" } });
    await prisma.productOptionValue.update({ where: { id: catalog.largeProductOptionValueId! }, data: { priceDelta: new Prisma.Decimal("7777.00") } });

    const loaded = await getOrder(session.qrSessionToken, order.id);
    expect(loaded.items[0]).toMatchObject({
      productCodeSnapshot: "snapshot_drink",
      productNameSnapshot: "snapshot Drink",
      processingArea: ProcessingArea.BAR,
      baseUnitPrice: "30000.00",
      optionUnitPrice: "5000.00",
      finalUnitPrice: "35000.00"
    });
    expect(loaded.items[0].options[0]).toMatchObject({ optionNameSnapshot: "Large", priceDeltaSnapshot: "5000.00" });
  });

  it("routes BAR and KITCHEN items into separate queues with urgency and rejects cross-area permissions", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("bar-token", setup.branchId, "BAR");
    const barCatalog = await createCatalog(setup.branchId, "bar", "5.000", ProcessingArea.BAR);
    const kitchenCatalog = await createCatalog(setup.branchId, "kitchen", "5.000", ProcessingArea.KITCHEN);
    const session = await createQrSession(setup.branchId, "P8-T05");
    const firstCart = await addItem(session.qrSessionToken, { productId: barCatalog.productId, quantity: 1 });
    await confirmOrder(session.qrSessionToken, firstCart.token, "bar-confirm");
    const secondCart = await addItem(session.qrSessionToken, { productId: kitchenCatalog.productId, quantity: 1 });
    await confirmOrder(session.qrSessionToken, secondCart.token, "kitchen-confirm");

    const barQueue = await staffGetQueue("admin-token", setup.branchId, "bar");
    const kitchenQueue = await staffGetQueue("admin-token", setup.branchId, "kitchen");
    expect(barQueue.items.map((item) => item.processingArea)).toEqual([ProcessingArea.BAR]);
    expect(kitchenQueue.items.map((item) => item.processingArea)).toEqual([ProcessingArea.KITCHEN]);
    expect(barQueue.items[0].urgency).toBe("GREEN");

    await request(app.getHttpServer()).get("/api/v1/kitchen/queue").set("Authorization", "Bearer bar-token").set("X-Branch-Id", setup.branchId).expect(403);
  });

  it("applies valid status transitions and rejects invalid transitions", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "transition", "5.000", ProcessingArea.BAR);
    const session = await createQrSession(setup.branchId, "P8-T06");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    let order = await confirmOrder(session.qrSessionToken, cart.token, "transition-confirm");
    const itemId = order.items[0].id;

    await request(app.getHttpServer()).patch(`/api/v1/order-items/${itemId}/status`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ status: OrderItemStatus.READY }).expect(409);
    order = await updateStatus(setup.branchId, itemId, OrderItemStatus.PREPARING);
    expect(order.items[0].status).toBe(OrderItemStatus.PREPARING);
    order = await updateStatus(setup.branchId, itemId, OrderItemStatus.READY);
    expect(order.items[0].status).toBe(OrderItemStatus.READY);
    order = await updateStatus(setup.branchId, itemId, OrderItemStatus.SERVED);
    expect(order.items[0].status).toBe(OrderItemStatus.SERVED);
    await request(app.getHttpServer()).patch(`/api/v1/order-items/${itemId}/status`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ status: OrderItemStatus.PREPARING }).expect(409);
  });

  it("cancels NEW with one RETURN and restores physical inventory", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "cancel-new", "5.000");
    const session = await createQrSession(setup.branchId, "P8-T07");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 2 });
    const order = await confirmOrder(session.qrSessionToken, cart.token, "cancel-new-confirm");

    const cancelled = await cancelItem(setup.branchId, order.items[0].id, "Customer changed mind");
    expect(cancelled.items[0].status).toBe(OrderItemStatus.CANCELLED);
    await expectInventory(catalog.inventoryId, "5.000", "0.000");
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: order.items[0].id, type: InventoryTransactionType.RETURN } })).resolves.toBe(1);
  });

  it("cancels PREPARING and READY with one WASTE and no physical restore", async () => {
    const setup = await setupAdmin("admin-token");
    const preparing = await confirmedItem(setup.branchId, "cancel-preparing", "P8-T08");
    await updateStatus(setup.branchId, preparing.itemId, OrderItemStatus.PREPARING);
    await cancelItem(setup.branchId, preparing.itemId, "Made already");
    await expectInventory(preparing.inventoryId, "4.000", "0.000");
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: preparing.itemId, type: InventoryTransactionType.WASTE } })).resolves.toBe(1);

    const ready = await confirmedItem(setup.branchId, "cancel-ready", "P8-T09");
    await updateStatus(setup.branchId, ready.itemId, OrderItemStatus.PREPARING);
    await updateStatus(setup.branchId, ready.itemId, OrderItemStatus.READY);
    await cancelItem(setup.branchId, ready.itemId, "No longer needed");
    await expectInventory(ready.inventoryId, "4.000", "0.000");
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: ready.itemId, type: InventoryTransactionType.WASTE } })).resolves.toBe(1);
  });

  it("prevents repeated concurrent cancellation from double applying effects and blocks customer cancellation", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P8-T10");
    const catalog = await createCatalog(setup.branchId, "cancel-race", "5.000");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const order = await confirmOrder(session.qrSessionToken, cart.token, "cancel-race-confirm");
    const itemId = order.items[0].id;

    await request(app.getHttpServer()).post(`/api/v1/order-items/${itemId}/cancellation`).set("Authorization", `Bearer ${session.qrSessionToken}`).send({ reason: "customer" }).expect(403);
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/order-items/${itemId}/cancellation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ reason: "first" }),
      request(app.getHttpServer()).post(`/api/v1/order-items/${itemId}/cancellation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ reason: "second" })
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(prisma.inventoryTransaction.count({ where: { orderItemId: itemId, type: InventoryTransactionType.RETURN } })).resolves.toBe(1);
    await expectInventory(catalog.inventoryId, "5.000", "0.000");
  });

  it("enforces session and branch isolation for order reads", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "scope-order", "5.000");
    const first = await createQrSession(setup.branchId, "P8-T11");
    const second = await createQrSession(setup.branchId, "P8-T12");
    const cart = await addItem(first.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const order = await confirmOrder(first.qrSessionToken, cart.token, "scope-confirm");
    const otherBranch = await prisma.branch.create({ data: { code: "P8-OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });

    await request(app.getHttpServer()).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${second.qrSessionToken}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/orders/${order.id}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).expect(403);
  });

  it("processes realtime outbox only after successful order commit", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "outbox", "5.000");
    const session = await createQrSession(setup.branchId, "P8-T13");
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    await confirmOrder(session.qrSessionToken, cart.token, "outbox-confirm");

    await expect(prisma.realtimeOutbox.count({ where: { eventType: "ORDER_CREATED", processedAt: null } })).resolves.toBe(1);
    await expect(ordersService.processOutbox(10)).resolves.toBeGreaterThan(0);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "ORDER_CREATED", processedAt: { not: null } } })).resolves.toBe(1);
  });

  it("allows only one customer to confirm the final stock and never violates reserved <= physical", async () => {
    const setup = await setupAdmin("admin-token");
    const catalog = await createCatalog(setup.branchId, "order-race", "1.000");
    const first = await createQrSession(setup.branchId, "P8-T14");
    const second = await createQrSession(setup.branchId, "P8-T15");
    const firstCart = await addItem(first.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    await request(app.getHttpServer()).post("/api/v1/cart/items").set("Authorization", `Bearer ${second.qrSessionToken}`).send({ productId: catalog.productId, quantity: 1 }).expect(422);

    const responses = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/orders").set("Authorization", `Bearer ${first.qrSessionToken}`).set("X-Cart-Token", firstCart.token).set("Idempotency-Key", "race-a").send({}),
      request(app.getHttpServer()).post("/api/v1/orders").set("Authorization", `Bearer ${first.qrSessionToken}`).set("X-Cart-Token", firstCart.token).set("Idempotency-Key", "race-b").send({})
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(prisma.order.count()).resolves.toBe(1);
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: catalog.inventoryId } });
    expect(inventory.reservedQuantity.lte(inventory.physicalQuantity)).toBe(true);
    expect(inventory.physicalQuantity.toFixed(3)).toBe("0.000");
    expect(inventory.reservedQuantity.toFixed(3)).toBe("0.000");
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

  async function createCatalog(
    branchId: string,
    code: string,
    physicalQuantity: string,
    area: ProcessingArea = ProcessingArea.BAR,
    options: { withLargeOption?: boolean } = {}
  ): Promise<CatalogSeed> {
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
        processingArea: area
      }
    });
    await prisma.recipe.create({
      data: {
        productId: product.id,
        type: RecipeType.BASE,
        name: `${code} base`,
        items: { create: { ingredientId: ingredient.id, quantity: new Prisma.Decimal("1.000") } }
      }
    });
    const inventory = await prisma.inventory.create({ data: { branchId, ingredientId: ingredient.id, physicalQuantity: new Prisma.Decimal(physicalQuantity) } });

    let largeProductOptionValueId: string | undefined;
    let largeOptionValueId: string | undefined;
    if (options.withLargeOption) {
      const optionGroup = await prisma.optionGroup.create({ data: { branchId, code: `${code}_size`, name: `${code} Size`, type: OptionGroupType.SIZE } });
      const optionValue = await prisma.optionValue.create({ data: { optionGroupId: optionGroup.id, code: `${code}_large`, name: "Large" } });
      const productOptionGroup = await prisma.productOptionGroup.create({ data: { productId: product.id, optionGroupId: optionGroup.id, isRequired: false, minSelections: 0, maxSelections: 1 } });
      const productOptionValue = await prisma.productOptionValue.create({ data: { productOptionGroupId: productOptionGroup.id, optionValueId: optionValue.id, priceDelta: new Prisma.Decimal("5000.00") } });
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
      largeOptionValueId = optionValue.id;
    }

    return { productId: product.id, inventoryId: inventory.id, largeProductOptionValueId, largeOptionValueId };
  }

  async function addItem(qrToken: string, body: CartItemRequest): Promise<CartResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/cart/items").set("Authorization", `Bearer ${qrToken}`).send(body).expect(201);
    return dataOf<CartResponse>(response.body);
  }

  async function confirmOrder(qrToken: string, cartToken: string, idempotencyKey: string): Promise<OrderResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/orders").set("Authorization", `Bearer ${qrToken}`).set("X-Cart-Token", cartToken).set("Idempotency-Key", idempotencyKey).send({}).expect(201);
    return dataOf<OrderResponse>(response.body);
  }

  async function getOrder(qrToken: string, orderId: string): Promise<OrderResponse> {
    const response = await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${qrToken}`).expect(200);
    return dataOf<OrderResponse>(response.body);
  }

  async function staffGetQueue(token: string, branchId: string, queue: "bar" | "kitchen"): Promise<QueueResponse> {
    const response = await request(app.getHttpServer()).get(`/api/v1/${queue}/queue`).set("Authorization", `Bearer ${token}`).set("X-Branch-Id", branchId).expect(200);
    return dataOf<QueueResponse>(response.body);
  }

  async function updateStatus(branchId: string, itemId: string, status: OrderItemStatus): Promise<OrderResponse> {
    const response = await request(app.getHttpServer()).patch(`/api/v1/order-items/${itemId}/status`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ status }).expect(200);
    return dataOf<OrderResponse>(response.body);
  }

  async function cancelItem(branchId: string, itemId: string, reason: string): Promise<OrderResponse> {
    const response = await request(app.getHttpServer()).post(`/api/v1/order-items/${itemId}/cancellation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ reason }).expect(201);
    return dataOf<OrderResponse>(response.body);
  }

  async function confirmedItem(branchId: string, code: string, tableCode: string): Promise<{ itemId: string; inventoryId: string }> {
    const catalog = await createCatalog(branchId, code, "5.000");
    const session = await createQrSession(branchId, tableCode);
    const cart = await addItem(session.qrSessionToken, { productId: catalog.productId, quantity: 1 });
    const order = await confirmOrder(session.qrSessionToken, cart.token, `${code}-confirm`);
    return { itemId: order.items[0].id, inventoryId: catalog.inventoryId };
  }

  async function setItemReservationExpiry(cartItemId: string, expiresAt: Date): Promise<void> {
    await prisma.$executeRaw`
      UPDATE inventory_reservations
      SET created_at = ${new Date(expiresAt.getTime() - 60_000)}, expires_at = ${expiresAt}, updated_at = now()
      WHERE cart_item_id = ${cartItemId}::uuid AND status = 'ACTIVE'::reservation_status
    `;
  }

  async function expectInventory(inventoryId: string, physical: string, reserved: string): Promise<void> {
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });
    expect(inventory.physicalQuantity.toFixed(3)).toBe(physical);
    expect(inventory.reservedQuantity.toFixed(3)).toBe(reserved);
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
  inventoryId: string;
  largeProductOptionValueId?: string;
  largeOptionValueId?: string;
}

interface CartItemRequest {
  productId: string;
  quantity: number;
  optionValueIds?: string[];
}

interface CartResponse {
  id: string;
  token: string;
  items: Array<{ id: string }>;
}

interface OrderResponse {
  id: string;
  items: OrderItemResponse[];
}

interface OrderItemResponse {
  id: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  processingArea: ProcessingArea;
  quantity: number;
  baseUnitPrice: string;
  optionUnitPrice: string;
  finalUnitPrice: string;
  status: OrderItemStatus;
  options: Array<{ optionNameSnapshot: string; priceDeltaSnapshot: string }>;
}

interface QueueResponse {
  items: Array<{ processingArea: ProcessingArea; urgency: "GREEN" | "ORANGE" | "RED" | "OVERDUE" }>;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

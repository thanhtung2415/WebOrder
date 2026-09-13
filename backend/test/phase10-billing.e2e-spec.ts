import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AccountStatus, BillStatus, OrderItemStatus, PaymentMethod, PaymentStatus, ProcessingArea } from "@prisma/client";
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

describe("Phase 10 billing", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let setupService: SetupService;
  let ordersService: OrdersService;
  const authByToken = new Map<string, AuthContext>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseJwtVerifierService)
      .useValue({
        verify: jest.fn((token: string) => {
          const auth = authByToken.get(token);
          if (!auth) {
            throw new Error("Invalid staff token");
          }
          return Promise.resolve(auth);
        })
      })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    prisma = moduleRef.get(PrismaService);
    setupService = moduleRef.get(SetupService);
    ordersService = moduleRef.get(OrdersService);
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

  it("creates a draft bill from unbilled order item quantities and rejects over-allocation", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [2]);

    const bill = await createBill(setup.branchId, fixture.sessionId);
    expect(bill.status).toBe(BillStatus.DRAFT);
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0].quantity).toBe(2);
    expect(bill.total).toBe("54000.00");

    await request(app.getHttpServer())
      .post("/api/v1/bills")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ tableSessionId: fixture.sessionId, items: [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }] })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "BILL_ALLOCATION_EXCEEDED"));
  });

  it("keeps allocation concurrency-safe when two cashiers race for final stock", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1]);

    const attempts = await Promise.allSettled([
      request(app.getHttpServer()).post("/api/v1/bills").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ tableSessionId: fixture.sessionId }),
      request(app.getHttpServer()).post("/api/v1/bills").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ tableSessionId: fixture.sessionId })
    ]);
    const statuses = attempts.map((attempt) => (attempt.status === "fulfilled" ? attempt.value.status : 500)).sort();
    expect(statuses).toEqual([201, 400]);
    await expect(totalAllocated(fixture.orderItemIds[0])).resolves.toBe(1);
  });

  it("splits a bill without duplicate or lost allocations", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [3]);
    const source = await createBill(setup.branchId, fixture.sessionId);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/bills/${source.id}/splits`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({
        parts: [
          { items: [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }] },
          { items: [{ orderItemId: fixture.orderItemIds[0], quantity: 2 }] }
        ]
      })
      .expect(201);

    const split = dataOf<{ sourceBill: BillResponse; bills: BillResponse[] }>(response.body);
    expect(split.sourceBill.items).toHaveLength(0);
    expect(split.bills.map((bill) => Number(bill.total)).sort((a, b) => a - b)).toEqual([27000, 54000]);
    await expect(totalAllocated(fixture.orderItemIds[0])).resolves.toBe(3);

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${split.bills[0].id}/splits`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ parts: [{ items: [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }] }, { items: [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }] }] })
      .expect(400)
      .expect((res) => expectErrorCode(res.body, "INVALID_SPLIT"));
  });

  it("merges unpaid bills in the same session and preserves source history", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1, 1]);
    const first = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }]);
    const second = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[1], quantity: 1 }]);

    const merged = await mergeBills(setup.branchId, second.id, [first.id], randomUUID());
    expect(merged.id).toBe(second.id);
    expect(merged.items).toHaveLength(2);
    expect(merged.total).toBe("54000.00");

    const source = await prisma.bill.findUniqueOrThrow({ where: { id: first.id } });
    expect(source.status).toBe(BillStatus.MERGED);
    expect(source.mergedIntoBillId).toBe(second.id);

    const other = await createBillableSession(setup.branchId, [1]);
    const otherBill = await createBill(setup.branchId, other.sessionId);
    await request(app.getHttpServer())
      .post("/api/v1/bills/merges")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ sourceBillIds: [otherBill.id], targetBillId: second.id, reason: "different session" })
      .expect(409)
      .expect((res) => expectErrorCode(res.body, "BILL_MERGE_SESSION_MISMATCH"));
  });

  it("replays concurrent idempotent merge without duplicate allocation", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1, 1]);
    const first = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }]);
    const second = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[1], quantity: 1 }]);
    const key = randomUUID();

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/bills/merges").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", key).send({ sourceBillIds: [first.id], targetBillId: second.id, reason: "combine" }),
      request(app.getHttpServer()).post("/api/v1/bills/merges").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", key).send({ sourceBillIds: [first.id], targetBillId: second.id, reason: "combine" })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    await expect(totalAllocated(fixture.orderItemIds[0])).resolves.toBe(1);
    await expect(prisma.billItem.count({ where: { billId: second.id, orderItemId: fixture.orderItemIds[0] } })).resolves.toBe(1);
  });

  it("voids unpaid bills, leaves orders untouched, and releases allocation for rebilling", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1]);
    const bill = await createBill(setup.branchId, fixture.sessionId);

    const voided = await voidBill(setup.branchId, bill.id, randomUUID());
    expect(voided.status).toBe(BillStatus.VOID);
    await expect(prisma.orderItem.findUniqueOrThrow({ where: { id: fixture.orderItemIds[0] } })).resolves.toMatchObject({ status: OrderItemStatus.NEW });
    await expect(totalAllocated(fixture.orderItemIds[0])).resolves.toBe(0);

    const rebill = await createBill(setup.branchId, fixture.sessionId);
    expect(rebill.items[0].quantity).toBe(1);
  });

  it("keeps repeated concurrent void safe", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1]);
    const bill = await createBill(setup.branchId, fixture.sessionId);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/bills/${bill.id}/voidance`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", randomUUID()).send({ reason: "mistake" }),
      request(app.getHttpServer()).post(`/api/v1/bills/${bill.id}/voidance`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", randomUUID()).send({ reason: "mistake" })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    await expect(totalAllocated(fixture.orderItemIds[0])).resolves.toBe(0);
  });

  it("rejects paid bills, active payments, cross-branch access and unauthorized staff", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("bar-token", setup.branchId, "BAR");
    const fixture = await createBillableSession(setup.branchId, [1]);
    const bill = await createBill(setup.branchId, fixture.sessionId);

    await request(app.getHttpServer()).get(`/api/v1/bills/${bill.id}`).set("Authorization", "Bearer bar-token").set("X-Branch-Id", setup.branchId).expect(403);

    const issued = await request(app.getHttpServer()).post(`/api/v1/bills/${bill.id}/issuance`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(200);
    expect(dataOf<BillResponse>(issued.body).status).toBe(BillStatus.ISSUED);
    await prisma.payment.create({
      data: {
        branchId: setup.branchId,
        billId: bill.id,
        method: PaymentMethod.CASH,
        amount: bill.total,
        status: PaymentStatus.PENDING,
        idempotencyKey: randomUUID(),
        initiatedById: setup.adminUserId
      }
    });

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${bill.id}/voidance`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "payment active" })
      .expect(409)
      .expect((res) => expectErrorCode(res.body, "BILL_HAS_ACTIVE_PAYMENT"));

    const paid = await createBillableSession(setup.branchId, [1]);
    const paidBill = await createBill(setup.branchId, paid.sessionId);
    await request(app.getHttpServer()).post(`/api/v1/bills/${paidBill.id}/issuance`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(200);
    await prisma.payment.create({
      data: {
        branchId: setup.branchId,
        billId: paidBill.id,
        method: PaymentMethod.CASH,
        amount: paidBill.total,
        status: PaymentStatus.SUCCEEDED,
        idempotencyKey: randomUUID(),
        initiatedById: setup.adminUserId,
        confirmedById: setup.adminUserId,
        confirmedAt: new Date()
      }
    });
    await prisma.bill.update({ where: { id: paidBill.id }, data: { status: BillStatus.PAID, paidAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${paidBill.id}/voidance`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "paid" })
      .expect(409)
      .expect((res) => expectErrorCode(res.body, "BILL_ALREADY_PAID"));

    const otherBranch = await prisma.branch.create({ data: { code: "P10-OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });
    await request(app.getHttpServer()).get(`/api/v1/bills/${paidBill.id}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).expect(403);
  });

  it("writes realtime outbox after commit and rolls back failed billing events", async () => {
    const setup = await setupAdmin("admin-token");
    const fixture = await createBillableSession(setup.branchId, [1, 1]);
    const first = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[0], quantity: 1 }]);
    const second = await createBill(setup.branchId, fixture.sessionId, [{ orderItemId: fixture.orderItemIds[1], quantity: 1 }]);
    const before = await prisma.realtimeOutbox.count({ where: { eventType: "BILL_MERGED" } });

    await request(app.getHttpServer())
      .post("/api/v1/bills/merges")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ sourceBillIds: [first.id], targetBillId: first.id, reason: "bad" })
      .expect(400);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "BILL_MERGED" } })).resolves.toBe(before);

    await mergeBills(setup.branchId, first.id, [second.id], randomUUID());
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "BILL_MERGED", processedAt: null } })).resolves.toBe(1);
    await expect(ordersService.processOutbox(20)).resolves.toBeGreaterThan(0);
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

  async function createBillableSession(branchId: string, quantities: number[]): Promise<{ sessionId: string; orderItemIds: string[] }> {
    const suffix = randomUUID().slice(0, 8);
    const table = await prisma.diningTable.create({ data: { branchId, code: `P10-${suffix}`, displayName: `P10 ${suffix}` } });
    const session = await prisma.tableSession.create({ data: { branchId, tableId: table.id, sessionNumber: `P10-${suffix}` } });
    const category = await prisma.category.create({ data: { branchId, code: `CAT-${suffix}`, name: "Coffee" } });
    const product = await prisma.product.create({
      data: {
        branchId,
        categoryId: category.id,
        code: `PROD-${suffix}`,
        name: "Latte",
        basePrice: "25000",
        processingArea: ProcessingArea.BAR
      }
    });
    const order = await prisma.order.create({
      data: {
        branchId,
        tableSessionId: session.id,
        orderNumber: `ORD-${suffix}`,
        items: {
          create: quantities.map((quantity, index) => ({
            productId: product.id,
            productCodeSnapshot: `${product.code}-${index}`,
            productNameSnapshot: `Latte ${index + 1}`,
            processingArea: ProcessingArea.BAR,
            quantity,
            baseUnitPrice: "25000",
            finalUnitPrice: "25000",
            lineSubtotal: String(quantity * 25000)
          }))
        }
      },
      include: { items: true }
    });
    return { sessionId: session.id, orderItemIds: order.items.map((item) => item.id) };
  }

  async function createBill(branchId: string, tableSessionId: string, items?: Array<{ orderItemId: string; quantity: number }>): Promise<BillResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/bills").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ tableSessionId, ...(items ? { items } : {}) });
    expect(response.status).toBe(201);
    return dataOf<BillResponse>(response.body);
  }

  async function mergeBills(branchId: string, targetBillId: string, sourceBillIds: string[], key: string): Promise<BillResponse> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/bills/merges")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .set("Idempotency-Key", key)
      .send({ sourceBillIds, targetBillId, reason: "combine" })
      .expect(200);
    return dataOf<BillResponse>(response.body);
  }

  async function voidBill(branchId: string, billId: string, key: string): Promise<BillResponse> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/bills/${billId}/voidance`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .set("Idempotency-Key", key)
      .send({ reason: "mistake" })
      .expect(200);
    return dataOf<BillResponse>(response.body);
  }

  async function totalAllocated(orderItemId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(sum(bi.quantity), 0) AS total
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id AND b.status NOT IN ('VOID', 'MERGED')
      WHERE bi.order_item_id = ${orderItemId}::uuid
    `;
    return Number(rows[0]?.total ?? 0);
  }
});

interface ApiEnvelope<T> {
  data: T;
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

interface BillResponse {
  id: string;
  status: BillStatus;
  total: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

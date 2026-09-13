import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AccountStatus, AuditAction, BillAdjustmentSource, BillAdjustmentStatus, BillStatus, DiscountType, PaymentMethod, PaymentStatus, ProcessingArea, VoucherStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { SetupService } from "../src/modules/setup/setup.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 11 voucher discount VAT", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let setupService: SetupService;
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

  it("manages vouchers and calculates percent and fixed voucher totals with VAT", async () => {
    const setup = await setupAdmin("admin-token");
    const percentVoucher = await createVoucher(setup.branchId, { code: "PCT10", discountType: DiscountType.PERCENT, discountValue: 10, maximumDiscount: 4000 });
    expect(percentVoucher.code).toBe("PCT10");

    const list = await request(app.getHttpServer()).get("/api/v1/vouchers").set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).expect(200);
    expect(dataOf<{ items: VoucherResponse[] }>(list.body).items).toHaveLength(1);

    const updated = await request(app.getHttpServer()).patch(`/api/v1/vouchers/${percentVoucher.id}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ name: "Percent cap" }).expect(200);
    expect(dataOf<VoucherResponse>(updated.body).name).toBe("Percent cap");

    const percentBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    const percentApplied = await applyVoucher(setup.branchId, percentBill.id, "PCT10");
    expect(percentApplied.voucherDiscountAmount).toBe("4000.00");
    expect(percentApplied.discountedAmount).toBe("46000.00");
    expect(percentApplied.vatAmount).toBe("3680.00");
    expect(percentApplied.total).toBe("49680.00");

    await createVoucher(setup.branchId, { code: "FIX10K", discountType: DiscountType.FIXED_AMOUNT, discountValue: 10000 });
    const fixedBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    const fixedApplied = await applyVoucher(setup.branchId, fixedBill.id, "FIX10K");
    expect(fixedApplied.voucherDiscountAmount).toBe("10000.00");
    expect(fixedApplied.discountedAmount).toBe("40000.00");
    expect(fixedApplied.vatAmount).toBe("3200.00");
    expect(fixedApplied.total).toBe("43200.00");
  });

  it("validates voucher minimum subtotal, date range, disabled status and usage limit concurrency", async () => {
    const setup = await setupAdmin("admin-token");
    const now = Date.now();
    await createVoucher(setup.branchId, { code: "MIN", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, minimumSubtotal: 100000 });
    await createVoucher(setup.branchId, { code: "FUTURE", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, startsAt: new Date(now + 86_400_000).toISOString() });
    await createVoucher(setup.branchId, { code: "OLD", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, startsAt: new Date(now - 172_800_000).toISOString(), endsAt: new Date(now - 86_400_000).toISOString() });
    await createVoucher(setup.branchId, { code: "OFF", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, status: VoucherStatus.INACTIVE });

    for (const [code, expected] of [
      ["MIN", "VOUCHER_MINIMUM_SUBTOTAL_NOT_MET"],
      ["FUTURE", "VOUCHER_NOT_STARTED"],
      ["OLD", "VOUCHER_EXPIRED"],
      ["OFF", "VOUCHER_INACTIVE"]
    ] as const) {
      const bill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1]));
      await request(app.getHttpServer())
        .post(`/api/v1/bills/${bill.id}/voucher-applications`)
        .set("Authorization", "Bearer admin-token")
        .set("X-Branch-Id", setup.branchId)
        .set("Idempotency-Key", randomUUID())
        .send({ voucherCode: code })
        .expect(409)
        .expect((response) => expectErrorCode(response.body, expected));
    }

    await createVoucher(setup.branchId, { code: "ONLY1", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, usageLimit: 1 });
    const first = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1]));
    const second = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1]));
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/bills/${first.id}/voucher-applications`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", randomUUID()).send({ voucherCode: "ONLY1" }),
      request(app.getHttpServer()).post(`/api/v1/bills/${second.id}/voucher-applications`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).set("Idempotency-Key", randomUUID()).send({ voucherCode: "ONLY1" })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    await expect(prisma.billAdjustment.count({ where: { codeSnapshot: "ONLY1", status: BillAdjustmentStatus.ACTIVE } })).resolves.toBe(1);
  });

  it("applies direct fixed and percent discounts and never lets discounts make totals negative", async () => {
    const setup = await setupAdmin("admin-token");
    const fixedBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    const fixed = await applyDirectDiscount(setup.branchId, fixedBill.id, DiscountType.FIXED_AMOUNT, 10000, "service recovery");
    expect(fixed.directDiscountAmount).toBe("10000.00");
    expect(fixed.discountedAmount).toBe("40000.00");
    expect(fixed.vatAmount).toBe("3200.00");
    expect(fixed.total).toBe("43200.00");

    const percentBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    const percent = await applyDirectDiscount(setup.branchId, percentBill.id, DiscountType.PERCENT, 10, "member discount");
    expect(percent.directDiscountAmount).toBe("5000.00");
    expect(percent.total).toBe("48600.00");

    const cappedBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1]));
    const capped = await applyDirectDiscount(setup.branchId, cappedBill.id, DiscountType.FIXED_AMOUNT, 999999, "full comp");
    expect(capped.directDiscountAmount).toBe("25000.00");
    expect(capped.discountedAmount).toBe("0.00");
    expect(capped.vatAmount).toBe("0.00");
    expect(capped.total).toBe("0.00");

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${cappedBill.id}/direct-discounts`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, total: "1.00", vatAmount: "1.00", reason: "tamper" })
      .expect(400);
  });

  it("requires DISCOUNT_OVERRIDE for voucher plus direct discount and stores override metadata", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("cashier-token", setup.branchId, "CASHIER");
    await createVoucher(setup.branchId, { code: "STACK", discountType: DiscountType.PERCENT, discountValue: 10 });
    const bill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    await applyVoucher(setup.branchId, bill.id, "STACK");

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${bill.id}/direct-discounts`)
      .set("Authorization", "Bearer cashier-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ discountType: DiscountType.FIXED_AMOUNT, discountValue: 5000, reason: "manager approved later" })
      .expect(403);

    const overridden = await request(app.getHttpServer())
      .post(`/api/v1/bills/${bill.id}/direct-discounts`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ discountType: DiscountType.FIXED_AMOUNT, discountValue: 5000, reason: "service recovery", overrideReason: "manager approved stack" })
      .expect(200);
    const result = dataOf<BillResponse>(overridden.body);
    expect(result.voucherDiscountAmount).toBe("5000.00");
    expect(result.directDiscountAmount).toBe("5000.00");
    expect(result.total).toBe("43200.00");

    const adjustment = await prisma.billAdjustment.findFirstOrThrow({ where: { billId: bill.id, source: BillAdjustmentSource.DIRECT_DISCOUNT, status: BillAdjustmentStatus.ACTIVE } });
    expect(adjustment.isOverride).toBe(true);
    expect(adjustment.overrideById).toBe(setup.adminUserId);
    expect(adjustment.overrideReason).toBe("manager approved stack");
    expect(adjustment.overrideBefore).toBeTruthy();
    expect(adjustment.overrideAfter).toBeTruthy();
    await expect(prisma.auditLog.count({ where: { action: AuditAction.DISCOUNT_OVERRIDE, entityId: bill.id } })).resolves.toBe(1);
  });

  it("reverses adjustments, recalculates bills and keeps history traceable", async () => {
    const setup = await setupAdmin("admin-token");
    await createVoucher(setup.branchId, { code: "UNDO", discountType: DiscountType.FIXED_AMOUNT, discountValue: 10000 });
    const bill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [2]));
    const discounted = await applyVoucher(setup.branchId, bill.id, "UNDO");
    expect(discounted.total).toBe("43200.00");
    const adjustmentId = discounted.adjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.VOUCHER)?.id;
    expect(adjustmentId).toBeDefined();

    const reversed = await request(app.getHttpServer())
      .post(`/api/v1/bill-adjustments/${adjustmentId}/reversal`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "customer changed mind" })
      .expect(200);
    const result = dataOf<BillResponse>(reversed.body);
    expect(result.voucherDiscountAmount).toBe("0.00");
    expect(result.vatAmount).toBe("4000.00");
    expect(result.total).toBe("54000.00");
    await expect(prisma.billAdjustment.count({ where: { billId: bill.id } })).resolves.toBe(1);
    await expect(prisma.billAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } })).resolves.toMatchObject({ status: BillAdjustmentStatus.REVERSED, reverseReason: "customer changed mind" });
  });

  it("rounds VAT to one VND and blocks paid bills from discount mutation", async () => {
    const setup = await setupAdmin("admin-token");
    const tinyBill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1], 13));
    expect(tinyBill.subtotal).toBe("13.00");
    expect(tinyBill.vatAmount).toBe("1.00");
    expect(tinyBill.total).toBe("14.00");

    await createVoucher(setup.branchId, { code: "PAID", discountType: DiscountType.FIXED_AMOUNT, discountValue: 1 });
    await request(app.getHttpServer()).post(`/api/v1/bills/${tinyBill.id}/issuance`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(200);
    await prisma.payment.create({
      data: {
        branchId: setup.branchId,
        billId: tinyBill.id,
        method: PaymentMethod.CASH,
        amount: tinyBill.total,
        status: PaymentStatus.SUCCEEDED,
        idempotencyKey: randomUUID(),
        initiatedById: setup.adminUserId,
        confirmedById: setup.adminUserId,
        confirmedAt: new Date()
      }
    });
    await prisma.bill.update({ where: { id: tinyBill.id }, data: { status: BillStatus.PAID, paidAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/v1/bills/${tinyBill.id}/voucher-applications`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ voucherCode: "PAID" })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "BILL_ALREADY_PAID"));
  });

  it("reverses source discounts on merge and emits audit/outbox only after successful transaction", async () => {
    const setup = await setupAdmin("admin-token");
    await createVoucher(setup.branchId, { code: "MERGE", discountType: DiscountType.FIXED_AMOUNT, discountValue: 10000 });
    const sessionId = await createBillableSession(setup.branchId, [2, 2]);
    const source = await createBill(setup.branchId, sessionId, [{ orderItemId: (await orderItemsForSession(sessionId))[0], quantity: 2 }]);
    const target = await createBill(setup.branchId, sessionId, [{ orderItemId: (await orderItemsForSession(sessionId))[1], quantity: 2 }]);
    const discountedSource = await applyVoucher(setup.branchId, source.id, "MERGE");
    expect(discountedSource.total).toBe("43200.00");
    const beforeOutbox = await prisma.realtimeOutbox.count({ where: { eventType: "BILL_UPDATED" } });

    await request(app.getHttpServer())
      .post("/api/v1/bills/merges")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ sourceBillIds: [source.id], targetBillId: source.id, reason: "bad merge" })
      .expect(400);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "BILL_UPDATED" } })).resolves.toBe(beforeOutbox);

    const merged = await mergeBills(setup.branchId, target.id, [source.id]);
    expect(merged.subtotal).toBe("100000.00");
    expect(merged.voucherDiscountAmount).toBe("0.00");
    expect(merged.total).toBe("108000.00");
    await expect(prisma.billAdjustment.findFirstOrThrow({ where: { billId: source.id, source: BillAdjustmentSource.VOUCHER } })).resolves.toMatchObject({ status: BillAdjustmentStatus.REVERSED });
    await expect(prisma.auditLog.count({ where: { action: AuditAction.MERGE_BILL, entityId: target.id } })).resolves.toBe(1);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "BILL_MERGED", aggregateId: target.id } })).resolves.toBe(1);
  });

  it("rejects cross-branch and unauthorized voucher/discount access", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("bar-token", setup.branchId, "BAR");
    const bill = await createBill(setup.branchId, await createBillableSession(setup.branchId, [1]));

    await request(app.getHttpServer()).get("/api/v1/vouchers").set("Authorization", "Bearer bar-token").set("X-Branch-Id", setup.branchId).expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/bills/${bill.id}/direct-discounts`)
      .set("Authorization", "Bearer bar-token")
      .set("X-Branch-Id", setup.branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ discountType: DiscountType.FIXED_AMOUNT, discountValue: 1000, reason: "no permission" })
      .expect(403);

    const otherBranch = await prisma.branch.create({ data: { code: "P11-OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });
    await request(app.getHttpServer()).get("/api/v1/vouchers").set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).expect(403);
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

  async function createVoucher(branchId: string, overrides: Partial<CreateVoucherRequest> = {}): Promise<VoucherResponse> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/vouchers")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({
        code: overrides.code ?? `VOUCHER-${randomUUID().slice(0, 6)}`,
        name: overrides.name ?? "Voucher",
        discountType: overrides.discountType ?? DiscountType.FIXED_AMOUNT,
        discountValue: overrides.discountValue ?? 1000,
        minimumSubtotal: overrides.minimumSubtotal ?? 0,
        maximumDiscount: overrides.maximumDiscount,
        usageLimit: overrides.usageLimit,
        startsAt: overrides.startsAt ?? new Date(Date.now() - 60_000).toISOString(),
        endsAt: overrides.endsAt,
        status: overrides.status ?? VoucherStatus.ACTIVE
      })
      .expect(201);
    return dataOf<VoucherResponse>(response.body);
  }

  async function createBillableSession(branchId: string, quantities: number[], unitPrice = 25000): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const table = await prisma.diningTable.create({ data: { branchId, code: `P11-${suffix}`, displayName: `P11 ${suffix}` } });
    const session = await prisma.tableSession.create({ data: { branchId, tableId: table.id, sessionNumber: `P11-${suffix}` } });
    const category = await prisma.category.create({ data: { branchId, code: `CAT-${suffix}`, name: "Coffee" } });
    const product = await prisma.product.create({
      data: {
        branchId,
        categoryId: category.id,
        code: `PROD-${suffix}`,
        name: "Latte",
        basePrice: String(unitPrice),
        processingArea: ProcessingArea.BAR
      }
    });
    await prisma.order.create({
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
            baseUnitPrice: String(unitPrice),
            finalUnitPrice: String(unitPrice),
            lineSubtotal: String(quantity * unitPrice)
          }))
        }
      }
    });
    return session.id;
  }

  async function orderItemsForSession(tableSessionId: string): Promise<string[]> {
    const rows = await prisma.orderItem.findMany({ where: { order: { tableSessionId } }, orderBy: { id: "asc" } });
    return rows.map((row) => row.id);
  }

  async function createBill(branchId: string, tableSessionId: string, items?: Array<{ orderItemId: string; quantity: number }>): Promise<BillResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/bills").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ tableSessionId, ...(items ? { items } : {}) }).expect(201);
    return dataOf<BillResponse>(response.body);
  }

  async function applyVoucher(branchId: string, billId: string, voucherCode: string): Promise<BillResponse> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/bills/${billId}/voucher-applications`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ voucherCode })
      .expect(200);
    return dataOf<BillResponse>(response.body);
  }

  async function applyDirectDiscount(branchId: string, billId: string, discountType: DiscountType, discountValue: number, reason: string): Promise<BillResponse> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/bills/${billId}/direct-discounts`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ discountType, discountValue, reason })
      .expect(200);
    return dataOf<BillResponse>(response.body);
  }

  async function mergeBills(branchId: string, targetBillId: string, sourceBillIds: string[]): Promise<BillResponse> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/bills/merges")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .set("Idempotency-Key", randomUUID())
      .send({ sourceBillIds, targetBillId, reason: "combine discounted bills" })
      .expect(200);
    return dataOf<BillResponse>(response.body);
  }
});

interface ApiEnvelope<T> {
  data: T;
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

interface CreateVoucherRequest {
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  maximumDiscount: number;
  minimumSubtotal: number;
  usageLimit: number;
  startsAt: string;
  endsAt: string;
  status: VoucherStatus;
}

interface VoucherResponse {
  id: string;
  code: string;
  name: string;
}

interface BillResponse {
  id: string;
  status: BillStatus;
  subtotal: string;
  voucherDiscountAmount: string;
  directDiscountAmount: string;
  discountedAmount: string;
  vatAmount: string;
  total: string;
  adjustments: Array<{ id: string; source: BillAdjustmentSource; status: BillAdjustmentStatus }>;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

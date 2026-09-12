import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AccountStatus, ServiceRequestStatus, ServiceRequestType, SessionStatus } from "@prisma/client";
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

describe("Phase 9 service requests", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
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

  it("lets a customer create CALL_STAFF and REQUEST_PAYMENT for their own active session", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P9-T01");

    const callStaff = await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF, session.session.id);
    expect(callStaff).toMatchObject({
      branchId: setup.branchId,
      tableSessionId: session.session.id,
      type: ServiceRequestType.CALL_STAFF,
      status: ServiceRequestStatus.PENDING,
      handledById: null
    });

    const payment = await createServiceRequest(session.qrSessionToken, ServiceRequestType.REQUEST_PAYMENT, session.session.id);
    expect(payment.type).toBe(ServiceRequestType.REQUEST_PAYMENT);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "PAYMENT_REQUESTED" } })).resolves.toBe(1);
  });

  it("prevents customers from creating requests for another or closed session", async () => {
    const setup = await setupAdmin("admin-token");
    const first = await createQrSession(setup.branchId, "P9-T02");
    const second = await createQrSession(setup.branchId, "P9-T03");

    await request(app.getHttpServer())
      .post("/api/v1/service-requests")
      .set("Authorization", `Bearer ${first.qrSessionToken}`)
      .send({ type: ServiceRequestType.CALL_STAFF, tableSessionId: second.session.id })
      .expect(403);

    await prisma.tableSession.update({
      where: { id: first.session.id },
      data: { status: SessionStatus.CLOSED, closedAt: new Date(), closedById: setup.adminUserId }
    });
    await request(app.getHttpServer())
      .post("/api/v1/service-requests")
      .set("Authorization", `Bearer ${first.qrSessionToken}`)
      .send({ type: ServiceRequestType.CALL_STAFF })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "SESSION_CLOSED"));
  });

  it("applies per-session and per-type cooldown without Redis", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P9-T04");
    await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF);

    await request(app.getHttpServer())
      .post("/api/v1/service-requests")
      .set("Authorization", `Bearer ${session.qrSessionToken}`)
      .send({ type: ServiceRequestType.CALL_STAFF })
      .expect(429)
      .expect((response) => expectErrorCode(response.body, "RATE_LIMITED"));

    await request(app.getHttpServer())
      .post("/api/v1/service-requests")
      .set("Authorization", `Bearer ${session.qrSessionToken}`)
      .send({ type: ServiceRequestType.REQUEST_PAYMENT })
      .expect(201);
  });

  it("shows only branch-scoped queue items to staff with read permission", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P9-T05");
    const requestForBranch = await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF);
    await createRequestInOtherBranch();

    const queue = await listServiceRequests("admin-token", setup.branchId);
    expect(queue.items.map((item) => item.id)).toEqual([requestForBranch.id]);
  });

  it("rejects unauthorized staff and accepts valid acknowledge and resolve transitions", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("bar-token", setup.branchId, "BAR");
    const session = await createQrSession(setup.branchId, "P9-T06");
    const serviceRequest = await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF);

    await request(app.getHttpServer())
      .patch(`/api/v1/service-requests/${serviceRequest.id}/status`)
      .set("Authorization", "Bearer bar-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: ServiceRequestStatus.ACKNOWLEDGED })
      .expect(403);

    const acknowledged = await updateRequestStatus(setup.branchId, serviceRequest.id, ServiceRequestStatus.ACKNOWLEDGED);
    expect(acknowledged.status).toBe(ServiceRequestStatus.ACKNOWLEDGED);
    expect(acknowledged.handledById).toBe(setup.adminUserId);
    expect(acknowledged.acknowledgedAt).not.toBeNull();

    const resolved = await updateRequestStatus(setup.branchId, serviceRequest.id, ServiceRequestStatus.RESOLVED);
    expect(resolved.status).toBe(ServiceRequestStatus.RESOLVED);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("rejects invalid and repeated transitions without emitting rollback events", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P9-T07");
    const serviceRequest = await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF);

    await request(app.getHttpServer())
      .patch(`/api/v1/service-requests/${serviceRequest.id}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: ServiceRequestStatus.RESOLVED })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "INVALID_STATUS_TRANSITION"));
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "SERVICE_REQUEST_UPDATED" } })).resolves.toBe(0);

    await updateRequestStatus(setup.branchId, serviceRequest.id, ServiceRequestStatus.ACKNOWLEDGED);
    await request(app.getHttpServer())
      .patch(`/api/v1/service-requests/${serviceRequest.id}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: ServiceRequestStatus.ACKNOWLEDGED })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "INVALID_STATUS_TRANSITION"));
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "SERVICE_REQUEST_UPDATED" } })).resolves.toBe(1);
  });

  it("emits service request realtime outbox after commit and the existing worker processes it", async () => {
    const setup = await setupAdmin("admin-token");
    const session = await createQrSession(setup.branchId, "P9-T08");
    await createServiceRequest(session.qrSessionToken, ServiceRequestType.CALL_STAFF);

    await expect(prisma.realtimeOutbox.count({ where: { eventType: "SERVICE_REQUEST_CREATED", processedAt: null } })).resolves.toBe(1);
    await expect(ordersService.processOutbox(10)).resolves.toBeGreaterThan(0);
    await expect(prisma.realtimeOutbox.count({ where: { eventType: "SERVICE_REQUEST_CREATED", processedAt: { not: null } } })).resolves.toBe(1);
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

  async function createServiceRequest(qrToken: string, type: ServiceRequestType, tableSessionId?: string): Promise<ServiceRequestResponse> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/service-requests")
      .set("Authorization", `Bearer ${qrToken}`)
      .send({ type, ...(tableSessionId ? { tableSessionId } : {}) })
      .expect(201);
    return dataOf<ServiceRequestResponse>(response.body);
  }

  async function listServiceRequests(token: string, branchId: string): Promise<ServiceRequestListResponse> {
    const response = await request(app.getHttpServer()).get("/api/v1/service-requests").set("Authorization", `Bearer ${token}`).set("X-Branch-Id", branchId).expect(200);
    return dataOf<ServiceRequestListResponse>(response.body);
  }

  async function updateRequestStatus(branchId: string, serviceRequestId: string, status: ServiceRequestStatus): Promise<ServiceRequestResponse> {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/service-requests/${serviceRequestId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ status })
      .expect(200);
    return dataOf<ServiceRequestResponse>(response.body);
  }

  async function createRequestInOtherBranch(): Promise<void> {
    const branch = await prisma.branch.create({ data: { code: "P9-OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });
    const table = await prisma.diningTable.create({ data: { branchId: branch.id, code: "P9-OTHER-T01", displayName: "Other T01" } });
    const session = await prisma.tableSession.create({
      data: {
        branchId: branch.id,
        tableId: table.id,
        sessionNumber: `P9-${Date.now()}`
      }
    });
    await prisma.serviceRequest.create({
      data: {
        branchId: branch.id,
        tableSessionId: session.id,
        type: ServiceRequestType.CALL_STAFF
      }
    });
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

interface ServiceRequestResponse {
  id: string;
  branchId: string;
  tableSessionId: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  handledById: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

interface ServiceRequestListResponse {
  items: ServiceRequestResponse[];
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

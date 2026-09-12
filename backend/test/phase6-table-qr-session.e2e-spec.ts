import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AccountStatus, SessionStatus, TableStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 6 table QR session", () => {
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

  it("manages branch scoped tables and enforces table/QR permissions", async () => {
    const setup = await setupAdmin("admin-token");

    const created = await createTable(setup.branchId, "B01", "Bàn 01", 4);
    expect(created).toMatchObject({
      code: "B01",
      displayName: "Bàn 01",
      capacity: 4,
      status: TableStatus.ACTIVE,
      derivedStatus: "AVAILABLE"
    });

    await request(app.getHttpServer())
      .post("/api/v1/tables")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "b01", displayName: "Duplicate" })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "TABLE_CODE_EXISTS"));

    await request(app.getHttpServer())
      .patch(`/api/v1/tables/${created.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ displayName: "Bàn VIP 01", status: TableStatus.OUT_OF_SERVICE })
      .expect(200)
      .expect((response) => {
        const table = dataOf<TableResponse>(response.body);
        expect(table.displayName).toBe("Bàn VIP 01");
        expect(table.derivedStatus).toBe("OUT_OF_SERVICE");
      });

    const otherBranch = await prisma.branch.create({ data: { code: "OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });
    await request(app.getHttpServer()).get(`/api/v1/tables/${created.id}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", otherBranch.id).expect(403);

    await registerAndApprove("waiter-token", setup.branchId, "WAITER");
    await request(app.getHttpServer()).get("/api/v1/tables").set("Authorization", "Bearer waiter-token").set("X-Branch-Id", setup.branchId).expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/tables/${created.id}/qr-rotation`)
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/tables")
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "B02", displayName: "Bàn 02" })
      .expect(403);
  });

  it("rotates and disables QR tokens and rejects inactive tables", async () => {
    const setup = await setupAdmin("admin-token");
    const table = await createTable(setup.branchId, "B01", "Bàn 01", 4);
    const firstQr = await rotateQr(setup.branchId, table.id);
    const secondQr = await rotateQr(setup.branchId, table.id);
    expect(secondQr.token).not.toBe(firstQr.token);

    await request(app.getHttpServer())
      .post("/api/v1/qr-sessions")
      .send({ qrToken: firstQr.token })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "QR_DISABLED"));

    await request(app.getHttpServer())
      .post(`/api/v1/tables/${table.id}/qr-disablement`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/qr-sessions")
      .send({ qrToken: secondQr.token })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "QR_DISABLED"));

    const inactive = await createTable(setup.branchId, "B02", "Bàn 02", 2);
    const inactiveQr = await rotateQr(setup.branchId, inactive.id);
    await request(app.getHttpServer()).patch(`/api/v1/tables/${inactive.id}`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ status: TableStatus.INACTIVE }).expect(200);
    await request(app.getHttpServer())
      .post("/api/v1/qr-sessions")
      .send({ qrToken: inactiveQr.token })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "TABLE_INACTIVE"));

    await request(app.getHttpServer())
      .post("/api/v1/qr-sessions")
      .send({ qrToken: randomUUID() })
      .expect(400)
      .expect((response) => expectErrorCode(response.body, "INVALID_QR"));
  });

  it("creates or joins a session and invalidates old session credentials after close", async () => {
    const setup = await setupAdmin("admin-token");
    const table = await createTable(setup.branchId, "B01", "Bàn 01", 4);
    const qr = await rotateQr(setup.branchId, table.id);

    const firstScan = await request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken: qr.token }).expect(201);
    const firstSession = dataOf<QrSessionResponse>(firstScan.body);
    const secondScan = await request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken: qr.token }).expect(201);
    expect(dataOf<QrSessionResponse>(secondScan.body).session.id).toBe(firstSession.session.id);

    await closeSession(setup.branchId, firstSession.session.id);
    await request(app.getHttpServer())
      .get("/api/v1/qr-sessions/current")
      .set("Authorization", `Bearer ${firstSession.qrSessionToken}`)
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "SESSION_CLOSED"));

    const newScan = await request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken: qr.token }).expect(201);
    expect(dataOf<QrSessionResponse>(newScan.body).session.id).not.toBe(firstSession.session.id);

  });

  it("locks, unlocks, payment-requests, transfers and closes sessions with audit and outbox", async () => {
    const setup = await setupAdmin("admin-token");
    const source = await createTable(setup.branchId, "B01", "Bàn 01", 4);
    const destination = await createTable(setup.branchId, "B02", "Bàn 02", 4);
    const occupied = await createTable(setup.branchId, "B03", "Bàn 03", 4);
    const sourceSession = await scanQr((await rotateQr(setup.branchId, source.id)).token);
    const occupiedSession = await scanQr((await rotateQr(setup.branchId, occupied.id)).token);

    await request(app.getHttpServer())
      .post(`/api/v1/table-sessions/${sourceSession.session.id}/lock`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ reason: "Khách cần hỗ trợ" })
      .expect(201)
      .expect((response) => expect(dataOf<SessionResponse>(response.body).status).toBe(SessionStatus.LOCKED));
    await request(app.getHttpServer()).post(`/api/v1/table-sessions/${sourceSession.session.id}/unlock`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({}).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/table-sessions/${sourceSession.session.id}/payment-request`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({})
      .expect(201)
      .expect((response) => expect(dataOf<SessionResponse>(response.body).status).toBe(SessionStatus.PAYMENT_REQUESTED));

    await request(app.getHttpServer())
      .post(`/api/v1/table-sessions/${sourceSession.session.id}/transfer`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ destinationTableId: destination.id, reason: "Đổi bàn" })
      .expect(201)
      .expect((response) => {
        const session = dataOf<SessionResponse>(response.body);
        expect(session.id).toBe(sourceSession.session.id);
        expect(session.tableId).toBe(destination.id);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/table-sessions/${sourceSession.session.id}/transfer`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ destinationTableId: occupied.id })
      .expect(409)
      .expect((response) => expectErrorCode(response.body, "TABLE_HAS_OPEN_SESSION"));

    const otherBranch = await prisma.branch.create({ data: { code: "OTHER", name: "Other", timezone: "Asia/Ho_Chi_Minh" } });
    const otherTable = await prisma.diningTable.create({ data: { branchId: otherBranch.id, code: "O01", displayName: "Other 01" } });
    await request(app.getHttpServer())
      .post(`/api/v1/table-sessions/${sourceSession.session.id}/transfer`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ destinationTableId: otherTable.id })
      .expect(404);

    await closeSession(setup.branchId, sourceSession.session.id);
    await closeSession(setup.branchId, occupiedSession.session.id);
    expect(await prisma.auditLog.count({ where: { branchId: setup.branchId, entityType: "table_session" } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.realtimeOutbox.count({ where: { branchId: setup.branchId, eventType: { in: ["SESSION_UPDATED", "SESSION_CLOSED"] } } })).toBeGreaterThanOrEqual(5);

    const sourceA = await createTable(setup.branchId, "A01", "A01", 4);
    const sourceC = await createTable(setup.branchId, "C01", "C01", 4);
    const raceDestination = await createTable(setup.branchId, "D01", "D01", 4);
    const sessionA = await scanQr((await rotateQr(setup.branchId, sourceA.id)).token);
    const sessionC = await scanQr((await rotateQr(setup.branchId, sourceC.id)).token);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/table-sessions/${sessionA.session.id}/transfer`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ destinationTableId: raceDestination.id }),
      request(app.getHttpServer()).post(`/api/v1/table-sessions/${sessionC.session.id}/transfer`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", setup.branchId).send({ destinationTableId: raceDestination.id })
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.tableSession.count({ where: { tableId: raceDestination.id, closedAt: null } })).toBe(1);
  });

  it("keeps one open session under 200 concurrent QR scans", async () => {
    const setup = await setupAdmin("race-admin-token");
    const table = await createTable(setup.branchId, "R01", "Race 01", 4, "race-admin-token");
    const qr = await rotateQr(setup.branchId, table.id, "race-admin-token");
    const responses = await Promise.all(
      Array.from({ length: 200 }, () => request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken: qr.token }))
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const sessionIds = new Set(responses.map((response) => dataOf<QrSessionResponse>(response.body).session.id));
    expect(sessionIds.size).toBe(1);
    expect(await prisma.tableSession.count({ where: { tableId: table.id, closedAt: null } })).toBe(1);
  }, 30000);

  async function setupAdmin(token: string): Promise<{ branchId: string; adminUserId: string }> {
    const auth = createAuthContext({ email: `${token}@example.com`, displayName: "Owner" });
    authByToken.set(token, auth);
    const response = await request(app.getHttpServer()).post("/api/v1/setup").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", randomUUID()).send(createSetupDto()).expect(201);
    return { branchId: dataOf<SetupResponse>(response.body).branch.id, adminUserId: dataOf<SetupResponse>(response.body).admin.id };
  }

  async function createTable(branchId: string, code: string, displayName: string, capacity?: number, token = "admin-token"): Promise<TableResponse> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/tables")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", branchId)
      .send({ code, displayName, capacity })
      .expect(201);
    return dataOf<TableResponse>(response.body);
  }

  async function rotateQr(branchId: string, tableId: string, token = "admin-token"): Promise<QrResponse> {
    const response = await request(app.getHttpServer()).post(`/api/v1/tables/${tableId}/qr-rotation`).set("Authorization", `Bearer ${token}`).set("X-Branch-Id", branchId).send({}).expect(201);
    return dataOf<QrResponse>(response.body);
  }

  async function scanQr(qrToken: string): Promise<QrSessionResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/qr-sessions").send({ qrToken }).expect(201);
    return dataOf<QrSessionResponse>(response.body);
  }

  async function closeSession(branchId: string, sessionId: string): Promise<SessionResponse> {
    const response = await request(app.getHttpServer()).post(`/api/v1/table-sessions/${sessionId}/closure`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ reason: "Done" }).expect(201);
    return dataOf<SessionResponse>(response.body);
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
});

interface ApiEnvelope<T> {
  data: T;
}

interface SetupResponse {
  branch: { id: string };
  admin: { id: string };
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

interface TableResponse {
  id: string;
  branchId: string;
  code: string;
  displayName: string;
  capacity: number | null;
  status: TableStatus;
  derivedStatus: string;
}

interface QrResponse {
  id: string;
  tableId: string;
  token: string;
  status: string;
  url: string;
}

interface SessionResponse {
  id: string;
  tableId: string;
  status: SessionStatus;
}

interface QrSessionResponse {
  qrSessionToken: string;
  session: SessionResponse;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

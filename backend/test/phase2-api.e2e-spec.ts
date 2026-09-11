import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import { AccountStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { configureApp } from "../src/main";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 2 RBAC, staff and branch APIs", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const authByToken = new Map<string, AuthContext>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
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

  it("P2-TEST-001/P2-TEST-002/P2-TEST-003 enforces permission and branch guards", async () => {
    const setup = await setupAdmin("admin-token");
    const waiter = await registerAndApprove("waiter-token", setup.branchId, "WAITER");
    const pending = await registerPending("pending-token");

    await request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ roleIds: [waiter.roleId], permission: "STAFF_APPROVE" })
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("FORBIDDEN"));

    await request(app.getHttpServer())
      .get("/api/v1/staff")
      .set("Authorization", "Bearer pending-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("ACCOUNT_PENDING"));
  });

  it("P2-TEST-004 implements branch CRUD with timezone validation", async () => {
    const setup = await setupAdmin("admin-token");

    const createResponse = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "B2", name: "Second Branch", timezone: "Asia/Ho_Chi_Minh" })
      .expect(201);

    const createdId = createResponse.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/branches/${createdId}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", createdId)
      .send({ name: "Second Branch Updated" })
      .expect(200)
      .expect((response) => expect(response.body.data.name).toBe("Second Branch Updated"));

    await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "BADTZ", name: "Bad Timezone", timezone: "Not/AZone" })
      .expect(422);
  });

  it("P2-TEST-005 through P2-TEST-012 supports staff and role management", async () => {
    const setup = await setupAdmin("admin-token");
    const pending = await registerPending("staff-token");
    const roles = await getRoles("admin-token", setup.branchId);
    const waiterRole = roles.find((role) => role.code === "WAITER");
    const cashierRole = roles.find((role) => role.code === "CASHIER");
    expect(waiterRole).toBeDefined();
    expect(cashierRole).toBeDefined();

    await request(app.getHttpServer())
      .get("/api/v1/staff?status=PENDING")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.items.some((staff: { id: string }) => staff.id === pending.userId)).toBe(true));

    await request(app.getHttpServer())
      .get(`/api/v1/staff/${pending.userId}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.branches).toHaveLength(0));

    await request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ roleIds: [waiterRole!.id] })
      .expect(201);

    const fakeActorId = randomUUID();
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/${pending.userId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "LOCKED", reason: "spoof attempt", actorId: fakeActorId })
      .expect(400);
    await expect(prisma.auditLog.count({ where: { actorId: fakeActorId } })).resolves.toBe(0);

    await request(app.getHttpServer())
      .get("/api/v1/staff?role=WAITER&status=ACTIVE")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.items.some((staff: { id: string }) => staff.id === pending.userId)).toBe(true));

    await request(app.getHttpServer())
      .put(`/api/v1/staff/${pending.userId}/branches/${setup.branchId}/roles`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ roleIds: [cashierRole!.id] })
      .expect(200)
      .expect((response) => expect(response.body.data.branches[0].roles[0].code).toBe("CASHIER"));

    await request(app.getHttpServer())
      .patch(`/api/v1/staff/${pending.userId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "LOCKED", reason: "security test" })
      .expect(200);

    await request(app.getHttpServer())
      .get("/api/v1/staff")
      .set("Authorization", "Bearer staff-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("ACCOUNT_LOCKED"));

    await request(app.getHttpServer())
      .patch(`/api/v1/staff/${pending.userId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "ACTIVE" })
      .expect(200);

    const rejected = await registerPending("reject-token");
    await request(app.getHttpServer())
      .post(`/api/v1/staff/${rejected.userId}/rejection`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ reason: "not allowed" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/api/v1/staff")
      .set("Authorization", "Bearer reject-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("ACCOUNT_REJECTED"));

    const roleResponse = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: `CUSTOM_${Date.now()}`, name: "Custom Role" })
      .expect(201);
    const customRoleId = roleResponse.body.data.id as string;
    const permissions = await request(app.getHttpServer())
      .get("/api/v1/permissions")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200);
    const branchRead = permissions.body.data.items.find((permission: { code: string }) => permission.code === "BRANCH_READ");

    await request(app.getHttpServer())
      .put(`/api/v1/roles/${customRoleId}/permissions`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ permissionIds: [branchRead.id] })
      .expect(200)
      .expect((response) => expect(response.body.data.permissions.map((permission: { code: string }) => permission.code)).toContain("BRANCH_READ"));

    await expect(prisma.auditLog.count({ where: { actorId: setup.adminUserId } })).resolves.toBeGreaterThanOrEqual(5);
    await expect(prisma.auditLog.count({ where: { actorId: pending.userId } })).resolves.toBe(0);
    await assertCrossBranchIsolation(setup.branchId);
  });

  it("P2-TEST-007 handles concurrent staff approval without duplicates", async () => {
    const setup = await setupAdmin("admin-token");
    const pending = await registerPending("staff-token");
    const role = await getRoleByCode("admin-token", setup.branchId, "WAITER");

    const first = request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ roleIds: [role.id] });
    const second = request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ roleIds: [role.id] });

    const responses = await Promise.all([first, second]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    await expect(prisma.staffBranch.count({ where: { userId: pending.userId, branchId: setup.branchId } })).resolves.toBe(1);
    const staffBranch = await prisma.staffBranch.findUniqueOrThrow({ where: { userId_branchId: { userId: pending.userId, branchId: setup.branchId } } });
    await expect(prisma.staffRole.count({ where: { staffBranchId: staffBranch.id } })).resolves.toBe(1);
  });

  it("P2-TEST-013/P2-TEST-014 protects the last active admin under concurrency", async () => {
    const setup = await setupAdmin("admin-token");
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/${setup.adminUserId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "LOCKED", reason: "last admin test" })
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("LAST_ADMIN_REQUIRED"));

    const adminRole = await getRoleByCode("admin-token", setup.branchId, "ADMIN");
    const secondAdmin = await registerAndApprove("admin-2-token", setup.branchId, "ADMIN");
    expect(secondAdmin.roleId).toBe(adminRole.id);

    const first = request(app.getHttpServer())
      .patch(`/api/v1/staff/${setup.adminUserId}/status`)
      .set("Authorization", "Bearer admin-2-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "LOCKED", reason: "concurrent admin removal" });
    const second = request(app.getHttpServer())
      .patch(`/api/v1/staff/${secondAdmin.userId}/status`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "LOCKED", reason: "concurrent admin removal" });

    const responses = await Promise.allSettled([first, second]);
    const statusCodes = responses.map((result) => (result.status === "fulfilled" ? result.value.status : 500));
    expect(statusCodes.filter((status) => status === 200)).toHaveLength(1);
    const activeAdmins = await activeAdminCount(setup.branchId);
    expect(activeAdmins).toBe(1);
  });

  async function assertCrossBranchIsolation(branchId: string): Promise<void> {
    const branchB = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ code: "B2", name: "Second Branch", timezone: "Asia/Ho_Chi_Minh" })
      .expect(201);
    const branchBId = branchB.body.data.id as string;
    const managerA = await registerAndApprove("manager-a-token", branchId, "MANAGER");
    const staffB = await registerAndApprove("staff-b-token", branchBId, "WAITER");

    await request(app.getHttpServer())
      .get(`/api/v1/staff/${staffB.userId}`)
      .set("Authorization", "Bearer manager-a-token")
      .set("X-Branch-Id", branchId)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("BRANCH_ACCESS_DENIED"));

    await request(app.getHttpServer())
      .get(`/api/v1/staff/${staffB.userId}`)
      .set("Authorization", "Bearer manager-a-token")
      .set("X-Branch-Id", branchBId)
      .expect(403)
      .expect((response) => expect(response.body.error.code).toBe("BRANCH_ACCESS_DENIED"));

    expect(managerA.userId).not.toBe(staffB.userId);
  }

  async function setupAdmin(token: string): Promise<{ branchId: string; adminUserId: string }> {
    const auth = createAuthContext({ email: "owner@example.com", displayName: "Owner" });
    authByToken.set(token, auth);
    const response = await request(app.getHttpServer())
      .post("/api/v1/setup")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send(createSetupDto())
      .expect(201);
    return {
      branchId: response.body.data.branch.id as string,
      adminUserId: response.body.data.admin.id as string
    };
  }

  async function registerPending(token: string): Promise<{ userId: string }> {
    const auth = createAuthContext();
    authByToken.set(token, auth);
    await request(app.getHttpServer()).post("/api/v1/auth/registrations").set("Authorization", `Bearer ${token}`).send({}).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { authUserId: auth.authUserId } });
    return { userId: user.id };
  }

  async function registerAndApprove(token: string, branchId: string, roleCode: string): Promise<{ userId: string; roleId: string }> {
    const pending = await registerPending(token);
    const role = await getRoleByCode("admin-token", branchId, roleCode);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ roleIds: [role.id] })
      .expect(201);
    return { userId: pending.userId, roleId: role.id };
  }

  async function getRoles(token: string, branchId: string): Promise<Array<{ id: string; code: string }>> {
    const response = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${token}`).set("X-Branch-Id", branchId).expect(200);
    return response.body.data.items;
  }

  async function getRoleByCode(token: string, branchId: string, roleCode: string): Promise<{ id: string; code: string }> {
    const roles = await getRoles(token, branchId);
    const role = roles.find((item) => item.code === roleCode);
    if (!role) {
      throw new Error(`Missing ${roleCode} role`);
    }
    return role;
  }

  async function activeAdminCount(branchId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT u.id)::bigint AS count
      FROM users u
      JOIN staff_branches sb ON sb.user_id = u.id
      JOIN staff_roles sr ON sr.staff_branch_id = sb.id
      JOIN roles r ON r.id = sr.role_id
      WHERE sb.branch_id = ${branchId}::uuid
        AND sb.is_active = true
        AND u.status = ${AccountStatus.ACTIVE}::account_status
        AND r.code = 'ADMIN'
    `;
    return Number(rows[0]?.count ?? 0n);
  }
});

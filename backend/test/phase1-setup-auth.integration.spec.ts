import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { SetupService } from "../src/modules/setup/setup.service";
import {
  createAuthContext,
  createPendingUser,
  createPendingSetup,
  createSetupDto,
  markSetupCompleted,
  resetDatabase
} from "./phase1-test-utils";

describe("Phase 1 setup and auth integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let setupService: SetupService;
  let authService: AuthService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    prisma = moduleRef.get(PrismaService);
    setupService = moduleRef.get(SetupService);
    authService = moduleRef.get(AuthService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  it("P1-TEST-002 creates setup records atomically", async () => {
    const auth = createAuthContext();
    const result = await setupService.completeSetup(createSetupDto(), auth, randomUUID());

    await expect(prisma.systemSetup.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject({
      status: "COMPLETED"
    });
    await expect(prisma.branch.count()).resolves.toBe(1);
    await expect(prisma.user.count({ where: { status: "ACTIVE" } })).resolves.toBe(1);
    await expect(prisma.staffBranch.count()).resolves.toBe(1);
    await expect(prisma.staffRole.count()).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { action: "FIRST_TIME_SETUP_COMPLETED" } })).resolves.toBe(1);
    expect(result.status).toBe("COMPLETED");
  });

  it("P1-TEST-003 allows only one concurrent setup success", async () => {
    const first = setupService.completeSetup(createSetupDto(), createAuthContext(), randomUUID());
    const second = setupService.completeSetup(
      createSetupDto({ branch: { code: "SECOND", name: "Second Branch", timezone: "Asia/Ho_Chi_Minh" } }),
      createAuthContext(),
      randomUUID()
    );

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await expect(prisma.branch.count()).resolves.toBe(1);
    await expect(prisma.user.count({ where: { status: "ACTIVE" } })).resolves.toBe(1);
    await expect(prisma.systemSetup.count({ where: { status: "COMPLETED" } })).resolves.toBe(1);
    await expect(prisma.staffRole.count()).resolves.toBe(1);
  });

  it("P1-TEST-005 creates pending staff registration only", async () => {
    await markSetupCompleted(prisma);
    const auth = createAuthContext();

    const result = await authService.registerStaff({}, auth);

    expect(result.user.status).toBe("PENDING");
    await expect(prisma.user.count({ where: { authUserId: auth.authUserId } })).resolves.toBe(1);
    await expect(prisma.staffBranch.count()).resolves.toBe(0);
    await expect(prisma.staffRole.count()).resolves.toBe(0);
  });

  it("P1-TEST-006 does not duplicate concurrent staff registration", async () => {
    await markSetupCompleted(prisma);
    const auth = createAuthContext();

    await Promise.all([authService.registerStaff({}, auth), authService.registerStaff({}, auth)]);

    await expect(prisma.user.count({ where: { authUserId: auth.authUserId } })).resolves.toBe(1);
    await expect(prisma.staffBranch.count()).resolves.toBe(0);
  });

  it("P1-TEST-007 maps auth/me from JWT sub to business user", async () => {
    const auth = createAuthContext();
    await setupService.completeSetup(createSetupDto(), auth, randomUUID());

    const me = await authService.getMe(auth);

    expect(me.profile.authUserId).toBe(auth.authUserId);
    expect(me.accountStatus).toBe("ACTIVE");
    expect(me.activeBranch?.code).toBe("MAIN");
    expect(me.roles).toContain("ADMIN");
    expect(me.permissions).toContain("SETUP_COMPLETE");
    expect(me.shiftAccess).toEqual({ current: null, availableActions: [] });
  });

  it("P1-TEST-008 replays setup with the same idempotency key and payload", async () => {
    const auth = createAuthContext();
    const dto = createSetupDto();
    const key = randomUUID();

    const first = await setupService.completeSetup(dto, auth, key);
    const second = await setupService.completeSetup(dto, auth, key);

    expect(second).toEqual(first);
    await expect(prisma.branch.count()).resolves.toBe(1);
    await expect(prisma.user.count({ where: { status: "ACTIVE" } })).resolves.toBe(1);
  });

  it("P1-TEST-009 rejects reused idempotency key with a different payload", async () => {
    const auth = createAuthContext();
    const key = randomUUID();

    await setupService.completeSetup(createSetupDto(), auth, key);
    await expect(
      setupService.completeSetup(
        createSetupDto({ branch: { code: "OTHER", name: "Other Branch", timezone: "Asia/Ho_Chi_Minh" } }),
        auth,
        key
      )
    ).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_REUSED" }
    });
  });

  it("P1-TEST-010 rolls back setup when a later transaction step fails", async () => {
    const auth = createAuthContext();
    await createPendingSetup(prisma);
    await createPendingUser(prisma, auth);

    await expect(setupService.completeSetup(createSetupDto(), auth, randomUUID())).rejects.toBeDefined();

    await expect(prisma.branch.count()).resolves.toBe(0);
    await expect(prisma.staffBranch.count()).resolves.toBe(0);
    await expect(prisma.staffRole.count()).resolves.toBe(0);
    await expect(prisma.systemSetup.findUnique({ where: { id: 1 } })).resolves.toMatchObject({
      status: "PENDING"
    });
  });
});

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { configureApp } from "../src/main";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 1 API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthContext;

  beforeAll(async () => {
    auth = createAuthContext({ email: "owner@example.com", displayName: "Owner" });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(SupabaseJwtVerifierService)
      .useValue({ verify: jest.fn().mockResolvedValue(auth) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it("returns setup status without leaking sensitive fields", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/setup/status").expect(200);

    expect(response.body.data).toEqual({ status: "PENDING" });
    expect(response.body.data.setupToken).toBeUndefined();
    expect(response.body.data.adminEmail).toBeUndefined();
  });

  it("P1-TEST-004 rejects body authUserId spoofing", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/setup")
      .set("Authorization", "Bearer verified-test-token")
      .set("Idempotency-Key", randomUUID())
      .send({
        ...createSetupDto(),
        authUserId: randomUUID()
      })
      .expect(400);

    await expect(prisma.branch.count()).resolves.toBe(0);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it("creates first setup through the API", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/setup")
      .set("Authorization", "Bearer verified-test-token")
      .set("Idempotency-Key", randomUUID())
      .send(createSetupDto())
      .expect(201);

    expect(response.body.data.status).toBe("COMPLETED");
    expect(response.body.data.admin.email).toBe("owner@example.com");
    await expect(prisma.auditLog.count({ where: { action: "FIRST_TIME_SETUP_COMPLETED" } })).resolves.toBe(1);
  });
});

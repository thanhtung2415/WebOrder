import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";

describe("HealthController", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({ ping: jest.fn().mockResolvedValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns standard success envelope and request id", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health")
      .set("X-Request-Id", "req_test_health")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("req_test_health");
    expect(response.body).toEqual({
      success: true,
      data: { status: "ok" },
      meta: {},
      requestId: "req_test_health"
    });
  });

  it("returns readiness when database ping succeeds", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/ready")
      .set("X-Request-Id", "req_test_ready")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { status: "ready", database: "ok" },
      meta: {},
      requestId: "req_test_ready"
    });
  });

  it("serves Swagger documentation", async () => {
    await request(app.getHttpServer()).get("/api/docs").expect(200);
  });

  it("applies security headers", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

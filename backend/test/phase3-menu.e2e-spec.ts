import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { unprocessable } from "../src/common/errors/api-exception";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { ProductImageStorageService } from "../src/modules/menu/product-image-storage.service";
import { configureApp } from "../src/main";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 3 menu, product and option APIs", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let failUpload = false;
  const authByToken = new Map<string, AuthContext>();
  const imageStorage = {
    uploadProductImage: jest.fn(async (branchId: string, productId: string, file: Express.Multer.File): Promise<string> => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
        throw unprocessable("INVALID_IMAGE_TYPE", "Product image must be JPEG, PNG or WEBP");
      }
      if (file.size <= 0 || file.size > 3 * 1024 * 1024) {
        throw unprocessable("INVALID_IMAGE_SIZE", "Product image must be between 1 byte and 3 MB");
      }
      if (failUpload) {
        throw unprocessable("IMAGE_UPLOAD_FAILED", "Product image upload failed");
      }
      return `${branchId}/products/${productId}/mock-image.png`;
    })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(SupabaseJwtVerifierService)
      .useValue({
        verify: jest.fn((token: string) => Promise.resolve(authByToken.get(token) ?? createAuthContext()))
      })
      .overrideProvider(ProductImageStorageService)
      .useValue(imageStorage)
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
    imageStorage.uploadProductImage.mockClear();
    failUpload = false;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it("supports category CRUD, inactive filtering and MENU_MANAGE authorization", async () => {
    const setup = await setupAdmin("admin-token");
    const category = await createCategory(setup.branchId, "COFFEE", "Ca phe");
    const waiter = await registerAndApprove("waiter-token", setup.branchId, "WAITER");

    await request(app.getHttpServer())
      .get("/api/v1/categories?activeOnly=true")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.items.some((item: { id: string }) => item.id === category.id)).toBe(true));

    await request(app.getHttpServer())
      .patch(`/api/v1/categories/${category.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ name: "Ca phe sua", sortOrder: 2, isActive: false })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.name).toBe("Ca phe sua");
        expect(response.body.data.isActive).toBe(false);
      });

    await request(app.getHttpServer())
      .get("/api/v1/categories?activeOnly=true")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.items.some((item: { id: string }) => item.id === category.id)).toBe(false));

    await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "TEA", name: "Tea" })
      .expect(403);
    expect(waiter.userId).toBeDefined();
  });

  it("supports product CRUD, decimal price, processing area and branch-scoped categories", async () => {
    const setup = await setupAdmin("admin-token");
    const category = await createCategory(setup.branchId, "COFFEE", "Ca phe");
    const branchB = await createBranch("B2", setup.branchId);
    const categoryB = await createCategory(branchB.id, "OTHER", "Other");

    const product = await createProduct(setup.branchId, category.id, {
      code: "MILK_COFFEE",
      name: "Ca phe sua",
      basePrice: "25000.50",
      processingArea: "BAR"
    });
    expect(product.basePrice).toBe("25000.50");
    expect(product.processingArea).toBe("BAR");
    expect(product.availability.isAvailable).toBe(true);
    expect(product.availability.inventoryAware).toBe(false);

    await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "BAD", name: "Bad", basePrice: "10000.00", processingArea: "KITCHEN", categoryId: categoryB.id })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "BAD_AREA", name: "Bad Area", basePrice: "10000.00", processingArea: "FRONT", categoryId: category.id })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: "INACTIVE", isFeatured: true })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe("INACTIVE");
        expect(response.body.data.availability.reason).toBe("PRODUCT_INACTIVE");
      });

    await request(app.getHttpServer())
      .get("/api/v1/products?activeOnly=true")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.items.some((item: { id: string }) => item.id === product.id)).toBe(false));
  });

  it("supports option groups, values and atomic product option rule replacement", async () => {
    const setup = await setupAdmin("admin-token");
    const category = await createCategory(setup.branchId, "COFFEE", "Ca phe");
    const product = await createProduct(setup.branchId, category.id, { code: "LATTE", name: "Latte", basePrice: "30000.00", processingArea: "BAR" });
    const size = await createOptionGroup(setup.branchId, "SIZE", "Size", "SIZE");
    const medium = await createOptionValue(setup.branchId, size.id, "M", "M");
    const large = await createOptionValue(setup.branchId, size.id, "L", "L");
    const branchB = await createBranch("B2", setup.branchId);
    const otherGroup = await createOptionGroup(branchB.id, "OTHER", "Other", "CUSTOM");
    const otherValue = await createOptionValue(branchB.id, otherGroup.id, "OTHER", "Other");

    await request(app.getHttpServer())
      .put(`/api/v1/products/${product.id}/option-rules`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({
        groups: [
          {
            optionGroupId: size.id,
            isRequired: true,
            minSelections: 1,
            maxSelections: 1,
            values: [
              { optionValueId: medium.id, priceDelta: "0.00", isDefault: true },
              { optionValueId: large.id, priceDelta: "5000.00" }
            ]
          }
        ]
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.optionGroups).toHaveLength(1);
        expect(response.body.data.optionGroups[0].values).toHaveLength(2);
      });

    await request(app.getHttpServer())
      .put(`/api/v1/products/${product.id}/option-rules`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({
        groups: [
          {
            optionGroupId: size.id,
            isRequired: true,
            minSelections: 0,
            maxSelections: 1,
            values: [{ optionValueId: medium.id, priceDelta: "0.00" }]
          }
        ]
      })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/products/${product.id}/option-rules`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({
        groups: [
          {
            optionGroupId: size.id,
            isRequired: false,
            minSelections: 0,
            maxSelections: 1,
            values: [
              { optionValueId: medium.id, priceDelta: "0.00" },
              { optionValueId: medium.id, priceDelta: "0.00" }
            ]
          }
        ]
      })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/products/${product.id}/option-rules`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({
        groups: [
          {
            optionGroupId: size.id,
            isRequired: false,
            minSelections: 0,
            maxSelections: 1,
            values: [{ optionValueId: otherValue.id, priceDelta: "0.00" }]
          }
        ]
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => expect(response.body.data.optionGroups[0].values).toHaveLength(2));
  });

  it("validates product image uploads and updates DB only after storage success", async () => {
    const setup = await setupAdmin("admin-token");
    const category = await createCategory(setup.branchId, "COFFEE", "Ca phe");
    const product = await createProduct(setup.branchId, category.id, { code: "ESPRESSO", name: "Espresso", basePrice: "20000.00", processingArea: "BAR" });
    await registerAndApprove("waiter-token", setup.branchId, "WAITER");

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/image`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .attach("image", Buffer.from("not image"), { filename: "bad.txt", contentType: "text/plain" })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/image`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .attach("image", Buffer.alloc(3 * 1024 * 1024 + 1), { filename: "big.png", contentType: "image/png" })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/image`)
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .attach("image", Buffer.from("png"), { filename: "coffee.png", contentType: "image/png" })
      .expect(403);

    failUpload = true;
    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/image`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .attach("image", Buffer.from("png"), { filename: "../unsafe.png", contentType: "image/png" })
      .expect(422);
    await expect(prisma.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({ imagePath: null });

    failUpload = false;
    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/image`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .attach("image", Buffer.from("png"), { filename: "../unsafe.png", contentType: "image/png" })
      .expect(201)
      .expect((response) => {
        const imagePath = response.body.data.imagePath as string;
        expect(imagePath).toMatch(new RegExp(`^${setup.branchId}/products/${product.id}/[a-z0-9-]+\\.png$`));
      });
  });

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
    const role = await getRoleByCode(branchId, roleCode);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/${pending.userId}/approval`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ roleIds: [role.id] })
      .expect(201);
    return { userId: pending.userId, roleId: role.id };
  }

  async function getRoleByCode(branchId: string, roleCode: string): Promise<{ id: string; code: string }> {
    const response = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).expect(200);
    const role = response.body.data.items.find((item: { code: string }) => item.code === roleCode);
    if (!role) {
      throw new Error(`Missing ${roleCode} role`);
    }
    return role;
  }

  async function createBranch(code: string, currentBranchId: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", currentBranchId)
      .send({ code, name: code, timezone: "Asia/Ho_Chi_Minh" })
      .expect(201);
    return { id: response.body.data.id as string };
  }

  async function createCategory(branchId: string, code: string, name: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer()).post("/api/v1/categories").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name }).expect(201);
    return { id: response.body.data.id as string };
  }

  async function createProduct(branchId: string, categoryId: string, payload: { code: string; name: string; basePrice: string; processingArea: string }): Promise<{ id: string; basePrice: string; processingArea: string; availability: { isAvailable: boolean; inventoryAware: boolean } }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ ...payload, categoryId })
      .expect(201);
    return response.body.data;
  }

  async function createOptionGroup(branchId: string, code: string, name: string, type: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer()).post("/api/v1/option-groups").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name, type }).expect(201);
    return { id: response.body.data.id as string };
  }

  async function createOptionValue(branchId: string, optionGroupId: string, code: string, name: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/option-values")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ optionGroupId, code, name })
      .expect(201);
    return { id: response.body.data.id as string };
  }
});

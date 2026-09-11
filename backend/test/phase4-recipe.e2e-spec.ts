import { INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { IngredientStatus, InventoryTransactionType, OptionGroupType, Prisma, ProcessingArea, RecipeType, UnitDimension } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { AuthorizationService } from "../src/modules/auth/services/authorization.service";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";
import { RecipeResolverService } from "../src/modules/recipes/recipe-resolver.service";
import { UnitConversionService } from "../src/modules/recipes/unit-conversion.service";
import { createAuthContext, createSetupDto, resetDatabase } from "./phase1-test-utils";

describe("Phase 4 units, ingredients and recipes", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authorizationService: AuthorizationService;
  let recipeResolver: RecipeResolverService;
  let unitConversionService: UnitConversionService;
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
    authorizationService = moduleRef.get(AuthorizationService);
    recipeResolver = moduleRef.get(RecipeResolverService);
    unitConversionService = moduleRef.get(UnitConversionService);
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

  it("manages units, ingredient base units and allowed unit conversions", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, { code: "g", name: "Gram", symbol: "g", dimension: UnitDimension.MASS });
    const kilogram = await createUnit(setup.branchId, { code: "kg", name: "Kilogram", symbol: "kg", dimension: UnitDimension.MASS });
    const milliliter = await createUnit(setup.branchId, { code: "ml", name: "Milliliter", symbol: "ml", dimension: UnitDimension.VOLUME });
    const ingredient = await createIngredient(setup.branchId, { code: "coffee", name: "Coffee", baseUnitId: gram.id });

    expect(ingredient.baseUnit.id).toBe(gram.id);
    expect(ingredient.units).toHaveLength(1);
    expect(ingredient.units[0].isDefault).toBe(true);
    expect(ingredient.units[0].conversionFactorToBase).toBe("1.000000");

    await request(app.getHttpServer())
      .put(`/api/v1/ingredients/${ingredient.id}/units/${kilogram.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ label: "Bao kg", conversionFactor: "1000", isActive: true })
      .expect(200)
      .expect((response) => {
        const data = dataOf<IngredientUnitResponse>(response.body);
        expect(data.conversionFactorToBase).toBe("1000.000000");
      });

    await expect(unitConversionService.convertToBaseUnit(ingredient.id, kilogram.id, "1.500")).resolves.toEqual(new Prisma.Decimal("1500.000000"));

    await request(app.getHttpServer())
      .put(`/api/v1/ingredients/${ingredient.id}/units/${kilogram.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ conversionFactor: "0" })
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INVALID_UNIT_CONVERSION"));

    await request(app.getHttpServer())
      .put(`/api/v1/ingredients/${ingredient.id}/units/${milliliter.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ conversionFactor: "1" })
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INVALID_UNIT_CONVERSION"));
  });

  it("prevents changing an ingredient base unit after inventory history exists", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, { code: "g", name: "Gram", symbol: "g", dimension: UnitDimension.MASS });
    const kilogram = await createUnit(setup.branchId, { code: "kg", name: "Kilogram", symbol: "kg", dimension: UnitDimension.MASS });
    const ingredient = await createIngredient(setup.branchId, { code: "milk_powder", name: "Milk Powder", baseUnitId: gram.id });
    const inventory = await prisma.inventory.create({
      data: {
        branchId: setup.branchId,
        ingredientId: ingredient.id,
        physicalQuantity: new Prisma.Decimal("10.000")
      }
    });
    await prisma.inventoryTransaction.create({
      data: {
        branchId: setup.branchId,
        inventoryId: inventory.id,
        type: InventoryTransactionType.ADJUSTMENT,
        quantityDelta: new Prisma.Decimal("1.000"),
        physicalQuantityAfter: new Prisma.Decimal("11.000"),
        createdById: setup.adminUserId
      }
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/ingredients/${ingredient.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ baseUnitId: kilogram.id })
      .expect(422)
      .expect((response) => expectErrorCode(response.body, "INVALID_UNIT_CONVERSION"));
  });

  it("versions, activates and resolves base, size and add-on recipes", async () => {
    const setup = await setupAdmin("admin-token");
    const gram = await createUnit(setup.branchId, { code: "g", name: "Gram", symbol: "g", dimension: UnitDimension.MASS });
    const coffee = await createIngredient(setup.branchId, { code: "coffee", name: "Coffee", baseUnitId: gram.id });
    const milk = await createIngredient(setup.branchId, { code: "milk", name: "Milk", baseUnitId: gram.id });
    const pearl = await createIngredient(setup.branchId, { code: "pearl", name: "Pearl", baseUnitId: gram.id });
    const category = await createCategory(setup.branchId, "DRINK", "Drink");
    const product = await createProduct(setup.branchId, category.id, "LATTE", "Latte");
    const options = await configureProductOptions(setup.branchId, product.id);

    const baseV1 = await createRecipe(setup.branchId, product.id, {
      type: RecipeType.BASE,
      name: "Latte base v1",
      items: [
        { ingredientId: coffee.id, quantity: "15.000" },
        { ingredientId: milk.id, quantity: "30.000" }
      ]
    });
    expect(baseV1.isActive).toBe(false);
    await activateRecipe(setup.branchId, baseV1.id);
    const baseV2 = await createRecipe(setup.branchId, product.id, {
      type: RecipeType.BASE,
      name: "Latte base v2",
      items: [
        { ingredientId: coffee.id, quantity: "20.000" },
        { ingredientId: milk.id, quantity: "40.000" }
      ]
    });
    expect(baseV2.version).toBe(2);
    await activateRecipe(setup.branchId, baseV2.id);

    const largeRecipe = await createRecipe(setup.branchId, product.id, {
      type: RecipeType.SIZE,
      productOptionValueId: options.largeProductOptionValueId,
      name: "Large delta",
      items: [{ ingredientId: milk.id, quantity: "20.000" }]
    });
    await activateRecipe(setup.branchId, largeRecipe.id);
    const pearlRecipe = await createRecipe(setup.branchId, product.id, {
      type: RecipeType.ADD_ON,
      productOptionValueId: options.pearlProductOptionValueId,
      name: "Pearl topping",
      items: [{ ingredientId: pearl.id, quantity: "50.000" }]
    });
    await activateRecipe(setup.branchId, pearlRecipe.id);

    await request(app.getHttpServer())
      .get(`/api/v1/products/${product.id}/recipes`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .expect(200)
      .expect((response) => {
        const items = dataOf<RecipeListResponse>(response.body).items;
        expect(items.find((recipe) => recipe.id === baseV1.id)?.isActive).toBe(false);
        expect(items.find((recipe) => recipe.id === baseV2.id)?.isActive).toBe(true);
      });

    const context = await authorizationService.resolveBranchContext(authByToken.get("admin-token")!, setup.branchId);
    const resolved = await recipeResolver.resolveProductRecipe(product.id, [options.largeProductOptionValueId, options.pearlProductOptionValueId], context);
    expect(resolved.ingredients.map((item) => [item.code, item.quantity])).toEqual([
      ["COFFEE", "20.000"],
      ["MILK", "60.000"],
      ["PEARL", "50.000"]
    ]);
    await expect(prisma.realtimeOutbox.count({ where: { branchId: setup.branchId, eventType: "PRODUCT_AVAILABILITY_CHANGED" } })).resolves.toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid recipe targets, missing active recipes and inactive ingredients during resolution", async () => {
    const setup = await setupAdmin("admin-token");
    const otherBranch = await createBranch(setup.branchId, "B2");
    const gram = await createUnit(setup.branchId, { code: "g", name: "Gram", symbol: "g", dimension: UnitDimension.MASS });
    const coffee = await createIngredient(setup.branchId, { code: "coffee", name: "Coffee", baseUnitId: gram.id });
    const category = await createCategory(setup.branchId, "DRINK", "Drink");
    const product = await createProduct(setup.branchId, category.id, "ESPRESSO", "Espresso");
    const options = await configureProductOptions(setup.branchId, product.id);
    const otherCategory = await createCategory(otherBranch.id, "OTHER", "Other");
    const otherProduct = await createProduct(otherBranch.id, otherCategory.id, "OTHER_PRODUCT", "Other Product");
    const otherOptions = await configureProductOptions(otherBranch.id, otherProduct.id);

    await request(app.getHttpServer())
      .post(`/api/v1/products/${product.id}/recipes`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ type: RecipeType.SIZE, productOptionValueId: otherOptions.largeProductOptionValueId, name: "Bad target", items: [{ ingredientId: coffee.id, quantity: "1.000" }] })
      .expect(400)
      .expect((response) => expectErrorCode(response.body, "INVALID_OPTION"));

    const context = await authorizationService.resolveBranchContext(authByToken.get("admin-token")!, setup.branchId);
    await expect(recipeResolver.resolveProductRecipe(product.id, [], context)).rejects.toMatchObject({ response: { code: "RECIPE_NOT_CONFIGURED" } });

    const base = await createRecipe(setup.branchId, product.id, {
      type: RecipeType.BASE,
      name: "Espresso base",
      items: [{ ingredientId: coffee.id, quantity: "9.000" }]
    });
    await activateRecipe(setup.branchId, base.id);
    await request(app.getHttpServer())
      .patch(`/api/v1/ingredients/${coffee.id}`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ status: IngredientStatus.INACTIVE })
      .expect(200);
    await expect(recipeResolver.resolveProductRecipe(product.id, [options.largeProductOptionValueId], context)).rejects.toMatchObject({ response: { code: "RECIPE_NOT_CONFIGURED" } });
  });

  it("enforces Phase 4 permissions", async () => {
    const setup = await setupAdmin("admin-token");
    await registerAndApprove("waiter-token", setup.branchId, "WAITER");

    await request(app.getHttpServer()).get("/api/v1/units").set("Authorization", "Bearer waiter-token").set("X-Branch-Id", setup.branchId).expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/units")
      .set("Authorization", "Bearer waiter-token")
      .set("X-Branch-Id", setup.branchId)
      .send({ code: "g", name: "Gram", symbol: "g", dimension: UnitDimension.MASS })
      .expect(403);
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
      branchId: dataOf<SetupResponse>(response.body).branch.id,
      adminUserId: dataOf<SetupResponse>(response.body).admin.id
    };
  }

  async function registerAndApprove(token: string, branchId: string, roleCode: string): Promise<void> {
    const auth = createAuthContext();
    authByToken.set(token, auth);
    await request(app.getHttpServer()).post("/api/v1/auth/registrations").set("Authorization", `Bearer ${token}`).send({}).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { authUserId: auth.authUserId } });
    const response = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).expect(200);
    const role = dataOf<RoleListResponse>(response.body).items.find((item) => item.code === roleCode);
    if (!role) {
      throw new Error(`Missing role ${roleCode}`);
    }
    await request(app.getHttpServer()).post(`/api/v1/staff/${user.id}/approval`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ roleIds: [role.id] }).expect(201);
  }

  async function createBranch(currentBranchId: string, code: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", currentBranchId)
      .send({ code, name: code, timezone: "Asia/Ho_Chi_Minh" })
      .expect(201);
    return { id: dataOf<IdResponse>(response.body).id };
  }

  async function createCategory(branchId: string, code: string, name: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer()).post("/api/v1/categories").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name }).expect(201);
    return { id: dataOf<IdResponse>(response.body).id };
  }

  async function createProduct(branchId: string, categoryId: string, code: string, name: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ code, name, categoryId, basePrice: "25000.00", processingArea: ProcessingArea.BAR })
      .expect(201);
    return { id: dataOf<IdResponse>(response.body).id };
  }

  async function createUnit(branchId: string, payload: { code: string; name: string; symbol: string; dimension: UnitDimension }): Promise<UnitResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/units").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send(payload).expect(201);
    return dataOf<UnitResponse>(response.body);
  }

  async function createIngredient(branchId: string, payload: { code: string; name: string; baseUnitId: string }): Promise<IngredientResponse> {
    const response = await request(app.getHttpServer()).post("/api/v1/ingredients").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send(payload).expect(201);
    return dataOf<IngredientResponse>(response.body);
  }

  async function createRecipe(branchId: string, productId: string, payload: CreateRecipePayload): Promise<RecipeResponse> {
    const response = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/recipes`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send(payload).expect(201);
    return dataOf<RecipeResponse>(response.body);
  }

  async function activateRecipe(branchId: string, recipeId: string): Promise<RecipeResponse> {
    const response = await request(app.getHttpServer()).post(`/api/v1/recipes/${recipeId}/activation`).set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({}).expect(201);
    return dataOf<RecipeResponse>(response.body);
  }

  async function configureProductOptions(branchId: string, productId: string): Promise<{ largeProductOptionValueId: string; pearlProductOptionValueId: string }> {
    const sizeGroup = await createOptionGroup(branchId, "SIZE", "Size", OptionGroupType.SIZE);
    const large = await createOptionValue(branchId, sizeGroup.id, "L", "Large");
    const toppingGroup = await createOptionGroup(branchId, "TOPPING", "Topping", OptionGroupType.TOPPING);
    const pearl = await createOptionValue(branchId, toppingGroup.id, "PEARL", "Pearl");
    const response = await request(app.getHttpServer())
      .put(`/api/v1/products/${productId}/option-rules`)
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({
        groups: [
          { optionGroupId: sizeGroup.id, isRequired: true, minSelections: 1, maxSelections: 1, values: [{ optionValueId: large.id, priceDelta: "5000.00", isDefault: true }] },
          { optionGroupId: toppingGroup.id, isRequired: false, minSelections: 0, maxSelections: 1, values: [{ optionValueId: pearl.id, priceDelta: "7000.00" }] }
        ]
      })
      .expect(200);
    const product = dataOf<ProductResponse>(response.body);
    const sizeOption = product.optionGroups.find((group) => group.code === "SIZE")?.values[0];
    const toppingOption = product.optionGroups.find((group) => group.code === "TOPPING")?.values[0];
    if (!sizeOption || !toppingOption) {
      throw new Error("Product option rules were not configured");
    }
    return {
      largeProductOptionValueId: sizeOption.id,
      pearlProductOptionValueId: toppingOption.id
    };
  }

  async function createOptionGroup(branchId: string, code: string, name: string, type: OptionGroupType): Promise<{ id: string }> {
    const response = await request(app.getHttpServer()).post("/api/v1/option-groups").set("Authorization", "Bearer admin-token").set("X-Branch-Id", branchId).send({ code, name, type }).expect(201);
    return { id: dataOf<IdResponse>(response.body).id };
  }

  async function createOptionValue(branchId: string, optionGroupId: string, code: string, name: string): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/option-values")
      .set("Authorization", "Bearer admin-token")
      .set("X-Branch-Id", branchId)
      .send({ optionGroupId, code, name })
      .expect(201);
    return { id: dataOf<IdResponse>(response.body).id };
  }
});

interface ApiEnvelope<T> {
  data: T;
}

interface IdResponse {
  id: string;
}

interface SetupResponse {
  branch: { id: string };
  admin: { id: string };
}

interface RoleListResponse {
  items: Array<{ id: string; code: string }>;
}

interface UnitResponse {
  id: string;
  code: string;
  name: string;
  symbol: string;
}

interface IngredientUnitResponse {
  conversionFactorToBase: string | null;
}

interface IngredientResponse {
  id: string;
  baseUnit: { id: string };
  units: Array<{ isDefault: boolean; conversionFactorToBase: string | null }>;
}

interface RecipeResponse {
  id: string;
  version: number;
  isActive: boolean;
}

interface RecipeListResponse {
  items: Array<{ id: string; isActive: boolean }>;
}

interface ProductResponse {
  optionGroups: Array<{ code: string; values: Array<{ id: string }> }>;
}

interface CreateRecipePayload {
  type: RecipeType;
  productOptionValueId?: string;
  name: string;
  items: Array<{ ingredientId: string; quantity: string }>;
}

function dataOf<T>(body: unknown): T {
  return (body as ApiEnvelope<T>).data;
}

function expectErrorCode(body: unknown, code: string): void {
  expect((body as { error: { code: string } }).error.code).toBe(code);
}


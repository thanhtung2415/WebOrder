import { Injectable } from "@nestjs/common";
import { AuditAction, IngredientStatus, OptionGroupType, Prisma, RecipeType, Unit, UnitDimension } from "@prisma/client";
import { badRequest, conflict, notFound, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { CreateIngredientDto, CreateRecipeDto, CreateUnitDto, Phase4ListQueryDto, UpdateIngredientDto, UpdateUnitDto, UpsertIngredientUnitDto } from "./dto/recipe.dto";
import { IngredientListResponse, IngredientResponse, IngredientUnitResponse, RecipeListResponse, RecipeResponse, UnitListResponse, UnitResponse } from "./recipe.types";
import { UnitConversionService } from "./unit-conversion.service";

type IngredientWithRelations = Prisma.IngredientGetPayload<{
  include: {
    baseUnit: true;
    ingredientUnits: { include: { unit: true } };
    unitConversions: true;
  };
}>;

type RecipeWithRelations = Prisma.RecipeGetPayload<{
  include: {
    items: {
      include: {
        ingredient: {
          include: { baseUnit: true };
        };
      };
    };
  };
}>;

@Injectable()
export class RecipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService,
    private readonly unitConversionService: UnitConversionService
  ) {}

  async listUnits(query: Phase4ListQueryDto): Promise<UnitListResponse> {
    const units = await this.prisma.unit.findMany({
      where: {
        ...(this.isActiveOnly(query) ? { isActive: true } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }, { symbol: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      orderBy: [{ dimension: "asc" }, { code: "asc" }]
    });
    return { items: units.map((unit) => this.toUnitResponse(unit)) };
  }

  async createUnit(dto: CreateUnitDto, context: BranchContext): Promise<UnitResponse> {
    try {
      const unit = await this.prisma.$transaction(async (tx) => {
        const created = await tx.unit.create({
          data: {
            code: this.normalizeCode(dto.code),
            name: dto.name.trim(),
            symbol: dto.symbol.trim(),
            dimension: dto.dimension,
            isActive: dto.isActive ?? true
          }
        });
        await this.writeAudit(tx, context, "unit", created.id, null, this.auditJson(created), "CREATE_UNIT");
        return created;
      });
      return this.toUnitResponse(unit);
    } catch (error) {
      this.rethrowUnique(error, "UNIT_CODE_EXISTS", "Unit code already exists");
      throw error;
    }
  }

  async updateUnit(id: string, dto: UpdateUnitDto, context: BranchContext): Promise<UnitResponse> {
    this.authorizationService.validateUuid(id, "INVALID_UNIT_ID");
    const before = await this.prisma.unit.findUnique({ where: { id } });
    if (!before) {
      throw notFound("UNIT_NOT_FOUND", "Unit not found");
    }
    if (dto.dimension && dto.dimension !== before.dimension) {
      await this.assertUnitDimensionCanChange(id);
    }
    const unit = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.symbol !== undefined ? { symbol: dto.symbol.trim() } : {}),
          ...(dto.dimension !== undefined ? { dimension: dto.dimension } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {})
        }
      });
      await this.writeAudit(tx, context, "unit", id, this.auditJson(before), this.auditJson(updated), "UPDATE_UNIT");
      return updated;
    });
    return this.toUnitResponse(unit);
  }

  async listIngredients(query: Phase4ListQueryDto): Promise<IngredientListResponse> {
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        deletedAt: null,
        ...(this.isActiveOnly(query) ? { status: IngredientStatus.ACTIVE } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      include: this.ingredientInclude(),
      orderBy: [{ code: "asc" }]
    });
    return { items: ingredients.map((ingredient) => this.toIngredientResponse(ingredient)) };
  }

  async createIngredient(dto: CreateIngredientDto, context: BranchContext): Promise<IngredientResponse> {
    this.authorizationService.validateUuid(dto.baseUnitId, "INVALID_UNIT_ID");
    await this.assertActiveUnit(dto.baseUnitId);
    try {
      const ingredient = await this.prisma.$transaction(async (tx) => {
        const created = await tx.ingredient.create({
          data: {
            code: this.normalizeCode(dto.code),
            name: dto.name.trim(),
            baseUnitId: dto.baseUnitId,
            status: dto.status ?? IngredientStatus.ACTIVE
          }
        });
        await tx.ingredientUnit.create({
          data: {
            ingredientId: created.id,
            unitId: dto.baseUnitId,
            isDefault: true,
            isActive: true
          }
        });
        const loaded = await tx.ingredient.findUniqueOrThrow({ where: { id: created.id }, include: this.ingredientInclude() });
        await this.writeAudit(tx, context, "ingredient", created.id, null, this.auditJson(loaded), "CREATE_INGREDIENT");
        return loaded;
      });
      return this.toIngredientResponse(ingredient);
    } catch (error) {
      this.rethrowUnique(error, "INGREDIENT_CODE_EXISTS", "Ingredient code already exists");
      throw error;
    }
  }

  async updateIngredient(id: string, dto: UpdateIngredientDto, context: BranchContext): Promise<IngredientResponse> {
    this.authorizationService.validateUuid(id, "INVALID_INGREDIENT_ID");
    const before = await this.prisma.ingredient.findFirst({ where: { id, deletedAt: null }, include: this.ingredientInclude() });
    if (!before) {
      throw notFound("INGREDIENT_NOT_FOUND", "Ingredient not found");
    }
    if (dto.baseUnitId && dto.baseUnitId !== before.baseUnitId) {
      this.authorizationService.validateUuid(dto.baseUnitId, "INVALID_UNIT_ID");
      await this.assertBaseUnitCanChange(id, dto.baseUnitId);
    }
    const ingredient = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ingredient.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.baseUnitId !== undefined ? { baseUnitId: dto.baseUnitId } : {})
        }
      });
      if (dto.baseUnitId && dto.baseUnitId !== before.baseUnitId) {
        await tx.ingredientUnit.updateMany({ where: { ingredientId: id }, data: { isDefault: false, isActive: false } });
        await tx.unitConversion.updateMany({ where: { ingredientId: id }, data: { isActive: false } });
        await tx.ingredientUnit.upsert({
          where: { ingredientId_unitId: { ingredientId: id, unitId: dto.baseUnitId } },
          create: { ingredientId: id, unitId: dto.baseUnitId, isDefault: true, isActive: true },
          update: { isDefault: true, isActive: true }
        });
      }
      const loaded = await tx.ingredient.findUniqueOrThrow({ where: { id: updated.id }, include: this.ingredientInclude() });
      await this.writeAudit(tx, context, "ingredient", id, this.auditJson(before), this.auditJson(loaded), "UPDATE_INGREDIENT");
      return loaded;
    });
    return this.toIngredientResponse(ingredient);
  }

  async getIngredientUnit(ingredientId: string, unitId: string): Promise<IngredientUnitResponse> {
    this.authorizationService.validateUuid(ingredientId, "INVALID_INGREDIENT_ID");
    this.authorizationService.validateUuid(unitId, "INVALID_UNIT_ID");
    const ingredient = await this.prisma.ingredient.findFirst({ where: { id: ingredientId, deletedAt: null }, include: this.ingredientInclude() });
    if (!ingredient) {
      throw notFound("INGREDIENT_NOT_FOUND", "Ingredient not found");
    }
    const ingredientUnit = ingredient.ingredientUnits.find((unit) => unit.unitId === unitId);
    if (!ingredientUnit) {
      throw notFound("INGREDIENT_UNIT_NOT_FOUND", "Ingredient allowed unit not found");
    }
    return this.toIngredientUnitResponse(ingredient, ingredientUnit);
  }

  async upsertIngredientUnit(ingredientId: string, unitId: string, dto: UpsertIngredientUnitDto, context: BranchContext): Promise<IngredientUnitResponse> {
    this.authorizationService.validateUuid(ingredientId, "INVALID_INGREDIENT_ID");
    this.authorizationService.validateUuid(unitId, "INVALID_UNIT_ID");
    const before = await this.prisma.ingredient.findFirst({ where: { id: ingredientId, deletedAt: null }, include: this.ingredientInclude() });
    if (!before) {
      throw notFound("INGREDIENT_NOT_FOUND", "Ingredient not found");
    }
    const unit = await this.assertActiveUnit(unitId);
    const baseUnit = before.baseUnit;
    if (unitId === before.baseUnitId && dto.isActive === false) {
      throw badRequest("INVALID_UNIT_CONVERSION", "Base unit cannot be disabled for an ingredient");
    }
    if (dto.isDefault === true && dto.isActive === false) {
      throw badRequest("VALIDATION_ERROR", "Inactive unit cannot be default");
    }
    let factor: Prisma.Decimal | null = null;
    if (unitId !== before.baseUnitId) {
      if (!dto.conversionFactor) {
        const existing = before.unitConversions.find((conversion) => conversion.fromUnitId === unitId && conversion.toUnitId === before.baseUnitId && conversion.isActive);
        if (!existing) {
          throw unprocessable("INVALID_UNIT_CONVERSION", "Conversion factor is required before allowing this unit");
        }
      } else {
        factor = this.unitConversionService.positiveDecimal(dto.conversionFactor, "INVALID_UNIT_CONVERSION", 6);
      }
      this.unitConversionService.assertCompatibleDimensions(unit, baseUnit);
    }

    const ingredient = await this.prisma.$transaction(async (tx) => {
      if (factor && (dto.isActive ?? true)) {
        await tx.unitConversion.upsert({
          where: { ingredientId_fromUnitId_toUnitId: { ingredientId, fromUnitId: unitId, toUnitId: before.baseUnitId } },
          create: {
            ingredientId,
            fromUnitId: unitId,
            toUnitId: before.baseUnitId,
            conversionFactor: factor,
            isActive: true,
            createdById: context.user.id
          },
          update: { conversionFactor: factor, isActive: true }
        });
      }
      if (dto.isDefault === true) {
        await tx.ingredientUnit.updateMany({ where: { ingredientId }, data: { isDefault: false } });
      }
      const allowedUnit = await tx.ingredientUnit.upsert({
        where: { ingredientId_unitId: { ingredientId, unitId } },
        create: {
          ingredientId,
          unitId,
          label: dto.label?.trim() || null,
          isDefault: dto.isDefault ?? unitId === before.baseUnitId,
          isActive: dto.isActive ?? true
        },
        update: {
          ...(dto.label !== undefined ? { label: dto.label.trim() || null } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {})
        }
      });
      if (unitId !== before.baseUnitId && allowedUnit.isActive === false) {
        await tx.unitConversion.updateMany({ where: { ingredientId, fromUnitId: unitId, toUnitId: before.baseUnitId }, data: { isActive: false } });
      }
      const loaded = await tx.ingredient.findUniqueOrThrow({ where: { id: ingredientId }, include: this.ingredientInclude() });
      await this.writeAudit(tx, context, "ingredient", ingredientId, this.auditJson(before), this.auditJson(loaded), "UPDATE_INGREDIENT_UNIT");
      return loaded;
    });
    const ingredientUnit = ingredient.ingredientUnits.find((allowedUnit) => allowedUnit.unitId === unitId);
    if (!ingredientUnit) {
      throw notFound("INGREDIENT_UNIT_NOT_FOUND", "Ingredient allowed unit not found");
    }
    return this.toIngredientUnitResponse(ingredient, ingredientUnit);
  }

  async listProductRecipes(productId: string, context: BranchContext): Promise<RecipeListResponse> {
    await this.assertProductInBranch(productId, context.branch.id);
    const recipes = await this.prisma.recipe.findMany({
      where: { productId },
      include: this.recipeInclude(),
      orderBy: [{ type: "asc" }, { productOptionValueId: "asc" }, { version: "desc" }]
    });
    return { items: recipes.map((recipe) => this.toRecipeResponse(recipe)) };
  }

  async createRecipe(productId: string, dto: CreateRecipeDto, context: BranchContext): Promise<RecipeResponse> {
    await this.assertProductInBranch(productId, context.branch.id);
    await this.assertRecipeTarget(productId, dto);
    const items = await this.buildRecipeItems(dto.items);
    const recipe = await this.prisma.$transaction(async (tx) => {
      const nextVersion = await this.nextRecipeVersion(tx, productId, dto.type, dto.productOptionValueId ?? null);
      const created = await tx.recipe.create({
        data: {
          productId,
          productOptionValueId: dto.productOptionValueId ?? null,
          type: dto.type,
          name: dto.name.trim(),
          version: nextVersion,
          isActive: false,
          items: { createMany: { data: items } }
        },
        include: this.recipeInclude()
      });
      await this.writeAudit(tx, context, "recipe", created.id, null, this.auditJson(created), "CREATE_RECIPE");
      return created;
    });
    return this.toRecipeResponse(recipe);
  }

  async activateRecipe(recipeId: string, context: BranchContext): Promise<RecipeResponse> {
    this.authorizationService.validateUuid(recipeId, "INVALID_RECIPE_ID");
    const before = await this.prisma.recipe.findUnique({
      where: { id: recipeId },
      include: {
        ...this.recipeInclude(),
        product: true
      }
    });
    if (!before || before.product.branchId !== context.branch.id || before.product.deletedAt) {
      throw notFound("RECIPE_NOT_FOUND", "Recipe not found");
    }
    this.assertRecipeComplete(before);
    const recipe = await this.prisma.$transaction(async (tx) => {
      if (before.type === RecipeType.BASE) {
        await tx.recipe.updateMany({ where: { productId: before.productId, type: RecipeType.BASE, isActive: true, id: { not: before.id } }, data: { isActive: false } });
      } else if (before.productOptionValueId) {
        await tx.recipe.updateMany({ where: { productOptionValueId: before.productOptionValueId, isActive: true, id: { not: before.id } }, data: { isActive: false } });
      }
      const updated = await tx.recipe.update({ where: { id: before.id }, data: { isActive: true }, include: this.recipeInclude() });
      await this.writeAudit(tx, context, "recipe", updated.id, this.auditJson(before), this.auditJson(updated), "ACTIVATE_RECIPE");
      await tx.realtimeOutbox.create({
        data: {
          branchId: context.branch.id,
          eventType: "PRODUCT_AVAILABILITY_CHANGED",
          aggregateType: "product",
          aggregateId: updated.productId,
          payload: {
            reason: "RECIPE_ACTIVATED",
            recipeId: updated.id,
            requestId: this.requestContext.getRequestId() ?? null
          }
        }
      });
      return updated;
    });
    return this.toRecipeResponse(recipe);
  }

  private ingredientInclude() {
    return {
      baseUnit: true,
      ingredientUnits: {
        include: { unit: true },
        orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }]
      },
      unitConversions: true
    };
  }

  private recipeInclude() {
    return {
      items: {
        include: {
          ingredient: { include: { baseUnit: true } }
        },
        orderBy: [{ createdAt: "asc" as const }]
      }
    };
  }

  private async assertActiveUnit(unitId: string): Promise<Unit> {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit || !unit.isActive) {
      throw badRequest("UNIT_NOT_FOUND", "Active unit not found");
    }
    return unit;
  }

  private async assertUnitDimensionCanChange(unitId: string): Promise<void> {
    const references = await Promise.all([
      this.prisma.ingredient.count({ where: { baseUnitId: unitId, deletedAt: null } }),
      this.prisma.ingredientUnit.count({ where: { unitId } }),
      this.prisma.unitConversion.count({ where: { OR: [{ fromUnitId: unitId }, { toUnitId: unitId }] } }),
      this.prisma.inventoryTransaction.count({ where: { inputUnitId: unitId } })
    ]);
    if (references.some((count) => count > 0)) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Unit dimension cannot change after it is referenced");
    }
  }

  private async assertBaseUnitCanChange(ingredientId: string, newBaseUnitId: string): Promise<void> {
    await this.assertActiveUnit(newBaseUnitId);
    const [ledgerCount, recipeItemCount, extraUnitCount] = await Promise.all([
      this.prisma.inventoryTransaction.count({ where: { inventory: { ingredientId } } }),
      this.prisma.recipeItem.count({ where: { ingredientId } }),
      this.prisma.ingredientUnit.count({ where: { ingredientId, isActive: true, unitId: { not: newBaseUnitId } } })
    ]);
    if (ledgerCount > 0 || recipeItemCount > 0 || extraUnitCount > 0) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Ingredient base unit cannot change after history, recipes or conversions exist");
    }
  }

  private async assertProductInBranch(productId: string, branchId: string): Promise<void> {
    this.authorizationService.validateUuid(productId, "INVALID_PRODUCT_ID");
    const product = await this.prisma.product.findFirst({ where: { id: productId, branchId, deletedAt: null } });
    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Product not found");
    }
  }

  private async assertRecipeTarget(productId: string, dto: CreateRecipeDto): Promise<void> {
    if (dto.type === RecipeType.BASE && dto.productOptionValueId) {
      throw badRequest("INVALID_RECIPE_TARGET", "Base recipe cannot target an option value");
    }
    if (dto.type !== RecipeType.BASE && !dto.productOptionValueId) {
      throw badRequest("INVALID_RECIPE_TARGET", "Option recipe requires a product option value");
    }
    if (!dto.productOptionValueId) {
      return;
    }
    const optionValue = await this.prisma.productOptionValue.findFirst({
      where: {
        id: dto.productOptionValueId,
        productOptionGroup: { productId }
      },
      include: { productOptionGroup: { include: { optionGroup: true } } }
    });
    if (!optionValue) {
      throw badRequest("INVALID_OPTION", "Product option value does not belong to this product");
    }
    const groupType = optionValue.productOptionGroup.optionGroup.type;
    if (dto.type === RecipeType.SIZE && groupType !== OptionGroupType.SIZE) {
      throw badRequest("INVALID_RECIPE_TARGET", "Size recipe must target a SIZE option");
    }
    if (dto.type === RecipeType.ADD_ON && groupType === OptionGroupType.SIZE) {
      throw badRequest("INVALID_RECIPE_TARGET", "Add-on recipe cannot target a SIZE option");
    }
  }

  private async buildRecipeItems(items: CreateRecipeDto["items"]): Promise<Array<{ ingredientId: string; quantity: Prisma.Decimal }>> {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.ingredientId)) {
        throw badRequest("VALIDATION_ERROR", "Duplicate ingredient in recipe");
      }
      seen.add(item.ingredientId);
    }
    const ingredients = await this.prisma.ingredient.findMany({ where: { id: { in: [...seen] }, deletedAt: null } });
    if (ingredients.length !== seen.size || ingredients.some((ingredient) => ingredient.status !== IngredientStatus.ACTIVE)) {
      throw badRequest("INGREDIENT_NOT_FOUND", "All recipe ingredients must exist and be active");
    }
    return items.map((item) => ({
      ingredientId: item.ingredientId,
      quantity: this.unitConversionService.positiveDecimal(item.quantity, "VALIDATION_ERROR", 3)
    }));
  }

  private async nextRecipeVersion(tx: Prisma.TransactionClient, productId: string, type: RecipeType, productOptionValueId: string | null): Promise<number> {
    const last = await tx.recipe.findFirst({
      where: {
        productId,
        type,
        ...(productOptionValueId ? { productOptionValueId } : { productOptionValueId: null })
      },
      orderBy: { version: "desc" }
    });
    return (last?.version ?? 0) + 1;
  }

  private assertRecipeComplete(recipe: RecipeWithRelations): void {
    if (recipe.items.length === 0 || recipe.items.some((item) => item.quantity.lte(0) || item.ingredient.status !== IngredientStatus.ACTIVE)) {
      throw unprocessable("RECIPE_NOT_CONFIGURED", "Recipe must have active ingredients and positive quantities before activation");
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    entityType: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
    phaseAction: string
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        branchId: context.branch.id,
        actorId: context.user.id,
        action: AuditAction.UPDATE_RECIPE,
        entityType,
        entityId,
        beforeData: beforeData ?? Prisma.JsonNull,
        afterData: afterData ?? Prisma.JsonNull,
        metadata: {
          phaseAction,
          requestId: this.requestContext.getRequestId() ?? null
        },
        requestId: this.requestContext.getRequestId() ?? null
      }
    });
  }

  private auditJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toIngredientResponse(ingredient: IngredientWithRelations): IngredientResponse {
    return {
      id: ingredient.id,
      code: ingredient.code,
      name: ingredient.name,
      status: ingredient.status,
      baseUnit: this.toUnitResponse(ingredient.baseUnit),
      units: ingredient.ingredientUnits.map((unit) => this.toIngredientUnitResponse(ingredient, unit)),
      createdAt: ingredient.createdAt.toISOString(),
      updatedAt: ingredient.updatedAt.toISOString()
    };
  }

  private toIngredientUnitResponse(ingredient: IngredientWithRelations, ingredientUnit: IngredientWithRelations["ingredientUnits"][number]): IngredientUnitResponse {
    const conversion = ingredient.unitConversions.find((item) => item.fromUnitId === ingredientUnit.unitId && item.toUnitId === ingredient.baseUnitId && item.isActive);
    return {
      id: ingredientUnit.id,
      ingredientId: ingredient.id,
      unit: this.toUnitResponse(ingredientUnit.unit),
      label: ingredientUnit.label,
      isDefault: ingredientUnit.isDefault,
      isActive: ingredientUnit.isActive,
      conversionFactorToBase: ingredientUnit.unitId === ingredient.baseUnitId ? "1.000000" : conversion?.conversionFactor.toFixed(6) ?? null,
      createdAt: ingredientUnit.createdAt.toISOString(),
      updatedAt: ingredientUnit.updatedAt.toISOString()
    };
  }

  private toRecipeResponse(recipe: RecipeWithRelations): RecipeResponse {
    return {
      id: recipe.id,
      productId: recipe.productId,
      productOptionValueId: recipe.productOptionValueId,
      type: recipe.type,
      name: recipe.name,
      version: recipe.version,
      isActive: recipe.isActive,
      items: recipe.items.map((item) => ({
        id: item.id,
        ingredient: {
          id: item.ingredient.id,
          code: item.ingredient.code,
          name: item.ingredient.name,
          status: item.ingredient.status,
          baseUnit: this.toUnitResponse(item.ingredient.baseUnit)
        },
        quantity: item.quantity.toFixed(3)
      })),
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString()
    };
  }

  private toUnitResponse(unit: Unit): UnitResponse {
    return {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      symbol: unit.symbol,
      dimension: unit.dimension as UnitDimension,
      isActive: unit.isActive,
      createdAt: unit.createdAt.toISOString(),
      updatedAt: unit.updatedAt.toISOString()
    };
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private isActiveOnly(query: Phase4ListQueryDto): boolean {
    return query.activeOnly === "true";
  }

  private rethrowUnique(error: unknown, code: string, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(code, message);
    }
  }
}

import { Injectable } from "@nestjs/common";
import { IngredientStatus, Prisma, RecipeType } from "@prisma/client";
import { badRequest, notFound, unprocessable } from "../../common/errors/api-exception";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { ResolvedRecipe } from "./recipe.types";

type ActiveRecipe = Prisma.RecipeGetPayload<{
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
export class RecipeResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService
  ) {}

  async resolveProductRecipe(productId: string, optionValueIds: string[], context?: BranchContext): Promise<ResolvedRecipe> {
    return this.resolveProductRecipeInTx(this.prisma, productId, optionValueIds, context?.branch.id);
  }

  async resolveProductRecipeInTx(tx: Prisma.TransactionClient | PrismaService, productId: string, optionValueIds: string[], branchId?: string): Promise<ResolvedRecipe> {
    this.authorizationService.validateUuid(productId, "INVALID_PRODUCT_ID");
    for (const optionValueId of optionValueIds) {
      this.authorizationService.validateUuid(optionValueId, "INVALID_OPTION");
    }
    const uniqueOptionValueIds = [...new Set(optionValueIds)].sort();
    const product = await tx.product.findFirst({
      where: {
        id: productId,
        deletedAt: null,
        ...(branchId ? { branchId } : {})
      }
    });
    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Product not found");
    }

    if (uniqueOptionValueIds.length > 0) {
      const matchedOptions = await tx.productOptionValue.findMany({
        where: {
          id: { in: uniqueOptionValueIds },
          isActive: true,
          productOptionGroup: { productId }
        },
        select: { id: true }
      });
      if (matchedOptions.length !== uniqueOptionValueIds.length) {
        throw badRequest("INVALID_OPTION", "Selected option does not belong to this product");
      }
    }

    const baseRecipe = await tx.recipe.findFirst({
      where: { productId, type: RecipeType.BASE, isActive: true },
      include: this.activeRecipeInclude()
    });
    if (!baseRecipe) {
      throw unprocessable("RECIPE_NOT_CONFIGURED", "Product active base recipe is missing");
    }
    const optionRecipes = uniqueOptionValueIds.length
      ? await tx.recipe.findMany({
          where: { productId, productOptionValueId: { in: uniqueOptionValueIds }, isActive: true },
          include: this.activeRecipeInclude(),
          orderBy: [{ productOptionValueId: "asc" }]
        })
      : [];
    const configuredOptionIds = new Set(optionRecipes.map((recipe) => recipe.productOptionValueId).filter(Boolean));
    const missingOptionRecipe = uniqueOptionValueIds.find((id) => !configuredOptionIds.has(id));
    if (missingOptionRecipe) {
      throw unprocessable("RECIPE_NOT_CONFIGURED", "Selected option active recipe is missing");
    }

    const totals = new Map<string, { code: string; name: string; quantity: Prisma.Decimal; unit: ActiveRecipe["items"][number]["ingredient"]["baseUnit"] }>();
    for (const recipe of [baseRecipe, ...optionRecipes]) {
      this.assertRecipeUsable(recipe);
      for (const item of recipe.items) {
        const current = totals.get(item.ingredientId);
        totals.set(item.ingredientId, {
          code: item.ingredient.code,
          name: item.ingredient.name,
          unit: item.ingredient.baseUnit,
          quantity: current ? current.quantity.add(item.quantity) : item.quantity
        });
      }
    }

    return {
      productId,
      optionValueIds: uniqueOptionValueIds,
      ingredients: [...totals.entries()]
        .sort((left, right) => left[1].code.localeCompare(right[1].code) || left[0].localeCompare(right[0]))
        .map(([ingredientId, item]) => ({
          ingredientId,
          code: item.code,
          name: item.name,
          quantity: item.quantity.toFixed(3),
          unit: {
            id: item.unit.id,
            code: item.unit.code,
            name: item.unit.name,
            symbol: item.unit.symbol,
            dimension: item.unit.dimension,
            isActive: item.unit.isActive,
            createdAt: item.unit.createdAt.toISOString(),
            updatedAt: item.unit.updatedAt.toISOString()
          }
        }))
    };
  }

  private activeRecipeInclude() {
    return {
      items: {
        include: {
          ingredient: {
            include: { baseUnit: true }
          }
        },
        orderBy: [{ createdAt: "asc" as const }]
      }
    };
  }

  private assertRecipeUsable(recipe: ActiveRecipe): void {
    if (recipe.items.length === 0) {
      throw unprocessable("RECIPE_NOT_CONFIGURED", "Active recipe has no items");
    }
    for (const item of recipe.items) {
      if (item.quantity.lte(0) || item.ingredient.status !== IngredientStatus.ACTIVE || item.ingredient.deletedAt) {
        throw unprocessable("RECIPE_NOT_CONFIGURED", "Active recipe contains invalid ingredients");
      }
    }
  }
}

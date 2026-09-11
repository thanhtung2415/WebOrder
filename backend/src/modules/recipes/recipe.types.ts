import { IngredientStatus, RecipeType, UnitDimension } from "@prisma/client";

export interface UnitResponse {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnitListResponse {
  items: UnitResponse[];
}

export interface IngredientUnitResponse {
  id: string;
  ingredientId: string;
  unit: UnitResponse;
  label: string | null;
  isDefault: boolean;
  isActive: boolean;
  conversionFactorToBase: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IngredientResponse {
  id: string;
  code: string;
  name: string;
  status: IngredientStatus;
  baseUnit: UnitResponse;
  units: IngredientUnitResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface IngredientListResponse {
  items: IngredientResponse[];
}

export interface RecipeItemResponse {
  id: string;
  ingredient: {
    id: string;
    code: string;
    name: string;
    status: IngredientStatus;
    baseUnit: UnitResponse;
  };
  quantity: string;
}

export interface RecipeResponse {
  id: string;
  productId: string;
  productOptionValueId: string | null;
  type: RecipeType;
  name: string;
  version: number;
  isActive: boolean;
  items: RecipeItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface RecipeListResponse {
  items: RecipeResponse[];
}

export interface ResolvedRecipeIngredient {
  ingredientId: string;
  code: string;
  name: string;
  quantity: string;
  unit: UnitResponse;
}

export interface ResolvedRecipe {
  productId: string;
  optionValueIds: string[];
  ingredients: ResolvedRecipeIngredient[];
}


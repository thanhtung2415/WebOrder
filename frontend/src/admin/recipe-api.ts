import { apiClient } from "../services/api-client";
import { RequestContext } from "./menu-api";

export type UnitDimension = "MASS" | "VOLUME" | "COUNT" | "PACKAGE";
export type IngredientStatus = "ACTIVE" | "INACTIVE";
export type RecipeType = "BASE" | "SIZE" | "ADD_ON";

export interface Unit {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  isActive: boolean;
}

export interface IngredientUnit {
  id: string;
  ingredientId: string;
  unit: Unit;
  label: string | null;
  isDefault: boolean;
  isActive: boolean;
  conversionFactorToBase: string | null;
}

export interface Ingredient {
  id: string;
  code: string;
  name: string;
  status: IngredientStatus;
  baseUnit: Unit;
  units: IngredientUnit[];
}

export interface Recipe {
  id: string;
  productId: string;
  productOptionValueId: string | null;
  type: RecipeType;
  name: string;
  version: number;
  isActive: boolean;
  items: Array<{
    id: string;
    ingredient: Ingredient;
    quantity: string;
  }>;
}

export interface UnitPayload {
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  isActive?: boolean;
}

export interface IngredientPayload {
  code: string;
  name: string;
  baseUnitId: string;
  status?: IngredientStatus;
}

export interface IngredientUnitPayload {
  label?: string;
  conversionFactor?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface RecipePayload {
  type: RecipeType;
  productOptionValueId?: string;
  name: string;
  items: Array<{ ingredientId: string; quantity: string }>;
}

interface ListParams {
  q?: string;
  activeOnly?: boolean;
}

function queryString(params: ListParams): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function listUnits(context: RequestContext, params: ListParams = {}): Promise<Unit[]> {
  const response = await apiClient.request<{ items: Unit[] }>(`/units${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createUnit(context: RequestContext, payload: UnitPayload): Promise<Unit> {
  const response = await apiClient.request<Unit>("/units", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateUnit(context: RequestContext, unitId: string, payload: Partial<UnitPayload>): Promise<Unit> {
  const response = await apiClient.request<Unit>(`/units/${unitId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listIngredients(context: RequestContext, params: ListParams = {}): Promise<Ingredient[]> {
  const response = await apiClient.request<{ items: Ingredient[] }>(`/ingredients${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createIngredient(context: RequestContext, payload: IngredientPayload): Promise<Ingredient> {
  const response = await apiClient.request<Ingredient>("/ingredients", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateIngredient(context: RequestContext, ingredientId: string, payload: Partial<IngredientPayload>): Promise<Ingredient> {
  const response = await apiClient.request<Ingredient>(`/ingredients/${ingredientId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function upsertIngredientUnit(context: RequestContext, ingredientId: string, unitId: string, payload: IngredientUnitPayload): Promise<IngredientUnit> {
  const response = await apiClient.request<IngredientUnit>(`/ingredients/${ingredientId}/units/${unitId}`, {
    method: "PUT",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listProductRecipes(context: RequestContext, productId: string): Promise<Recipe[]> {
  const response = await apiClient.request<{ items: Recipe[] }>(`/products/${productId}/recipes`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createRecipe(context: RequestContext, productId: string, payload: RecipePayload): Promise<Recipe> {
  const response = await apiClient.request<Recipe>(`/products/${productId}/recipes`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function activateRecipe(context: RequestContext, recipeId: string): Promise<Recipe> {
  const response = await apiClient.request<Recipe>(`/recipes/${recipeId}/activation`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}


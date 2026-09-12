import { createRequestId } from "../utils/request-id";
import { apiClient } from "../services/api-client";
import { RequestContext } from "./menu-api";
import { Unit } from "./recipe-api";

export type InventoryTransactionType = "IMPORT" | "ADJUSTMENT" | "WASTE" | "DAMAGED" | "STAFF_USE" | "STOCKTAKE";
export type StocktakeStatus = "DRAFT" | "COUNTING" | "COMPLETED" | "CANCELLED";

export interface InventoryIngredient {
  id: string;
  code: string;
  name: string;
  status: string;
  baseUnit: Unit;
}

export interface InventoryBalance {
  id: string | null;
  ingredient: InventoryIngredient;
  physicalQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  minimumQuantity: string;
  lowStock: boolean;
  lastUnitCost: string | null;
  version: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  inventoryId: string;
  ingredient: InventoryIngredient;
  type: InventoryTransactionType;
  quantityDelta: string;
  physicalQuantityAfter: string;
  unitCost: string | null;
  inputQuantity: string | null;
  inputUnit: Unit | null;
  conversionFactor: string | null;
  convertedBaseQuantity: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  reference: { orderItemId: string | null; stocktakeItemId: string | null };
  reason: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface StocktakeItem {
  id: string;
  inventoryId: string;
  ingredient: InventoryIngredient;
  expectedQuantity: string;
  countedQuantity: string;
  difference: string;
  note: string | null;
  updatedAt: string;
}

export interface Stocktake {
  id: string;
  code: string;
  status: StocktakeStatus;
  note: string | null;
  startedBy: { id: string; displayName: string; email: string };
  completedBy: { id: string; displayName: string; email: string } | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  items: StocktakeItem[];
}

interface InventoryParams {
  q?: string;
  lowStockOnly?: boolean;
}

interface LedgerParams {
  inventoryId?: string;
  ingredientId?: string;
  type?: InventoryTransactionType;
  cursor?: string | null;
  limit?: number;
}

export interface ImportPayload {
  ingredientId: string;
  inputQuantity: string;
  inputUnitId: string;
  unitCost?: string;
  reason: string;
}

export interface AdjustmentPayload {
  ingredientId: string;
  type: "ADJUSTMENT" | "WASTE" | "DAMAGED" | "STAFF_USE";
  quantity?: string;
  quantityDelta?: string;
  reason: string;
}

function queryString(params: object): string {
  const query = new URLSearchParams();
  Object.entries(params as Record<string, string | number | boolean | null | undefined>).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function listInventory(context: RequestContext, params: InventoryParams = {}): Promise<InventoryBalance[]> {
  const response = await apiClient.request<{ items: InventoryBalance[] }>(`/inventory${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function listInventoryTransactions(context: RequestContext, params: LedgerParams = {}): Promise<{ items: InventoryTransaction[]; nextCursor: string | null }> {
  const response = await apiClient.request<{ items: InventoryTransaction[]; nextCursor: string | null }>(`/inventory-transactions${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function importInventory(context: RequestContext, payload: ImportPayload): Promise<InventoryTransaction> {
  const response = await apiClient.request<InventoryTransaction>("/inventory-transactions", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { ...payload, type: "IMPORT" }
  });
  return response.data;
}

export async function adjustInventory(context: RequestContext, payload: AdjustmentPayload): Promise<InventoryTransaction> {
  const response = await apiClient.request<InventoryTransaction>("/inventory-transactions", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: payload
  });
  return response.data;
}

export async function listStocktakes(context: RequestContext): Promise<Stocktake[]> {
  const response = await apiClient.request<{ items: Stocktake[] }>("/stocktakes", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createStocktake(context: RequestContext, payload: { code?: string; note?: string }): Promise<Stocktake> {
  const response = await apiClient.request<Stocktake>("/stocktakes", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateStocktakeItem(context: RequestContext, stocktakeId: string, itemId: string, payload: { countedQuantity: string; note?: string }): Promise<Stocktake> {
  const response = await apiClient.request<Stocktake>(`/stocktakes/${stocktakeId}/items/${itemId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function completeStocktake(context: RequestContext, stocktakeId: string, payload: { note?: string }): Promise<Stocktake> {
  const response = await apiClient.request<Stocktake>(`/stocktakes/${stocktakeId}/completion`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: payload
  });
  return response.data;
}

export async function cancelStocktake(context: RequestContext, stocktakeId: string): Promise<Stocktake> {
  const response = await apiClient.request<Stocktake>(`/stocktakes/${stocktakeId}/cancellation`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}

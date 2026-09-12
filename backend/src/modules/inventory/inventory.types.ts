import { InventoryTransactionType, StocktakeStatus } from "@prisma/client";

export interface InventoryUnitResponse {
  id: string;
  code: string;
  name: string;
  symbol: string;
}

export interface InventoryIngredientResponse {
  id: string;
  code: string;
  name: string;
  status: string;
  baseUnit: InventoryUnitResponse;
}

export interface InventoryBalanceResponse {
  id: string | null;
  ingredient: InventoryIngredientResponse;
  physicalQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  minimumQuantity: string;
  lowStock: boolean;
  lastUnitCost: string | null;
  version: number;
  updatedAt: string;
}

export interface InventoryListResponse {
  items: InventoryBalanceResponse[];
}

export interface InventoryDetailResponse extends InventoryBalanceResponse {
  recentTransactions: InventoryTransactionResponse[];
}

export interface InventoryTransactionResponse {
  id: string;
  inventoryId: string;
  ingredient: InventoryIngredientResponse;
  type: InventoryTransactionType;
  quantityDelta: string;
  physicalQuantityAfter: string;
  unitCost: string | null;
  inputQuantity: string | null;
  inputUnit: InventoryUnitResponse | null;
  conversionFactor: string | null;
  convertedBaseQuantity: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  reference: { orderItemId: string | null; stocktakeItemId: string | null };
  reason: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface InventoryTransactionListResponse {
  items: InventoryTransactionResponse[];
  nextCursor: string | null;
}

export interface StocktakeItemResponse {
  id: string;
  inventoryId: string;
  ingredient: InventoryIngredientResponse;
  expectedQuantity: string;
  countedQuantity: string;
  difference: string;
  note: string | null;
  updatedAt: string;
}

export interface StocktakeResponse {
  id: string;
  code: string;
  status: StocktakeStatus;
  note: string | null;
  startedBy: { id: string; displayName: string; email: string };
  completedBy: { id: string; displayName: string; email: string } | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  items: StocktakeItemResponse[];
}

export interface StocktakeListResponse {
  items: StocktakeResponse[];
}

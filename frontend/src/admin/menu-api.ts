import { apiClient } from "../services/api-client";

export type ProcessingArea = "BAR" | "KITCHEN";
export type ProductStatus = "ACTIVE" | "INACTIVE";
export type OptionGroupType = "SIZE" | "TOPPING" | "SUGAR" | "ICE" | "CUSTOM";

export interface RequestContext {
  accessToken: string;
  branchId: string;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  basePrice: string;
  processingArea: ProcessingArea;
  status: ProductStatus;
  isFeatured: boolean;
  category: Category;
  availability: {
    isAvailable: boolean;
    inventoryAware: boolean;
    reason: string | null;
  };
  optionGroups?: ProductOptionGroup[];
}

export interface OptionGroup {
  id: string;
  code: string;
  name: string;
  type: OptionGroupType;
  sortOrder: number;
  isActive: boolean;
}

export interface OptionValue {
  id: string;
  optionGroupId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  optionGroup: OptionGroup;
}

export interface ProductOptionGroup {
  id: string;
  optionGroupId: string;
  code: string;
  name: string;
  type: OptionGroupType;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  values: ProductOptionValue[];
}

export interface ProductOptionValue {
  id: string;
  optionValueId: string;
  code: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface CategoryPayload {
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ProductPayload {
  code: string;
  name: string;
  categoryId: string;
  basePrice: string;
  description?: string;
  processingArea: ProcessingArea;
  status?: ProductStatus;
  isFeatured?: boolean;
}

export interface OptionGroupPayload {
  code: string;
  name: string;
  type: OptionGroupType;
  sortOrder?: number;
  isActive?: boolean;
}

export interface OptionValuePayload {
  optionGroupId: string;
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ProductOptionRulesPayload {
  groups: Array<{
    optionGroupId: string;
    isRequired?: boolean;
    minSelections?: number;
    maxSelections?: number;
    sortOrder?: number;
    values: Array<{
      optionValueId: string;
      priceDelta?: string;
      isDefault?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    }>;
  }>;
}

interface ListParams {
  q?: string;
  activeOnly?: boolean;
  categoryId?: string;
  optionGroupId?: string;
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

export async function listCategories(context: RequestContext, params: ListParams = {}): Promise<Category[]> {
  const response = await apiClient.request<{ items: Category[] }>(`/categories${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createCategory(context: RequestContext, payload: CategoryPayload): Promise<Category> {
  const response = await apiClient.request<Category>("/categories", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateCategory(context: RequestContext, categoryId: string, payload: Partial<CategoryPayload>): Promise<Category> {
  const response = await apiClient.request<Category>(`/categories/${categoryId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listProducts(context: RequestContext, params: ListParams = {}): Promise<Product[]> {
  const response = await apiClient.request<{ items: Product[] }>(`/products${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createProduct(context: RequestContext, payload: ProductPayload): Promise<Product> {
  const response = await apiClient.request<Product>("/products", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateProduct(context: RequestContext, productId: string, payload: Partial<ProductPayload>): Promise<Product> {
  const response = await apiClient.request<Product>(`/products/${productId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function uploadProductImage(context: RequestContext, productId: string, file: File): Promise<Product> {
  const formData = new FormData();
  formData.append("image", file);
  const response = await apiClient.request<Product>(`/products/${productId}/image`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: formData
  });
  return response.data;
}

export async function replaceProductOptionRules(context: RequestContext, productId: string, payload: ProductOptionRulesPayload): Promise<Product> {
  const response = await apiClient.request<Product>(`/products/${productId}/option-rules`, {
    method: "PUT",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listOptionGroups(context: RequestContext, params: ListParams = {}): Promise<OptionGroup[]> {
  const response = await apiClient.request<{ items: OptionGroup[] }>(`/option-groups${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createOptionGroup(context: RequestContext, payload: OptionGroupPayload): Promise<OptionGroup> {
  const response = await apiClient.request<OptionGroup>("/option-groups", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateOptionGroup(context: RequestContext, optionGroupId: string, payload: Partial<OptionGroupPayload>): Promise<OptionGroup> {
  const response = await apiClient.request<OptionGroup>(`/option-groups/${optionGroupId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listOptionValues(context: RequestContext, params: ListParams = {}): Promise<OptionValue[]> {
  const response = await apiClient.request<{ items: OptionValue[] }>(`/option-values${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createOptionValue(context: RequestContext, payload: OptionValuePayload): Promise<OptionValue> {
  const response = await apiClient.request<OptionValue>("/option-values", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateOptionValue(context: RequestContext, optionValueId: string, payload: Partial<OptionValuePayload>): Promise<OptionValue> {
  const response = await apiClient.request<OptionValue>(`/option-values/${optionValueId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

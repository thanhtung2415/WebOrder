import { Product } from "../admin/menu-api";
import { apiClient } from "../services/api-client";

export async function fetchCustomerMenu(branchId: string, qrSessionToken: string): Promise<Product[]> {
  const response = await apiClient.request<{ items: Product[] }>("/products?activeOnly=true", {
    branchId,
    qrSessionToken
  });
  return response.data.items;
}

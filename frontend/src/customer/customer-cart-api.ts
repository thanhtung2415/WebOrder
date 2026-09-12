import { apiClient } from "../services/api-client";

export type CartStatus = "ACTIVE" | "ORDERED" | "ABANDONED" | "EXPIRED";
export type ReservationStatus = "ACTIVE" | "EXPIRED" | "RELEASED" | "UNAVAILABLE";

export interface CartItemPayload {
  productId?: string;
  quantity?: number;
  optionValueIds?: string[];
  note?: string;
  isTakeaway?: boolean;
}

export interface CartItemOption {
  id: string;
  productOptionValueId: string;
  optionGroupId: string;
  optionGroupCode: string;
  optionGroupName: string;
  optionValueId: string;
  optionValueCode: string;
  optionValueName: string;
  priceDelta: string;
}

export interface CartReservation {
  id: string;
  inventoryId: string;
  ingredientId: string;
  status: "ACTIVE" | "EXPIRED_PENDING" | "EXPIRED" | "RELEASED" | "CONSUMED";
  quantity: string;
  expiresAt: string;
  terminalAt: string | null;
}

export interface CartItem {
  id: string;
  product: {
    id: string;
    code: string;
    name: string;
    imagePath: string | null;
  };
  quantity: number;
  note: string | null;
  isTakeaway: boolean;
  unitPrice: string;
  lineSubtotal: string;
  reservationStatus: ReservationStatus;
  reservationExpiresAt: string | null;
  options: CartItemOption[];
  reservations: CartReservation[];
  createdAt: string;
  updatedAt: string;
}

export interface Cart {
  id: string;
  token: string;
  branchId: string;
  tableSessionId: string;
  status: CartStatus;
  items: CartItem[];
  subtotal: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCustomerCart(qrSessionToken: string, cartToken?: string): Promise<Cart> {
  const response = await apiClient.request<Cart>("/cart", {
    qrSessionToken,
    headers: cartToken ? { "X-Cart-Token": cartToken } : undefined
  });
  return response.data;
}

export async function addCustomerCartItem(qrSessionToken: string, payload: Required<Pick<CartItemPayload, "productId" | "quantity">> & CartItemPayload, cartToken?: string): Promise<Cart> {
  const response = await apiClient.request<Cart>("/cart/items", {
    method: "POST",
    qrSessionToken,
    headers: cartToken ? { "X-Cart-Token": cartToken } : undefined,
    body: payload
  });
  return response.data;
}

export async function updateCustomerCartItem(qrSessionToken: string, itemId: string, payload: CartItemPayload): Promise<Cart> {
  const response = await apiClient.request<Cart>(`/cart/items/${itemId}`, {
    method: "PATCH",
    qrSessionToken,
    body: payload
  });
  return response.data;
}

export async function deleteCustomerCartItem(qrSessionToken: string, itemId: string): Promise<Cart> {
  const response = await apiClient.request<Cart>(`/cart/items/${itemId}`, {
    method: "DELETE",
    qrSessionToken
  });
  return response.data;
}

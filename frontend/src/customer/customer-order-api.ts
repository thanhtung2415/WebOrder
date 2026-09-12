import { apiClient } from "../services/api-client";

export type OrderItemStatus = "NEW" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
export type ProcessingArea = "BAR" | "KITCHEN";

export interface OrderItemOption {
  id: string;
  productOptionValueId: string | null;
  groupType: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  priceDeltaSnapshot: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  processingArea: ProcessingArea;
  quantity: number;
  baseUnitPrice: string;
  optionUnitPrice: string;
  finalUnitPrice: string;
  lineSubtotal: string;
  note: string | null;
  isTakeaway: boolean;
  status: OrderItemStatus;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  options: OrderItemOption[];
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  branchId: string;
  tableSessionId: string;
  cartId: string | null;
  orderNumber: string;
  source: "CUSTOMER" | "STAFF";
  createdById: string | null;
  table: { id: string; code: string; displayName: string };
  items: OrderItem[];
  subtotal: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListResponse {
  items: Order[];
}

export async function confirmCustomerOrder(qrSessionToken: string, cartToken: string, idempotencyKey: string): Promise<Order> {
  const response = await apiClient.request<Order>("/orders", {
    method: "POST",
    qrSessionToken,
    idempotencyKey,
    headers: { "X-Cart-Token": cartToken },
    body: {}
  });
  return response.data;
}

export async function fetchCustomerSessionOrders(qrSessionToken: string, tableSessionId: string): Promise<OrderListResponse> {
  const response = await apiClient.request<OrderListResponse>(`/table-sessions/${tableSessionId}/orders`, {
    qrSessionToken
  });
  return response.data;
}

import { apiClient } from "../services/api-client";
import type { Order, OrderItemStatus, ProcessingArea } from "../customer/customer-order-api";

export interface StaffOrderContext {
  accessToken: string;
  branchId: string;
}

export type QueueUrgency = "GREEN" | "ORANGE" | "RED" | "OVERDUE";

export interface QueueItem {
  id: string;
  orderId: string;
  orderNumber: string;
  tableSessionId: string;
  table: { id: string; code: string; displayName: string };
  processingArea: ProcessingArea;
  productNameSnapshot: string;
  quantity: number;
  note: string | null;
  status: OrderItemStatus;
  options: Array<{ id: string; optionNameSnapshot: string; priceDeltaSnapshot: string }>;
  orderCreatedAt: string;
  createdAt: string;
  elapsedSeconds: number;
  urgency: QueueUrgency;
}

export interface QueueResponse {
  items: QueueItem[];
}

export async function fetchQueue(context: StaffOrderContext, area: Lowercase<ProcessingArea>): Promise<QueueResponse> {
  const response = await apiClient.request<QueueResponse>(`/${area}/queue`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function updateOrderItemStatus(context: StaffOrderContext, itemId: string, status: OrderItemStatus): Promise<Order> {
  const response = await apiClient.request<Order>(`/order-items/${itemId}/status`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { status }
  });
  return response.data;
}

export async function cancelOrderItem(context: StaffOrderContext, itemId: string, reason: string): Promise<Order> {
  const response = await apiClient.request<Order>(`/order-items/${itemId}/cancellation`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { reason }
  });
  return response.data;
}

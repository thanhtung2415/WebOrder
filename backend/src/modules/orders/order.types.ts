import { OrderItemStatus, OrderSource, ProcessingArea } from "@prisma/client";
import { BranchContext } from "../auth/branch-context";
import { QrSessionContext } from "../tables/table.types";

export type OrderAccessContext = { kind: "qr"; qr: QrSessionContext } | { kind: "staff"; branch: BranchContext };

export interface OrderItemOptionResponse {
  id: string;
  productOptionValueId: string | null;
  groupType: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  priceDeltaSnapshot: string;
}

export interface OrderItemResponse {
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
  options: OrderItemOptionResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderResponse {
  id: string;
  branchId: string;
  tableSessionId: string;
  cartId: string | null;
  orderNumber: string;
  source: OrderSource;
  createdById: string | null;
  table: {
    id: string;
    code: string;
    displayName: string;
  };
  items: OrderItemResponse[];
  subtotal: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListResponse {
  items: OrderResponse[];
}

export interface QueueItemResponse {
  id: string;
  orderId: string;
  orderNumber: string;
  tableSessionId: string;
  table: {
    id: string;
    code: string;
    displayName: string;
  };
  processingArea: ProcessingArea;
  productNameSnapshot: string;
  quantity: number;
  note: string | null;
  status: OrderItemStatus;
  options: OrderItemOptionResponse[];
  orderCreatedAt: string;
  createdAt: string;
  elapsedSeconds: number;
  urgency: "GREEN" | "ORANGE" | "RED" | "OVERDUE";
}

export interface QueueResponse {
  items: QueueItemResponse[];
}

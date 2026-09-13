import { BillStatus } from "@prisma/client";

export interface BillItemResponse {
  id: string;
  orderItemId: string;
  productId: string;
  productNameSnapshot: string;
  quantity: number;
  orderedQuantity: number;
  unitPriceSnapshot: string;
  lineAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillResponse {
  id: string;
  branchId: string;
  tableSessionId: string;
  mergedIntoBillId: string | null;
  billNumber: string;
  status: BillStatus;
  subtotal: string;
  voucherDiscountAmount: string;
  directDiscountAmount: string;
  discountedAmount: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  issuedById: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  voidedById: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  mergedById: string | null;
  mergedAt: string | null;
  mergeReason: string | null;
  items: BillItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface UnbilledOrderItemResponse {
  orderItemId: string;
  productId: string;
  productNameSnapshot: string;
  orderedQuantity: number;
  billedQuantity: number;
  remainingQuantity: number;
  unitPrice: string;
  remainingAmount: string;
}

export interface SessionBillingResponse {
  tableSessionId: string;
  bills: BillResponse[];
  unbilledItems: UnbilledOrderItemResponse[];
}

import { BillAdjustmentSource, BillAdjustmentStatus, BillStatus, DiscountType, VoucherStatus } from "@prisma/client";

export interface VoucherResponse {
  id: string;
  branchId: string;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: string;
  maximumDiscount: string | null;
  minimumSubtotal: string;
  usageLimit: number | null;
  startsAt: string;
  endsAt: string | null;
  status: VoucherStatus;
  createdAt: string;
  updatedAt: string;
}

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

export interface BillAdjustmentResponse {
  id: string;
  billId: string;
  source: BillAdjustmentSource;
  discountType: DiscountType;
  discountValue: string;
  discountAmount: string;
  voucherId: string | null;
  codeSnapshot: string | null;
  status: BillAdjustmentStatus;
  appliedById: string;
  reversedById: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  isOverride: boolean;
  overrideById: string | null;
  overrideReason: string | null;
  overrideBefore: unknown;
  overrideAfter: unknown;
  createdAt: string;
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
  adjustments: BillAdjustmentResponse[];
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

import { apiClient } from "../services/api-client";
import { createRequestId } from "../utils/request-id";

export type BillStatus = "DRAFT" | "ISSUED" | "PAID" | "MERGED" | "VOID";
export type DiscountType = "PERCENT" | "FIXED_AMOUNT";
export type VoucherStatus = "ACTIVE" | "INACTIVE";

export interface StaffBillingContext {
  accessToken: string;
  branchId: string;
}

export interface BillAllocationInput {
  orderItemId: string;
  quantity: number;
}

export interface BillItem {
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

export interface Voucher {
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

export interface BillAdjustment {
  id: string;
  billId: string;
  source: "VOUCHER" | "DIRECT_DISCOUNT";
  discountType: DiscountType;
  discountValue: string;
  discountAmount: string;
  voucherId: string | null;
  codeSnapshot: string | null;
  status: "ACTIVE" | "REVERSED";
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

export interface Bill {
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
  items: BillItem[];
  adjustments: BillAdjustment[];
  createdAt: string;
  updatedAt: string;
}

export interface UnbilledOrderItem {
  orderItemId: string;
  productId: string;
  productNameSnapshot: string;
  orderedQuantity: number;
  billedQuantity: number;
  remainingQuantity: number;
  unitPrice: string;
  remainingAmount: string;
}

export interface SessionBilling {
  tableSessionId: string;
  bills: Bill[];
  unbilledItems: UnbilledOrderItem[];
}

export interface SplitBillPartInput {
  items: BillAllocationInput[];
}

export interface SplitBillResponse {
  sourceBill: Bill;
  bills: Bill[];
}

export interface VoucherListResponse {
  items: Voucher[];
}

export interface CreateVoucherInput {
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  maximumDiscount?: number;
  minimumSubtotal?: number;
  usageLimit?: number;
  startsAt: string;
  endsAt?: string;
  status?: VoucherStatus;
}

export async function fetchSessionBilling(context: StaffBillingContext, tableSessionId: string): Promise<SessionBilling> {
  const response = await apiClient.request<SessionBilling>(`/table-sessions/${tableSessionId}/bills`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function createBill(context: StaffBillingContext, tableSessionId: string, items?: BillAllocationInput[]): Promise<Bill> {
  const response = await apiClient.request<Bill>("/bills", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { tableSessionId, items }
  });
  return response.data;
}

export async function issueBill(context: StaffBillingContext, billId: string): Promise<Bill> {
  const response = await apiClient.request<Bill>(`/bills/${billId}/issuance`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function splitBill(context: StaffBillingContext, billId: string, parts: SplitBillPartInput[]): Promise<SplitBillResponse> {
  const response = await apiClient.request<SplitBillResponse>(`/bills/${billId}/splits`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { parts }
  });
  return response.data;
}

export async function mergeBills(context: StaffBillingContext, targetBillId: string, sourceBillIds: string[], reason: string): Promise<Bill> {
  const response = await apiClient.request<Bill>("/bills/merges", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { targetBillId, sourceBillIds, reason }
  });
  return response.data;
}

export async function voidBill(context: StaffBillingContext, billId: string, reason: string): Promise<Bill> {
  const response = await apiClient.request<Bill>(`/bills/${billId}/voidance`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { reason }
  });
  return response.data;
}

export async function fetchVouchers(context: StaffBillingContext): Promise<VoucherListResponse> {
  const response = await apiClient.request<VoucherListResponse>("/vouchers", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function createVoucher(context: StaffBillingContext, input: CreateVoucherInput): Promise<Voucher> {
  const response = await apiClient.request<Voucher>("/vouchers", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: input
  });
  return response.data;
}

export async function updateVoucherStatus(context: StaffBillingContext, voucherId: string, status: VoucherStatus): Promise<Voucher> {
  const response = await apiClient.request<Voucher>(`/vouchers/${voucherId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { status }
  });
  return response.data;
}

export async function applyVoucher(context: StaffBillingContext, billId: string, voucherCode: string, overrideReason?: string): Promise<Bill> {
  const response = await apiClient.request<Bill>(`/bills/${billId}/voucher-applications`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { voucherCode, ...(overrideReason?.trim() ? { overrideReason: overrideReason.trim() } : {}) }
  });
  return response.data;
}

export async function applyDirectDiscount(context: StaffBillingContext, billId: string, discountType: DiscountType, discountValue: number, reason: string, overrideReason?: string): Promise<Bill> {
  const response = await apiClient.request<Bill>(`/bills/${billId}/direct-discounts`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { discountType, discountValue, reason, ...(overrideReason?.trim() ? { overrideReason: overrideReason.trim() } : {}) }
  });
  return response.data;
}

export async function reverseAdjustment(context: StaffBillingContext, adjustmentId: string, reason: string): Promise<Bill> {
  const response = await apiClient.request<Bill>(`/bill-adjustments/${adjustmentId}/reversal`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    idempotencyKey: createRequestId(),
    body: { reason }
  });
  return response.data;
}

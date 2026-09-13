import { Injectable } from "@nestjs/common";
import { AuditAction, BillAdjustmentSource, BillAdjustmentStatus, BillStatus, DiscountType, IdempotencyStatus, PaymentStatus, Prisma, SessionStatus, VoucherStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { ApiException, badRequest, conflict, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { stableStringify } from "../setup/stable-json";
import { BillAdjustmentResponse, BillResponse, SessionBillingResponse, UnbilledOrderItemResponse, VoucherResponse } from "./billing.types";
import { ApplyDirectDiscountDto, ApplyVoucherDto, BillAllocationDto, CreateBillDto, CreateVoucherDto, MergeBillsDto, ReverseBillAdjustmentDto, SplitBillDto, SplitBillPartDto, UpdateVoucherDto, VoidBillDto } from "./dto/billing.dto";

const EFFECTIVE_BILL_STATUSES: BillStatus[] = [BillStatus.DRAFT, BillStatus.ISSUED, BillStatus.PAID];
const MUTABLE_BILL_STATUSES: BillStatus[] = [BillStatus.DRAFT, BillStatus.ISSUED];
const ZERO = new Prisma.Decimal(0);
const VAT_RATE = new Prisma.Decimal(8);

type BillWithItems = Prisma.BillGetPayload<{
  include: {
    items: { include: { orderItem: true }; orderBy: [{ createdAt: "asc" }, { id: "asc" }] };
    adjustments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] };
  };
}>;

type VoucherRecord = Prisma.VoucherGetPayload<Record<string, never>>;

type AdjustmentRecord = Prisma.BillAdjustmentGetPayload<Record<string, never>>;

interface LockedSessionRow {
  id: string;
  branch_id: string;
  status: SessionStatus;
  closed_at: Date | null;
}

interface LockedBillRow {
  id: string;
  branch_id: string;
  table_session_id: string;
  status: BillStatus;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

interface LockedVoucherRow {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: Prisma.Decimal;
  maximum_discount: Prisma.Decimal | null;
  minimum_subtotal: Prisma.Decimal;
  usage_limit: number | null;
  starts_at: Date;
  ends_at: Date | null;
  status: VoucherStatus;
  deleted_at: Date | null;
}

interface LockedOrderItemRow {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  final_unit_price: Prisma.Decimal;
}

interface AllocationRow {
  order_item_id: string;
  quantity: bigint;
}

interface LockedIdempotencyRow {
  id: string;
  request_hash: string;
  response_body: Prisma.JsonValue | null;
  status: IdempotencyStatus;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService
  ) {}

  async getSessionBills(tableSessionId: string, context: BranchContext): Promise<SessionBillingResponse> {
    this.authorizationService.validateUuid(tableSessionId, "INVALID_SESSION_ID");
    await this.assertSessionInBranch(tableSessionId, context.branch.id);
    const [bills, unbilledItems] = await Promise.all([
      this.prisma.bill.findMany({
        where: { branchId: context.branch.id, tableSessionId },
        include: this.billInclude(),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      this.loadUnbilledItems(this.prisma, context.branch.id, tableSessionId)
    ]);
    return { tableSessionId, bills: bills.map((bill) => this.toBillResponse(bill)), unbilledItems };
  }

  async getBill(id: string, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    const bill = await this.prisma.bill.findFirst({ where: { id, branchId: context.branch.id }, include: this.billInclude() });
    if (!bill) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    return this.toBillResponse(bill);
  }

  async createBill(dto: CreateBillDto, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(dto.tableSessionId, "INVALID_SESSION_ID");
    return this.rethrowBillingErrors(
      this.prisma.$transaction(async (tx) => {
        await this.lockOpenSession(tx, context.branch.id, dto.tableSessionId);
        const requested = this.normalizeAllocations(dto.items ?? []);
        const orderItems = await this.lockOrderItems(tx, context.branch.id, dto.tableSessionId, requested.size ? [...requested.keys()] : undefined);
        if (requested.size && orderItems.length !== requested.size) {
          throw notFound("ORDER_ITEM_NOT_FOUND", "Order item not found");
        }

        const allocations = await this.resolveRequestedAllocations(tx, orderItems, requested);
        if (allocations.length === 0) {
          throw badRequest("NO_BILLABLE_ITEMS", "No unbilled order items are available");
        }

        const bill = await tx.bill.create({
          data: {
            branchId: context.branch.id,
            tableSessionId: dto.tableSessionId,
            billNumber: this.generateBillNumber()
          }
        });
        await this.createBillItems(tx, bill.id, allocations);
        const updated = await this.recalculateBill(tx, bill.id);
        await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "BILL_CREATED" });
        return this.toBillResponse(updated);
      })
    );
  }

  async issueBill(id: string, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    return this.rethrowBillingErrors(
      this.prisma.$transaction(async (tx) => {
        const bill = await this.lockBill(tx, context.branch.id, id);
        if (!bill) {
          throw notFound("BILL_NOT_FOUND", "Bill not found");
        }
        this.assertMutableBill(bill.status);
        await this.assertNoActivePayment(tx, bill.id);
        await this.recalculateBill(tx, bill.id);
        const issued = await tx.bill.update({
          where: { id: bill.id },
          data: { status: BillStatus.ISSUED, issuedById: context.user.id, issuedAt: new Date() },
          include: this.billInclude()
        });
        await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "BILL_ISSUED" });
        return this.toBillResponse(issued);
      })
    );
  }

  async splitBill(id: string, dto: SplitBillDto, idempotencyKey: string | undefined, context: BranchContext): Promise<{ sourceBill: BillResponse; bills: BillResponse[] }> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    return this.withIdempotency(context.branch.id, "billing.split", idempotencyKey, { id, dto }, 201, (tx) =>
      this.rethrowBillingErrors(this.splitBillInTx(tx, id, dto, context))
    );
  }

  async mergeBills(dto: MergeBillsDto, idempotencyKey: string | undefined, context: BranchContext): Promise<BillResponse> {
    return this.withIdempotency(context.branch.id, "billing.merge", idempotencyKey, dto, 200, (tx) => this.rethrowBillingErrors(this.mergeBillsInTx(tx, dto, context)));
  }

  async voidBill(id: string, dto: VoidBillDto, idempotencyKey: string | undefined, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    const reason = this.cleanReason(dto.reason);
    return this.withIdempotency(context.branch.id, "billing.void", idempotencyKey, { id, reason }, 200, (tx) => this.rethrowBillingErrors(this.voidBillInTx(tx, id, reason, context)));
  }

  async listVouchers(context: BranchContext): Promise<{ items: VoucherResponse[] }> {
    const vouchers = await this.prisma.voucher.findMany({
      where: { branchId: context.branch.id, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { code: "asc" }]
    });
    return { items: vouchers.map((voucher) => this.toVoucherResponse(voucher)) };
  }

  async createVoucher(dto: CreateVoucherDto, context: BranchContext): Promise<VoucherResponse> {
    const normalized = this.normalizeVoucherInput(dto);
    const voucher = await this.prisma.voucher.create({
      data: {
        branchId: context.branch.id,
        code: normalized.code,
        name: normalized.name,
        discountType: dto.discountType,
        discountValue: this.money(dto.discountValue),
        maximumDiscount: dto.maximumDiscount === undefined ? null : this.money(dto.maximumDiscount),
        minimumSubtotal: this.money(dto.minimumSubtotal ?? 0),
        usageLimit: dto.usageLimit ?? null,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        status: dto.status ?? VoucherStatus.ACTIVE
      }
    });
    return this.toVoucherResponse(voucher);
  }

  async updateVoucher(id: string, dto: UpdateVoucherDto, context: BranchContext): Promise<VoucherResponse> {
    this.authorizationService.validateUuid(id, "INVALID_VOUCHER_ID");
    const current = await this.prisma.voucher.findFirst({ where: { id, branchId: context.branch.id, deletedAt: null } });
    if (!current) {
      throw notFound("VOUCHER_NOT_FOUND", "Voucher not found");
    }
    const startsAt = dto.startsAt === undefined ? undefined : this.parseDate(dto.startsAt, "startsAt");
    const endsAt = dto.endsAt === undefined ? undefined : dto.endsAt === null ? null : this.parseDate(dto.endsAt, "endsAt");
    this.assertVoucherDates(startsAt ?? current.startsAt, endsAt === undefined ? current.endsAt : endsAt);
    const voucher = await this.prisma.voucher.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: this.cleanText(dto.name, "Voucher name is required") } : {}),
        ...(dto.discountType !== undefined ? { discountType: dto.discountType } : {}),
        ...(dto.discountValue !== undefined ? { discountValue: this.money(dto.discountValue) } : {}),
        ...(dto.maximumDiscount !== undefined ? { maximumDiscount: dto.maximumDiscount === null ? null : this.money(dto.maximumDiscount) } : {}),
        ...(dto.minimumSubtotal !== undefined ? { minimumSubtotal: this.money(dto.minimumSubtotal) } : {}),
        ...(dto.usageLimit !== undefined ? { usageLimit: dto.usageLimit } : {}),
        ...(startsAt !== undefined ? { startsAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {})
      }
    });
    return this.toVoucherResponse(voucher);
  }

  async applyVoucher(id: string, dto: ApplyVoucherDto, idempotencyKey: string | undefined, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    const voucherCode = this.normalizeVoucherCode(dto.voucherCode);
    return this.withIdempotency(context.branch.id, "billing.apply-voucher", idempotencyKey, { id, voucherCode, overrideReason: dto.overrideReason?.trim() ?? null }, 200, (tx) =>
      this.rethrowBillingErrors(this.applyVoucherInTx(tx, id, voucherCode, dto.overrideReason, context))
    );
  }

  async applyDirectDiscount(id: string, dto: ApplyDirectDiscountDto, idempotencyKey: string | undefined, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BILL_ID");
    const reason = this.cleanReason(dto.reason);
    return this.withIdempotency(
      context.branch.id,
      "billing.apply-direct-discount",
      idempotencyKey,
      { id, discountType: dto.discountType, discountValue: dto.discountValue, reason, overrideReason: dto.overrideReason?.trim() ?? null },
      200,
      (tx) => this.rethrowBillingErrors(this.applyDirectDiscountInTx(tx, id, dto.discountType, this.money(dto.discountValue), reason, dto.overrideReason, context))
    );
  }

  async reverseAdjustment(id: string, dto: ReverseBillAdjustmentDto, idempotencyKey: string | undefined, context: BranchContext): Promise<BillResponse> {
    this.authorizationService.validateUuid(id, "INVALID_ADJUSTMENT_ID");
    const reason = this.cleanReason(dto.reason);
    return this.withIdempotency(context.branch.id, "billing.reverse-adjustment", idempotencyKey, { id, reason }, 200, (tx) => this.rethrowBillingErrors(this.reverseAdjustmentInTx(tx, id, reason, context)));
  }

  private async splitBillInTx(tx: Prisma.TransactionClient, id: string, dto: SplitBillDto, context: BranchContext): Promise<{ sourceBill: BillResponse; bills: BillResponse[] }> {
    const source = await this.lockBill(tx, context.branch.id, id);
    if (!source) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMutableBill(source.status);
    await this.assertNoActivePayment(tx, source.id);
    await this.lockBillItemsForBills(tx, [source.id]);
    const sourceItems = await tx.billItem.findMany({ where: { billId: source.id }, include: { orderItem: true }, orderBy: [{ orderItemId: "asc" }, { id: "asc" }] });
    if (sourceItems.length === 0) {
      throw badRequest("INVALID_SPLIT", "Bill has no items to split");
    }

    const sourceTotals = this.sumByOrderItem(sourceItems.map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity })));
    const requestedParts = dto.parts.map((part) => this.normalizePart(part));
    this.assertSplitPreservesAllocations(sourceTotals, requestedParts);

    const sourceBefore = await this.loadBill(tx, source.id);
    await this.reverseActiveAdjustmentsForBill(tx, source.id, context.user.id, "Bill split", context);
    await tx.billItem.deleteMany({ where: { billId: source.id } });
    const newBills: BillWithItems[] = [];
    for (const part of requestedParts) {
      const newBill = await tx.bill.create({
        data: {
          branchId: context.branch.id,
          tableSessionId: source.table_session_id,
          billNumber: this.generateBillNumber()
        }
      });
      const allocations = [...part.entries()].map(([orderItemId, quantity]) => {
        const sourceItem = sourceItems.find((item) => item.orderItemId === orderItemId);
        if (!sourceItem) {
          throw badRequest("INVALID_SPLIT", "Split item does not belong to source bill");
        }
        return {
          orderItemId,
          quantity,
          unitPrice: sourceItem.unitPriceSnapshot,
          productId: sourceItem.orderItem.productId,
          productNameSnapshot: sourceItem.orderItem.productNameSnapshot
        };
      });
      await this.createBillItems(tx, newBill.id, allocations);
      newBills.push(await this.recalculateBill(tx, newBill.id));
      await this.writeBillOutbox(tx, context.branch.id, newBill.id, "BILL_UPDATED", { reason: "BILL_SPLIT" });
    }

    const sourceAfter = await this.recalculateBill(tx, source.id);
    await this.writeAudit(tx, context, AuditAction.SPLIT_BILL, "bill", source.id, this.auditBill(sourceBefore), this.auditBill(sourceAfter), { newBillIds: newBills.map((bill) => bill.id) });
    await this.writeBillOutbox(tx, context.branch.id, source.id, "BILL_UPDATED", { reason: "BILL_SPLIT_SOURCE" });
    return { sourceBill: this.toBillResponse(sourceAfter), bills: newBills.map((bill) => this.toBillResponse(bill)) };
  }

  private async mergeBillsInTx(tx: Prisma.TransactionClient, dto: MergeBillsDto, context: BranchContext): Promise<BillResponse> {
    const sourceBillIds = [...new Set(dto.sourceBillIds)];
    if (sourceBillIds.length !== dto.sourceBillIds.length || sourceBillIds.includes(dto.targetBillId)) {
      throw badRequest("INVALID_BILL_MERGE", "Invalid merge bill list");
    }
    const reason = this.cleanReason(dto.reason);
    const locked = await this.lockBills(tx, context.branch.id, [...sourceBillIds, dto.targetBillId]);
    if (locked.length !== sourceBillIds.length + 1) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    const target = locked.find((bill) => bill.id === dto.targetBillId);
    const sources = locked.filter((bill) => sourceBillIds.includes(bill.id));
    if (!target || sources.length !== sourceBillIds.length) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMergeCompatible(target, sources);
    await this.assertNoActivePayment(tx, target.id);
    for (const source of sources) {
      await this.assertNoActivePayment(tx, source.id);
    }
    await this.lockBillItemsForBills(tx, [...sourceBillIds, target.id]);
    const beforeTarget = await this.loadBill(tx, target.id);
    const beforeSources = await Promise.all(sourceBillIds.map((sourceId) => this.loadBill(tx, sourceId)));
    for (const sourceId of sourceBillIds) {
      await this.reverseActiveAdjustmentsForBill(tx, sourceId, context.user.id, `Bill merged: ${reason}`, context);
    }

    const sourceItems = await tx.billItem.findMany({ where: { billId: { in: sourceBillIds } }, orderBy: [{ orderItemId: "asc" }, { id: "asc" }] });
    await tx.bill.updateMany({
      where: { id: { in: sourceBillIds } },
      data: {
        status: BillStatus.MERGED,
        mergedIntoBillId: target.id,
        mergedById: context.user.id,
        mergedAt: new Date(),
        mergeReason: reason
      }
    });
    for (const item of sourceItems) {
      await this.addOrIncrementBillItem(tx, target.id, item.orderItemId, item.quantity, item.unitPriceSnapshot);
    }
    const updated = await this.recalculateBill(tx, target.id);
    await this.writeAudit(tx, context, AuditAction.MERGE_BILL, "bill", target.id, { target: this.auditBill(beforeTarget), sources: beforeSources.map((bill) => this.auditBill(bill)) }, this.auditBill(updated), { sourceBillIds, reason });
    await this.writeBillOutbox(tx, context.branch.id, target.id, "BILL_MERGED", { sourceBillIds, reason });
    await this.writeBillOutbox(tx, context.branch.id, target.id, "BILL_UPDATED", { reason: "BILL_MERGED" });
    return this.toBillResponse(updated);
  }

  private async voidBillInTx(tx: Prisma.TransactionClient, id: string, reason: string, context: BranchContext): Promise<BillResponse> {
    const bill = await this.lockBill(tx, context.branch.id, id);
    if (!bill) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMutableBill(bill.status);
    await this.assertNoActivePayment(tx, bill.id);
    await this.lockBillItemsForBills(tx, [bill.id]);
    const before = await this.loadBill(tx, bill.id);
    await this.reverseActiveAdjustmentsForBill(tx, bill.id, context.user.id, `Bill voided: ${reason}`, context);
    await this.recalculateBill(tx, bill.id);
    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: { status: BillStatus.VOID, voidedById: context.user.id, voidedAt: new Date(), voidReason: reason },
      include: this.billInclude()
    });
    await this.writeAudit(tx, context, AuditAction.VOID_BILL, "bill", bill.id, this.auditBill(before), this.auditBill(updated), { reason });
    await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_VOIDED", { reason });
    await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "BILL_VOIDED" });
    return this.toBillResponse(updated);
  }

  private async applyVoucherInTx(tx: Prisma.TransactionClient, billId: string, voucherCode: string, overrideReason: string | undefined, context: BranchContext): Promise<BillResponse> {
    const bill = await this.lockBill(tx, context.branch.id, billId);
    if (!bill) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMutableBill(bill.status);
    await this.assertNoActivePayment(tx, bill.id);
    const before = await this.recalculateBill(tx, bill.id);
    const activeAdjustments = await this.lockActiveAdjustments(tx, bill.id);
    const activeDirect = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.DIRECT_DISCOUNT);
    const activeVoucher = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.VOUCHER);
    const isOverride = Boolean(activeDirect);
    const cleanedOverrideReason = this.assertOverrideAllowed(isOverride, overrideReason, context);
    const voucher = await this.lockVoucherByCode(tx, context.branch.id, voucherCode);
    this.assertVoucherUsable(voucher, before.subtotal);

    if (activeVoucher) {
      await this.reverseAdjustmentRecord(tx, activeVoucher.id, context.user.id, "Voucher replaced");
    }
    await this.assertVoucherUsageAvailable(tx, voucher.id, activeVoucher?.voucherId === voucher.id ? activeVoucher.id : null, voucher.usage_limit);

    const amount = this.calculateDiscountAmount(before.subtotal, voucher.discount_type, new Prisma.Decimal(voucher.discount_value), voucher.maximum_discount ? new Prisma.Decimal(voucher.maximum_discount) : null);
    const adjustment = await tx.billAdjustment.create({
      data: {
        billId: bill.id,
        source: BillAdjustmentSource.VOUCHER,
        discountType: voucher.discount_type,
        discountValue: voucher.discount_value,
        discountAmount: amount,
        voucherId: voucher.id,
        codeSnapshot: voucher.code,
        appliedById: context.user.id,
        isOverride,
        ...(isOverride
          ? {
              overrideById: context.user.id,
              overrideReason: cleanedOverrideReason,
              overrideBefore: this.auditBill(before),
              overrideAfter: { pending: true } as Prisma.InputJsonObject
            }
          : {})
      }
    });
    const after = await this.recalculateBill(tx, bill.id);
    await this.patchOverrideAfter(tx, adjustment.id, isOverride, after);
    const result = isOverride ? await this.loadBill(tx, bill.id) : after;
    await this.writeAudit(tx, context, AuditAction.APPLY_VOUCHER, "bill", bill.id, this.auditBill(before), this.auditBill(result), { voucherId: voucher.id, voucherCode: voucher.code });
    if (isOverride) {
      await this.writeAudit(tx, context, AuditAction.DISCOUNT_OVERRIDE, "bill", bill.id, this.auditBill(before), this.auditBill(result), { source: BillAdjustmentSource.VOUCHER, overrideReason: cleanedOverrideReason });
    }
    await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "VOUCHER_APPLIED" });
    return this.toBillResponse(result);
  }

  private async applyDirectDiscountInTx(
    tx: Prisma.TransactionClient,
    billId: string,
    discountType: DiscountType,
    discountValue: Prisma.Decimal,
    reason: string,
    overrideReason: string | undefined,
    context: BranchContext
  ): Promise<BillResponse> {
    const bill = await this.lockBill(tx, context.branch.id, billId);
    if (!bill) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMutableBill(bill.status);
    await this.assertNoActivePayment(tx, bill.id);
    const before = await this.recalculateBill(tx, bill.id);
    const activeAdjustments = await this.lockActiveAdjustments(tx, bill.id);
    const activeVoucher = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.VOUCHER);
    const activeDirect = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.DIRECT_DISCOUNT);
    const isOverride = Boolean(activeVoucher);
    const cleanedOverrideReason = this.assertOverrideAllowed(isOverride, overrideReason, context);
    if (activeDirect) {
      await this.reverseAdjustmentRecord(tx, activeDirect.id, context.user.id, "Direct discount replaced");
    }
    const voucherAmount = activeVoucher ? this.calculateDiscountAmount(before.subtotal, activeVoucher.discountType, activeVoucher.discountValue, await this.maximumDiscountFor(tx, activeVoucher)) : ZERO;
    const base = Prisma.Decimal.max(ZERO, before.subtotal.sub(voucherAmount));
    const amount = this.calculateDiscountAmount(base, discountType, discountValue, null);
    const adjustment = await tx.billAdjustment.create({
      data: {
        billId: bill.id,
        source: BillAdjustmentSource.DIRECT_DISCOUNT,
        discountType,
        discountValue,
        discountAmount: amount,
        appliedById: context.user.id,
        codeSnapshot: reason.slice(0, 48),
        isOverride,
        ...(isOverride
          ? {
              overrideById: context.user.id,
              overrideReason: cleanedOverrideReason,
              overrideBefore: this.auditBill(before),
              overrideAfter: { pending: true } as Prisma.InputJsonObject
            }
          : {})
      }
    });
    const after = await this.recalculateBill(tx, bill.id);
    await this.patchOverrideAfter(tx, adjustment.id, isOverride, after);
    const result = isOverride ? await this.loadBill(tx, bill.id) : after;
    await this.writeAudit(tx, context, AuditAction.APPLY_DISCOUNT, "bill", bill.id, this.auditBill(before), this.auditBill(result), { discountType, discountValue: discountValue.toFixed(2), reason });
    if (isOverride) {
      await this.writeAudit(tx, context, AuditAction.DISCOUNT_OVERRIDE, "bill", bill.id, this.auditBill(before), this.auditBill(result), { source: BillAdjustmentSource.DIRECT_DISCOUNT, overrideReason: cleanedOverrideReason });
    }
    await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "DIRECT_DISCOUNT_APPLIED" });
    return this.toBillResponse(result);
  }

  private async reverseAdjustmentInTx(tx: Prisma.TransactionClient, adjustmentId: string, reason: string, context: BranchContext): Promise<BillResponse> {
    const adjustment = await this.lockAdjustment(tx, context.branch.id, adjustmentId);
    if (!adjustment) {
      throw notFound("ADJUSTMENT_NOT_FOUND", "Bill adjustment not found");
    }
    const bill = await this.lockBill(tx, context.branch.id, adjustment.bill_id);
    if (!bill) {
      throw notFound("BILL_NOT_FOUND", "Bill not found");
    }
    this.assertMutableBill(bill.status);
    await this.assertNoActivePayment(tx, bill.id);
    if (adjustment.status !== BillAdjustmentStatus.ACTIVE) {
      throw conflict("INVALID_ADJUSTMENT_STATUS", "Only active adjustments can be reversed");
    }
    const before = await this.loadBill(tx, bill.id);
    await this.reverseAdjustmentRecord(tx, adjustment.id, context.user.id, reason);
    const after = await this.recalculateBill(tx, bill.id);
    await this.writeAudit(tx, context, adjustment.source === BillAdjustmentSource.VOUCHER ? AuditAction.APPLY_VOUCHER : AuditAction.APPLY_DISCOUNT, "bill_adjustment", adjustment.id, this.auditBill(before), this.auditBill(after), { reason, operation: "REVERSAL" });
    await this.writeBillOutbox(tx, context.branch.id, bill.id, "BILL_UPDATED", { reason: "ADJUSTMENT_REVERSED", adjustmentId });
    return this.toBillResponse(after);
  }

  private async resolveRequestedAllocations(
    tx: Prisma.TransactionClient,
    orderItems: LockedOrderItemRow[],
    requested: Map<string, number>
  ): Promise<Array<{ orderItemId: string; quantity: number; unitPrice: Prisma.Decimal; productId: string; productNameSnapshot: string }>> {
    const billed = await this.loadAllocatedQuantities(tx, orderItems.map((item) => item.id));
    return orderItems
      .map((item) => {
        const remaining = item.quantity - (billed.get(item.id) ?? 0);
        const quantity = requested.size ? requested.get(item.id) ?? 0 : remaining;
        if (quantity > remaining) {
          throw conflict("BILL_ALLOCATION_EXCEEDED", "Bill allocation exceeds unbilled order item quantity");
        }
        return { orderItemId: item.id, quantity, unitPrice: new Prisma.Decimal(item.final_unit_price), productId: item.product_id, productNameSnapshot: item.product_name_snapshot };
      })
      .filter((item) => item.quantity > 0);
  }

  private async createBillItems(
    tx: Prisma.TransactionClient,
    billId: string,
    allocations: Array<{ orderItemId: string; quantity: number; unitPrice: Prisma.Decimal; productId: string; productNameSnapshot: string }>
  ): Promise<void> {
    for (const allocation of allocations) {
      await tx.billItem.create({
        data: {
          billId,
          orderItemId: allocation.orderItemId,
          quantity: allocation.quantity,
          unitPriceSnapshot: allocation.unitPrice,
          lineAmount: allocation.unitPrice.mul(allocation.quantity)
        }
      });
    }
  }

  private async addOrIncrementBillItem(tx: Prisma.TransactionClient, billId: string, orderItemId: string, quantity: number, unitPrice: Prisma.Decimal): Promise<void> {
    const current = await tx.billItem.findUnique({ where: { billId_orderItemId: { billId, orderItemId } } });
    if (current) {
      const nextQuantity = current.quantity + quantity;
      await tx.billItem.update({
        where: { id: current.id },
        data: {
          quantity: nextQuantity,
          unitPriceSnapshot: unitPrice,
          lineAmount: unitPrice.mul(nextQuantity)
        }
      });
    } else {
      await tx.billItem.create({
        data: {
          billId,
          orderItemId,
          quantity,
          unitPriceSnapshot: unitPrice,
          lineAmount: unitPrice.mul(quantity)
        }
      });
    }
  }

  private async recalculateBill(tx: Prisma.TransactionClient, billId: string): Promise<BillWithItems> {
    const aggregate = await tx.billItem.aggregate({ where: { billId }, _sum: { lineAmount: true } });
    const subtotal = aggregate._sum.lineAmount ?? ZERO;
    const activeAdjustments = await tx.billAdjustment.findMany({ where: { billId, status: BillAdjustmentStatus.ACTIVE }, orderBy: [{ source: "asc" }, { createdAt: "asc" }] });
    const voucherAdjustment = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.VOUCHER);
    const directAdjustment = activeAdjustments.find((adjustment) => adjustment.source === BillAdjustmentSource.DIRECT_DISCOUNT);
    const voucherDiscountAmount = voucherAdjustment ? this.calculateDiscountAmount(subtotal, voucherAdjustment.discountType, voucherAdjustment.discountValue, await this.maximumDiscountFor(tx, voucherAdjustment)) : ZERO;
    const directBase = Prisma.Decimal.max(ZERO, subtotal.sub(voucherDiscountAmount));
    const directDiscountAmount = directAdjustment ? this.calculateDiscountAmount(directBase, directAdjustment.discountType, directAdjustment.discountValue, null) : ZERO;
    const discountedAmount = Prisma.Decimal.max(ZERO, subtotal.sub(voucherDiscountAmount).sub(directDiscountAmount));
    const vatAmount = this.roundVnd(discountedAmount.mul(VAT_RATE).div(100));
    const total = discountedAmount.add(vatAmount);

    if (voucherAdjustment && !voucherAdjustment.discountAmount.equals(voucherDiscountAmount)) {
      await tx.billAdjustment.update({ where: { id: voucherAdjustment.id }, data: { discountAmount: voucherDiscountAmount } });
    }
    if (directAdjustment && !directAdjustment.discountAmount.equals(directDiscountAmount)) {
      await tx.billAdjustment.update({ where: { id: directAdjustment.id }, data: { discountAmount: directDiscountAmount } });
    }

    return tx.bill.update({
      where: { id: billId },
      data: {
        subtotal,
        voucherDiscountAmount,
        directDiscountAmount,
        discountedAmount,
        vatRate: VAT_RATE,
        vatAmount,
        total
      },
      include: this.billInclude()
    });
  }

  private async maximumDiscountFor(tx: Prisma.TransactionClient, adjustment: AdjustmentRecord): Promise<Prisma.Decimal | null> {
    if (!adjustment.voucherId) {
      return null;
    }
    const voucher = await tx.voucher.findUnique({ where: { id: adjustment.voucherId }, select: { maximumDiscount: true } });
    return voucher?.maximumDiscount ?? null;
  }

  private calculateDiscountAmount(base: Prisma.Decimal, type: DiscountType, value: Prisma.Decimal, maximumDiscount: Prisma.Decimal | null): Prisma.Decimal {
    if (base.lte(0)) {
      return ZERO;
    }
    const raw = type === DiscountType.PERCENT ? this.roundVnd(base.mul(value).div(100)) : this.money(value);
    const cappedByMaximum = maximumDiscount ? Prisma.Decimal.min(raw, maximumDiscount) : raw;
    return Prisma.Decimal.min(base, Prisma.Decimal.max(ZERO, cappedByMaximum));
  }

  private async lockActiveAdjustments(tx: Prisma.TransactionClient, billId: string): Promise<AdjustmentRecord[]> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM bill_adjustments
      WHERE bill_id = ${billId}::uuid AND status = 'ACTIVE'
      ORDER BY source ASC, created_at ASC, id ASC
      FOR UPDATE
    `;
    return tx.billAdjustment.findMany({ where: { billId, status: BillAdjustmentStatus.ACTIVE }, orderBy: [{ source: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  }

  private async lockVoucherByCode(tx: Prisma.TransactionClient, branchId: string, code: string): Promise<LockedVoucherRow> {
    const rows = await tx.$queryRaw<LockedVoucherRow[]>`
      SELECT id, branch_id, code, name, discount_type, discount_value, maximum_discount, minimum_subtotal, usage_limit, starts_at, ends_at, status, deleted_at
      FROM vouchers
      WHERE branch_id = ${branchId}::uuid AND code = ${code}
      FOR UPDATE
    `;
    const voucher = rows[0];
    if (!voucher || voucher.deleted_at) {
      throw notFound("VOUCHER_NOT_FOUND", "Voucher not found");
    }
    return voucher;
  }

  private assertVoucherUsable(voucher: LockedVoucherRow, subtotal: Prisma.Decimal): void {
    const now = new Date();
    if (voucher.status !== VoucherStatus.ACTIVE) {
      throw conflict("VOUCHER_INACTIVE", "Voucher is not active");
    }
    if (voucher.starts_at > now) {
      throw conflict("VOUCHER_NOT_STARTED", "Voucher is not started");
    }
    if (voucher.ends_at && voucher.ends_at < now) {
      throw conflict("VOUCHER_EXPIRED", "Voucher is expired");
    }
    if (subtotal.lt(voucher.minimum_subtotal)) {
      throw conflict("VOUCHER_MINIMUM_SUBTOTAL_NOT_MET", "Bill subtotal does not meet voucher minimum subtotal");
    }
  }

  private async assertVoucherUsageAvailable(tx: Prisma.TransactionClient, voucherId: string, _replacedAdjustmentId: string | null, usageLimit: number | null): Promise<void> {
    if (!usageLimit) {
      return;
    }
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM bill_adjustments ba
      JOIN bills b ON b.id = ba.bill_id
      WHERE ba.voucher_id = ${voucherId}::uuid
        AND ba.status = 'ACTIVE'
        AND b.status IN ('DRAFT', 'ISSUED', 'PAID')
    `;
    if (Number(rows[0]?.count ?? 0n) >= usageLimit) {
      throw conflict("VOUCHER_USAGE_LIMIT_REACHED", "Voucher usage limit has been reached");
    }
  }

  private assertOverrideAllowed(isOverride: boolean, overrideReason: string | undefined, context: BranchContext): string | null {
    if (!isOverride) {
      return null;
    }
    this.authorizationService.assertPermissions(context, ["DISCOUNT_OVERRIDE"]);
    return this.cleanReason(overrideReason ?? "");
  }

  private async lockAdjustment(tx: Prisma.TransactionClient, branchId: string, adjustmentId: string): Promise<(AdjustmentRecord & { bill_id: string }) | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; bill_id: string }>>`
      SELECT ba.id, ba.bill_id
      FROM bill_adjustments ba
      JOIN bills b ON b.id = ba.bill_id
      WHERE ba.id = ${adjustmentId}::uuid AND b.branch_id = ${branchId}::uuid
      FOR UPDATE OF ba
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    const adjustment = await tx.billAdjustment.findUniqueOrThrow({ where: { id: row.id } });
    return { ...adjustment, bill_id: row.bill_id };
  }

  private async reverseActiveAdjustmentsForBill(tx: Prisma.TransactionClient, billId: string, actorId: string, reason: string, context: BranchContext): Promise<void> {
    const adjustments = await this.lockActiveAdjustments(tx, billId);
    for (const adjustment of adjustments) {
      await this.reverseAdjustmentRecord(tx, adjustment.id, actorId, reason);
      await this.writeAudit(tx, context, adjustment.source === BillAdjustmentSource.VOUCHER ? AuditAction.APPLY_VOUCHER : AuditAction.APPLY_DISCOUNT, "bill_adjustment", adjustment.id, null, null, { reason, operation: "REVERSAL" });
    }
  }

  private async reverseAdjustmentRecord(tx: Prisma.TransactionClient, adjustmentId: string, actorId: string, reason: string): Promise<void> {
    await tx.billAdjustment.update({
      where: { id: adjustmentId },
      data: {
        status: BillAdjustmentStatus.REVERSED,
        reversedById: actorId,
        reversedAt: new Date(),
        reverseReason: reason
      }
    });
  }

  private async patchOverrideAfter(tx: Prisma.TransactionClient, adjustmentId: string, isOverride: boolean, bill: BillWithItems): Promise<void> {
    if (!isOverride) {
      return;
    }
    await tx.billAdjustment.update({
      where: { id: adjustmentId },
      data: { overrideAfter: this.auditBill(bill) }
    });
  }

  private normalizeAllocations(items: BillAllocationDto[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw badRequest("VALIDATION_ERROR", "Bill item quantity must be a positive integer");
      }
      result.set(item.orderItemId, (result.get(item.orderItemId) ?? 0) + item.quantity);
    }
    return result;
  }

  private normalizePart(part: SplitBillPartDto): Map<string, number> {
    const allocations = this.normalizeAllocations(part.items);
    if (allocations.size === 0) {
      throw badRequest("INVALID_SPLIT", "Split part must contain bill items");
    }
    return allocations;
  }

  private sumByOrderItem(items: Array<{ orderItemId: string; quantity: number }>): Map<string, number> {
    const result = new Map<string, number>();
    for (const item of items) {
      result.set(item.orderItemId, (result.get(item.orderItemId) ?? 0) + item.quantity);
    }
    return result;
  }

  private assertSplitPreservesAllocations(source: Map<string, number>, parts: Map<string, number>[]): void {
    const combined = new Map<string, number>();
    for (const part of parts) {
      for (const [orderItemId, quantity] of part.entries()) {
        combined.set(orderItemId, (combined.get(orderItemId) ?? 0) + quantity);
      }
    }
    if (combined.size !== source.size) {
      throw badRequest("INVALID_SPLIT", "Split must preserve bill item allocations");
    }
    for (const [orderItemId, quantity] of source.entries()) {
      if (combined.get(orderItemId) !== quantity) {
        throw badRequest("INVALID_SPLIT", "Split must preserve bill item allocations");
      }
    }
  }

  private assertMergeCompatible(target: LockedBillRow, sources: LockedBillRow[]): void {
    this.assertMutableBill(target.status);
    for (const source of sources) {
      this.assertMutableBill(source.status);
      if (source.table_session_id !== target.table_session_id) {
        throw conflict("BILL_MERGE_SESSION_MISMATCH", "Bills must belong to the same table session");
      }
    }
  }

  private assertMutableBill(status: BillStatus): void {
    if (status === BillStatus.PAID) {
      throw conflict("BILL_ALREADY_PAID", "Paid bill cannot be modified");
    }
    if (!MUTABLE_BILL_STATUSES.includes(status)) {
      throw conflict("INVALID_STATUS_TRANSITION", "Bill cannot be modified in its current status");
    }
  }

  private cleanReason(reason: string): string {
    const value = reason.trim();
    if (!value) {
      throw badRequest("VALIDATION_ERROR", "Reason is required");
    }
    return value;
  }

  private cleanText(value: string, message: string): string {
    const cleaned = value.trim();
    if (!cleaned) {
      throw badRequest("VALIDATION_ERROR", message);
    }
    return cleaned;
  }

  private normalizeVoucherCode(value: string): string {
    return this.cleanText(value, "Voucher code is required").toUpperCase();
  }

  private normalizeVoucherInput(dto: CreateVoucherDto): { code: string; name: string; startsAt: Date; endsAt: Date | null } {
    const startsAt = this.parseDate(dto.startsAt, "startsAt");
    const endsAt = dto.endsAt ? this.parseDate(dto.endsAt, "endsAt") : null;
    this.assertVoucherDates(startsAt, endsAt);
    return {
      code: this.normalizeVoucherCode(dto.code),
      name: this.cleanText(dto.name, "Voucher name is required"),
      startsAt,
      endsAt
    };
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw badRequest("VALIDATION_ERROR", `Invalid ${field}`);
    }
    return date;
  }

  private assertVoucherDates(startsAt: Date, endsAt: Date | null): void {
    if (endsAt && endsAt <= startsAt) {
      throw badRequest("VALIDATION_ERROR", "Voucher end date must be after start date");
    }
  }

  private money(value: number | string | Prisma.Decimal): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (decimal.lt(0)) {
      throw badRequest("VALIDATION_ERROR", "Money amount must be non-negative");
    }
    return decimal.toDecimalPlaces(0);
  }

  private roundVnd(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(0);
  }

  private generateBillNumber(): string {
    return `BILL-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private async assertSessionInBranch(tableSessionId: string, branchId: string): Promise<void> {
    const exists = await this.prisma.tableSession.findFirst({ where: { id: tableSessionId, branchId }, select: { id: true } });
    if (!exists) {
      throw notFound("SESSION_NOT_FOUND", "Table session not found");
    }
  }

  private async lockOpenSession(tx: Prisma.TransactionClient, branchId: string, tableSessionId: string): Promise<LockedSessionRow> {
    const rows = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT id, branch_id, status, closed_at
      FROM table_sessions
      WHERE id = ${tableSessionId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    const session = rows[0];
    if (!session) {
      throw notFound("SESSION_NOT_FOUND", "Table session not found");
    }
    if (session.status === SessionStatus.CLOSED || session.closed_at) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
    return session;
  }

  private async lockBill(tx: Prisma.TransactionClient, branchId: string, id: string): Promise<LockedBillRow | null> {
    const rows = await tx.$queryRaw<LockedBillRow[]>`
      SELECT id, branch_id, table_session_id, status, subtotal, total
      FROM bills
      WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockBills(tx: Prisma.TransactionClient, branchId: string, ids: string[]): Promise<LockedBillRow[]> {
    const uniqueIds = [...new Set(ids)].sort();
    return tx.$queryRaw<LockedBillRow[]>`
      SELECT id, branch_id, table_session_id, status, subtotal, total
      FROM bills
      WHERE branch_id = ${branchId}::uuid AND id IN (${Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id ASC
      FOR UPDATE
    `;
  }

  private async lockOrderItems(tx: Prisma.TransactionClient, branchId: string, tableSessionId: string, itemIds?: string[]): Promise<LockedOrderItemRow[]> {
    if (itemIds && itemIds.length === 0) {
      return [];
    }
    return itemIds
      ? tx.$queryRaw<LockedOrderItemRow[]>`
          SELECT oi.id, oi.product_id, oi.product_name_snapshot, oi.quantity, oi.final_unit_price
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.branch_id = ${branchId}::uuid
            AND o.table_session_id = ${tableSessionId}::uuid
            AND oi.status <> 'CANCELLED'
            AND oi.id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY oi.id ASC
          FOR UPDATE OF oi
        `
      : tx.$queryRaw<LockedOrderItemRow[]>`
          SELECT oi.id, oi.product_id, oi.product_name_snapshot, oi.quantity, oi.final_unit_price
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.branch_id = ${branchId}::uuid
            AND o.table_session_id = ${tableSessionId}::uuid
            AND oi.status <> 'CANCELLED'
          ORDER BY oi.id ASC
          FOR UPDATE OF oi
        `;
  }

  private async lockBillItemsForBills(tx: Prisma.TransactionClient, billIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(billIds)].sort();
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM bill_items
      WHERE bill_id IN (${Prisma.join(uniqueIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY bill_id ASC, order_item_id ASC, id ASC
      FOR UPDATE
    `;
  }

  private async loadAllocatedQuantities(tx: Prisma.TransactionClient | PrismaService, orderItemIds: string[]): Promise<Map<string, number>> {
    if (orderItemIds.length === 0) {
      return new Map();
    }
    const rows = await tx.$queryRaw<AllocationRow[]>`
      SELECT bi.order_item_id, COALESCE(sum(bi.quantity), 0) AS quantity
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id AND b.status IN (${Prisma.join(EFFECTIVE_BILL_STATUSES.map((status) => Prisma.sql`${status}::bill_status`))})
      WHERE bi.order_item_id IN (${Prisma.join(orderItemIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY bi.order_item_id
    `;
    return new Map(rows.map((row) => [row.order_item_id, Number(row.quantity)]));
  }

  private async loadUnbilledItems(tx: Prisma.TransactionClient | PrismaService, branchId: string, tableSessionId: string): Promise<UnbilledOrderItemResponse[]> {
    const orderItems = await this.lockOrderItems(tx as Prisma.TransactionClient, branchId, tableSessionId);
    const allocated = await this.loadAllocatedQuantities(tx, orderItems.map((item) => item.id));
    return orderItems
      .map((item) => {
        const billedQuantity = allocated.get(item.id) ?? 0;
        const remainingQuantity = item.quantity - billedQuantity;
        const unitPrice = new Prisma.Decimal(item.final_unit_price);
        return {
          orderItemId: item.id,
          productId: item.product_id,
          productNameSnapshot: item.product_name_snapshot,
          orderedQuantity: item.quantity,
          billedQuantity,
          remainingQuantity,
          unitPrice: unitPrice.toFixed(2),
          remainingAmount: unitPrice.mul(Math.max(0, remainingQuantity)).toFixed(2)
        };
      })
      .filter((item) => item.remainingQuantity > 0);
  }

  private async assertNoActivePayment(tx: Prisma.TransactionClient, billId: string): Promise<void> {
    const payment = await tx.payment.findFirst({
      where: { billId, status: PaymentStatus.PENDING },
      select: { id: true }
    });
    if (payment) {
      throw conflict("BILL_HAS_ACTIVE_PAYMENT", "Bill has an active payment");
    }
  }

  private async loadBill(tx: Prisma.TransactionClient, billId: string): Promise<BillWithItems> {
    return tx.bill.findUniqueOrThrow({ where: { id: billId }, include: this.billInclude() });
  }

  private billInclude() {
    return {
      items: {
        include: { orderItem: true },
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }]
      },
      adjustments: {
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }]
      }
    };
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    action: AuditAction,
    entityType: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
    metadata: Prisma.InputJsonValue
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        branchId: context.branch.id,
        actorId: context.user.id,
        action,
        entityType,
        entityId,
        beforeData: beforeData ?? Prisma.JsonNull,
        afterData: afterData ?? Prisma.JsonNull,
        metadata,
        requestId: this.requestContext.getRequestId() ?? null
      }
    });
  }

  private async writeBillOutbox(tx: Prisma.TransactionClient, branchId: string, billId: string, eventType: "BILL_UPDATED" | "BILL_MERGED" | "BILL_VOIDED", payload: Prisma.InputJsonObject): Promise<void> {
    await tx.realtimeOutbox.create({
      data: {
        branchId,
        eventType,
        aggregateType: "bill",
        aggregateId: billId,
        payload: { billId, requestId: this.requestContext.getRequestId() ?? null, ...payload }
      }
    });
  }

  private auditBill(bill: BillWithItems): Prisma.InputJsonObject {
    return {
      id: bill.id,
      status: bill.status,
      subtotal: bill.subtotal.toFixed(2),
      voucherDiscountAmount: bill.voucherDiscountAmount.toFixed(2),
      directDiscountAmount: bill.directDiscountAmount.toFixed(2),
      discountedAmount: bill.discountedAmount.toFixed(2),
      vatRate: bill.vatRate.toFixed(2),
      vatAmount: bill.vatAmount.toFixed(2),
      total: bill.total.toFixed(2),
      items: bill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity, lineAmount: item.lineAmount.toFixed(2) })),
      adjustments: bill.adjustments.map((adjustment) => ({ id: adjustment.id, source: adjustment.source, status: adjustment.status, discountAmount: adjustment.discountAmount.toFixed(2) }))
    };
  }

  private toVoucherResponse(voucher: VoucherRecord): VoucherResponse {
    return {
      id: voucher.id,
      branchId: voucher.branchId,
      code: voucher.code,
      name: voucher.name,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue.toFixed(2),
      maximumDiscount: voucher.maximumDiscount?.toFixed(2) ?? null,
      minimumSubtotal: voucher.minimumSubtotal.toFixed(2),
      usageLimit: voucher.usageLimit,
      startsAt: voucher.startsAt.toISOString(),
      endsAt: voucher.endsAt?.toISOString() ?? null,
      status: voucher.status,
      createdAt: voucher.createdAt.toISOString(),
      updatedAt: voucher.updatedAt.toISOString()
    };
  }

  private toAdjustmentResponse(adjustment: AdjustmentRecord): BillAdjustmentResponse {
    return {
      id: adjustment.id,
      billId: adjustment.billId,
      source: adjustment.source,
      discountType: adjustment.discountType,
      discountValue: adjustment.discountValue.toFixed(2),
      discountAmount: adjustment.discountAmount.toFixed(2),
      voucherId: adjustment.voucherId,
      codeSnapshot: adjustment.codeSnapshot,
      status: adjustment.status,
      appliedById: adjustment.appliedById,
      reversedById: adjustment.reversedById,
      reversedAt: adjustment.reversedAt?.toISOString() ?? null,
      reverseReason: adjustment.reverseReason,
      isOverride: adjustment.isOverride,
      overrideById: adjustment.overrideById,
      overrideReason: adjustment.overrideReason,
      overrideBefore: adjustment.overrideBefore,
      overrideAfter: adjustment.overrideAfter,
      createdAt: adjustment.createdAt.toISOString()
    };
  }

  private toBillResponse(bill: BillWithItems): BillResponse {
    return {
      id: bill.id,
      branchId: bill.branchId,
      tableSessionId: bill.tableSessionId,
      mergedIntoBillId: bill.mergedIntoBillId,
      billNumber: bill.billNumber,
      status: bill.status,
      subtotal: bill.subtotal.toFixed(2),
      voucherDiscountAmount: bill.voucherDiscountAmount.toFixed(2),
      directDiscountAmount: bill.directDiscountAmount.toFixed(2),
      discountedAmount: bill.discountedAmount.toFixed(2),
      vatRate: bill.vatRate.toFixed(2),
      vatAmount: bill.vatAmount.toFixed(2),
      total: bill.total.toFixed(2),
      issuedById: bill.issuedById,
      issuedAt: bill.issuedAt?.toISOString() ?? null,
      paidAt: bill.paidAt?.toISOString() ?? null,
      voidedById: bill.voidedById,
      voidedAt: bill.voidedAt?.toISOString() ?? null,
      voidReason: bill.voidReason,
      mergedById: bill.mergedById,
      mergedAt: bill.mergedAt?.toISOString() ?? null,
      mergeReason: bill.mergeReason,
      items: bill.items.map((item) => ({
        id: item.id,
        orderItemId: item.orderItemId,
        productId: item.orderItem.productId,
        productNameSnapshot: item.orderItem.productNameSnapshot,
        quantity: item.quantity,
        orderedQuantity: item.orderItem.quantity,
        unitPriceSnapshot: item.unitPriceSnapshot.toFixed(2),
        lineAmount: item.lineAmount.toFixed(2),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      })),
      adjustments: bill.adjustments.map((adjustment) => this.toAdjustmentResponse(adjustment)),
      createdAt: bill.createdAt.toISOString(),
      updatedAt: bill.updatedAt.toISOString()
    };
  }

  private async withIdempotency<TResponse extends object>(
    branchId: string,
    scope: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    responseStatus: number,
    executor: (tx: Prisma.TransactionClient) => Promise<TResponse>
  ): Promise<TResponse> {
    if (!idempotencyKey?.trim()) {
      throw conflict("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
    }
    const key = idempotencyKey.trim();
    const requestHash = createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
    return this.prisma.$transaction(async (tx) => {
      const idempotency = await this.lockOrCreateIdempotency(tx, branchId, scope, key, requestHash);
      if (idempotency.status === IdempotencyStatus.SUCCEEDED) {
        if (!idempotency.response_body || typeof idempotency.response_body !== "object" || Array.isArray(idempotency.response_body)) {
          throw conflict("IDEMPOTENCY_KEY_REUSED", "Stored idempotent response is unavailable");
        }
        return idempotency.response_body as unknown as TResponse;
      }
      const response = await executor(tx);
      await tx.idempotencyKey.update({
        where: { id: idempotency.id },
        data: { status: IdempotencyStatus.SUCCEEDED, responseStatus, responseBody: response as Prisma.InputJsonObject }
      });
      return response;
    });
  }

  private async lockOrCreateIdempotency(tx: Prisma.TransactionClient, branchId: string, scope: string, key: string, requestHash: string): Promise<LockedIdempotencyRow> {
    await tx.$executeRaw`
      INSERT INTO idempotency_keys (id, branch_id, scope, key, request_hash, status, expires_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${branchId}::uuid, ${scope}, ${key}, ${requestHash}, 'PROCESSING'::idempotency_status, ${new Date(Date.now() + 24 * 60 * 60 * 1000)}, CURRENT_TIMESTAMP)
      ON CONFLICT (scope, key) DO NOTHING
    `;
    const rows = await tx.$queryRaw<LockedIdempotencyRow[]>`
      SELECT id, request_hash, response_body, status
      FROM idempotency_keys
      WHERE scope = ${scope} AND key = ${key}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw conflict("IDEMPOTENCY_KEY_REQUIRED", "Idempotency state is unavailable");
    }
    if (row.request_hash !== requestHash) {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different payload");
    }
    return row;
  }

  private async rethrowBillingErrors<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientUnknownRequestError) {
        if (error.message.includes("Billed quantity exceeds order item quantity")) {
          throw conflict("BILL_ALLOCATION_EXCEEDED", "Bill allocation exceeds order item quantity");
        }
        if (error.message.includes("Items can only be changed on a draft or issued unpaid bill") || error.message.includes("Paid, merged or void bill is immutable")) {
          throw conflict("INVALID_STATUS_TRANSITION", "Bill cannot be modified in its current status");
        }
        if (error.message.includes("Paid bill cannot be split, merged or voided")) {
          throw conflict("BILL_ALREADY_PAID", "Paid bill cannot be modified");
        }
        if (error.message.includes("Bill item and bill must belong to the same table session")) {
          throw conflict("BILL_MERGE_SESSION_MISMATCH", "Bill item and bill must belong to the same table session");
        }
        if (error.message.includes("Adjustments can only be changed on a draft or issued unpaid bill")) {
          throw conflict("INVALID_STATUS_TRANSITION", "Bill cannot be modified in its current status");
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("DUPLICATE_RECORD", "Record already exists");
      }
      throw error;
    }
  }
}

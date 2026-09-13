import { Injectable } from "@nestjs/common";
import { AuditAction, BillStatus, IdempotencyStatus, PaymentStatus, Prisma, SessionStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { ApiException, badRequest, conflict, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { stableStringify } from "../setup/stable-json";
import { BillResponse, SessionBillingResponse, UnbilledOrderItemResponse } from "./billing.types";
import { BillAllocationDto, CreateBillDto, MergeBillsDto, SplitBillDto, SplitBillPartDto, VoidBillDto } from "./dto/billing.dto";

const EFFECTIVE_BILL_STATUSES: BillStatus[] = [BillStatus.DRAFT, BillStatus.ISSUED, BillStatus.PAID];
const MUTABLE_BILL_STATUSES: BillStatus[] = [BillStatus.DRAFT, BillStatus.ISSUED];
const ZERO = new Prisma.Decimal(0);

type BillWithItems = Prisma.BillGetPayload<{
  include: { items: { include: { orderItem: true }; orderBy: [{ createdAt: "asc" }, { id: "asc" }] } };
}>;

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
  total: Prisma.Decimal;
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
            billNumber: this.generateBillNumber(),
            vatRate: ZERO
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
    await tx.billItem.deleteMany({ where: { billId: source.id } });
    const newBills: BillWithItems[] = [];
    for (const part of requestedParts) {
      const newBill = await tx.bill.create({
        data: {
          branchId: context.branch.id,
          tableSessionId: source.table_session_id,
          billNumber: this.generateBillNumber(),
          vatRate: ZERO
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
    await this.reverseSourceAdjustments(tx, sourceBillIds, context.user.id, reason);

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
    return tx.bill.update({
      where: { id: billId },
      data: {
        subtotal,
        voucherDiscountAmount: ZERO,
        directDiscountAmount: ZERO,
        discountedAmount: subtotal,
        vatRate: ZERO,
        vatAmount: ZERO,
        total: subtotal
      },
      include: this.billInclude()
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
      SELECT id, branch_id, table_session_id, status, total
      FROM bills
      WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockBills(tx: Prisma.TransactionClient, branchId: string, ids: string[]): Promise<LockedBillRow[]> {
    const uniqueIds = [...new Set(ids)].sort();
    return tx.$queryRaw<LockedBillRow[]>`
      SELECT id, branch_id, table_session_id, status, total
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

  private async reverseSourceAdjustments(tx: Prisma.TransactionClient, billIds: string[], actorId: string, reason: string): Promise<void> {
    await tx.billAdjustment.updateMany({
      where: { billId: { in: billIds }, status: "ACTIVE" },
      data: {
        status: "REVERSED",
        reversedById: actorId,
        reversedAt: new Date(),
        reverseReason: `Bill merged: ${reason}`
      }
    });
  }

  private async loadBill(tx: Prisma.TransactionClient, billId: string): Promise<BillWithItems> {
    return tx.bill.findUniqueOrThrow({ where: { id: billId }, include: this.billInclude() });
  }

  private billInclude() {
    return {
      items: {
        include: { orderItem: true },
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
      total: bill.total.toFixed(2),
      items: bill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity, lineAmount: item.lineAmount.toFixed(2) }))
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
      }
      throw error;
    }
  }
}

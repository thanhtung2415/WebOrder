import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AuditAction,
  CartStatus,
  IdempotencyStatus,
  InventoryTransactionType,
  OrderItemStatus,
  OrderSource,
  Prisma,
  ProcessingArea,
  ReservationStatus,
  SessionStatus
} from "@prisma/client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { PermissionCode } from "../auth/permissions";
import { AuthorizationService } from "../auth/services/authorization.service";
import { stableStringify } from "../setup/stable-json";
import { CancelOrderItemDto, ConfirmOrderDto, UpdateOrderItemStatusDto } from "./dto/order.dto";
import { OrderAccessContext, OrderItemOptionResponse, OrderItemResponse, OrderListResponse, OrderResponse, QueueItemResponse, QueueResponse } from "./order.types";

type OrderWithItems = Prisma.OrderGetPayload<{
  include: ReturnType<OrdersService["orderInclude"]>;
}>;

type QueueOrderItem = Prisma.OrderItemGetPayload<{
  include: ReturnType<OrdersService["queueItemInclude"]>;
}>;

interface LockedIdempotencyRow {
  id: string;
  request_hash: string;
  response_body: Prisma.JsonValue | null;
  status: IdempotencyStatus;
}

interface LockedSessionRow {
  id: string;
  branch_id: string;
  status: SessionStatus;
  closed_at: Date | null;
}

interface LockedCartRow {
  id: string;
  branch_id: string;
  table_session_id: string;
  status: CartStatus;
  token: string;
}

interface LockedReservationRow {
  id: string;
  inventory_id: string;
  cart_item_id: string;
  quantity: Prisma.Decimal;
  status: ReservationStatus;
  expires_at: Date;
  order_item_id: string | null;
}

interface LockedInventoryRow {
  id: string;
  ingredient_id: string;
  physical_quantity: Prisma.Decimal;
  reserved_quantity: Prisma.Decimal;
}

interface ConfirmTarget {
  branchId: string;
  tableSessionId: string;
  cartToken: string | undefined;
  actorId: string | null;
  source: OrderSource;
}

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;
  private supabase: SupabaseClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService,
    private readonly configService: ConfigService<EnvironmentVariables, true>
  ) {}

  onModuleInit(): void {
    if (this.configService.get("NODE_ENV", { infer: true }) === "test") {
      return;
    }
    this.scheduler = setInterval(() => {
      void this.processOutbox(50).catch(() => undefined);
    }, 2_000);
    this.scheduler.unref();
  }

  onModuleDestroy(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  async confirmOrder(access: OrderAccessContext, idempotencyKey: string | undefined, cartToken: string | undefined, tableSessionId: string | undefined, dto: ConfirmOrderDto): Promise<OrderResponse> {
    const target = await this.resolveConfirmTarget(access, cartToken, tableSessionId);
    if (access.kind === "staff") {
      this.authorizationService.assertPermissions(access.branch, ["ORDER_CREATE"]);
    }
    const payload = { cartToken: target.cartToken ?? null, tableSessionId: target.tableSessionId, clientRequestId: dto.clientRequestId ?? null };
    return this.withIdempotency(target.branchId, "orders.confirm", idempotencyKey, payload, 201, (tx) => this.confirmOrderInTx(tx, target));
  }

  async getOrder(access: OrderAccessContext, orderId: string): Promise<OrderResponse> {
    this.authorizationService.validateUuid(orderId, "INVALID_ORDER_ID");
    if (access.kind === "staff") {
      this.authorizationService.assertPermissions(access.branch, ["ORDER_READ"]);
    }
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        ...(access.kind === "qr" ? { branchId: access.qr.branchId, tableSessionId: access.qr.tableSessionId } : { branchId: access.branch.branch.id })
      },
      include: this.orderInclude()
    });
    if (!order) {
      throw notFound("ORDER_NOT_FOUND", "Order not found");
    }
    return this.toOrderResponse(order);
  }

  async getSessionOrders(access: OrderAccessContext, tableSessionId: string): Promise<OrderListResponse> {
    this.authorizationService.validateUuid(tableSessionId, "INVALID_SESSION_ID");
    if (access.kind === "qr") {
      if (access.qr.tableSessionId !== tableSessionId) {
        throw notFound("ORDER_NOT_FOUND", "Orders not found");
      }
    } else {
      this.authorizationService.assertPermissions(access.branch, ["ORDER_READ"]);
    }
    const orders = await this.prisma.order.findMany({
      where: {
        tableSessionId,
        ...(access.kind === "qr" ? { branchId: access.qr.branchId } : { branchId: access.branch.branch.id })
      },
      include: this.orderInclude(),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return { items: orders.map((order) => this.toOrderResponse(order)) };
  }

  async updateItemStatus(access: OrderAccessContext, itemId: string, dto: UpdateOrderItemStatusDto): Promise<OrderResponse> {
    const context = this.requireStaff(access);
    this.authorizationService.assertPermissions(context, ["ORDER_STATUS_UPDATE"]);
    this.authorizationService.validateUuid(itemId, "INVALID_ORDER_ITEM_ID");
    return this.prisma.$transaction(async (tx) => {
      const item = await this.lockOrderItem(tx, itemId, context.branch.id);
      if (!item) {
        throw notFound("ORDER_NOT_FOUND", "Order item not found");
      }
      this.assertStatusTransition(item.status, dto.status);
      if (dto.status !== OrderItemStatus.SERVED) {
        this.assertAreaPermission(context, item.processing_area);
      }
      const now = new Date();
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: dto.status,
          ...(dto.status === OrderItemStatus.PREPARING ? { preparingAt: now } : {}),
          ...(dto.status === OrderItemStatus.READY ? { readyAt: now } : {}),
          ...(dto.status === OrderItemStatus.SERVED ? { servedAt: now } : {})
        }
      });
      await tx.orderItemStatusHistory.create({
        data: {
          orderItemId: itemId,
          fromStatus: item.status,
          toStatus: dto.status,
          changedById: context.user.id
        }
      });
      await this.writeOrderItemOutbox(tx, context.branch.id, item.order_id, itemId, "ORDER_ITEM_STATUS_CHANGED", dto.status);
      return this.toOrderResponse(await this.loadOrder(tx, item.order_id));
    });
  }

  async cancelItem(access: OrderAccessContext, itemId: string, dto: CancelOrderItemDto): Promise<OrderResponse> {
    const context = this.requireStaff(access);
    this.authorizationService.assertPermissions(context, ["ORDER_CANCEL"]);
    this.authorizationService.validateUuid(itemId, "INVALID_ORDER_ITEM_ID");
    const reason = dto.reason.trim();
    if (!reason) {
      throw unprocessable("CANCELLATION_REASON_REQUIRED", "Cancellation reason is required");
    }
    return this.prisma.$transaction(async (tx) => {
      const item = await this.lockOrderItem(tx, itemId, context.branch.id);
      if (!item) {
        throw notFound("ORDER_NOT_FOUND", "Order item not found");
      }
      const cancellableStatuses = new Set<OrderItemStatus>([OrderItemStatus.NEW, OrderItemStatus.PREPARING, OrderItemStatus.READY]);
      if (!cancellableStatuses.has(item.status)) {
        throw conflict("INVALID_STATUS_TRANSITION", "Order item cannot be cancelled from its current status");
      }
      const effectType = item.status === OrderItemStatus.NEW ? InventoryTransactionType.RETURN : InventoryTransactionType.WASTE;
      const reservations = await this.lockConsumedReservations(tx, itemId);
      const inventoryIds = [...new Set(reservations.map((reservation) => reservation.inventory_id))].sort();
      const inventories = await this.lockInventories(tx, inventoryIds);
      const inventoryById = new Map(inventories.map((inventory) => [inventory.id, inventory]));
      const byInventory = this.sumReservationsByInventory(reservations);
      for (const [inventoryId, quantity] of byInventory) {
        const inventory = inventoryById.get(inventoryId);
        if (!inventory) {
          throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
        }
        const afterPhysical = effectType === InventoryTransactionType.RETURN ? inventory.physical_quantity.plus(quantity) : inventory.physical_quantity;
        if (effectType === InventoryTransactionType.RETURN) {
          await tx.inventory.update({ where: { id: inventoryId }, data: { physicalQuantity: afterPhysical, version: { increment: 1 } } });
        }
        await tx.inventoryTransaction.create({
          data: {
            branchId: context.branch.id,
            inventoryId,
            orderItemId: itemId,
            type: effectType,
            quantityDelta: effectType === InventoryTransactionType.RETURN ? quantity : quantity.neg(),
            physicalQuantityAfter: afterPhysical,
            reason,
            createdById: context.user.id,
            metadata: {
              requestId: this.requestContext.getRequestId() ?? null,
              cancellationStatus: item.status,
              quantity: quantity.toFixed(3),
              classificationOnly: effectType === InventoryTransactionType.WASTE
            }
          }
        });
      }
      const now = new Date();
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: OrderItemStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: context.user.id,
          cancelReason: reason
        }
      });
      await tx.orderItemStatusHistory.create({
        data: {
          orderItemId: itemId,
          fromStatus: item.status,
          toStatus: OrderItemStatus.CANCELLED,
          changedById: context.user.id,
          reason
        }
      });
      await tx.auditLog.create({
        data: {
          branchId: context.branch.id,
          actorId: context.user.id,
          action: AuditAction.CANCEL_ORDER_ITEM,
          entityType: "order_item",
          entityId: itemId,
          beforeData: { status: item.status },
          afterData: { status: OrderItemStatus.CANCELLED, effectType },
          metadata: { reason },
          requestId: this.requestContext.getRequestId()
        }
      });
      await this.writeInventoryOutbox(tx, context.branch.id, [...byInventory.keys()], item.product_id, `ORDER_ITEM_CANCELLED_${effectType}`);
      await this.writeOrderItemOutbox(tx, context.branch.id, item.order_id, itemId, "ORDER_ITEM_STATUS_CHANGED", OrderItemStatus.CANCELLED);
      return this.toOrderResponse(await this.loadOrder(tx, item.order_id));
    });
  }

  async getQueue(access: OrderAccessContext, area: ProcessingArea): Promise<QueueResponse> {
    const context = this.requireStaff(access);
    this.assertAreaPermission(context, area);
    const items = await this.prisma.orderItem.findMany({
      where: {
        processingArea: area,
        status: { in: [OrderItemStatus.NEW, OrderItemStatus.PREPARING, OrderItemStatus.READY] },
        order: { branchId: context.branch.id }
      },
      include: this.queueItemInclude(),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return { items: items.map((item) => this.toQueueItemResponse(item)) };
  }

  async processOutbox(limit = 50): Promise<number> {
    const batchLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; branch_id: string; event_type: string; payload: Prisma.JsonValue }>>`
        SELECT id, branch_id, event_type, payload
        FROM realtime_outbox
        WHERE processed_at IS NULL AND available_at <= now()
        ORDER BY created_at ASC, id ASC
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      `;
      if (locked.length === 0) {
        return [];
      }
      await tx.realtimeOutbox.updateMany({
        where: { id: { in: locked.map((row) => row.id) } },
        data: { attempts: { increment: 1 } }
      });
      return locked;
    });

    for (const row of rows) {
      try {
        await this.broadcastOutbox(row.branch_id, row.event_type, row.payload);
        await this.prisma.realtimeOutbox.update({ where: { id: row.id }, data: { processedAt: new Date(), lastError: null } });
      } catch (error) {
        await this.prisma.realtimeOutbox.update({
          where: { id: row.id },
          data: { lastError: error instanceof Error ? error.message.slice(0, 1000) : "Realtime broadcast failed", availableAt: new Date(Date.now() + 5_000) }
        });
      }
    }
    return rows.length;
  }

  private async confirmOrderInTx(tx: Prisma.TransactionClient, target: ConfirmTarget): Promise<OrderResponse> {
    const session = await this.lockSession(tx, target.tableSessionId, target.branchId);
    if (!session || session.closed_at || session.status === SessionStatus.CLOSED) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
    const cart = await this.lockOrderableCart(tx, target);
    const itemIds = await this.lockCartItems(tx, cart.id);
    if (itemIds.length === 0) {
      throw badRequest("CART_NOT_FOUND", "Cart has no orderable items");
    }
    const reservations = await this.lockCartReservations(tx, itemIds);
    this.assertReservationsOrderable(itemIds, reservations);
    const inventoryIds = [...new Set(reservations.map((reservation) => reservation.inventory_id))].sort();
    await this.lockInventories(tx, inventoryIds);
    const cartSnapshot = await tx.cart.findUniqueOrThrow({ where: { id: cart.id }, include: this.cartConfirmInclude() });
    const order = await tx.order.create({
      data: {
        branchId: target.branchId,
        tableSessionId: target.tableSessionId,
        cartId: cart.id,
        orderNumber: this.generateOrderNumber(),
        source: target.source,
        createdById: target.actorId
      }
    });
    for (const cartItem of cartSnapshot.items) {
      const options = cartItem.options.map((option) => option.productOptionValue);
      const optionUnitPrice = options.reduce((sum, option) => sum.add(option.priceDelta), new Prisma.Decimal(0));
      const finalUnitPrice = cartItem.product.basePrice.add(optionUnitPrice);
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: cartItem.productId,
          productCodeSnapshot: cartItem.product.code,
          productNameSnapshot: cartItem.product.name,
          processingArea: cartItem.product.processingArea,
          quantity: cartItem.quantity,
          baseUnitPrice: cartItem.product.basePrice,
          optionUnitPrice,
          finalUnitPrice,
          lineSubtotal: finalUnitPrice.mul(cartItem.quantity),
          note: cartItem.note,
          isTakeaway: cartItem.isTakeaway
        }
      });
      await tx.orderItemOption.createMany({
        data: options.map((option) => ({
          orderItemId: orderItem.id,
          productOptionValueId: option.id,
          groupType: option.productOptionGroup.optionGroup.type,
          groupNameSnapshot: option.productOptionGroup.optionGroup.name,
          optionNameSnapshot: option.optionValue.name,
          priceDeltaSnapshot: option.priceDelta
        }))
      });
      await tx.orderItemStatusHistory.create({ data: { orderItemId: orderItem.id, toStatus: OrderItemStatus.NEW, changedById: target.actorId } });
      const itemReservations = reservations.filter((reservation) => reservation.cart_item_id === cartItem.id);
      for (const reservation of itemReservations) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: ReservationStatus.CONSUMED, orderItemId: orderItem.id, terminalAt: new Date() }
        });
        const updated = await tx.inventory.updateMany({
          where: { id: reservation.inventory_id, physicalQuantity: { gte: reservation.quantity } },
          data: { physicalQuantity: { decrement: reservation.quantity }, version: { increment: 1 } }
        });
        if (updated.count !== 1) {
          throw unprocessable("INVENTORY_WOULD_BE_NEGATIVE", "Inventory physical quantity cannot be negative");
        }
        const inventory = await tx.inventory.findUniqueOrThrow({ where: { id: reservation.inventory_id } });
        await tx.inventoryTransaction.create({
          data: {
            branchId: target.branchId,
            inventoryId: reservation.inventory_id,
            orderItemId: orderItem.id,
            type: InventoryTransactionType.ORDER_CONSUMPTION,
            quantityDelta: reservation.quantity.neg(),
            physicalQuantityAfter: inventory.physicalQuantity,
            reason: "Order confirmed",
            createdById: target.actorId,
            metadata: {
              cartId: cart.id,
              cartItemId: cartItem.id,
              reservationId: reservation.id,
              requestId: this.requestContext.getRequestId() ?? null
            }
          }
        });
      }
      await this.writeInventoryOutbox(tx, target.branchId, itemReservations.map((reservation) => reservation.inventory_id), cartItem.productId, "ORDER_CONSUMPTION");
    }
    await tx.cart.update({ where: { id: cart.id }, data: { status: CartStatus.ORDERED, lastActivityAt: new Date() } });
    await tx.realtimeOutbox.create({
      data: {
        branchId: target.branchId,
        eventType: "ORDER_CREATED",
        aggregateType: "order",
        aggregateId: order.id,
        payload: { orderId: order.id, tableSessionId: target.tableSessionId, requestId: this.requestContext.getRequestId() ?? null }
      }
    });
    return this.toOrderResponse(await this.loadOrder(tx, order.id));
  }

  private async resolveConfirmTarget(access: OrderAccessContext, cartToken: string | undefined, tableSessionId: string | undefined): Promise<ConfirmTarget> {
    if (cartToken) {
      this.authorizationService.validateUuid(cartToken, "INVALID_CART_TOKEN");
    }
    if (tableSessionId) {
      this.authorizationService.validateUuid(tableSessionId, "INVALID_SESSION_ID");
    }
    if (access.kind === "qr") {
      return {
        branchId: access.qr.branchId,
        tableSessionId: access.qr.tableSessionId,
        cartToken,
        actorId: null,
        source: OrderSource.CUSTOMER
      };
    }
    const resolvedSessionId = tableSessionId ?? (cartToken ? await this.findCartSession(access.branch.branch.id, cartToken) : undefined);
    if (!resolvedSessionId) {
      throw badRequest("VALIDATION_ERROR", "X-Cart-Token or X-Table-Session-Id is required");
    }
    return {
      branchId: access.branch.branch.id,
      tableSessionId: resolvedSessionId,
      cartToken,
      actorId: access.branch.user.id,
      source: OrderSource.STAFF
    };
  }

  private async findCartSession(branchId: string, cartToken: string): Promise<string | undefined> {
    const cart = await this.prisma.cart.findFirst({ where: { branchId, token: cartToken }, select: { tableSessionId: true } });
    return cart?.tableSessionId;
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
        data: { status: IdempotencyStatus.SUCCEEDED, responseStatus, responseBody: this.json(response) }
      });
      return response;
    });
  }

  private async lockOrCreateIdempotency(tx: Prisma.TransactionClient, branchId: string, scope: string, key: string, requestHash: string): Promise<LockedIdempotencyRow> {
    await tx.idempotencyKey.upsert({
      where: { scope_key: { scope, key } },
      create: {
        branchId,
        scope,
        key,
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      update: {}
    });
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

  private async lockSession(tx: Prisma.TransactionClient, tableSessionId: string, branchId: string): Promise<LockedSessionRow | null> {
    const rows = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT id, branch_id, status, closed_at
      FROM table_sessions
      WHERE id = ${tableSessionId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockOrderableCart(tx: Prisma.TransactionClient, target: ConfirmTarget): Promise<LockedCartRow> {
    const rows = target.cartToken
      ? await tx.$queryRaw<LockedCartRow[]>`
          SELECT id, branch_id, table_session_id, status, token
          FROM carts
          WHERE token = ${target.cartToken}::uuid AND branch_id = ${target.branchId}::uuid AND table_session_id = ${target.tableSessionId}::uuid
          FOR UPDATE
        `
      : await tx.$queryRaw<LockedCartRow[]>`
          SELECT id, branch_id, table_session_id, status, token
          FROM carts
          WHERE branch_id = ${target.branchId}::uuid AND table_session_id = ${target.tableSessionId}::uuid AND status = 'ACTIVE'
          ORDER BY last_activity_at DESC, id ASC
          LIMIT 1
          FOR UPDATE
        `;
    const cart = rows[0];
    if (!cart) {
      throw notFound("CART_NOT_FOUND", "Cart not found");
    }
    if (cart.status !== CartStatus.ACTIVE) {
      throw conflict("ORDER_ALREADY_CONFIRMED", "Cart was already confirmed");
    }
    return cart;
  }

  private async lockCartItems(tx: Prisma.TransactionClient, cartId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM cart_items
      WHERE cart_id = ${cartId}::uuid
      ORDER BY id ASC
      FOR UPDATE
    `;
    return rows.map((row) => row.id);
  }

  private async lockCartReservations(tx: Prisma.TransactionClient, itemIds: string[]): Promise<LockedReservationRow[]> {
    return tx.$queryRaw<LockedReservationRow[]>`
      SELECT id, inventory_id, cart_item_id, quantity, status, expires_at, order_item_id
      FROM inventory_reservations
      WHERE cart_item_id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY inventory_id ASC, id ASC
      FOR UPDATE
    `;
  }

  private assertReservationsOrderable(itemIds: string[], reservations: LockedReservationRow[]): void {
    const now = Date.now();
    for (const itemId of itemIds) {
      const itemReservations = reservations.filter((reservation) => reservation.cart_item_id === itemId);
      if (itemReservations.length === 0) {
        throw unprocessable("INSUFFICIENT_INVENTORY", "Cart item has no active reservation");
      }
      if (itemReservations.some((reservation) => reservation.status !== ReservationStatus.ACTIVE || reservation.order_item_id)) {
        throw conflict("ORDER_ALREADY_CONFIRMED", "Reservation was already consumed");
      }
      if (itemReservations.some((reservation) => reservation.expires_at.getTime() <= now)) {
        throw conflict("RESERVATION_EXPIRED", "Reservation expired");
      }
    }
  }

  private async lockInventories(tx: Prisma.TransactionClient, inventoryIds: string[]): Promise<LockedInventoryRow[]> {
    if (inventoryIds.length === 0) {
      return [];
    }
    return tx.$queryRaw<LockedInventoryRow[]>`
      SELECT id, ingredient_id, physical_quantity, reserved_quantity
      FROM inventories
      WHERE id IN (${Prisma.join(inventoryIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id ASC
      FOR UPDATE
    `;
  }

  private async lockOrderItem(tx: Prisma.TransactionClient, itemId: string, branchId: string): Promise<{
    id: string;
    order_id: string;
    product_id: string;
    processing_area: ProcessingArea;
    status: OrderItemStatus;
  } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; order_id: string; product_id: string; processing_area: ProcessingArea; status: OrderItemStatus }>>`
      SELECT oi.id, oi.order_id, oi.product_id, oi.processing_area, oi.status
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ${itemId}::uuid AND o.branch_id = ${branchId}::uuid
      FOR UPDATE OF oi
    `;
    return rows[0] ?? null;
  }

  private async lockConsumedReservations(tx: Prisma.TransactionClient, orderItemId: string): Promise<LockedReservationRow[]> {
    return tx.$queryRaw<LockedReservationRow[]>`
      SELECT id, inventory_id, cart_item_id, quantity, status, expires_at, order_item_id
      FROM inventory_reservations
      WHERE order_item_id = ${orderItemId}::uuid AND status = 'CONSUMED'
      ORDER BY inventory_id ASC, id ASC
      FOR UPDATE
    `;
  }

  private sumReservationsByInventory(reservations: LockedReservationRow[]): Map<string, Prisma.Decimal> {
    const result = new Map<string, Prisma.Decimal>();
    for (const reservation of reservations) {
      result.set(reservation.inventory_id, (result.get(reservation.inventory_id) ?? new Prisma.Decimal(0)).add(reservation.quantity));
    }
    return result;
  }

  private assertStatusTransition(from: OrderItemStatus, to: OrderItemStatus): void {
    const valid: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
      [OrderItemStatus.NEW]: OrderItemStatus.PREPARING,
      [OrderItemStatus.PREPARING]: OrderItemStatus.READY,
      [OrderItemStatus.READY]: OrderItemStatus.SERVED
    };
    if (valid[from] !== to) {
      throw conflict("INVALID_STATUS_TRANSITION", "Invalid order item status transition");
    }
  }

  private requireStaff(access: OrderAccessContext): BranchContext {
    if (access.kind !== "staff") {
      throw forbidden("FORBIDDEN", "Staff access is required");
    }
    return access.branch;
  }

  private assertAreaPermission(context: BranchContext, area: ProcessingArea): void {
    const required: PermissionCode = area === ProcessingArea.BAR ? "BAR_QUEUE_READ" : "KITCHEN_QUEUE_READ";
    this.authorizationService.assertPermissions(context, [required]);
  }

  private async writeInventoryOutbox(tx: Prisma.TransactionClient, branchId: string, inventoryIds: string[], productId: string, reason: string): Promise<void> {
    const uniqueInventoryIds = [...new Set(inventoryIds)].sort();
    const events: Prisma.RealtimeOutboxCreateManyInput[] = uniqueInventoryIds.map((inventoryId) => ({
      branchId,
      eventType: "INVENTORY_CHANGED",
      aggregateType: "inventory",
      aggregateId: inventoryId,
      payload: { inventoryId, productId, reason, requestId: this.requestContext.getRequestId() ?? null }
    }));
    events.push({
      branchId,
      eventType: "PRODUCT_AVAILABILITY_CHANGED",
      aggregateType: "product",
      aggregateId: productId,
      payload: { productId, reason, requestId: this.requestContext.getRequestId() ?? null }
    });
    await tx.realtimeOutbox.createMany({ data: events });
  }

  private async writeOrderItemOutbox(tx: Prisma.TransactionClient, branchId: string, orderId: string, orderItemId: string, eventType: string, status: OrderItemStatus): Promise<void> {
    await tx.realtimeOutbox.create({
      data: {
        branchId,
        eventType,
        aggregateType: "order_item",
        aggregateId: orderItemId,
        payload: { orderId, orderItemId, status, requestId: this.requestContext.getRequestId() ?? null }
      }
    });
  }

  private async broadcastOutbox(branchId: string, eventType: string, payload: Prisma.JsonValue): Promise<void> {
    if (this.configService.get("NODE_ENV", { infer: true }) === "test" || !this.configService.get("REALTIME_ENABLED", { infer: true })) {
      return;
    }
    const client = this.getSupabaseClient();
    const channel = client.channel(`branch:${branchId}`);
    const result = await channel.send({ type: "broadcast", event: eventType, payload });
    if (result !== "ok") {
      throw new Error(`Realtime broadcast failed: ${result}`);
    }
  }

  private getSupabaseClient(): SupabaseClient {
    if (!this.supabase) {
      this.supabase = createClient(this.configService.get("SUPABASE_URL", { infer: true }), this.configService.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true }), {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    return this.supabase;
  }

  private async loadOrder(tx: Prisma.TransactionClient | PrismaService, orderId: string): Promise<OrderWithItems> {
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: this.orderInclude() });
  }

  private orderInclude() {
    return {
      tableSession: { include: { table: true } },
      items: {
        include: { options: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } },
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }]
      }
    };
  }

  private queueItemInclude() {
    return {
      options: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
      order: { include: { tableSession: { include: { table: true } } } }
    };
  }

  private cartConfirmInclude() {
    return {
      items: {
        include: {
          product: true,
          options: {
            include: {
              productOptionValue: {
                include: {
                  optionValue: { include: { optionGroup: true } },
                  productOptionGroup: { include: { optionGroup: true } }
                }
              }
            },
            orderBy: [{ productOptionValueId: "asc" as const }]
          }
        },
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }]
      }
    };
  }

  private toOrderResponse(order: OrderWithItems): OrderResponse {
    const items = order.items.map((item) => this.toOrderItemResponse(item));
    const subtotal = items.reduce((sum, item) => sum.add(item.lineSubtotal), new Prisma.Decimal(0));
    return {
      id: order.id,
      branchId: order.branchId,
      tableSessionId: order.tableSessionId,
      cartId: order.cartId,
      orderNumber: order.orderNumber,
      source: order.source,
      createdById: order.createdById,
      table: {
        id: order.tableSession.table.id,
        code: order.tableSession.table.code,
        displayName: order.tableSession.table.displayName
      },
      items,
      subtotal: subtotal.toFixed(2),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private toOrderItemResponse(item: OrderWithItems["items"][number]): OrderItemResponse {
    return {
      id: item.id,
      productId: item.productId,
      productCodeSnapshot: item.productCodeSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      processingArea: item.processingArea,
      quantity: item.quantity,
      baseUnitPrice: item.baseUnitPrice.toFixed(2),
      optionUnitPrice: item.optionUnitPrice.toFixed(2),
      finalUnitPrice: item.finalUnitPrice.toFixed(2),
      lineSubtotal: item.lineSubtotal.toFixed(2),
      note: item.note,
      isTakeaway: item.isTakeaway,
      status: item.status,
      preparingAt: item.preparingAt?.toISOString() ?? null,
      readyAt: item.readyAt?.toISOString() ?? null,
      servedAt: item.servedAt?.toISOString() ?? null,
      cancelledAt: item.cancelledAt?.toISOString() ?? null,
      cancelReason: item.cancelReason,
      options: item.options.map((option) => this.toOptionResponse(option)),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toOptionResponse(option: OrderWithItems["items"][number]["options"][number]): OrderItemOptionResponse {
    return {
      id: option.id,
      productOptionValueId: option.productOptionValueId,
      groupType: option.groupType,
      groupNameSnapshot: option.groupNameSnapshot,
      optionNameSnapshot: option.optionNameSnapshot,
      priceDeltaSnapshot: option.priceDeltaSnapshot.toFixed(2)
    };
  }

  private toQueueItemResponse(item: QueueOrderItem): QueueItemResponse {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - item.createdAt.getTime()) / 1000));
    return {
      id: item.id,
      orderId: item.orderId,
      orderNumber: item.order.orderNumber,
      tableSessionId: item.order.tableSessionId,
      table: {
        id: item.order.tableSession.table.id,
        code: item.order.tableSession.table.code,
        displayName: item.order.tableSession.table.displayName
      },
      processingArea: item.processingArea,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      note: item.note,
      status: item.status,
      options: item.options.map((option) => this.toOptionResponse(option)),
      orderCreatedAt: item.order.createdAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      elapsedSeconds,
      urgency: this.urgency(elapsedSeconds)
    };
  }

  private urgency(elapsedSeconds: number): QueueItemResponse["urgency"] {
    const minutes = elapsedSeconds / 60;
    if (minutes <= 3) {
      return "GREEN";
    }
    if (minutes <= 7) {
      return "ORANGE";
    }
    if (minutes <= 10) {
      return "RED";
    }
    return "OVERDUE";
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

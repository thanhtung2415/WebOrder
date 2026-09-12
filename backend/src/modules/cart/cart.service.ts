import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CartStatus, Prisma, ProductStatus, ReservationStatus, SessionStatus } from "@prisma/client";
import { badRequest, conflict, notFound, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../database/prisma.service";
import { AuthorizationService } from "../auth/services/authorization.service";
import { RecipeResolverService } from "../recipes/recipe-resolver.service";
import { ResolvedRecipe } from "../recipes/recipe.types";
import { CreateCartItemDto, UpdateCartItemDto } from "./dto/cart.dto";
import { CartAccessContext, CartItemOptionResponse, CartItemResponse, CartReservationResponse, CartResponse } from "./cart.types";

type CartWithItems = Prisma.CartGetPayload<{
  include: ReturnType<CartService["cartInclude"]>;
}>;

type ProductOptionValueWithRelations = Prisma.ProductOptionValueGetPayload<{
  include: {
    optionValue: { include: { optionGroup: true } };
    productOptionGroup: { include: { optionGroup: true } };
  };
}>;

interface CartTarget {
  branchId: string;
  tableSessionId: string;
  staffActorId: string | null;
  customerTableId: string | null;
}

interface LockedSessionRow {
  id: string;
  branch_id: string;
  table_id: string;
  status: SessionStatus;
  closed_at: Date | null;
}

interface LockedCartRow {
  id: string;
  branch_id: string;
  table_session_id: string;
  token: string;
  status: CartStatus;
}

interface LockedCartItemRow {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number;
  note: string | null;
  is_takeaway: boolean;
}

interface LockedReservationRow {
  id: string;
  inventory_id: string;
  cart_item_id: string;
  quantity: Prisma.Decimal;
  status: ReservationStatus;
  expires_at: Date;
  terminal_at: Date | null;
}

interface DueReservationRow extends LockedReservationRow {
  branch_id: string;
  ingredient_id: string;
  product_id: string;
}

interface InventoryIdentity {
  id: string;
  ingredientId: string;
}

@Injectable()
export class CartService implements OnModuleInit, OnModuleDestroy {
  private scheduler: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly recipeResolver: RecipeResolverService,
    private readonly requestContext: RequestContextService,
    private readonly configService: ConfigService<EnvironmentVariables, true>
  ) {}

  onModuleInit(): void {
    if (this.configService.get("NODE_ENV", { infer: true }) === "test") {
      return;
    }
    this.scheduler = setInterval(() => {
      void this.expireDueReservations(100).catch(() => undefined);
    }, 30_000);
    this.scheduler.unref();
  }

  onModuleDestroy(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  async getCart(access: CartAccessContext, cartToken?: string, tableSessionId?: string): Promise<CartResponse> {
    const target = await this.resolveTarget(access, cartToken, tableSessionId);
    const cart = await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, target, false);
      const activeCart = await this.getOrCreateActiveCart(tx, target, cartToken);
      return this.loadCart(tx, activeCart.id);
    });
    return this.toCartResponse(cart);
  }

  async addItem(access: CartAccessContext, cartToken: string | undefined, tableSessionId: string | undefined, dto: CreateCartItemDto): Promise<CartResponse> {
    const target = await this.resolveTarget(access, cartToken, tableSessionId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, target, true);
      const cart = await this.getOrCreateActiveCart(tx, target, cartToken);
      const optionValueIds = await this.validateAndNormalizeOptions(tx, target.branchId, dto.productId, dto.optionValueIds ?? []);
      const recipe = await this.recipeResolver.resolveProductRecipeInTx(tx, dto.productId, optionValueIds, target.branchId);
      const item = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: dto.productId,
          quantity: dto.quantity,
          note: this.cleanNote(dto.note),
          isTakeaway: dto.isTakeaway ?? false,
          options: { createMany: { data: optionValueIds.map((id) => ({ productOptionValueId: id })) } }
        }
      });
      await this.reserveRecipe(tx, target.branchId, item.id, recipe, dto.quantity, this.nextExpiry());
      await this.touchCart(tx, cart.id);
      await this.writeAvailabilityOutbox(tx, target.branchId, dto.productId, recipe.ingredients.map((ingredient) => ingredient.ingredientId), "CART_ITEM_ADDED");
      return this.toCartResponse(await this.loadCart(tx, cart.id));
    });
  }

  async updateItem(access: CartAccessContext, itemId: string, dto: UpdateCartItemDto): Promise<CartResponse> {
    this.authorizationService.validateUuid(itemId, "INVALID_CART_ITEM_ID");
    this.assertUpdateBody(dto);
    const target = await this.resolveTarget(access);
    const expired = await this.expireItemReservations(itemId, target);
    const changesRecipe = dto.quantity !== undefined || dto.optionValueIds !== undefined;

    if (!changesRecipe && expired > 0) {
      throw conflict("RESERVATION_EXPIRED", "Reservation expired; update item choices or add the item again");
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, target, true);
      const item = await this.lockCartItem(tx, itemId, target);
      if (!item) {
        throw notFound("CART_NOT_FOUND", "Cart item not found");
      }
      if (!changesRecipe) {
        await tx.cartItem.update({
          where: { id: itemId },
          data: {
            ...(dto.note !== undefined ? { note: this.cleanNote(dto.note) } : {}),
            ...(dto.isTakeaway !== undefined ? { isTakeaway: dto.isTakeaway } : {})
          }
        });
        await this.touchCart(tx, item.cart_id);
        return this.toCartResponse(await this.loadCart(tx, item.cart_id));
      }

      const existingOptions = await tx.cartItemOption.findMany({ where: { cartItemId: itemId }, orderBy: [{ productOptionValueId: "asc" }] });
      const nextQuantity = dto.quantity ?? item.quantity;
      const nextOptionValueIds = dto.optionValueIds ?? existingOptions.map((option) => option.productOptionValueId);
      const normalizedOptions = await this.validateAndNormalizeOptions(tx, target.branchId, item.product_id, nextOptionValueIds);
      const recipe = await this.recipeResolver.resolveProductRecipeInTx(tx, item.product_id, normalizedOptions, target.branchId);
      const terminalConflict = await this.itemHasTerminalReservationConflict(tx, itemId, target.branchId, recipe);

      if (expired > 0 || terminalConflict) {
        const replacement = await this.replaceCartItem(tx, item, dto, normalizedOptions, nextQuantity);
        await this.reserveRecipe(tx, target.branchId, replacement.id, recipe, nextQuantity, this.nextExpiry());
        await this.writeAvailabilityOutbox(tx, target.branchId, item.product_id, recipe.ingredients.map((ingredient) => ingredient.ingredientId), "CART_ITEM_REPLACED");
        await this.touchCart(tx, item.cart_id);
        return this.toCartResponse(await this.loadCart(tx, item.cart_id));
      }

      await this.reconcileReservations(tx, target.branchId, itemId, recipe, nextQuantity, this.nextExpiry());
      await tx.cartItemOption.deleteMany({ where: { cartItemId: itemId } });
      await tx.cartItemOption.createMany({ data: normalizedOptions.map((id) => ({ cartItemId: itemId, productOptionValueId: id })) });
      await tx.cartItem.update({
        where: { id: itemId },
        data: {
          quantity: nextQuantity,
          ...(dto.note !== undefined ? { note: this.cleanNote(dto.note) } : {}),
          ...(dto.isTakeaway !== undefined ? { isTakeaway: dto.isTakeaway } : {})
        }
      });
      await this.writeAvailabilityOutbox(tx, target.branchId, item.product_id, recipe.ingredients.map((ingredient) => ingredient.ingredientId), "CART_ITEM_UPDATED");
      await this.touchCart(tx, item.cart_id);
      return this.toCartResponse(await this.loadCart(tx, item.cart_id));
    });
  }

  async deleteItem(access: CartAccessContext, itemId: string): Promise<CartResponse> {
    this.authorizationService.validateUuid(itemId, "INVALID_CART_ITEM_ID");
    const target = await this.resolveTarget(access);
    await this.expireItemReservations(itemId, target);

    return this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx, target, true);
      const item = await this.lockCartItem(tx, itemId, target);
      if (!item) {
        throw notFound("CART_NOT_FOUND", "Cart item not found");
      }
      const reservations = await this.lockItemReservations(tx, itemId);
      const activeReservations = reservations.filter((reservation) => reservation.status === ReservationStatus.ACTIVE);
      for (const reservation of activeReservations) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: ReservationStatus.RELEASED, terminalAt: new Date() }
        });
      }
      await this.moveItemToAbandonedCart(tx, item);
      await this.touchCart(tx, item.cart_id);
      await this.writeReservationOutbox(tx, target.branchId, activeReservations.map((reservation) => reservation.inventory_id), item.product_id, "CART_ITEM_DELETED");
      return this.toCartResponse(await this.loadCart(tx, item.cart_id));
    });
  }

  async expireDueReservations(limit = 100): Promise<number> {
    const batchLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<DueReservationRow[]>`
        SELECT ir.id, ir.inventory_id, ir.cart_item_id, ir.quantity, ir.status, ir.expires_at, ir.terminal_at,
               c.branch_id, i.ingredient_id, ci.product_id
        FROM inventory_reservations ir
        JOIN inventories i ON i.id = ir.inventory_id
        JOIN cart_items ci ON ci.id = ir.cart_item_id
        JOIN carts c ON c.id = ci.cart_id
        WHERE ir.status = 'ACTIVE' AND ir.expires_at <= now()
        ORDER BY ir.expires_at ASC, ir.id ASC
        LIMIT ${batchLimit}
        FOR UPDATE OF ir SKIP LOCKED
      `;
      for (const reservation of due) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: ReservationStatus.EXPIRED, terminalAt: new Date() }
        });
      }
      await this.writeSchedulerOutbox(tx, due);
      return due.length;
    });
  }

  private async resolveTarget(access: CartAccessContext, cartToken?: string, tableSessionId?: string): Promise<CartTarget> {
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
        staffActorId: null,
        customerTableId: access.qr.tableId
      };
    }

    if (tableSessionId) {
      return {
        branchId: access.branch.branch.id,
        tableSessionId,
        staffActorId: access.branch.user.id,
        customerTableId: null
      };
    }

    if (cartToken) {
      const cart = await this.prisma.cart.findUnique({ where: { token: cartToken } });
      if (!cart || cart.branchId !== access.branch.branch.id || cart.status !== CartStatus.ACTIVE) {
        throw notFound("CART_NOT_FOUND", "Cart not found");
      }
      return {
        branchId: access.branch.branch.id,
        tableSessionId: cart.tableSessionId,
        staffActorId: access.branch.user.id,
        customerTableId: null
      };
    }

    throw badRequest("VALIDATION_ERROR", "X-Table-Session-Id is required for staff cart creation");
  }

  private async lockSession(tx: Prisma.TransactionClient, target: CartTarget, forMutation: boolean): Promise<LockedSessionRow> {
    const rows = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT id, branch_id, table_id, status, closed_at
      FROM table_sessions
      WHERE id = ${target.tableSessionId}::uuid AND branch_id = ${target.branchId}::uuid
      FOR UPDATE
    `;
    const session = rows[0];
    if (!session) {
      throw notFound("SESSION_NOT_FOUND", "Session not found");
    }
    if (target.customerTableId && session.table_id !== target.customerTableId) {
      throw conflict("INVALID_QR_SESSION", "QR session does not match the current table");
    }
    if (session.status === SessionStatus.CLOSED || session.closed_at) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
    if (forMutation && session.status === SessionStatus.LOCKED) {
      throw conflict("SESSION_LOCKED", "Table session is locked");
    }
    return session;
  }

  private async getOrCreateActiveCart(tx: Prisma.TransactionClient, target: CartTarget, cartToken?: string): Promise<LockedCartRow> {
    if (cartToken) {
      const rows = await tx.$queryRaw<LockedCartRow[]>`
        SELECT id, branch_id, table_session_id, token, status
        FROM carts
        WHERE token = ${cartToken}::uuid
        FOR UPDATE
      `;
      const cart = rows[0];
      if (!cart || cart.branch_id !== target.branchId || cart.table_session_id !== target.tableSessionId || cart.status !== CartStatus.ACTIVE) {
        throw notFound("CART_NOT_FOUND", "Cart not found");
      }
      return cart;
    }

    const created = await tx.cart.create({
      data: {
        branchId: target.branchId,
        tableSessionId: target.tableSessionId,
        status: CartStatus.ACTIVE
      }
    });
    return {
      id: created.id,
      branch_id: created.branchId,
      table_session_id: created.tableSessionId,
      token: created.token,
      status: created.status
    };
  }

  private async lockCartItem(tx: Prisma.TransactionClient, itemId: string, target: CartTarget): Promise<LockedCartItemRow | null> {
    const rows = await tx.$queryRaw<LockedCartItemRow[]>`
      SELECT ci.id, ci.cart_id, ci.product_id, ci.quantity, ci.note, ci.is_takeaway
      FROM cart_items ci
      JOIN carts c ON c.id = ci.cart_id
      WHERE ci.id = ${itemId}::uuid
        AND c.branch_id = ${target.branchId}::uuid
        AND c.table_session_id = ${target.tableSessionId}::uuid
        AND c.status = 'ACTIVE'
      FOR UPDATE OF ci
    `;
    return rows[0] ?? null;
  }

  private async validateAndNormalizeOptions(tx: Prisma.TransactionClient, branchId: string, productId: string, optionValueIds: string[]): Promise<string[]> {
    this.authorizationService.validateUuid(productId, "INVALID_PRODUCT_ID");
    const product = await tx.product.findFirst({
      where: { id: productId, branchId, deletedAt: null },
      include: {
        category: true,
        optionGroups: {
          include: {
            optionGroup: true,
            values: { include: { optionValue: { include: { optionGroup: true } } } }
          }
        }
      }
    });
    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Product not found");
    }
    if (product.status !== ProductStatus.ACTIVE || !product.category.isActive || product.category.deletedAt) {
      throw unprocessable("PRODUCT_UNAVAILABLE", "Product is unavailable");
    }

    const selected = new Set([...optionValueIds].sort());
    for (const id of selected) {
      this.authorizationService.validateUuid(id, "INVALID_OPTION");
    }

    const activeGroups = product.optionGroups.filter((group) => group.optionGroup.isActive && !group.optionGroup.deletedAt);
    const activeValues = new Map<string, ProductOptionValueWithRelations>();
    for (const group of activeGroups) {
      for (const value of group.values) {
        if (value.isActive && value.optionValue.isActive && !value.optionValue.deletedAt) {
          activeValues.set(value.id, {
            ...value,
            productOptionGroup: { ...group, optionGroup: group.optionGroup }
          });
        }
      }
    }

    for (const id of selected) {
      if (!activeValues.has(id)) {
        throw badRequest("INVALID_OPTION", "Selected option does not belong to this product");
      }
    }

    for (const group of activeGroups) {
      const groupValues = group.values.filter((value) => value.isActive && value.optionValue.isActive && !value.optionValue.deletedAt);
      const selectedForGroup = groupValues.filter((value) => selected.has(value.id));
      if (selectedForGroup.length === 0) {
        const defaultValue = groupValues.find((value) => value.isDefault);
        if (defaultValue) {
          selected.add(defaultValue.id);
          selectedForGroup.push(defaultValue);
        }
      }
      if (selectedForGroup.length < group.minSelections || selectedForGroup.length > group.maxSelections) {
        throw badRequest("INVALID_OPTION", "Selected options do not satisfy product option rules");
      }
    }

    return [...selected].sort();
  }

  private async reserveRecipe(tx: Prisma.TransactionClient, branchId: string, cartItemId: string, recipe: ResolvedRecipe, quantity: number, expiresAt: Date): Promise<void> {
    const requirements = recipe.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      quantity: new Prisma.Decimal(ingredient.quantity).mul(quantity)
    }));
    const inventories = await this.ensureInventories(tx, branchId, requirements.map((requirement) => requirement.ingredientId));
    await this.lockInventories(tx, inventories.map((inventory) => inventory.id));
    const inventoryByIngredient = new Map(inventories.map((inventory) => [inventory.ingredientId, inventory]));

    try {
      for (const requirement of requirements) {
        const inventory = inventoryByIngredient.get(requirement.ingredientId);
        if (!inventory) {
          throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
        }
        await tx.inventoryReservation.create({
          data: {
            inventoryId: inventory.id,
            cartItemId,
            quantity: requirement.quantity,
            status: ReservationStatus.ACTIVE,
            expiresAt
          }
        });
      }
    } catch (error) {
      this.rethrowReservationError(error);
      throw error;
    }
  }

  private async reconcileReservations(tx: Prisma.TransactionClient, branchId: string, cartItemId: string, recipe: ResolvedRecipe, quantity: number, expiresAt: Date): Promise<void> {
    const requirements = recipe.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      quantity: new Prisma.Decimal(ingredient.quantity).mul(quantity)
    }));
    const inventories = await this.ensureInventories(tx, branchId, requirements.map((requirement) => requirement.ingredientId));
    await this.lockInventories(tx, inventories.map((inventory) => inventory.id));
    const inventoryByIngredient = new Map(inventories.map((inventory) => [inventory.ingredientId, inventory]));
    const activeReservations = await this.lockItemReservations(tx, cartItemId);
    const activeByInventoryId = new Map(activeReservations.filter((reservation) => reservation.status === ReservationStatus.ACTIVE).map((reservation) => [reservation.inventory_id, reservation]));
    const requiredInventoryIds = new Set<string>();

    try {
      for (const requirement of requirements) {
        const inventory = inventoryByIngredient.get(requirement.ingredientId);
        if (!inventory) {
          throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
        }
        requiredInventoryIds.add(inventory.id);
        const existing = activeByInventoryId.get(inventory.id);
        if (existing) {
          await tx.inventoryReservation.update({
            where: { id: existing.id },
            data: { quantity: requirement.quantity, expiresAt }
          });
        } else {
          await tx.inventoryReservation.create({
            data: {
              inventoryId: inventory.id,
              cartItemId,
              quantity: requirement.quantity,
              status: ReservationStatus.ACTIVE,
              expiresAt
            }
          });
        }
      }
      for (const reservation of activeByInventoryId.values()) {
        if (!requiredInventoryIds.has(reservation.inventory_id)) {
          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: { status: ReservationStatus.RELEASED, terminalAt: new Date() }
          });
        }
      }
    } catch (error) {
      this.rethrowReservationError(error);
      throw error;
    }
  }

  private async ensureInventories(tx: Prisma.TransactionClient, branchId: string, ingredientIds: string[]): Promise<InventoryIdentity[]> {
    const uniqueIngredientIds = [...new Set(ingredientIds)].sort();
    for (const ingredientId of uniqueIngredientIds) {
      await tx.inventory.upsert({
        where: { branchId_ingredientId: { branchId, ingredientId } },
        create: { branchId, ingredientId },
        update: {}
      });
    }
    return tx.inventory.findMany({
      where: { branchId, ingredientId: { in: uniqueIngredientIds } },
      select: { id: true, ingredientId: true }
    });
  }

  private async lockInventories(tx: Prisma.TransactionClient, inventoryIds: string[]): Promise<void> {
    for (const inventoryId of [...new Set(inventoryIds)].sort()) {
      await tx.$executeRaw`SELECT id FROM inventories WHERE id = ${inventoryId}::uuid FOR UPDATE`;
    }
  }

  private async lockItemReservations(tx: Prisma.TransactionClient, cartItemId: string): Promise<LockedReservationRow[]> {
    return tx.$queryRaw<LockedReservationRow[]>`
      SELECT id, inventory_id, cart_item_id, quantity, status, expires_at, terminal_at
      FROM inventory_reservations
      WHERE cart_item_id = ${cartItemId}::uuid
      ORDER BY inventory_id ASC
      FOR UPDATE
    `;
  }

  private async expireItemReservations(itemId: string, target: CartTarget): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const item = await this.lockCartItem(tx, itemId, target);
      if (!item) {
        return 0;
      }
      const due = await tx.$queryRaw<LockedReservationRow[]>`
        SELECT ir.id, ir.inventory_id, ir.cart_item_id, ir.quantity, ir.status, ir.expires_at, ir.terminal_at
        FROM inventory_reservations ir
        WHERE ir.cart_item_id = ${itemId}::uuid
          AND ir.status = 'ACTIVE'
          AND ir.expires_at <= now()
        ORDER BY ir.inventory_id ASC
        FOR UPDATE OF ir
      `;
      for (const reservation of due) {
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: ReservationStatus.EXPIRED, terminalAt: new Date() }
        });
      }
      await this.writeReservationOutbox(tx, target.branchId, due.map((reservation) => reservation.inventory_id), item.product_id, "CART_ITEM_EXPIRED");
      return due.length;
    });
  }

  private async itemHasTerminalReservationConflict(tx: Prisma.TransactionClient, itemId: string, branchId: string, recipe: ResolvedRecipe): Promise<boolean> {
    const inventories = await this.ensureInventories(tx, branchId, recipe.ingredients.map((ingredient) => ingredient.ingredientId));
    const requiredInventoryIds = new Set(inventories.map((inventory) => inventory.id));
    const rows = await tx.inventoryReservation.findMany({
      where: {
        cartItemId: itemId,
        inventoryId: { in: [...requiredInventoryIds] },
        status: { not: ReservationStatus.ACTIVE }
      },
      select: { id: true }
    });
    return rows.length > 0;
  }

  private async replaceCartItem(
    tx: Prisma.TransactionClient,
    item: LockedCartItemRow,
    dto: UpdateCartItemDto,
    optionValueIds: string[],
    quantity: number
  ): Promise<{ id: string }> {
    const activeReservations = (await this.lockItemReservations(tx, item.id)).filter((reservation) => reservation.status === ReservationStatus.ACTIVE);
    for (const reservation of activeReservations) {
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.RELEASED, terminalAt: new Date() }
      });
    }
    await this.moveItemToAbandonedCart(tx, item);
    return tx.cartItem.create({
      data: {
        cartId: item.cart_id,
        productId: item.product_id,
        quantity,
        note: dto.note !== undefined ? this.cleanNote(dto.note) : item.note,
        isTakeaway: dto.isTakeaway ?? item.is_takeaway,
        options: { createMany: { data: optionValueIds.map((id) => ({ productOptionValueId: id })) } }
      },
      select: { id: true }
    });
  }

  private async moveItemToAbandonedCart(tx: Prisma.TransactionClient, item: LockedCartItemRow): Promise<void> {
    const sourceCart = await tx.cart.findUniqueOrThrow({ where: { id: item.cart_id } });
    const abandoned = await tx.cart.create({
      data: {
        branchId: sourceCart.branchId,
        tableSessionId: sourceCart.tableSessionId,
        status: CartStatus.ABANDONED
      }
    });
    await tx.cartItem.update({ where: { id: item.id }, data: { cartId: abandoned.id } });
  }

  private async touchCart(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
    await tx.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } });
  }

  private async loadCart(tx: Prisma.TransactionClient | PrismaService, cartId: string): Promise<CartWithItems> {
    return tx.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: this.cartInclude()
    });
  }

  private cartInclude() {
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
          },
          reservations: {
            include: { inventory: true },
            orderBy: [{ inventoryId: "asc" as const }]
          }
        },
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }]
      }
    };
  }

  private toCartResponse(cart: CartWithItems): CartResponse {
    const items = cart.items.map((item) => this.toCartItemResponse(item));
    const subtotal = items.reduce((sum, item) => sum.add(item.lineSubtotal), new Prisma.Decimal(0));
    return {
      id: cart.id,
      token: cart.token,
      branchId: cart.branchId,
      tableSessionId: cart.tableSessionId,
      status: cart.status,
      items,
      subtotal: subtotal.toFixed(2),
      lastActivityAt: cart.lastActivityAt.toISOString(),
      createdAt: cart.createdAt.toISOString(),
      updatedAt: cart.updatedAt.toISOString()
    };
  }

  private toCartItemResponse(item: CartWithItems["items"][number]): CartItemResponse {
    const options = item.options.map((option) => this.toCartItemOptionResponse(option.productOptionValue));
    const unitPrice = options.reduce((sum, option) => sum.add(option.priceDelta), item.product.basePrice);
    const reservations = item.reservations.map((reservation) => this.toReservationResponse(reservation));
    const active = reservations.filter((reservation) => reservation.status === ReservationStatus.ACTIVE || reservation.status === "EXPIRED_PENDING");
    return {
      id: item.id,
      product: {
        id: item.product.id,
        code: item.product.code,
        name: item.product.name,
        imagePath: item.product.imagePath
      },
      quantity: item.quantity,
      note: item.note,
      isTakeaway: item.isTakeaway,
      unitPrice: unitPrice.toFixed(2),
      lineSubtotal: unitPrice.mul(item.quantity).toFixed(2),
      reservationStatus: this.deriveItemReservationStatus(reservations),
      reservationExpiresAt: active.length ? active.map((reservation) => reservation.expiresAt).sort()[0] : null,
      options,
      reservations,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toCartItemOptionResponse(value: ProductOptionValueWithRelations): CartItemOptionResponse {
    return {
      id: value.id,
      productOptionValueId: value.id,
      optionGroupId: value.productOptionGroup.optionGroupId,
      optionGroupCode: value.productOptionGroup.optionGroup.code,
      optionGroupName: value.productOptionGroup.optionGroup.name,
      optionValueId: value.optionValueId,
      optionValueCode: value.optionValue.code,
      optionValueName: value.optionValue.name,
      priceDelta: value.priceDelta.toFixed(2)
    };
  }

  private toReservationResponse(reservation: CartWithItems["items"][number]["reservations"][number]): CartReservationResponse {
    const isExpiredPending = reservation.status === ReservationStatus.ACTIVE && reservation.expiresAt.getTime() <= Date.now();
    return {
      id: reservation.id,
      inventoryId: reservation.inventoryId,
      ingredientId: reservation.inventory.ingredientId,
      status: isExpiredPending ? "EXPIRED_PENDING" : reservation.status,
      quantity: reservation.quantity.toFixed(3),
      expiresAt: reservation.expiresAt.toISOString(),
      terminalAt: reservation.terminalAt?.toISOString() ?? null
    };
  }

  private deriveItemReservationStatus(reservations: CartReservationResponse[]): CartItemResponse["reservationStatus"] {
    if (reservations.length === 0) {
      return "UNAVAILABLE";
    }
    if (reservations.some((reservation) => reservation.status === "EXPIRED_PENDING" || reservation.status === ReservationStatus.EXPIRED)) {
      return "EXPIRED";
    }
    if (reservations.some((reservation) => reservation.status === ReservationStatus.ACTIVE)) {
      return "ACTIVE";
    }
    return "RELEASED";
  }

  private async writeAvailabilityOutbox(tx: Prisma.TransactionClient, branchId: string, productId: string, ingredientIds: string[], reason: string): Promise<void> {
    const inventories = await tx.inventory.findMany({
      where: { branchId, ingredientId: { in: [...new Set(ingredientIds)] } },
      select: { id: true, ingredientId: true }
    });
    await this.writeReservationOutbox(tx, branchId, inventories.map((inventory) => inventory.id), productId, reason);
  }

  private async writeReservationOutbox(tx: Prisma.TransactionClient, branchId: string, inventoryIds: string[], productId: string, reason: string): Promise<void> {
    const uniqueInventoryIds = [...new Set(inventoryIds)].sort();
    const events: Prisma.RealtimeOutboxCreateManyInput[] = uniqueInventoryIds.map((inventoryId) => ({
      branchId,
      eventType: "INVENTORY_CHANGED",
      aggregateType: "inventory",
      aggregateId: inventoryId,
      payload: {
        inventoryId,
        productId,
        reason,
        requestId: this.requestContext.getRequestId() ?? null
      }
    }));
    events.push({
      branchId,
      eventType: "PRODUCT_AVAILABILITY_CHANGED",
      aggregateType: "product",
      aggregateId: productId,
      payload: {
        inventoryId: null,
        productId,
        reason,
        requestId: this.requestContext.getRequestId() ?? null
      }
    });
    await tx.realtimeOutbox.createMany({ data: events });
  }

  private async writeSchedulerOutbox(tx: Prisma.TransactionClient, rows: DueReservationRow[]): Promise<void> {
    const byBranchAndProduct = new Map<string, { branchId: string; productId: string; inventoryIds: Set<string> }>();
    for (const row of rows) {
      const key = `${row.branch_id}:${row.product_id}`;
      const current = byBranchAndProduct.get(key) ?? { branchId: row.branch_id, productId: row.product_id, inventoryIds: new Set<string>() };
      current.inventoryIds.add(row.inventory_id);
      byBranchAndProduct.set(key, current);
    }
    for (const value of byBranchAndProduct.values()) {
      await this.writeReservationOutbox(tx, value.branchId, [...value.inventoryIds], value.productId, "RESERVATION_EXPIRED");
    }
  }

  private nextExpiry(): Date {
    const minutes = this.configService.get("RESERVATION_TTL_MINUTES", { infer: true });
    return new Date(Date.now() + (minutes || 10) * 60 * 1000);
  }

  private cleanNote(value: string | undefined): string | null {
    return value?.trim() || null;
  }

  private assertUpdateBody(dto: UpdateCartItemDto): void {
    if (dto.quantity === undefined && dto.optionValueIds === undefined && dto.note === undefined && dto.isTakeaway === undefined) {
      throw badRequest("VALIDATION_ERROR", "At least one cart item field is required");
    }
  }

  private rethrowReservationError(error: unknown): void {
    if (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes("Insufficient available inventory")) {
      throw unprocessable("INSUFFICIENT_INVENTORY", "Insufficient inventory for reservation");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("RESERVATION_EXPIRED", "Reservation cannot be revived");
    }
  }
}

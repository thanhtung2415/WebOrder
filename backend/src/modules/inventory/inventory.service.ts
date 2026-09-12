import { Injectable } from "@nestjs/common";
import { AuditAction, IdempotencyStatus, IngredientStatus, InventoryTransactionType, Prisma, StocktakeStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { PermissionCode } from "../auth/permissions";
import { AuthorizationService } from "../auth/services/authorization.service";
import { stableStringify } from "../setup/stable-json";
import { CompleteStocktakeDto, CreateInventoryTransactionDto, CreateStocktakeDto, InventoryListQueryDto, InventoryTransactionListQueryDto, StocktakeListQueryDto, UpdateStocktakeItemDto } from "./dto/inventory.dto";
import { InventoryBalanceResponse, InventoryDetailResponse, InventoryIngredientResponse, InventoryListResponse, InventoryTransactionListResponse, InventoryTransactionResponse, InventoryUnitResponse, StocktakeListResponse, StocktakeResponse } from "./inventory.types";

type InventoryWithIngredient = Prisma.InventoryGetPayload<{
  include: {
    ingredient: {
      include: { baseUnit: true };
    };
  };
}>;

type IngredientWithBaseUnit = Prisma.IngredientGetPayload<{
  include: { baseUnit: true };
}>;

type InventoryTransactionWithRelations = Prisma.InventoryTransactionGetPayload<{
  include: {
    inventory: { include: { ingredient: { include: { baseUnit: true } } } };
    inputUnit: true;
    createdBy: true;
  };
}>;

type StocktakeWithRelations = Prisma.StocktakeGetPayload<{
  include: {
    startedBy: true;
    completedBy: true;
    items: {
      include: {
        inventory: {
          include: {
            ingredient: { include: { baseUnit: true } };
          };
        };
      };
    };
  };
}>;

interface LockedIdempotencyRow {
  id: string;
  request_hash: string;
  response_body: Prisma.JsonValue | null;
  status: IdempotencyStatus;
}

interface LockedInventoryRow {
  id: string;
  branch_id: string;
  ingredient_id: string;
  physical_quantity: Prisma.Decimal;
  reserved_quantity: Prisma.Decimal;
  minimum_quantity: Prisma.Decimal;
  version: number;
}

interface LockedStocktakeRow {
  id: string;
  status: StocktakeStatus;
}

const manualTransactionTypes = new Set<InventoryTransactionType>([
  InventoryTransactionType.IMPORT,
  InventoryTransactionType.ADJUSTMENT,
  InventoryTransactionType.WASTE,
  InventoryTransactionType.DAMAGED,
  InventoryTransactionType.STAFF_USE
]);

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService
  ) {}

  async listInventory(query: InventoryListQueryDto, context: BranchContext): Promise<InventoryListResponse> {
    const ingredients = await this.prisma.ingredient.findMany({
      where: {
        deletedAt: null,
        status: IngredientStatus.ACTIVE,
        ...(query.ingredientId ? { id: query.ingredientId } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      include: { baseUnit: true },
      orderBy: [{ code: "asc" }]
    });
    const inventories = await this.prisma.inventory.findMany({
      where: { branchId: context.branch.id, ingredientId: { in: ingredients.map((ingredient) => ingredient.id) } },
      include: { ingredient: { include: { baseUnit: true } } }
    });
    const byIngredientId = new Map(inventories.map((inventory) => [inventory.ingredientId, inventory]));
    const items = ingredients.map((ingredient) => this.toInventoryBalance(byIngredientId.get(ingredient.id) ?? null, ingredient));
    return {
      items: this.isTrue(query.lowStockOnly) ? items.filter((item) => item.lowStock) : items
    };
  }

  async getInventory(id: string, context: BranchContext): Promise<InventoryDetailResponse> {
    this.authorizationService.validateUuid(id, "INVALID_INVENTORY_ID");
    const inventory = await this.prisma.inventory.findFirst({
      where: { id, branchId: context.branch.id },
      include: { ingredient: { include: { baseUnit: true } } }
    });
    if (!inventory) {
      throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
    }
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: { inventoryId: inventory.id, branchId: context.branch.id },
      include: this.transactionInclude(),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 20
    });
    return {
      ...this.toInventoryBalance(inventory, inventory.ingredient),
      recentTransactions: transactions.map((transaction) => this.toInventoryTransactionResponse(transaction))
    };
  }

  async listTransactions(query: InventoryTransactionListQueryDto, context: BranchContext): Promise<InventoryTransactionListResponse> {
    const limit = this.parseLimit(query.limit);
    const take = limit + 1;
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        branchId: context.branch.id,
        ...(query.inventoryId ? { inventoryId: query.inventoryId } : {}),
        ...(query.ingredientId ? { inventory: { ingredientId: query.ingredientId } } : {}),
        ...(query.type ? { type: query.type } : {})
      },
      include: this.transactionInclude(),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take
    });
    const items = transactions.slice(0, limit);
    return {
      items: items.map((transaction) => this.toInventoryTransactionResponse(transaction)),
      nextCursor: transactions.length > limit ? transactions[limit].id : null
    };
  }

  async createTransaction(dto: CreateInventoryTransactionDto, context: BranchContext, idempotencyKey: string | undefined): Promise<InventoryTransactionResponse> {
    if (!manualTransactionTypes.has(dto.type)) {
      throw badRequest("VALIDATION_ERROR", "Inventory transaction type is not supported by this endpoint");
    }
    this.authorizationService.assertPermissions(context, [this.permissionForTransaction(dto.type)]);
    const response = await this.withIdempotency(
      context.branch.id,
      "inventory.transaction",
      idempotencyKey,
      dto,
      201,
      async (tx) => this.createTransactionInTx(tx, dto, context)
    );
    return this.assertStoredTransactionResponse(response);
  }

  async listStocktakes(query: StocktakeListQueryDto, context: BranchContext): Promise<StocktakeListResponse> {
    const status = this.parseStocktakeStatus(query.status);
    const stocktakes = await this.prisma.stocktake.findMany({
      where: { branchId: context.branch.id, ...(status ? { status } : {}) },
      include: this.stocktakeInclude(),
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    });
    return { items: stocktakes.map((stocktake) => this.toStocktakeResponse(stocktake)) };
  }

  async createStocktake(dto: CreateStocktakeDto, context: BranchContext): Promise<StocktakeResponse> {
    try {
      const stocktake = await this.prisma.$transaction(async (tx) => {
        const ingredients = await tx.ingredient.findMany({
          where: { deletedAt: null, status: IngredientStatus.ACTIVE },
          orderBy: [{ code: "asc" }]
        });
        for (const ingredient of ingredients) {
          await this.ensureInventory(tx, context.branch.id, ingredient.id);
        }
        const inventories = await tx.inventory.findMany({
          where: { branchId: context.branch.id, ingredientId: { in: ingredients.map((ingredient) => ingredient.id) } },
          include: { ingredient: { include: { baseUnit: true } } },
          orderBy: [{ ingredient: { code: "asc" } }]
        });
        const created = await tx.stocktake.create({
          data: {
            branchId: context.branch.id,
            code: dto.code?.trim().toUpperCase() ?? this.generateStocktakeCode(),
            note: dto.note?.trim() || null,
            status: StocktakeStatus.DRAFT,
            startedById: context.user.id,
            items: {
              createMany: {
                data: inventories.map((inventory) => ({
                  inventoryId: inventory.id,
                  expectedQuantity: inventory.physicalQuantity,
                  countedQuantity: inventory.physicalQuantity,
                  difference: new Prisma.Decimal(0)
                }))
              }
            }
          },
          include: this.stocktakeInclude()
        });
        await this.writeAudit(tx, context, AuditAction.STOCKTAKE, "stocktake", created.id, null, this.auditJson(created), "STOCKTAKE_OPENED");
        return created;
      });
      return this.toStocktakeResponse(stocktake);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("STOCKTAKE_CODE_EXISTS", "Stocktake code already exists");
      }
      throw error;
    }
  }

  async getStocktake(id: string, context: BranchContext): Promise<StocktakeResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STOCKTAKE_ID");
    const stocktake = await this.prisma.stocktake.findFirst({
      where: { id, branchId: context.branch.id },
      include: this.stocktakeInclude()
    });
    if (!stocktake) {
      throw notFound("STOCKTAKE_NOT_FOUND", "Stocktake not found");
    }
    return this.toStocktakeResponse(stocktake);
  }

  async updateStocktakeItem(stocktakeId: string, itemId: string, dto: UpdateStocktakeItemDto, context: BranchContext): Promise<StocktakeResponse> {
    this.authorizationService.validateUuid(stocktakeId, "INVALID_STOCKTAKE_ID");
    this.authorizationService.validateUuid(itemId, "INVALID_STOCKTAKE_ITEM_ID");
    const countedQuantity = this.nonNegativeDecimal(dto.countedQuantity, "VALIDATION_ERROR", 3);
    const stocktake = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockStocktake(tx, stocktakeId, context.branch.id);
      if (!locked) {
        throw notFound("STOCKTAKE_NOT_FOUND", "Stocktake not found");
      }
      if (!this.isOpenStocktakeStatus(locked.status)) {
        throw conflict("INVALID_STOCKTAKE_STATE", "Only open stocktakes can be edited");
      }
      const item = await tx.stocktakeItem.findFirst({ where: { id: itemId, stocktakeId } });
      if (!item) {
        throw notFound("STOCKTAKE_ITEM_NOT_FOUND", "Stocktake item not found");
      }
      await tx.stocktake.update({ where: { id: stocktakeId }, data: { status: StocktakeStatus.COUNTING } });
      await tx.stocktakeItem.update({
        where: { id: itemId },
        data: {
          countedQuantity,
          difference: countedQuantity.minus(item.expectedQuantity),
          note: dto.note?.trim() || null
        }
      });
      return tx.stocktake.findUniqueOrThrow({ where: { id: stocktakeId }, include: this.stocktakeInclude() });
    });
    return this.toStocktakeResponse(stocktake);
  }

  async completeStocktake(stocktakeId: string, dto: CompleteStocktakeDto, context: BranchContext, idempotencyKey: string | undefined): Promise<StocktakeResponse> {
    this.authorizationService.validateUuid(stocktakeId, "INVALID_STOCKTAKE_ID");
    const response = await this.withIdempotency(
      context.branch.id,
      `stocktake.complete.${stocktakeId}`,
      idempotencyKey,
      dto,
      201,
      async (tx) => this.completeStocktakeInTx(tx, stocktakeId, dto, context)
    );
    return this.assertStoredStocktakeResponse(response);
  }

  async cancelStocktake(stocktakeId: string, context: BranchContext): Promise<StocktakeResponse> {
    this.authorizationService.validateUuid(stocktakeId, "INVALID_STOCKTAKE_ID");
    const stocktake = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockStocktake(tx, stocktakeId, context.branch.id);
      if (!locked) {
        throw notFound("STOCKTAKE_NOT_FOUND", "Stocktake not found");
      }
      if (!this.isOpenStocktakeStatus(locked.status)) {
        throw conflict("INVALID_STOCKTAKE_STATE", "Only draft or counting stocktakes can be cancelled");
      }
      const before = await tx.stocktake.findUniqueOrThrow({ where: { id: stocktakeId }, include: this.stocktakeInclude() });
      const updated = await tx.stocktake.update({
        where: { id: stocktakeId },
        data: { status: StocktakeStatus.CANCELLED },
        include: this.stocktakeInclude()
      });
      await this.writeAudit(tx, context, AuditAction.STOCKTAKE, "stocktake", stocktakeId, this.auditJson(before), this.auditJson(updated), "STOCKTAKE_CANCELLED");
      return updated;
    });
    return this.toStocktakeResponse(stocktake);
  }

  private async createTransactionInTx(tx: Prisma.TransactionClient, dto: CreateInventoryTransactionDto, context: BranchContext): Promise<InventoryTransactionResponse> {
    const inventory = await this.ensureInventory(tx, context.branch.id, dto.ingredientId);
    const locked = await this.lockInventory(tx, inventory.id);
    const before = this.lockedInventoryJson(locked);
    const mutation = await this.resolveManualMutation(tx, dto, inventory);
    const resultingPhysical = locked.physical_quantity.plus(mutation.quantityDelta);
    this.assertResultingBalance(resultingPhysical, locked.reserved_quantity);

    await tx.inventory.update({
      where: { id: locked.id },
      data: {
        physicalQuantity: resultingPhysical,
        version: { increment: 1 },
        ...(dto.type === InventoryTransactionType.IMPORT && mutation.unitCost ? { lastUnitCost: mutation.unitCost } : {})
      }
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        branchId: context.branch.id,
        inventoryId: locked.id,
        type: dto.type,
        quantityDelta: mutation.quantityDelta,
        physicalQuantityAfter: resultingPhysical,
        unitCost: mutation.unitCost,
        inputQuantity: mutation.inputQuantity,
        inputUnitId: mutation.inputUnitId,
        conversionFactor: mutation.conversionFactor,
        convertedBaseQuantity: mutation.convertedBaseQuantity,
        reason: dto.reason.trim(),
        createdById: context.user.id,
        metadata: {
          requestId: this.requestContext.getRequestId() ?? null
        }
      },
      include: this.transactionInclude()
    });
    const after = { ...before, physicalQuantity: resultingPhysical.toFixed(3), version: locked.version + 1 };
    await this.writeAudit(tx, context, dto.type === InventoryTransactionType.IMPORT ? AuditAction.IMPORT_INVENTORY : AuditAction.ADJUST_INVENTORY, "inventory", locked.id, before, after, dto.type);
    await this.writeInventoryOutbox(tx, context.branch.id, locked.id, dto.ingredientId, dto.type, transaction.id);
    return this.toInventoryTransactionResponse(transaction);
  }

  private async completeStocktakeInTx(tx: Prisma.TransactionClient, stocktakeId: string, dto: CompleteStocktakeDto, context: BranchContext): Promise<StocktakeResponse> {
    const locked = await this.lockStocktake(tx, stocktakeId, context.branch.id);
    if (!locked) {
      throw notFound("STOCKTAKE_NOT_FOUND", "Stocktake not found");
    }
    if (!this.isOpenStocktakeStatus(locked.status)) {
      throw conflict("INVALID_STOCKTAKE_STATE", "Only open stocktakes can be completed");
    }
    const before = await tx.stocktake.findUniqueOrThrow({ where: { id: stocktakeId }, include: this.stocktakeInclude() });
    const inventoryIds = before.items.map((item) => item.inventoryId).sort();
    for (const inventoryId of inventoryIds) {
      await this.lockInventory(tx, inventoryId);
    }
    const inventories = await tx.inventory.findMany({ where: { id: { in: inventoryIds } }, include: { ingredient: { include: { baseUnit: true } } } });
    const inventoryById = new Map(inventories.map((inventory) => [inventory.id, inventory]));
    for (const item of before.items) {
      const inventory = inventoryById.get(item.inventoryId);
      if (!inventory) {
        throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
      }
      if (item.countedQuantity.lt(inventory.reservedQuantity)) {
        throw unprocessable("INSUFFICIENT_INVENTORY", "Counted quantity cannot be lower than reserved quantity");
      }
      const quantityDelta = item.countedQuantity.minus(inventory.physicalQuantity);
      if (!quantityDelta.isZero()) {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { physicalQuantity: item.countedQuantity, version: { increment: 1 } }
        });
        const transaction = await tx.inventoryTransaction.create({
          data: {
            branchId: context.branch.id,
            inventoryId: inventory.id,
            type: InventoryTransactionType.STOCKTAKE,
            quantityDelta,
            physicalQuantityAfter: item.countedQuantity,
            stocktakeItemId: item.id,
            reason: dto.note?.trim() || "Stocktake completed",
            createdById: context.user.id,
            metadata: {
              expectedQuantity: item.expectedQuantity.toFixed(3),
              countedQuantity: item.countedQuantity.toFixed(3),
              snapshotDifference: item.difference.toFixed(3),
              requestId: this.requestContext.getRequestId() ?? null
            }
          }
        });
        await this.writeInventoryOutbox(tx, context.branch.id, inventory.id, inventory.ingredientId, InventoryTransactionType.STOCKTAKE, transaction.id);
      }
    }
    const updated = await tx.stocktake.update({
      where: { id: stocktakeId },
      data: {
        status: StocktakeStatus.COMPLETED,
        completedById: context.user.id,
        completedAt: new Date(),
        note: dto.note?.trim() || before.note
      },
      include: this.stocktakeInclude()
    });
    await this.writeAudit(tx, context, AuditAction.STOCKTAKE, "stocktake", stocktakeId, this.auditJson(before), this.auditJson(updated), "STOCKTAKE_COMPLETED");
    return this.toStocktakeResponse(updated);
  }

  private async resolveManualMutation(
    tx: Prisma.TransactionClient,
    dto: CreateInventoryTransactionDto,
    inventory: InventoryWithIngredient
  ): Promise<{
    quantityDelta: Prisma.Decimal;
    inputQuantity: Prisma.Decimal | null;
    inputUnitId: string | null;
    conversionFactor: Prisma.Decimal | null;
    convertedBaseQuantity: Prisma.Decimal | null;
    unitCost: Prisma.Decimal | null;
  }> {
    const unitCost = dto.unitCost ? this.nonNegativeDecimal(dto.unitCost, "VALIDATION_ERROR", 2) : null;
    if (dto.type === InventoryTransactionType.IMPORT) {
      if (!dto.inputQuantity || !dto.inputUnitId) {
        throw badRequest("VALIDATION_ERROR", "Import requires input quantity and input unit");
      }
      const inputQuantity = this.positiveDecimal(dto.inputQuantity, "VALIDATION_ERROR", 3);
      const snapshot = await this.resolveImportSnapshot(tx, inventory.ingredientId, inventory.ingredient.baseUnitId, dto.inputUnitId, inputQuantity);
      return {
        quantityDelta: snapshot.convertedBaseQuantity,
        inputQuantity,
        inputUnitId: dto.inputUnitId,
        conversionFactor: snapshot.conversionFactor,
        convertedBaseQuantity: snapshot.convertedBaseQuantity,
        unitCost
      };
    }
    if (unitCost) {
      throw badRequest("VALIDATION_ERROR", "Unit cost is only allowed for imports");
    }
    if (dto.type === InventoryTransactionType.ADJUSTMENT) {
      if (!dto.quantityDelta) {
        throw badRequest("VALIDATION_ERROR", "Adjustment requires quantityDelta");
      }
      const quantityDelta = this.signedDecimal(dto.quantityDelta, "VALIDATION_ERROR", 3);
      if (quantityDelta.isZero()) {
        throw badRequest("VALIDATION_ERROR", "Adjustment quantityDelta must not be zero");
      }
      return { quantityDelta, inputQuantity: null, inputUnitId: null, conversionFactor: null, convertedBaseQuantity: null, unitCost: null };
    }
    if (!dto.quantity) {
      throw badRequest("VALIDATION_ERROR", "This transaction type requires quantity");
    }
    const quantity = this.positiveDecimal(dto.quantity, "VALIDATION_ERROR", 3);
    return { quantityDelta: quantity.neg(), inputQuantity: null, inputUnitId: null, conversionFactor: null, convertedBaseQuantity: null, unitCost: null };
  }

  private async resolveImportSnapshot(
    tx: Prisma.TransactionClient,
    ingredientId: string,
    baseUnitId: string,
    inputUnitId: string,
    inputQuantity: Prisma.Decimal
  ): Promise<{ conversionFactor: Prisma.Decimal; convertedBaseQuantity: Prisma.Decimal }> {
    this.authorizationService.validateUuid(inputUnitId, "INVALID_UNIT_ID");
    const unit = await tx.unit.findUnique({ where: { id: inputUnitId } });
    if (!unit || !unit.isActive) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Input unit is not active");
    }
    const allowedUnit = await tx.ingredientUnit.findUnique({ where: { ingredientId_unitId: { ingredientId, unitId: inputUnitId } } });
    if (!allowedUnit || !allowedUnit.isActive) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Input unit is not allowed for this ingredient");
    }
    if (inputUnitId === baseUnitId) {
      return { conversionFactor: new Prisma.Decimal(1), convertedBaseQuantity: inputQuantity };
    }
    const conversion = await tx.unitConversion.findFirst({ where: { ingredientId, fromUnitId: inputUnitId, toUnitId: baseUnitId, isActive: true } });
    if (!conversion) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Active conversion to the ingredient base unit is required");
    }
    const convertedBaseQuantity = inputQuantity.mul(conversion.conversionFactor);
    if (convertedBaseQuantity.decimalPlaces() > 3) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Converted base quantity exceeds allowed precision");
    }
    return { conversionFactor: conversion.conversionFactor, convertedBaseQuantity };
  }

  private async withIdempotency<TResponse extends object>(
    branchId: string,
    scope: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    responseStatus: number,
    executor: (tx: Prisma.TransactionClient) => Promise<TResponse>
  ): Promise<TResponse> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
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
        data: {
          status: IdempotencyStatus.SUCCEEDED,
          responseStatus,
          responseBody: this.auditJson(response)
        }
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

  private async ensureInventory(tx: Prisma.TransactionClient, branchId: string, ingredientId: string): Promise<InventoryWithIngredient> {
    this.authorizationService.validateUuid(ingredientId, "INVALID_INGREDIENT_ID");
    const ingredient = await tx.ingredient.findFirst({
      where: { id: ingredientId, deletedAt: null, status: IngredientStatus.ACTIVE },
      include: { baseUnit: true }
    });
    if (!ingredient) {
      throw notFound("INGREDIENT_NOT_FOUND", "Ingredient not found");
    }
    await tx.inventory.upsert({
      where: { branchId_ingredientId: { branchId, ingredientId } },
      create: { branchId, ingredientId },
      update: {}
    });
    return tx.inventory.findUniqueOrThrow({
      where: { branchId_ingredientId: { branchId, ingredientId } },
      include: { ingredient: { include: { baseUnit: true } } }
    });
  }

  private async lockInventory(tx: Prisma.TransactionClient, inventoryId: string): Promise<LockedInventoryRow> {
    const rows = await tx.$queryRaw<LockedInventoryRow[]>`
      SELECT id, branch_id, ingredient_id, physical_quantity, reserved_quantity, minimum_quantity, version
      FROM inventories
      WHERE id = ${inventoryId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw notFound("INVENTORY_NOT_FOUND", "Inventory not found");
    }
    return row;
  }

  private async lockStocktake(tx: Prisma.TransactionClient, stocktakeId: string, branchId: string): Promise<LockedStocktakeRow | null> {
    const rows = await tx.$queryRaw<LockedStocktakeRow[]>`
      SELECT id, status
      FROM stocktakes
      WHERE id = ${stocktakeId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async writeInventoryOutbox(tx: Prisma.TransactionClient, branchId: string, inventoryId: string, ingredientId: string, reason: string, transactionId: string): Promise<void> {
    const payload = {
      inventoryId,
      ingredientId,
      transactionId,
      reason,
      requestId: this.requestContext.getRequestId() ?? null
    };
    await tx.realtimeOutbox.createMany({
      data: [
        { branchId, eventType: "INVENTORY_CHANGED", aggregateType: "inventory", aggregateId: inventoryId, payload },
        { branchId, eventType: "PRODUCT_AVAILABILITY_CHANGED", aggregateType: "ingredient", aggregateId: ingredientId, payload }
      ]
    });
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    action: AuditAction,
    entityType: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
    phaseAction: string
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
        metadata: {
          phaseAction,
          requestId: this.requestContext.getRequestId() ?? null
        },
        requestId: this.requestContext.getRequestId() ?? null
      }
    });
  }

  private transactionInclude() {
    return {
      inventory: { include: { ingredient: { include: { baseUnit: true } } } },
      inputUnit: true,
      createdBy: true
    };
  }

  private stocktakeInclude() {
    return {
      startedBy: true,
      completedBy: true,
      items: {
        include: {
          inventory: { include: { ingredient: { include: { baseUnit: true } } } }
        },
        orderBy: [{ inventory: { ingredient: { code: "asc" as const } } }]
      }
    };
  }

  private toInventoryBalance(inventory: InventoryWithIngredient | null, ingredient: IngredientWithBaseUnit): InventoryBalanceResponse {
    const physicalQuantity = inventory?.physicalQuantity ?? new Prisma.Decimal(0);
    const reservedQuantity = inventory?.reservedQuantity ?? new Prisma.Decimal(0);
    const minimumQuantity = inventory?.minimumQuantity ?? new Prisma.Decimal(0);
    const availableQuantity = physicalQuantity.minus(reservedQuantity);
    return {
      id: inventory?.id ?? null,
      ingredient: this.toIngredientResponse(ingredient),
      physicalQuantity: physicalQuantity.toFixed(3),
      reservedQuantity: reservedQuantity.toFixed(3),
      availableQuantity: availableQuantity.toFixed(3),
      minimumQuantity: minimumQuantity.toFixed(3),
      lowStock: availableQuantity.lte(minimumQuantity),
      lastUnitCost: inventory?.lastUnitCost?.toFixed(2) ?? null,
      version: inventory?.version ?? 0,
      updatedAt: (inventory?.updatedAt ?? ingredient.updatedAt).toISOString()
    };
  }

  private toInventoryTransactionResponse(transaction: InventoryTransactionWithRelations): InventoryTransactionResponse {
    return {
      id: transaction.id,
      inventoryId: transaction.inventoryId,
      ingredient: this.toIngredientResponse(transaction.inventory.ingredient),
      type: transaction.type,
      quantityDelta: transaction.quantityDelta.toFixed(3),
      physicalQuantityAfter: transaction.physicalQuantityAfter.toFixed(3),
      unitCost: transaction.unitCost?.toFixed(2) ?? null,
      inputQuantity: transaction.inputQuantity?.toFixed(3) ?? null,
      inputUnit: transaction.inputUnit ? this.toUnitResponse(transaction.inputUnit) : null,
      conversionFactor: transaction.conversionFactor?.toFixed(6) ?? null,
      convertedBaseQuantity: transaction.convertedBaseQuantity?.toFixed(3) ?? null,
      actor: transaction.createdBy
        ? { id: transaction.createdBy.id, displayName: transaction.createdBy.displayName, email: transaction.createdBy.email }
        : null,
      reference: { orderItemId: transaction.orderItemId, stocktakeItemId: transaction.stocktakeItemId },
      reason: transaction.reason,
      occurredAt: transaction.occurredAt.toISOString(),
      createdAt: transaction.createdAt.toISOString()
    };
  }

  private toStocktakeResponse(stocktake: StocktakeWithRelations): StocktakeResponse {
    return {
      id: stocktake.id,
      code: stocktake.code,
      status: stocktake.status,
      note: stocktake.note,
      startedBy: { id: stocktake.startedBy.id, displayName: stocktake.startedBy.displayName, email: stocktake.startedBy.email },
      completedBy: stocktake.completedBy ? { id: stocktake.completedBy.id, displayName: stocktake.completedBy.displayName, email: stocktake.completedBy.email } : null,
      startedAt: stocktake.startedAt.toISOString(),
      completedAt: stocktake.completedAt?.toISOString() ?? null,
      updatedAt: stocktake.updatedAt.toISOString(),
      items: stocktake.items.map((item) => ({
        id: item.id,
        inventoryId: item.inventoryId,
        ingredient: this.toIngredientResponse(item.inventory.ingredient),
        expectedQuantity: item.expectedQuantity.toFixed(3),
        countedQuantity: item.countedQuantity.toFixed(3),
        difference: item.difference.toFixed(3),
        note: item.note,
        updatedAt: item.updatedAt.toISOString()
      }))
    };
  }

  private toIngredientResponse(ingredient: IngredientWithBaseUnit): InventoryIngredientResponse {
    return {
      id: ingredient.id,
      code: ingredient.code,
      name: ingredient.name,
      status: ingredient.status,
      baseUnit: this.toUnitResponse(ingredient.baseUnit)
    };
  }

  private toUnitResponse(unit: { id: string; code: string; name: string; symbol: string }): InventoryUnitResponse {
    return { id: unit.id, code: unit.code, name: unit.name, symbol: unit.symbol };
  }

  private permissionForTransaction(type: InventoryTransactionType): PermissionCode {
    return type === InventoryTransactionType.IMPORT ? "INVENTORY_IMPORT" : "INVENTORY_ADJUST";
  }

  private assertResultingBalance(physicalQuantity: Prisma.Decimal, reservedQuantity: Prisma.Decimal): void {
    if (physicalQuantity.lt(0)) {
      throw unprocessable("INVENTORY_WOULD_BE_NEGATIVE", "Inventory physical quantity cannot be negative");
    }
    if (physicalQuantity.lt(reservedQuantity)) {
      throw unprocessable("INSUFFICIENT_INVENTORY", "Inventory physical quantity cannot be lower than reserved quantity");
    }
  }

  private positiveDecimal(value: Prisma.Decimal.Value, code: string, maxDecimalPlaces: number): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > maxDecimalPlaces) {
      throw unprocessable(code, "Value must be positive and use the allowed decimal precision");
    }
    return decimal;
  }

  private nonNegativeDecimal(value: Prisma.Decimal.Value, code: string, maxDecimalPlaces: number): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lt(0) || decimal.decimalPlaces() > maxDecimalPlaces) {
      throw unprocessable(code, "Value must be non-negative and use the allowed decimal precision");
    }
    return decimal;
  }

  private signedDecimal(value: Prisma.Decimal.Value, code: string, maxDecimalPlaces: number): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.decimalPlaces() > maxDecimalPlaces) {
      throw unprocessable(code, "Value must use the allowed decimal precision");
    }
    return decimal;
  }

  private parseLimit(value: string | undefined): number {
    const parsed = Number(value ?? 50);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return 50;
    }
    return parsed;
  }

  private parseStocktakeStatus(status: string | undefined): StocktakeStatus | null {
    if (!status) {
      return null;
    }
    if (Object.values(StocktakeStatus).includes(status as StocktakeStatus)) {
      return status as StocktakeStatus;
    }
    throw badRequest("VALIDATION_ERROR", "Invalid stocktake status");
  }

  private isTrue(value: string | undefined): boolean {
    return value === "true";
  }

  private isOpenStocktakeStatus(status: StocktakeStatus): boolean {
    return status === StocktakeStatus.DRAFT || status === StocktakeStatus.COUNTING;
  }

  private generateStocktakeCode(): string {
    const compactIso = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `STK-${compactIso}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private lockedInventoryJson(row: LockedInventoryRow): Prisma.InputJsonObject {
    return {
      id: row.id,
      branchId: row.branch_id,
      ingredientId: row.ingredient_id,
      physicalQuantity: row.physical_quantity.toFixed(3),
      reservedQuantity: row.reserved_quantity.toFixed(3),
      minimumQuantity: row.minimum_quantity.toFixed(3),
      version: row.version
    };
  }

  private auditJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private assertStoredTransactionResponse(value: object): InventoryTransactionResponse {
    const record = value as Partial<InventoryTransactionResponse>;
    if (typeof record.id !== "string" || typeof record.inventoryId !== "string") {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "Stored inventory transaction response is invalid");
    }
    return record as InventoryTransactionResponse;
  }

  private assertStoredStocktakeResponse(value: object): StocktakeResponse {
    const record = value as Partial<StocktakeResponse>;
    if (typeof record.id !== "string" || typeof record.code !== "string") {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "Stored stocktake response is invalid");
    }
    return record as StocktakeResponse;
  }
}

import { InventoryTransactionType } from "@prisma/client";
import { IsDecimal, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

export class InventoryListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsUUID("4")
  ingredientId?: string;

  @IsOptional()
  @IsString()
  lowStockOnly?: string;
}

export class InventoryTransactionListQueryDto {
  @IsOptional()
  @IsUUID("4")
  inventoryId?: string;

  @IsOptional()
  @IsUUID("4")
  ingredientId?: string;

  @IsOptional()
  @IsEnum(InventoryTransactionType)
  type?: InventoryTransactionType;

  @IsOptional()
  @IsUUID("4")
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class CreateInventoryTransactionDto {
  @IsUUID("4")
  ingredientId!: string;

  @IsEnum(InventoryTransactionType)
  type!: InventoryTransactionType;

  @ValidateIf((dto: CreateInventoryTransactionDto) => dto.type === InventoryTransactionType.IMPORT)
  @IsDecimal({ decimal_digits: "0,3" })
  inputQuantity?: string;

  @ValidateIf((dto: CreateInventoryTransactionDto) => dto.type === InventoryTransactionType.IMPORT)
  @IsUUID("4")
  inputUnitId?: string;

  @ValidateIf((dto: CreateInventoryTransactionDto) => dto.type === InventoryTransactionType.ADJUSTMENT)
  @IsDecimal({ decimal_digits: "0,3" })
  quantityDelta?: string;

  @ValidateIf((dto: CreateInventoryTransactionDto) => ([InventoryTransactionType.WASTE, InventoryTransactionType.DAMAGED, InventoryTransactionType.STAFF_USE] as InventoryTransactionType[]).includes(dto.type))
  @IsDecimal({ decimal_digits: "0,3" })
  quantity?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: "0,2" })
  unitCost?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class CreateStocktakeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateStocktakeItemDto {
  @IsDecimal({ decimal_digits: "0,3" })
  countedQuantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StocktakeListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}

export class CompleteStocktakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelStocktakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

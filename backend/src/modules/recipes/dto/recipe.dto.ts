import { IngredientStatus, RecipeType, UnitDimension } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsBoolean, IsDecimal, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

const codePattern = /^[A-Za-z0-9_-]+$/;

export class Phase4ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsString()
  activeOnly?: string;
}

export class CreateUnitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(24)
  symbol!: string;

  @IsEnum(UnitDimension)
  dimension!: UnitDimension;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  symbol?: string;

  @IsOptional()
  @IsEnum(UnitDimension)
  dimension?: UnitDimension;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateIngredientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsUUID("4")
  baseUnitId!: string;

  @IsOptional()
  @IsEnum(IngredientStatus)
  status?: IngredientStatus;
}

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsUUID("4")
  baseUnitId?: string;

  @IsOptional()
  @IsEnum(IngredientStatus)
  status?: IngredientStatus;
}

export class UpsertIngredientUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDecimal({ decimal_digits: "0,6" })
  conversionFactor?: string;
}

export class RecipeItemDto {
  @IsUUID("4")
  ingredientId!: string;

  @IsDecimal({ decimal_digits: "0,3" })
  quantity!: string;
}

export class CreateRecipeDto {
  @IsEnum(RecipeType)
  type!: RecipeType;

  @IsOptional()
  @IsUUID("4")
  productOptionValueId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RecipeItemDto)
  items!: RecipeItemDto[];
}


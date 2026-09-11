import { OptionGroupType, ProcessingArea, ProductStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsBoolean, IsDecimal, IsEnum, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

const codePattern = /^[A-Za-z0-9_-]+$/;

export class MenuListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsString()
  activeOnly?: string;
}

export class ProductListQueryDto extends MenuListQueryDto {
  @IsOptional()
  @IsUUID("4")
  categoryId?: string;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUUID("4")
  categoryId!: string;

  @IsDecimal({ decimal_digits: "0,2" })
  basePrice!: string;

  @IsEnum(ProcessingArea)
  processingArea!: ProcessingArea;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID("4")
  categoryId?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: "0,2" })
  basePrice?: string;

  @IsOptional()
  @IsEnum(ProcessingArea)
  processingArea?: ProcessingArea;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export class CreateOptionGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(OptionGroupType)
  type!: OptionGroupType;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOptionGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(OptionGroupType)
  type?: OptionGroupType;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateOptionValueDto {
  @IsUUID("4")
  optionGroupId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(codePattern)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOptionValueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductOptionValueRuleDto {
  @IsUUID("4")
  optionValueId!: string;

  @IsDecimal({ decimal_digits: "0,2" })
  priceDelta!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class ProductOptionGroupRuleDto {
  @IsUUID("4")
  optionGroupId!: string;

  @IsBoolean()
  isRequired!: boolean;

  @Min(0)
  @Max(50)
  minSelections!: number;

  @Min(0)
  @Max(50)
  maxSelections!: number;

  @IsOptional()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ProductOptionValueRuleDto)
  values!: ProductOptionValueRuleDto[];
}

export class ReplaceProductOptionRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductOptionGroupRuleDto)
  groups!: ProductOptionGroupRuleDto[];
}

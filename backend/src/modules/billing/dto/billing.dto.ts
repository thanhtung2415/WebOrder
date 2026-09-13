import { ArrayMinSize, IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { DiscountType, VoucherStatus } from "@prisma/client";

export class BillAllocationDto {
  @IsUUID("4")
  orderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateBillDto {
  @IsUUID("4")
  tableSessionId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillAllocationDto)
  items?: BillAllocationDto[];
}

export class SplitBillPartDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillAllocationDto)
  items!: BillAllocationDto[];
}

export class SplitBillDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => SplitBillPartDto)
  parts!: SplitBillPartDto[];
}

export class MergeBillsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  sourceBillIds!: string[];

  @IsUUID("4")
  targetBillId!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class VoidBillDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreateVoucherDto {
  @IsString()
  @MaxLength(48)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @Type(() => Number)
  @Min(1)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  maximumDiscount?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minimumSubtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;
}

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  discountValue?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  maximumDiscount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minimumSubtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;
}

export class ApplyVoucherDto {
  @IsString()
  @MaxLength(48)
  voucherCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}

export class ApplyDirectDiscountDto {
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @Type(() => Number)
  @Min(1)
  discountValue!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}

export class ReverseBillAdjustmentDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

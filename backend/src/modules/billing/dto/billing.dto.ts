import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

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

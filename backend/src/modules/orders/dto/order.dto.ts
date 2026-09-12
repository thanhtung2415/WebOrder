import { OrderItemStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateOrderItemStatusDto {
  @IsEnum(OrderItemStatus)
  status!: OrderItemStatus;
}

export class CancelOrderItemDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ConfirmOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientRequestId?: string;
}

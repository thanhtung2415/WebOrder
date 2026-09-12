import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

export class CreateServiceRequestDto {
  @ApiProperty({ enum: ServiceRequestType })
  @IsEnum(ServiceRequestType)
  type!: ServiceRequestType;

  @ApiPropertyOptional({ description: "Optional client-side assertion; must match the QR session." })
  @IsOptional()
  @IsUUID()
  tableSessionId?: string;
}

export class UpdateServiceRequestStatusDto {
  @ApiProperty({ enum: [ServiceRequestStatus.ACKNOWLEDGED, ServiceRequestStatus.RESOLVED] })
  @IsEnum(ServiceRequestStatus)
  status!: "ACKNOWLEDGED" | "RESOLVED";
}

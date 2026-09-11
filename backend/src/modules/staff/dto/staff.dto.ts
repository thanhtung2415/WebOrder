import { AccountStatus } from "@prisma/client";
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class StaffListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  role?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class ApproveStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeCode?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  roleIds!: string[];
}

export class RejectStaffDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ChangeStaffStatusDto {
  @IsEnum(AccountStatus)
  status!: Extract<AccountStatus, "ACTIVE" | "LOCKED" | "INACTIVE">;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReplaceStaffRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  roleIds!: string[];
}

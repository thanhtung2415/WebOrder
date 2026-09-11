import { BranchStatus } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  attendanceGraceMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  attendanceGraceMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;
}

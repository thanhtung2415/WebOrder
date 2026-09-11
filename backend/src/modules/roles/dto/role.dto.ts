import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}

export class ReplaceRolePermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  permissionIds!: string[];
}

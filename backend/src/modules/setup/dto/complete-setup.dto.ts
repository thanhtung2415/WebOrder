import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength, ValidateNested } from "class-validator";

export class SetupBranchDto {
  @ApiProperty({ example: "MAIN" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: "Main Branch" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: "Asia/Ho_Chi_Minh" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone!: string;
}

export class SetupAdminDto {
  @ApiProperty({ example: "Owner" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  displayName!: string;
}

export class CompleteSetupDto {
  @ApiProperty({ example: "one-time-secret" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  setupToken!: string;

  @ApiProperty({ type: SetupBranchDto })
  @ValidateNested()
  @Type(() => SetupBranchDto)
  branch!: SetupBranchDto;

  @ApiProperty({ type: SetupAdminDto })
  @ValidateNested()
  @Type(() => SetupAdminDto)
  admin!: SetupAdminDto;
}

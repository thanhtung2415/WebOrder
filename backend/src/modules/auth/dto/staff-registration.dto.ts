import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class StaffRegistrationDto {
  @ApiPropertyOptional({ example: "Nguyen Van A" })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;
}

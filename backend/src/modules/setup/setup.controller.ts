import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentAuth } from "../auth/current-auth.decorator";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { AuthContext } from "../auth/auth-context";
import { CompleteSetupDto } from "./dto/complete-setup.dto";
import { SetupService } from "./setup.service";
import { CompleteSetupResponse, SetupStatusResponse } from "./setup.types";

@ApiTags("setup")
@Controller("setup")
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get("status")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  getStatus(): Promise<SetupStatusResponse> {
    return this.setupService.getStatus();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(SupabaseAuthGuard)
  completeSetup(
    @Body() dto: CompleteSetupDto,
    @CurrentAuth() auth: AuthContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined
  ): Promise<CompleteSetupResponse> {
    return this.setupService.completeSetup(dto, auth, idempotencyKey);
  }
}

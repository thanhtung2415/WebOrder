import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentAuth } from "./current-auth.decorator";
import { AuthContext } from "./auth-context";
import { AuthService } from "./auth.service";
import { AuthMeResponse, LogoutResponse, StaffRegistrationResponse } from "./auth.types";
import { StaffRegistrationDto } from "./dto/staff-registration.dto";
import { SupabaseAuthGuard } from "./guards/supabase-auth.guard";

@ApiTags("auth")
@ApiBearerAuth()
@Controller("auth")
@UseGuards(SupabaseAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("registrations")
  @HttpCode(HttpStatus.CREATED)
  registerStaff(@Body() dto: StaffRegistrationDto, @CurrentAuth() auth: AuthContext): Promise<StaffRegistrationResponse> {
    return this.authService.registerStaff(dto, auth);
  }

  @Get("me")
  getMe(@CurrentAuth() auth: AuthContext): Promise<AuthMeResponse> {
    return this.authService.getMe(auth);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@CurrentAuth() auth: AuthContext): Promise<LogoutResponse> {
    return this.authService.logout(auth);
  }
}

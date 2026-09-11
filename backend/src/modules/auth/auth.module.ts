import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { BranchAccessGuard } from "./guards/branch-access.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { SupabaseAuthGuard } from "./guards/supabase-auth.guard";
import { AuthorizationService } from "./services/authorization.service";
import { RbacSeedService } from "./services/rbac-seed.service";
import { SupabaseJwtVerifierService } from "./supabase-jwt-verifier.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, SupabaseAuthGuard, BranchAccessGuard, PermissionGuard, AuthorizationService, RbacSeedService, SupabaseJwtVerifierService],
  exports: [AuthService, SupabaseAuthGuard, BranchAccessGuard, PermissionGuard, AuthorizationService, RbacSeedService, SupabaseJwtVerifierService]
})
export class AuthModule {}

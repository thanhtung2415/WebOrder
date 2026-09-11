import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { StaffService } from "./staff.service";
import { StaffResponse } from "./staff.types";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly staffService: StaffService) {}

  @Get(":id")
  @RequirePermissions("STAFF_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<StaffResponse> {
    return this.staffService.get(id, context);
  }
}

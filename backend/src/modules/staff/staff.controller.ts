import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ApproveStaffDto, ChangeStaffStatusDto, RejectStaffDto, ReplaceStaffRolesDto, StaffListQueryDto } from "./dto/staff.dto";
import { StaffService } from "./staff.service";
import { StaffListResponse, StaffResponse } from "./staff.types";

@ApiTags("staff")
@ApiBearerAuth()
@Controller("staff")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @RequirePermissions("STAFF_READ")
  list(@Query() query: StaffListQueryDto, @CurrentBranch() context: BranchContext): Promise<StaffListResponse> {
    return this.staffService.list(query, context);
  }

  @Get(":id")
  @RequirePermissions("STAFF_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<StaffResponse> {
    return this.staffService.get(id, context);
  }

  @Post(":id/approval")
  @RequirePermissions("STAFF_APPROVE")
  approve(@Param("id") id: string, @Body() dto: ApproveStaffDto, @CurrentBranch() context: BranchContext): Promise<StaffResponse> {
    return this.staffService.approve(id, dto, context);
  }

  @Post(":id/rejection")
  @RequirePermissions("STAFF_REJECT")
  reject(@Param("id") id: string, @Body() dto: RejectStaffDto, @CurrentBranch() context: BranchContext): Promise<StaffResponse> {
    return this.staffService.reject(id, dto, context);
  }

  @Patch(":id/status")
  @RequirePermissions("STAFF_STATUS_MANAGE")
  changeStatus(@Param("id") id: string, @Body() dto: ChangeStaffStatusDto, @CurrentBranch() context: BranchContext): Promise<StaffResponse> {
    return this.staffService.changeStatus(id, dto, context);
  }

  @Put(":id/branches/:branchId/roles")
  @RequirePermissions("STAFF_ROLE_MANAGE")
  replaceRoles(
    @Param("id") id: string,
    @Param("branchId") branchId: string,
    @Body() dto: ReplaceStaffRolesDto,
    @CurrentBranch() context: BranchContext
  ): Promise<StaffResponse> {
    return this.staffService.replaceStaffRoles(id, branchId, dto, context);
  }
}

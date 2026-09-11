import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from "./dto/role.dto";
import { PermissionListResponse, RoleListResponse, RoleResponse } from "./roles.types";
import { RolesService } from "./roles.service";

@ApiTags("roles")
@ApiBearerAuth()
@Controller()
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get("roles")
  @RequirePermissions("ROLE_READ")
  list(): Promise<RoleListResponse> {
    return this.rolesService.list();
  }

  @Post("roles")
  @RequirePermissions("ROLE_MANAGE")
  create(@Body() dto: CreateRoleDto, @CurrentBranch() context: BranchContext): Promise<RoleResponse> {
    return this.rolesService.create(dto, context);
  }

  @Patch("roles/:id")
  @RequirePermissions("ROLE_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateRoleDto, @CurrentBranch() context: BranchContext): Promise<RoleResponse> {
    return this.rolesService.update(id, dto, context);
  }

  @Get("permissions")
  @RequirePermissions("ROLE_READ")
  listPermissions(): Promise<PermissionListResponse> {
    return this.rolesService.listPermissions();
  }

  @Put("roles/:id/permissions")
  @RequirePermissions("ROLE_MANAGE")
  replacePermissions(@Param("id") id: string, @Body() dto: ReplaceRolePermissionsDto, @CurrentBranch() context: BranchContext): Promise<RoleResponse> {
    return this.rolesService.replacePermissions(id, dto, context);
  }
}

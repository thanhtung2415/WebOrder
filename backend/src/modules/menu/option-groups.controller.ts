import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateOptionGroupDto, MenuListQueryDto, UpdateOptionGroupDto } from "./dto/menu.dto";
import { MenuService } from "./menu.service";
import { OptionGroupListResponse, OptionGroupResponse } from "./menu.types";

@ApiTags("option-groups")
@ApiBearerAuth()
@Controller("option-groups")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class OptionGroupsController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @RequirePermissions("MENU_READ")
  list(@Query() query: MenuListQueryDto, @CurrentBranch() context: BranchContext): Promise<OptionGroupListResponse> {
    return this.menuService.listOptionGroups(query, context);
  }

  @Post()
  @RequirePermissions("MENU_MANAGE")
  create(@Body() dto: CreateOptionGroupDto, @CurrentBranch() context: BranchContext): Promise<OptionGroupResponse> {
    return this.menuService.createOptionGroup(dto, context);
  }

  @Get(":id")
  @RequirePermissions("MENU_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<OptionGroupResponse> {
    return this.menuService.getOptionGroup(id, context);
  }

  @Patch(":id")
  @RequirePermissions("MENU_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateOptionGroupDto, @CurrentBranch() context: BranchContext): Promise<OptionGroupResponse> {
    return this.menuService.updateOptionGroup(id, dto, context);
  }
}

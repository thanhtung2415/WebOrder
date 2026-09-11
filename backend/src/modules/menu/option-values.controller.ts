import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateOptionValueDto, MenuListQueryDto, UpdateOptionValueDto } from "./dto/menu.dto";
import { MenuService } from "./menu.service";
import { OptionValueListResponse, OptionValueResponse } from "./menu.types";

@ApiTags("option-values")
@ApiBearerAuth()
@Controller("option-values")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class OptionValuesController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @RequirePermissions("MENU_READ")
  list(@Query() query: MenuListQueryDto, @CurrentBranch() context: BranchContext): Promise<OptionValueListResponse> {
    return this.menuService.listOptionValues(query, context);
  }

  @Post()
  @RequirePermissions("MENU_MANAGE")
  create(@Body() dto: CreateOptionValueDto, @CurrentBranch() context: BranchContext): Promise<OptionValueResponse> {
    return this.menuService.createOptionValue(dto, context);
  }

  @Get(":id")
  @RequirePermissions("MENU_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<OptionValueResponse> {
    return this.menuService.getOptionValue(id, context);
  }

  @Patch(":id")
  @RequirePermissions("MENU_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateOptionValueDto, @CurrentBranch() context: BranchContext): Promise<OptionValueResponse> {
    return this.menuService.updateOptionValue(id, dto, context);
  }
}

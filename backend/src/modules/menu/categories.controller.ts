import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateCategoryDto, MenuListQueryDto, UpdateCategoryDto } from "./dto/menu.dto";
import { CategoryListResponse, CategoryResponse } from "./menu.types";
import { MenuService } from "./menu.service";

@ApiTags("categories")
@ApiBearerAuth()
@Controller("categories")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class CategoriesController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @RequirePermissions("MENU_READ")
  list(@Query() query: MenuListQueryDto, @CurrentBranch() context: BranchContext): Promise<CategoryListResponse> {
    return this.menuService.listCategories(query, context);
  }

  @Post()
  @RequirePermissions("MENU_MANAGE")
  create(@Body() dto: CreateCategoryDto, @CurrentBranch() context: BranchContext): Promise<CategoryResponse> {
    return this.menuService.createCategory(dto, context);
  }

  @Get(":id")
  @RequirePermissions("MENU_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<CategoryResponse> {
    return this.menuService.getCategory(id, context);
  }

  @Patch(":id")
  @RequirePermissions("MENU_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateCategoryDto, @CurrentBranch() context: BranchContext): Promise<CategoryResponse> {
    return this.menuService.updateCategory(id, dto, context);
  }
}

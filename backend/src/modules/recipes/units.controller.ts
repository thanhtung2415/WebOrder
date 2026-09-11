import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequireAnyPermission, RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateUnitDto, Phase4ListQueryDto, UpdateUnitDto } from "./dto/recipe.dto";
import { RecipeService } from "./recipe.service";
import { UnitListResponse, UnitResponse } from "./recipe.types";

@ApiTags("units")
@ApiBearerAuth()
@Controller("units")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class UnitsController {
  constructor(private readonly recipeService: RecipeService) {}

  @Get()
  @RequireAnyPermission("INVENTORY_READ", "RECIPE_READ")
  list(@Query() query: Phase4ListQueryDto): Promise<UnitListResponse> {
    return this.recipeService.listUnits(query);
  }

  @Post()
  @RequirePermissions("INVENTORY_ADJUST")
  create(@Body() dto: CreateUnitDto, @CurrentBranch() context: BranchContext): Promise<UnitResponse> {
    return this.recipeService.createUnit(dto, context);
  }

  @Patch(":id")
  @RequirePermissions("INVENTORY_ADJUST")
  update(@Param("id") id: string, @Body() dto: UpdateUnitDto, @CurrentBranch() context: BranchContext): Promise<UnitResponse> {
    return this.recipeService.updateUnit(id, dto, context);
  }
}


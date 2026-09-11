import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateIngredientDto, Phase4ListQueryDto, UpdateIngredientDto, UpsertIngredientUnitDto } from "./dto/recipe.dto";
import { RecipeService } from "./recipe.service";
import { IngredientListResponse, IngredientResponse, IngredientUnitResponse } from "./recipe.types";

@ApiTags("ingredients")
@ApiBearerAuth()
@Controller("ingredients")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class IngredientsController {
  constructor(private readonly recipeService: RecipeService) {}

  @Get()
  @RequirePermissions("INVENTORY_READ")
  list(@Query() query: Phase4ListQueryDto): Promise<IngredientListResponse> {
    return this.recipeService.listIngredients(query);
  }

  @Post()
  @RequirePermissions("INVENTORY_ADJUST")
  create(@Body() dto: CreateIngredientDto, @CurrentBranch() context: BranchContext): Promise<IngredientResponse> {
    return this.recipeService.createIngredient(dto, context);
  }

  @Patch(":id")
  @RequirePermissions("INVENTORY_ADJUST")
  update(@Param("id") id: string, @Body() dto: UpdateIngredientDto, @CurrentBranch() context: BranchContext): Promise<IngredientResponse> {
    return this.recipeService.updateIngredient(id, dto, context);
  }

  @Get(":id/units/:unitId")
  @RequirePermissions("INVENTORY_ADJUST")
  getUnit(@Param("id") id: string, @Param("unitId") unitId: string): Promise<IngredientUnitResponse> {
    return this.recipeService.getIngredientUnit(id, unitId);
  }

  @Put(":id/units/:unitId")
  @RequirePermissions("INVENTORY_ADJUST")
  upsertUnit(@Param("id") id: string, @Param("unitId") unitId: string, @Body() dto: UpsertIngredientUnitDto, @CurrentBranch() context: BranchContext): Promise<IngredientUnitResponse> {
    return this.recipeService.upsertIngredientUnit(id, unitId, dto, context);
  }
}


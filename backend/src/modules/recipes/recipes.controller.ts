import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateRecipeDto } from "./dto/recipe.dto";
import { RecipeService } from "./recipe.service";
import { RecipeListResponse, RecipeResponse } from "./recipe.types";

@ApiTags("recipes")
@ApiBearerAuth()
@Controller()
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class RecipesController {
  constructor(private readonly recipeService: RecipeService) {}

  @Get("products/:id/recipes")
  @RequirePermissions("RECIPE_READ")
  listProductRecipes(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<RecipeListResponse> {
    return this.recipeService.listProductRecipes(id, context);
  }

  @Post("products/:id/recipes")
  @RequirePermissions("RECIPE_MANAGE")
  create(@Param("id") id: string, @Body() dto: CreateRecipeDto, @CurrentBranch() context: BranchContext): Promise<RecipeResponse> {
    return this.recipeService.createRecipe(id, dto, context);
  }

  @Post("recipes/:id/activation")
  @RequirePermissions("RECIPE_MANAGE")
  activate(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<RecipeResponse> {
    return this.recipeService.activateRecipe(id, context);
  }
}

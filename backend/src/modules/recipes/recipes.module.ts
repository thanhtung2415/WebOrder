import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { IngredientsController } from "./ingredients.controller";
import { RecipeResolverService } from "./recipe-resolver.service";
import { RecipeService } from "./recipe.service";
import { RecipesController } from "./recipes.controller";
import { UnitConversionService } from "./unit-conversion.service";
import { UnitsController } from "./units.controller";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule],
  controllers: [UnitsController, IngredientsController, RecipesController],
  providers: [RecipeService, RecipeResolverService, UnitConversionService],
  exports: [RecipeResolverService, UnitConversionService]
})
export class RecipesModule {}

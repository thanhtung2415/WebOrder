import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RecipesModule } from "../recipes/recipes.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { StocktakesController } from "./stocktakes.controller";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule, RecipesModule],
  controllers: [InventoryController, StocktakesController],
  providers: [InventoryService]
})
export class InventoryModule {}

import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RecipesModule } from "../recipes/recipes.module";
import { TablesModule } from "../tables/tables.module";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { CartAccessGuard } from "./guards/cart-access.guard";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule, RecipesModule, TablesModule],
  controllers: [CartController],
  providers: [CartService, CartAccessGuard],
  exports: [CartService]
})
export class CartModule {}

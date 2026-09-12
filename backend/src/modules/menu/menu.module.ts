import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { TablesModule } from "../tables/tables.module";
import { CategoriesController } from "./categories.controller";
import { MenuService } from "./menu.service";
import { OptionGroupsController } from "./option-groups.controller";
import { OptionValuesController } from "./option-values.controller";
import { ProductImageStorageService } from "./product-image-storage.service";
import { ProductsController } from "./products.controller";

@Module({
  imports: [CommonInfrastructureModule, DatabaseModule, AuthModule, TablesModule],
  controllers: [CategoriesController, ProductsController, OptionGroupsController, OptionValuesController],
  providers: [MenuService, ProductImageStorageService],
  exports: [MenuService, ProductImageStorageService]
})
export class MenuModule {}

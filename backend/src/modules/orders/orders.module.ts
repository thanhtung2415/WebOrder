import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { TablesModule } from "../tables/tables.module";
import { OrdersController } from "./orders.controller";
import { OrderAccessGuard } from "./guards/order-access.guard";
import { OrdersService } from "./orders.service";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule, TablesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderAccessGuard],
  exports: [OrdersService]
})
export class OrdersModule {}

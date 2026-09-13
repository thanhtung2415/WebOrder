import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { CommonInfrastructureModule } from "./common/common-infrastructure.module";
import { AppConfigModule } from "./config/app-config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BranchesModule } from "./modules/branches/branches.module";
import { CartModule } from "./modules/cart/cart.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { MenuModule } from "./modules/menu/menu.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { RecipesModule } from "./modules/recipes/recipes.module";
import { RolesModule } from "./modules/roles/roles.module";
import { ServiceRequestsModule } from "./modules/service-requests/service-requests.module";
import { SetupModule } from "./modules/setup/setup.module";
import { StaffModule } from "./modules/staff/staff.module";
import { TablesModule } from "./modules/tables/tables.module";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import { RequestLoggingMiddleware } from "./common/middleware/request-logging.middleware";

@Module({
  imports: [
    AppConfigModule,
    CommonInfrastructureModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 1000
      }
    ]),
    DatabaseModule,
    HealthModule,
    AuthModule,
    SetupModule,
    BranchesModule,
    BillingModule,
    CartModule,
    OrdersModule,
    MenuModule,
    RecipesModule,
    InventoryModule,
    TablesModule,
    StaffModule,
    RolesModule,
    ServiceRequestsModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, RequestLoggingMiddleware).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}

import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppConfigModule } from "./config/app-config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import { RequestLoggingMiddleware } from "./common/middleware/request-logging.middleware";
import { RequestContextService } from "./common/request-context/request-context.service";
import { StructuredLoggerService } from "./common/logging/structured-logger.service";

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120
      }
    ]),
    DatabaseModule,
    HealthModule
  ],
  providers: [
    RequestContextService,
    StructuredLoggerService,
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

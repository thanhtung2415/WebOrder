import { Module } from "@nestjs/common";
import { StructuredLoggerService } from "./logging/structured-logger.service";
import { RequestContextService } from "./request-context/request-context.service";

@Module({
  providers: [RequestContextService, StructuredLoggerService],
  exports: [RequestContextService, StructuredLoggerService]
})
export class CommonInfrastructureModule {}

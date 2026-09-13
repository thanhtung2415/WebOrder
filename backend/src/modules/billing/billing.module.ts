import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule],
  controllers: [BillingController],
  providers: [BillingService]
})
export class BillingModule {}

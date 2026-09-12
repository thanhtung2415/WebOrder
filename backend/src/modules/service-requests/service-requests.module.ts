import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { TablesModule } from "../tables/tables.module";
import { ServiceRequestAccessGuard } from "./guards/service-request-access.guard";
import { ServiceRequestsController } from "./service-requests.controller";
import { ServiceRequestsService } from "./service-requests.service";

@Module({
  imports: [DatabaseModule, AuthModule, CommonInfrastructureModule, TablesModule],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService, ServiceRequestAccessGuard],
  exports: [ServiceRequestsService]
})
export class ServiceRequestsModule {}

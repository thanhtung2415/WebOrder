import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";

@Module({
  imports: [CommonInfrastructureModule, DatabaseModule, AuthModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService]
})
export class RolesModule {}

import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";
import { SetupTokenService } from "./setup-token.service";

@Module({
  imports: [CommonInfrastructureModule, DatabaseModule, AuthModule],
  controllers: [SetupController],
  providers: [SetupService, SetupTokenService],
  exports: [SetupService, SetupTokenService]
})
export class SetupModule {}

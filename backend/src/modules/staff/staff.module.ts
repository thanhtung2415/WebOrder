import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [CommonInfrastructureModule, DatabaseModule, AuthModule],
  controllers: [StaffController, UsersController],
  providers: [StaffService],
  exports: [StaffService]
})
export class StaffModule {}

import { Module } from "@nestjs/common";
import { CommonInfrastructureModule } from "../../common/common-infrastructure.module";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { ProductReadAccessGuard } from "./guards/product-read-access.guard";
import { QrSessionTokenService } from "./qr-session-token.service";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";

@Module({
  imports: [CommonInfrastructureModule, DatabaseModule, AuthModule],
  controllers: [TablesController],
  providers: [TablesService, QrSessionTokenService, ProductReadAccessGuard],
  exports: [QrSessionTokenService, ProductReadAccessGuard, TablesService]
})
export class TablesModule {}

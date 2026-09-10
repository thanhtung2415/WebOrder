import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TransactionManager } from "./transaction-manager.service";

@Module({
  providers: [PrismaService, TransactionManager],
  exports: [PrismaService, TransactionManager]
})
export class DatabaseModule {}

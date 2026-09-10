import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export interface HealthStatus {
  status: "ok";
}

export interface ReadinessStatus {
  status: "ready";
  database: "ok";
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth(): HealthStatus {
    return { status: "ok" };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    try {
      await this.prisma.ping();
      return { status: "ready", database: "ok" };
    } catch {
      throw new ServiceUnavailableException({
        code: "INTERNAL_ERROR",
        message: "Database is unavailable"
      });
    }
  }
}

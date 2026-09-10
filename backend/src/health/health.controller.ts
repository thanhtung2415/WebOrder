import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { HealthService, HealthStatus, ReadinessStatus } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ description: "Application health status." })
  getHealth(): HealthStatus {
    return this.healthService.getHealth();
  }

  @Get("ready")
  @ApiOkResponse({ description: "Application readiness status." })
  getReadiness(): Promise<ReadinessStatus> {
    return this.healthService.getReadiness();
  }
}

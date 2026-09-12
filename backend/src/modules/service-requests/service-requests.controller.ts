import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { invalidToken } from "../../common/errors/api-exception";
import { CreateServiceRequestDto, UpdateServiceRequestStatusDto } from "./dto/service-request.dto";
import { ServiceRequestAccessGuard } from "./guards/service-request-access.guard";
import { ServiceRequestAccessContext, ServiceRequestListResponse, ServiceRequestResponse } from "./service-request.types";
import { ServiceRequestsService } from "./service-requests.service";

@ApiTags("service-requests")
@ApiBearerAuth()
@UseGuards(ServiceRequestAccessGuard)
@Controller("service-requests")
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsService: ServiceRequestsService) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  create(@Req() request: Request, @Body() dto: CreateServiceRequestDto): Promise<ServiceRequestResponse> {
    return this.serviceRequestsService.create(this.requireAccess(request), dto);
  }

  @Get()
  list(@Req() request: Request): Promise<ServiceRequestListResponse> {
    return this.serviceRequestsService.list(this.requireAccess(request));
  }

  @Patch(":id/status")
  updateStatus(@Req() request: Request, @Param("id") id: string, @Body() dto: UpdateServiceRequestStatusDto): Promise<ServiceRequestResponse> {
    return this.serviceRequestsService.updateStatus(this.requireAccess(request), id, dto);
  }

  private requireAccess(request: Request): ServiceRequestAccessContext {
    if (!request.serviceRequestAccessContext) {
      throw invalidToken();
    }
    return request.serviceRequestAccessContext;
  }
}

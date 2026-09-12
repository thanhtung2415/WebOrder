import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, ServiceRequestStatus, ServiceRequestType, SessionStatus } from "@prisma/client";
import { ApiException, badRequest, conflict, forbidden, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { CreateServiceRequestDto, UpdateServiceRequestStatusDto } from "./dto/service-request.dto";
import { ServiceRequestAccessContext, ServiceRequestListResponse, ServiceRequestResponse } from "./service-request.types";

const SERVICE_REQUEST_COOLDOWN_MS = 60_000;

type ServiceRequestWithTable = Prisma.ServiceRequestGetPayload<{
  include: { tableSession: { include: { table: true } } };
}>;

@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService
  ) {}

  async create(access: ServiceRequestAccessContext, dto: CreateServiceRequestDto): Promise<ServiceRequestResponse> {
    if (access.kind !== "qr") {
      throw forbidden("FORBIDDEN", "Only QR sessions can create service requests");
    }
    if (dto.tableSessionId && dto.tableSessionId !== access.qr.tableSessionId) {
      throw forbidden("FORBIDDEN", "QR session cannot create requests for another table session");
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockOpenSession(tx, access.qr.branchId, access.qr.tableSessionId);
      const cutoff = new Date(Date.now() - SERVICE_REQUEST_COOLDOWN_MS);
      const recent = await tx.serviceRequest.findFirst({
        where: {
          branchId: access.qr.branchId,
          tableSessionId: access.qr.tableSessionId,
          type: dto.type,
          createdAt: { gte: cutoff }
        },
        orderBy: { createdAt: "desc" }
      });
      if (recent) {
        throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Please wait before sending this request again");
      }

      const request = await tx.serviceRequest.create({
        data: {
          branchId: access.qr.branchId,
          tableSessionId: access.qr.tableSessionId,
          type: dto.type
        },
        include: this.includeTable()
      });
      await this.writeOutbox(tx, request.branchId, request.id, "SERVICE_REQUEST_CREATED", request);
      if (request.type === ServiceRequestType.REQUEST_PAYMENT) {
        await this.writeOutbox(tx, request.branchId, request.id, "PAYMENT_REQUESTED", request);
      }
      return this.toResponse(request);
    });
  }

  async list(access: ServiceRequestAccessContext): Promise<ServiceRequestListResponse> {
    const branch = this.requireStaff(access);
    this.authorizationService.assertPermissions(branch, ["SERVICE_REQUEST_READ"]);
    const items = await this.prisma.serviceRequest.findMany({
      where: {
        branchId: branch.branch.id,
        status: { in: [ServiceRequestStatus.PENDING, ServiceRequestStatus.ACKNOWLEDGED] }
      },
      include: this.includeTable(),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return { items: items.map((item) => this.toResponse(item)) };
  }

  async updateStatus(access: ServiceRequestAccessContext, id: string, dto: UpdateServiceRequestStatusDto): Promise<ServiceRequestResponse> {
    const branch = this.requireStaff(access);
    this.authorizationService.assertPermissions(branch, ["SERVICE_REQUEST_HANDLE"]);
    this.authorizationService.validateUuid(id, "INVALID_SERVICE_REQUEST_ID");
    if (dto.status !== ServiceRequestStatus.ACKNOWLEDGED && dto.status !== ServiceRequestStatus.RESOLVED) {
      throw badRequest("VALIDATION_ERROR", "Unsupported service request status");
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockRequest(tx, branch.branch.id, id);
      if (!current) {
        throw notFound("SESSION_NOT_FOUND", "Service request not found");
      }
      this.assertTransition(current.status, dto.status);
      const now = new Date();
      const updated = await tx.serviceRequest.update({
        where: { id },
        data: {
          status: dto.status,
          handledById: branch.user.id,
          acknowledgedAt: dto.status === ServiceRequestStatus.ACKNOWLEDGED ? now : current.acknowledged_at,
          resolvedAt: dto.status === ServiceRequestStatus.RESOLVED ? now : null
        },
        include: this.includeTable()
      });
      await this.writeOutbox(tx, updated.branchId, updated.id, "SERVICE_REQUEST_UPDATED", updated);
      return this.toResponse(updated);
    });
  }

  private async lockOpenSession(tx: Prisma.TransactionClient, branchId: string, tableSessionId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; closed_at: Date | null }>>`
      SELECT id, status, closed_at
      FROM table_sessions
      WHERE id = ${tableSessionId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    const session = rows[0];
    if (!session) {
      throw notFound("SESSION_NOT_FOUND", "Table session not found");
    }
    if (session.closed_at || session.status === SessionStatus.CLOSED) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
  }

  private async lockRequest(
    tx: Prisma.TransactionClient,
    branchId: string,
    id: string
  ): Promise<{ id: string; status: ServiceRequestStatus; acknowledged_at: Date | null } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: ServiceRequestStatus; acknowledged_at: Date | null }>>`
      SELECT id, status, acknowledged_at
      FROM service_requests
      WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private assertTransition(current: ServiceRequestStatus, next: ServiceRequestStatus): void {
    const valid =
      (current === ServiceRequestStatus.PENDING && next === ServiceRequestStatus.ACKNOWLEDGED) ||
      (current === ServiceRequestStatus.ACKNOWLEDGED && next === ServiceRequestStatus.RESOLVED);
    if (!valid) {
      throw conflict("INVALID_STATUS_TRANSITION", "Invalid service request status transition");
    }
  }

  private requireStaff(access: ServiceRequestAccessContext): BranchContext {
    if (access.kind !== "staff") {
      throw forbidden("FORBIDDEN", "Staff access is required");
    }
    return access.branch;
  }

  private async writeOutbox(
    tx: Prisma.TransactionClient,
    branchId: string,
    serviceRequestId: string,
    eventType: "SERVICE_REQUEST_CREATED" | "SERVICE_REQUEST_UPDATED" | "PAYMENT_REQUESTED",
    request: ServiceRequestWithTable
  ): Promise<void> {
    await tx.realtimeOutbox.create({
      data: {
        branchId,
        eventType,
        aggregateType: "service_request",
        aggregateId: serviceRequestId,
        payload: {
          serviceRequestId,
          tableSessionId: request.tableSessionId,
          tableId: request.tableSession.tableId,
          type: request.type,
          status: request.status,
          requestId: this.requestContext.getRequestId() ?? null
        }
      }
    });
  }

  private includeTable() {
    return { tableSession: { include: { table: true } } };
  }

  private toResponse(request: ServiceRequestWithTable): ServiceRequestResponse {
    return {
      id: request.id,
      branchId: request.branchId,
      tableSessionId: request.tableSessionId,
      type: request.type,
      status: request.status,
      handledById: request.handledById,
      acknowledgedAt: request.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
      table: {
        id: request.tableSession.table.id,
        code: request.tableSession.table.code,
        displayName: request.tableSession.table.displayName
      },
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString()
    };
  }
}

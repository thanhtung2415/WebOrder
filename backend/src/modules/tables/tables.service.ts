import { Injectable } from "@nestjs/common";
import { AuditAction, Prisma, QrStatus, SessionStatus, TableStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { badRequest, conflict, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { CreateQrSessionDto, CreateTableDto, LockTableSessionDto, SessionListQueryDto, SessionReasonDto, TableListQueryDto, TransferTableSessionDto, UpdateTableDto } from "./dto/table.dto";
import { QrCodeResponse, QrSessionResponse, TableListResponse, TableResponse, TableSessionListResponse, TableSessionSummaryResponse } from "./table.types";
import { QrSessionTokenService } from "./qr-session-token.service";

type TableWithReadRelations = Prisma.DiningTableGetPayload<{
  include: ReturnType<TablesService["tableReadInclude"]>;
}>;

type SessionRow = Prisma.TableSessionGetPayload<Record<string, never>>;

interface LockedTableRow {
  id: string;
  branch_id: string;
  code: string;
  display_name: string;
  capacity: number | null;
  status: TableStatus;
  deleted_at: Date | null;
}

interface LockedSessionRow {
  id: string;
  branch_id: string;
  table_id: string;
  session_number: string;
  status: SessionStatus;
  opened_at: Date;
  payment_requested_at: Date | null;
  locked_at: Date | null;
  lock_reason: string | null;
  closed_at: Date | null;
}

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService,
    private readonly qrSessionTokenService: QrSessionTokenService
  ) {}

  async listTables(query: TableListQueryDto, context: BranchContext): Promise<TableListResponse> {
    const tables = await this.prisma.diningTable.findMany({
      where: {
        branchId: context.branch.id,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { displayName: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      include: this.tableReadInclude(),
      orderBy: [{ code: "asc" }]
    });
    return { items: tables.map((table) => this.toTableResponse(table)) };
  }

  async createTable(dto: CreateTableDto, context: BranchContext): Promise<TableResponse> {
    try {
      const table = await this.prisma.$transaction(async (tx) => {
        const created = await tx.diningTable.create({
          data: {
            branchId: context.branch.id,
            code: this.normalizeCode(dto.code),
            displayName: dto.displayName.trim(),
            capacity: dto.capacity ?? null,
            status: dto.status ?? TableStatus.ACTIVE
          },
          include: this.tableReadInclude()
        });
        await this.writeAudit(tx, context, AuditAction.TRANSFER_TABLE, "table", created.id, null, this.auditJson(this.toTableResponse(created)), "CREATE_TABLE");
        return created;
      });
      return this.toTableResponse(table);
    } catch (error) {
      this.rethrowUnique(error, "TABLE_CODE_EXISTS", "Table code already exists");
      throw error;
    }
  }

  async getTable(id: string, context: BranchContext): Promise<TableResponse> {
    this.authorizationService.validateUuid(id, "INVALID_TABLE_ID");
    const table = await this.prisma.diningTable.findFirst({
      where: { id, branchId: context.branch.id, deletedAt: null },
      include: this.tableReadInclude()
    });
    if (!table) {
      throw notFound("TABLE_NOT_FOUND", "Table not found");
    }
    return this.toTableResponse(table);
  }

  async updateTable(id: string, dto: UpdateTableDto, context: BranchContext): Promise<TableResponse> {
    this.authorizationService.validateUuid(id, "INVALID_TABLE_ID");
    try {
      const table = await this.prisma.$transaction(async (tx) => {
        const before = await tx.diningTable.findFirst({
          where: { id, branchId: context.branch.id, deletedAt: null },
          include: this.tableReadInclude()
        });
        if (!before) {
          throw notFound("TABLE_NOT_FOUND", "Table not found");
        }
        const updated = await tx.diningTable.update({
          where: { id },
          data: {
            ...(dto.displayName !== undefined ? { displayName: dto.displayName.trim() } : {}),
            ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {})
          },
          include: this.tableReadInclude()
        });
        await this.writeAudit(tx, context, AuditAction.TRANSFER_TABLE, "table", id, this.auditJson(this.toTableResponse(before)), this.auditJson(this.toTableResponse(updated)), "UPDATE_TABLE");
        return updated;
      });
      return this.toTableResponse(table);
    } catch (error) {
      this.rethrowUnique(error, "TABLE_CODE_EXISTS", "Table code already exists");
      throw error;
    }
  }

  async getActiveQr(tableId: string, context: BranchContext): Promise<QrCodeResponse> {
    await this.assertTableInBranch(tableId, context.branch.id);
    const qr = await this.prisma.tableQrCode.findFirst({
      where: { tableId, status: QrStatus.ACTIVE },
      orderBy: { activatedAt: "desc" }
    });
    if (!qr) {
      throw notFound("QR_NOT_FOUND", "Active QR code not found");
    }
    return this.toQrResponse(qr);
  }

  async rotateQr(tableId: string, context: BranchContext): Promise<QrCodeResponse> {
    this.authorizationService.validateUuid(tableId, "INVALID_TABLE_ID");
    const qr = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTable(tx, tableId, context.branch.id);
      if (!locked || locked.deleted_at) {
        throw notFound("TABLE_NOT_FOUND", "Table not found");
      }
      const before = await tx.tableQrCode.findFirst({ where: { tableId, status: QrStatus.ACTIVE }, orderBy: { activatedAt: "desc" } });
      await tx.tableQrCode.updateMany({
        where: { tableId, status: QrStatus.ACTIVE },
        data: { status: QrStatus.DISABLED, disabledAt: new Date() }
      });
      const created = await tx.tableQrCode.create({
        data: {
          tableId,
          token: randomUUID(),
          generatedById: context.user.id,
          status: QrStatus.ACTIVE
        }
      });
      await this.writeAudit(tx, context, AuditAction.ROTATE_QR, "table_qr_code", created.id, this.redactedQrAudit(before), this.redactedQrAudit(created), "ROTATE_QR");
      return created;
    });
    return this.toQrResponse(qr);
  }

  async disableQr(tableId: string, context: BranchContext): Promise<{ tableId: string; disabled: boolean }> {
    this.authorizationService.validateUuid(tableId, "INVALID_TABLE_ID");
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTable(tx, tableId, context.branch.id);
      if (!locked || locked.deleted_at) {
        throw notFound("TABLE_NOT_FOUND", "Table not found");
      }
      const before = await tx.tableQrCode.findFirst({ where: { tableId, status: QrStatus.ACTIVE }, orderBy: { activatedAt: "desc" } });
      if (!before) {
        return { tableId, disabled: false };
      }
      const beforeAudit = this.redactedQrAudit(before);
      await tx.tableQrCode.update({
        where: { id: before.id },
        data: { status: QrStatus.DISABLED, disabledAt: new Date() }
      });
      await this.writeAudit(tx, context, AuditAction.DISABLE_QR, "table_qr_code", before.id, beforeAudit, beforeAudit ? { ...beforeAudit, status: QrStatus.DISABLED } : null, "DISABLE_QR");
      return { tableId, disabled: true };
    });
  }

  async createOrJoinQrSession(dto: CreateQrSessionDto): Promise<QrSessionResponse> {
    const qrToken = dto.qrToken.trim();
    const qr = await this.prisma.tableQrCode.findUnique({
      where: { token: qrToken },
      include: { table: { include: { branch: true } } }
    });
    if (!qr) {
      throw badRequest("INVALID_QR", "QR token is invalid");
    }
    if (qr.status !== QrStatus.ACTIVE || qr.disabledAt) {
      throw conflict("QR_DISABLED", "QR token is disabled");
    }
    if (qr.table.deletedAt || qr.table.status !== TableStatus.ACTIVE || qr.table.branch.status !== "ACTIVE" || qr.table.branch.deletedAt) {
      throw conflict("TABLE_INACTIVE", "Table is inactive");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedTable = await this.lockTable(tx, qr.tableId, qr.table.branchId);
      if (!lockedTable || lockedTable.deleted_at || lockedTable.status !== TableStatus.ACTIVE) {
        throw conflict("TABLE_INACTIVE", "Table is inactive");
      }
      const lockedQr = await tx.tableQrCode.findUnique({ where: { id: qr.id } });
      if (!lockedQr || lockedQr.status !== QrStatus.ACTIVE || lockedQr.disabledAt) {
        throw conflict("QR_DISABLED", "QR token is disabled");
      }
      const existing = await tx.tableSession.findFirst({
        where: { tableId: lockedTable.id, closedAt: null },
        orderBy: { openedAt: "asc" }
      });
      if (existing) {
        return existing;
      }
      try {
        const session = await tx.tableSession.create({
          data: {
            branchId: lockedTable.branch_id,
            tableId: lockedTable.id,
            sessionNumber: this.generateSessionNumber(),
            status: SessionStatus.ACTIVE
          }
        });
        await this.writeSessionOutbox(tx, lockedTable.branch_id, session.id, "SESSION_UPDATED", "QR_SESSION_CREATED");
        return session;
      } catch (error) {
        this.rethrowOpenSessionRace(error);
        const winner = await tx.tableSession.findFirst({ where: { tableId: lockedTable.id, closedAt: null }, orderBy: { openedAt: "asc" } });
        if (!winner) {
          throw error;
        }
        return winner;
      }
    });

    return this.toQrSessionResponse(result, qr.table.branch, qr.table);
  }

  async getQrSession(token: string): Promise<QrSessionResponse> {
    const context = await this.qrSessionTokenService.verifyActive(token);
    const session = await this.prisma.tableSession.findUnique({
      where: { id: context.tableSessionId },
      include: { branch: true, table: true }
    });
    if (!session || session.closedAt || session.status === SessionStatus.CLOSED) {
      throw conflict("SESSION_CLOSED", "Table session is closed");
    }
    return this.toQrSessionResponse(session, session.branch, session.table);
  }

  async listSessions(query: SessionListQueryDto, context: BranchContext): Promise<TableSessionListResponse> {
    if (query.tableId) {
      this.authorizationService.validateUuid(query.tableId, "INVALID_TABLE_ID");
    }
    const sessions = await this.prisma.tableSession.findMany({
      where: {
        branchId: context.branch.id,
        ...(query.tableId ? { tableId: query.tableId } : {}),
        ...(query.status ? { status: query.status } : { closedAt: null })
      },
      orderBy: [{ openedAt: "desc" }, { id: "desc" }]
    });
    return { items: sessions.map((session) => this.toSessionSummary(session)) };
  }

  async lockSession(sessionId: string, dto: LockTableSessionDto, context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.updateSessionState(sessionId, context, SessionStatus.LOCKED, "LOCK_SESSION", { lockedById: context.user.id, lockedAt: new Date(), lockReason: dto.reason.trim() });
  }

  async unlockSession(sessionId: string, context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.updateSessionState(sessionId, context, SessionStatus.ACTIVE, "UNLOCK_SESSION", { lockedById: null, lockedAt: null, lockReason: null });
  }

  async requestPayment(sessionId: string, context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.updateSessionState(sessionId, context, SessionStatus.PAYMENT_REQUESTED, "PAYMENT_REQUESTED", { paymentRequestedAt: new Date() });
  }

  async transferSession(sessionId: string, dto: TransferTableSessionDto, context: BranchContext): Promise<TableSessionSummaryResponse> {
    this.authorizationService.validateUuid(sessionId, "INVALID_SESSION_ID");
    this.authorizationService.validateUuid(dto.destinationTableId, "INVALID_TABLE_ID");
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSessionRow(tx, sessionId, context.branch.id);
      if (!session) {
        throw notFound("SESSION_NOT_FOUND", "Session not found");
      }
      this.assertOpenSession(session);
      if (session.table_id === dto.destinationTableId) {
        const unchanged = await tx.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
        return this.toSessionSummary(unchanged);
      }
      await this.lockTablesInOrder(tx, context.branch.id, [session.table_id, dto.destinationTableId]);
      const destination = await tx.diningTable.findFirst({ where: { id: dto.destinationTableId, branchId: context.branch.id, deletedAt: null } });
      if (!destination) {
        throw notFound("TABLE_NOT_FOUND", "Destination table not found");
      }
      if (destination.status !== TableStatus.ACTIVE) {
        throw conflict("TABLE_INACTIVE", "Destination table is inactive");
      }
      const occupied = await tx.tableSession.findFirst({
        where: { tableId: dto.destinationTableId, closedAt: null, id: { not: sessionId } }
      });
      if (occupied) {
        throw conflict("TABLE_HAS_OPEN_SESSION", "Destination table has an open session");
      }
      const before = this.lockedSessionJson(session);
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: { tableId: dto.destinationTableId },
      });
      await this.writeAudit(tx, context, AuditAction.TRANSFER_TABLE, "table_session", sessionId, before, this.auditJson(this.toSessionSummary(updated)), dto.reason?.trim() || "TRANSFER_TABLE");
      await this.writeSessionOutbox(tx, context.branch.id, sessionId, "SESSION_UPDATED", "TRANSFER_TABLE");
      return this.toSessionSummary(updated);
    });
  }

  async closeSession(sessionId: string, dto: SessionReasonDto, context: BranchContext): Promise<TableSessionSummaryResponse> {
    this.authorizationService.validateUuid(sessionId, "INVALID_SESSION_ID");
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSessionRow(tx, sessionId, context.branch.id);
      if (!session) {
        throw notFound("SESSION_NOT_FOUND", "Session not found");
      }
      if (session.closed_at || session.status === SessionStatus.CLOSED) {
        throw conflict("SESSION_CLOSED", "Session is already closed");
      }
      const before = this.lockedSessionJson(session);
      try {
        const updated = await tx.tableSession.update({
          where: { id: sessionId },
          data: {
            status: SessionStatus.CLOSED,
            closedAt: new Date(),
            closedById: context.user.id
          }
        });
        await this.writeAudit(tx, context, AuditAction.CLOSE_SESSION, "table_session", sessionId, before, this.auditJson(this.toSessionSummary(updated)), dto.reason?.trim() || "CLOSE_SESSION");
        await this.writeSessionOutbox(tx, context.branch.id, sessionId, "SESSION_CLOSED", "CLOSE_SESSION");
        return this.toSessionSummary(updated);
      } catch (error) {
        this.rethrowSessionCloseGuard(error);
        throw error;
      }
    });
  }

  private async updateSessionState(
    sessionId: string,
    context: BranchContext,
    nextStatus: SessionStatus,
    phaseAction: string,
    data: Prisma.TableSessionUncheckedUpdateInput
  ): Promise<TableSessionSummaryResponse> {
    this.authorizationService.validateUuid(sessionId, "INVALID_SESSION_ID");
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSessionRow(tx, sessionId, context.branch.id);
      if (!session) {
        throw notFound("SESSION_NOT_FOUND", "Session not found");
      }
      this.assertOpenSession(session);
      const before = this.lockedSessionJson(session);
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: { status: nextStatus, ...data }
      });
      await this.writeAudit(tx, context, AuditAction.TRANSFER_TABLE, "table_session", sessionId, before, this.auditJson(this.toSessionSummary(updated)), phaseAction);
      await this.writeSessionOutbox(tx, context.branch.id, sessionId, "SESSION_UPDATED", phaseAction);
      return this.toSessionSummary(updated);
    });
  }

  private async assertTableInBranch(tableId: string, branchId: string): Promise<void> {
    this.authorizationService.validateUuid(tableId, "INVALID_TABLE_ID");
    const table = await this.prisma.diningTable.findFirst({ where: { id: tableId, branchId, deletedAt: null } });
    if (!table) {
      throw notFound("TABLE_NOT_FOUND", "Table not found");
    }
  }

  private async lockTable(tx: Prisma.TransactionClient, tableId: string, branchId: string): Promise<LockedTableRow | null> {
    const rows = await tx.$queryRaw<LockedTableRow[]>`
      SELECT id, branch_id, code, display_name, capacity, status, deleted_at
      FROM tables
      WHERE id = ${tableId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async lockTablesInOrder(tx: Prisma.TransactionClient, branchId: string, tableIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(tableIds)].sort();
    for (const tableId of uniqueIds) {
      await this.lockTable(tx, tableId, branchId);
    }
  }

  private async lockSessionRow(tx: Prisma.TransactionClient, sessionId: string, branchId: string): Promise<LockedSessionRow | null> {
    const rows = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT id, branch_id, table_id, session_number, status, opened_at, payment_requested_at, locked_at, lock_reason, closed_at
      FROM table_sessions
      WHERE id = ${sessionId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private assertOpenSession(session: LockedSessionRow): void {
    if (session.status === SessionStatus.CLOSED || session.closed_at) {
      throw conflict("SESSION_CLOSED", "Session is closed");
    }
  }

  private tableReadInclude() {
    return {
      qrCodes: {
        where: { status: QrStatus.ACTIVE },
        orderBy: { activatedAt: "desc" as const },
        take: 1
      },
      sessions: {
        where: { closedAt: null },
        orderBy: { openedAt: "asc" as const },
        take: 1
      }
    };
  }

  private toTableResponse(table: TableWithReadRelations): TableResponse {
    const currentSession = table.sessions[0] ? this.toSessionSummary(table.sessions[0]) : null;
    return {
      id: table.id,
      branchId: table.branchId,
      code: table.code,
      displayName: table.displayName,
      capacity: table.capacity,
      status: table.status,
      derivedStatus: this.deriveTableStatus(table.status, currentSession),
      currentSession,
      activeQr: table.qrCodes[0]
        ? {
            id: table.qrCodes[0].id,
            status: table.qrCodes[0].status,
            activatedAt: table.qrCodes[0].activatedAt.toISOString()
          }
        : null,
      createdAt: table.createdAt.toISOString(),
      updatedAt: table.updatedAt.toISOString()
    };
  }

  private toQrResponse(qr: { id: string; tableId: string; token: string; status: QrStatus; activatedAt: Date; disabledAt: Date | null; createdAt: Date }): QrCodeResponse {
    return {
      id: qr.id,
      tableId: qr.tableId,
      token: qr.token,
      status: qr.status,
      url: `${this.frontendUrl()}/table/${qr.token}`,
      activatedAt: qr.activatedAt.toISOString(),
      disabledAt: qr.disabledAt?.toISOString() ?? null,
      createdAt: qr.createdAt.toISOString()
    };
  }

  private toQrSessionResponse(
    session: SessionRow,
    branch: { id: string; code: string; name: string; timezone: string },
    table: { code: string; displayName: string; status: TableStatus }
  ): QrSessionResponse {
    const qrSessionToken = this.qrSessionTokenService.sign({
      branchId: session.branchId,
      tableId: session.tableId,
      tableSessionId: session.id
    });
    return {
      qrSessionToken,
      branch: {
        id: branch.id,
        code: branch.code,
        name: branch.name,
        timezone: branch.timezone
      },
      table: {
        code: table.code,
        displayName: table.displayName,
        status: table.status
      },
      session: this.toSessionSummary(session)
    };
  }

  private toSessionSummary(session: SessionRow): TableSessionSummaryResponse {
    const closedAt = session.closedAt?.toISOString() ?? null;
    const end = session.closedAt?.getTime() ?? Date.now();
    return {
      id: session.id,
      branchId: session.branchId,
      tableId: session.tableId,
      sessionNumber: session.sessionNumber,
      status: session.status,
      openedAt: session.openedAt.toISOString(),
      paymentRequestedAt: session.paymentRequestedAt?.toISOString() ?? null,
      lockedAt: session.lockedAt?.toISOString() ?? null,
      lockReason: session.lockReason,
      closedAt,
      durationSeconds: Math.max(0, Math.floor((end - session.openedAt.getTime()) / 1000))
    };
  }

  private deriveTableStatus(tableStatus: TableStatus, currentSession: TableSessionSummaryResponse | null): TableResponse["derivedStatus"] {
    if (tableStatus === TableStatus.INACTIVE) {
      return "INACTIVE";
    }
    if (tableStatus === TableStatus.OUT_OF_SERVICE) {
      return "OUT_OF_SERVICE";
    }
    return currentSession ? "OCCUPIED" : "AVAILABLE";
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    action: AuditAction,
    entityType: string,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
    phaseAction: string
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        branchId: context.branch.id,
        actorId: context.user.id,
        action,
        entityType,
        entityId,
        beforeData: beforeData ?? Prisma.JsonNull,
        afterData: afterData ?? Prisma.JsonNull,
        metadata: {
          phaseAction,
          requestId: this.requestContext.getRequestId() ?? null
        },
        requestId: this.requestContext.getRequestId() ?? null
      }
    });
  }

  private async writeSessionOutbox(tx: Prisma.TransactionClient, branchId: string, sessionId: string, eventType: "SESSION_UPDATED" | "SESSION_CLOSED", reason: string): Promise<void> {
    await tx.realtimeOutbox.create({
      data: {
        branchId,
        eventType,
        aggregateType: "table_session",
        aggregateId: sessionId,
        payload: {
          sessionId,
          reason,
          requestId: this.requestContext.getRequestId() ?? null
        }
      }
    });
  }

  private redactedQrAudit(qr: { id: string; tableId: string; status: QrStatus; activatedAt: Date; disabledAt: Date | null } | null): Prisma.InputJsonObject | null {
    if (!qr) {
      return null;
    }
    return {
      id: qr.id,
      tableId: qr.tableId,
      status: qr.status,
      activatedAt: qr.activatedAt.toISOString(),
      disabledAt: qr.disabledAt?.toISOString() ?? null
    };
  }

  private lockedSessionJson(session: LockedSessionRow): Prisma.InputJsonValue {
    return {
      id: session.id,
      branchId: session.branch_id,
      tableId: session.table_id,
      sessionNumber: session.session_number,
      status: session.status,
      openedAt: session.opened_at.toISOString(),
      paymentRequestedAt: session.payment_requested_at?.toISOString() ?? null,
      lockedAt: session.locked_at?.toISOString() ?? null,
      lockReason: session.lock_reason,
      closedAt: session.closed_at?.toISOString() ?? null
    };
  }

  private rethrowUnique(error: unknown, code: string, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(code, message);
    }
  }

  private rethrowOpenSessionRace(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
  }

  private rethrowSessionCloseGuard(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw conflict("SESSION_CLOSED", "Session cannot be closed");
    }
    if (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes("Active inventory reservations")) {
      throw conflict("RESERVATION_EXPIRED", "Active reservations must be resolved before closing the session");
    }
    if (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes("bill")) {
      throw conflict("TABLE_HAS_OPEN_SESSION", "Session has unresolved bill or order state");
    }
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private generateSessionNumber(): string {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `S-${timestamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private frontendUrl(): string {
    return process.env.FRONTEND_URL?.replace(/\/+$/, "") ?? "http://localhost:5173";
  }

  private auditJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

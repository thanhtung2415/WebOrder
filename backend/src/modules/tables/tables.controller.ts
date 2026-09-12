import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequireAnyPermission, RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateQrSessionDto, CreateTableDto, LockTableSessionDto, SessionListQueryDto, SessionReasonDto, TableListQueryDto, TransferTableSessionDto, UpdateTableDto } from "./dto/table.dto";
import { QrCodeResponse, QrSessionResponse, TableListResponse, TableResponse, TableSessionListResponse, TableSessionSummaryResponse } from "./table.types";
import { TablesService } from "./tables.service";

@ApiTags("tables")
@ApiBearerAuth()
@Controller()
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get("tables")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("TABLE_READ")
  listTables(@Query() query: TableListQueryDto, @CurrentBranch() context: BranchContext): Promise<TableListResponse> {
    return this.tablesService.listTables(query, context);
  }

  @Post("tables")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("TABLE_MANAGE")
  createTable(@Body() dto: CreateTableDto, @CurrentBranch() context: BranchContext): Promise<TableResponse> {
    return this.tablesService.createTable(dto, context);
  }

  @Get("tables/:id")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("TABLE_READ")
  getTable(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<TableResponse> {
    return this.tablesService.getTable(id, context);
  }

  @Patch("tables/:id")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("TABLE_MANAGE")
  updateTable(@Param("id") id: string, @Body() dto: UpdateTableDto, @CurrentBranch() context: BranchContext): Promise<TableResponse> {
    return this.tablesService.updateTable(id, dto, context);
  }

  @Get("tables/:id/qr")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("QR_MANAGE")
  getQr(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<QrCodeResponse> {
    return this.tablesService.getActiveQr(id, context);
  }

  @Post("tables/:id/qr-rotation")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("QR_MANAGE")
  rotateQr(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<QrCodeResponse> {
    return this.tablesService.rotateQr(id, context);
  }

  @Post("tables/:id/qr-disablement")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("QR_MANAGE")
  disableQr(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<{ tableId: string; disabled: boolean }> {
    return this.tablesService.disableQr(id, context);
  }

  @Post("qr-sessions")
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  createQrSession(@Body() dto: CreateQrSessionDto): Promise<QrSessionResponse> {
    return this.tablesService.createOrJoinQrSession(dto);
  }

  @Get("qr-sessions/current")
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  getQrSession(@Headers("authorization") authorization: string | undefined): Promise<QrSessionResponse> {
    const token = this.extractBearerToken(authorization);
    return this.tablesService.getQrSession(token);
  }

  @Get("table-sessions")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("SESSION_READ")
  listSessions(@Query() query: SessionListQueryDto, @CurrentBranch() context: BranchContext): Promise<TableSessionListResponse> {
    return this.tablesService.listSessions(query, context);
  }

  @Post("table-sessions/:id/lock")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("SESSION_MANAGE")
  lockSession(@Param("id") id: string, @Body() dto: LockTableSessionDto, @CurrentBranch() context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.tablesService.lockSession(id, dto, context);
  }

  @Post("table-sessions/:id/unlock")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("SESSION_MANAGE")
  unlockSession(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.tablesService.unlockSession(id, context);
  }

  @Post("table-sessions/:id/payment-request")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequireAnyPermission("SESSION_MANAGE", "SESSION_CLOSE")
  requestPayment(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.tablesService.requestPayment(id, context);
  }

  @Post("table-sessions/:id/transfer")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("SESSION_TRANSFER")
  transfer(@Param("id") id: string, @Body() dto: TransferTableSessionDto, @CurrentBranch() context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.tablesService.transferSession(id, dto, context);
  }

  @Post("table-sessions/:id/closure")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("SESSION_CLOSE")
  close(@Param("id") id: string, @Body() dto: SessionReasonDto, @CurrentBranch() context: BranchContext): Promise<TableSessionSummaryResponse> {
    return this.tablesService.closeSession(id, dto, context);
  }

  private extractBearerToken(header: string | undefined): string {
    if (!header) {
      return "";
    }
    const [scheme, token] = header.split(" ");
    return scheme === "Bearer" ? token?.trim() ?? "" : "";
  }
}

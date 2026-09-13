import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { BillingService } from "./billing.service";
import { BillResponse, SessionBillingResponse } from "./billing.types";
import { CreateBillDto, MergeBillsDto, SplitBillDto, VoidBillDto } from "./dto/billing.dto";

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("table-sessions/:id/bills")
  @RequirePermissions("BILL_READ")
  getSessionBills(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<SessionBillingResponse> {
    return this.billingService.getSessionBills(id, context);
  }

  @Get("bills/:id")
  @RequirePermissions("BILL_READ")
  getBill(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<BillResponse> {
    return this.billingService.getBill(id, context);
  }

  @Post("bills")
  @RequirePermissions("BILL_MANAGE")
  createBill(@Body() dto: CreateBillDto, @CurrentBranch() context: BranchContext): Promise<BillResponse> {
    return this.billingService.createBill(dto, context);
  }

  @Post("bills/:id/issuance")
  @HttpCode(200)
  @RequirePermissions("BILL_ISSUE")
  issueBill(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<BillResponse> {
    return this.billingService.issueBill(id, context);
  }

  @Post("bills/:id/splits")
  @RequirePermissions("BILL_SPLIT")
  splitBill(@Param("id") id: string, @Body() dto: SplitBillDto, @Headers("idempotency-key") idempotencyKey: string | undefined, @CurrentBranch() context: BranchContext): Promise<{ sourceBill: BillResponse; bills: BillResponse[] }> {
    return this.billingService.splitBill(id, dto, idempotencyKey, context);
  }

  @Post("bills/merges")
  @HttpCode(200)
  @RequirePermissions("BILL_MERGE")
  mergeBills(@Body() dto: MergeBillsDto, @Headers("idempotency-key") idempotencyKey: string | undefined, @CurrentBranch() context: BranchContext): Promise<BillResponse> {
    return this.billingService.mergeBills(dto, idempotencyKey, context);
  }

  @Post("bills/:id/voidance")
  @HttpCode(200)
  @RequirePermissions("BILL_VOID")
  voidBill(@Param("id") id: string, @Body() dto: VoidBillDto, @Headers("idempotency-key") idempotencyKey: string | undefined, @CurrentBranch() context: BranchContext): Promise<BillResponse> {
    return this.billingService.voidBill(id, dto, idempotencyKey, context);
  }
}

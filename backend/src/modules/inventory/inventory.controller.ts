import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequireAnyPermission, RequirePermissions } from "../auth/require-permissions.decorator";
import { CreateInventoryTransactionDto, InventoryListQueryDto, InventoryTransactionListQueryDto } from "./dto/inventory.dto";
import { InventoryService } from "./inventory.service";
import { InventoryDetailResponse, InventoryListResponse, InventoryTransactionListResponse, InventoryTransactionResponse } from "./inventory.types";

@ApiTags("inventory")
@ApiBearerAuth()
@Controller()
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get("inventory")
  @RequirePermissions("INVENTORY_READ")
  list(@Query() query: InventoryListQueryDto, @CurrentBranch() context: BranchContext): Promise<InventoryListResponse> {
    return this.inventoryService.listInventory(query, context);
  }

  @Get("inventory/:id")
  @RequirePermissions("INVENTORY_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<InventoryDetailResponse> {
    return this.inventoryService.getInventory(id, context);
  }

  @Get("inventory-transactions")
  @RequirePermissions("INVENTORY_READ")
  listTransactions(@Query() query: InventoryTransactionListQueryDto, @CurrentBranch() context: BranchContext): Promise<InventoryTransactionListResponse> {
    return this.inventoryService.listTransactions(query, context);
  }

  @Post("inventory-transactions")
  @RequireAnyPermission("INVENTORY_IMPORT", "INVENTORY_ADJUST")
  createTransaction(
    @Body() dto: CreateInventoryTransactionDto,
    @CurrentBranch() context: BranchContext,
    @Headers("idempotency-key") idempotencyKey?: string
  ): Promise<InventoryTransactionResponse> {
    return this.inventoryService.createTransaction(dto, context, idempotencyKey);
  }
}

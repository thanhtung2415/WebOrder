import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CancelStocktakeDto, CompleteStocktakeDto, CreateStocktakeDto, StocktakeListQueryDto, UpdateStocktakeItemDto } from "./dto/inventory.dto";
import { InventoryService } from "./inventory.service";
import { StocktakeListResponse, StocktakeResponse } from "./inventory.types";

@ApiTags("stocktakes")
@ApiBearerAuth()
@Controller("stocktakes")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
@RequirePermissions("STOCKTAKE_MANAGE")
export class StocktakesController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  list(@Query() query: StocktakeListQueryDto, @CurrentBranch() context: BranchContext): Promise<StocktakeListResponse> {
    return this.inventoryService.listStocktakes(query, context);
  }

  @Post()
  create(@Body() dto: CreateStocktakeDto, @CurrentBranch() context: BranchContext): Promise<StocktakeResponse> {
    return this.inventoryService.createStocktake(dto, context);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<StocktakeResponse> {
    return this.inventoryService.getStocktake(id, context);
  }

  @Patch(":id/items/:itemId")
  updateItem(@Param("id") id: string, @Param("itemId") itemId: string, @Body() dto: UpdateStocktakeItemDto, @CurrentBranch() context: BranchContext): Promise<StocktakeResponse> {
    return this.inventoryService.updateStocktakeItem(id, itemId, dto, context);
  }

  @Post(":id/completion")
  complete(
    @Param("id") id: string,
    @Body() dto: CompleteStocktakeDto,
    @CurrentBranch() context: BranchContext,
    @Headers("idempotency-key") idempotencyKey?: string
  ): Promise<StocktakeResponse> {
    return this.inventoryService.completeStocktake(id, dto, context, idempotencyKey);
  }

  @Post(":id/cancellation")
  cancel(@Param("id") id: string, @Body() _dto: CancelStocktakeDto, @CurrentBranch() context: BranchContext): Promise<StocktakeResponse> {
    return this.inventoryService.cancelStocktake(id, context);
  }
}

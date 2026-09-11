import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { BranchContext } from "../auth/branch-context";
import { BranchesService } from "./branches.service";
import { BranchListResponse, BranchResponse } from "./branches.types";
import { CreateBranchDto, UpdateBranchDto } from "./dto/branch.dto";

@ApiTags("branches")
@ApiBearerAuth()
@Controller("branches")
@UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequirePermissions("BRANCH_READ")
  list(@CurrentBranch() context: BranchContext): Promise<BranchListResponse> {
    return this.branchesService.list(context);
  }

  @Post()
  @RequirePermissions("BRANCH_MANAGE")
  create(@Body() dto: CreateBranchDto, @CurrentBranch() context: BranchContext): Promise<BranchResponse> {
    return this.branchesService.create(dto, context);
  }

  @Get(":id")
  @RequirePermissions("BRANCH_READ")
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext): Promise<BranchResponse> {
    return this.branchesService.get(id, context);
  }

  @Patch(":id")
  @RequirePermissions("BRANCH_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateBranchDto, @CurrentBranch() context: BranchContext): Promise<BranchResponse> {
    return this.branchesService.update(id, dto, context);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { BranchContext } from "../auth/branch-context";
import { CurrentBranch } from "../auth/current-branch.decorator";
import { BranchAccessGuard } from "../auth/guards/branch-access.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { SupabaseAuthGuard } from "../auth/guards/supabase-auth.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { CurrentQrSession } from "../tables/current-qr-session.decorator";
import { ProductReadAccessGuard } from "../tables/guards/product-read-access.guard";
import { QrSessionContext } from "../tables/table.types";
import { CreateProductDto, ProductListQueryDto, ReplaceProductOptionRulesDto, UpdateProductDto } from "./dto/menu.dto";
import { ProductListResponse, ProductResponse } from "./menu.types";
import { MenuService } from "./menu.service";

@ApiTags("products")
@ApiBearerAuth()
@Controller("products")
export class ProductsController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @UseGuards(ProductReadAccessGuard)
  list(@Query() query: ProductListQueryDto, @CurrentBranch() context: BranchContext | undefined, @CurrentQrSession() qrContext: QrSessionContext | undefined): Promise<ProductListResponse> {
    if (qrContext) {
      return this.menuService.listProductsForQrSession(query, qrContext);
    }
    return this.menuService.listProducts(query, this.requireBranchContext(context));
  }

  @Post()
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("MENU_MANAGE")
  create(@Body() dto: CreateProductDto, @CurrentBranch() context: BranchContext): Promise<ProductResponse> {
    return this.menuService.createProduct(dto, context);
  }

  @Get(":id")
  @UseGuards(ProductReadAccessGuard)
  get(@Param("id") id: string, @CurrentBranch() context: BranchContext | undefined, @CurrentQrSession() qrContext: QrSessionContext | undefined): Promise<ProductResponse> {
    if (qrContext) {
      return this.menuService.getProductForQrSession(id, qrContext);
    }
    return this.menuService.getProduct(id, this.requireBranchContext(context));
  }

  @Patch(":id")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("MENU_MANAGE")
  update(@Param("id") id: string, @Body() dto: UpdateProductDto, @CurrentBranch() context: BranchContext): Promise<ProductResponse> {
    return this.menuService.updateProduct(id, dto, context);
  }

  @Post(":id/image")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("MENU_MANAGE")
  @UseInterceptors(FileInterceptor("image"))
  @ApiConsumes("multipart/form-data")
  uploadImage(@Param("id") id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentBranch() context: BranchContext): Promise<ProductResponse> {
    return this.menuService.uploadProductImage(id, file, context);
  }

  @Put(":id/option-rules")
  @UseGuards(SupabaseAuthGuard, BranchAccessGuard, PermissionGuard)
  @RequirePermissions("MENU_MANAGE")
  replaceOptionRules(@Param("id") id: string, @Body() dto: ReplaceProductOptionRulesDto, @CurrentBranch() context: BranchContext): Promise<ProductResponse> {
    return this.menuService.replaceProductOptionRules(id, dto, context);
  }

  private requireBranchContext(context: BranchContext | undefined): BranchContext {
    if (!context) {
      throw new Error("Branch context was not resolved");
    }
    return context;
  }
}

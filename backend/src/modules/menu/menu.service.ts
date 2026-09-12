import { Injectable } from "@nestjs/common";
import { OptionGroupType, Prisma, ProductStatus } from "@prisma/client";
import { badRequest, conflict, notFound, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { QrSessionContext } from "../tables/table.types";
import {
  CreateCategoryDto,
  CreateOptionGroupDto,
  CreateOptionValueDto,
  CreateProductDto,
  MenuListQueryDto,
  ProductListQueryDto,
  ReplaceProductOptionRulesDto,
  UpdateCategoryDto,
  UpdateOptionGroupDto,
  UpdateOptionValueDto,
  UpdateProductDto
} from "./dto/menu.dto";
import { CategoryListResponse, CategoryResponse, OptionGroupListResponse, OptionGroupResponse, OptionValueListResponse, OptionValueResponse, ProductListResponse, ProductResponse } from "./menu.types";
import { ProductImageStorageService } from "./product-image-storage.service";

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: ReturnType<MenuService["productInclude"]>;
}>;

type OptionGroupWithValues = Prisma.OptionGroupGetPayload<{
  include: { values: true };
}>;

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService,
    private readonly imageStorage: ProductImageStorageService
  ) {}

  async listCategories(query: MenuListQueryDto, context: BranchContext): Promise<CategoryListResponse> {
    const categories = await this.prisma.category.findMany({
      where: {
        branchId: context.branch.id,
        deletedAt: null,
        ...(this.isActiveOnly(query) ? { isActive: true } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    return { items: categories.map((category) => this.toCategoryResponse(category)) };
  }

  async createCategory(dto: CreateCategoryDto, context: BranchContext): Promise<CategoryResponse> {
    try {
      const category = await this.prisma.category.create({
        data: {
          branchId: context.branch.id,
          code: this.normalizeCode(dto.code),
          name: dto.name.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true
        }
      });
      return this.toCategoryResponse(category);
    } catch (error) {
      this.rethrowUnique(error, "CATEGORY_CODE_EXISTS", "Category code already exists");
      throw error;
    }
  }

  async getCategory(id: string, context: BranchContext): Promise<CategoryResponse> {
    this.authorizationService.validateUuid(id, "INVALID_CATEGORY_ID");
    const category = await this.prisma.category.findFirst({ where: { id, branchId: context.branch.id, deletedAt: null } });
    if (!category) {
      throw notFound("CATEGORY_NOT_FOUND", "Category not found");
    }
    return this.toCategoryResponse(category);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, context: BranchContext): Promise<CategoryResponse> {
    await this.getCategory(id, context);
    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {})
      }
    });
    await this.emitAvailabilityChanged(context.branch.id, id, "CATEGORY_UPDATED");
    return this.toCategoryResponse(category);
  }

  async listProducts(query: ProductListQueryDto, context: BranchContext): Promise<ProductListResponse> {
    return this.listProductsForBranch(query, context.branch.id);
  }

  async listProductsForQrSession(query: ProductListQueryDto, context: QrSessionContext): Promise<ProductListResponse> {
    return this.listProductsForBranch({ ...query, activeOnly: "true" }, context.branchId);
  }

  async listProductsForBranch(query: ProductListQueryDto, branchId: string): Promise<ProductListResponse> {
    if (query.categoryId) {
      this.authorizationService.validateUuid(query.categoryId, "INVALID_CATEGORY_ID");
    }
    const products = await this.prisma.product.findMany({
      where: {
        branchId,
        deletedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(this.isActiveOnly(query) ? { status: ProductStatus.ACTIVE, category: { isActive: true, deletedAt: null } } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      include: this.productInclude(),
      orderBy: [{ isFeatured: "desc" }, { name: "asc" }]
    });
    return { items: products.map((product) => this.toProductResponse(product)) };
  }

  async createProduct(dto: CreateProductDto, context: BranchContext): Promise<ProductResponse> {
    await this.assertCategoryInBranch(dto.categoryId, context.branch.id);
    const price = this.decimalMoney(dto.basePrice, "INVALID_PRODUCT_PRICE");
    try {
      const product = await this.prisma.product.create({
        data: {
          branchId: context.branch.id,
          categoryId: dto.categoryId,
          code: this.normalizeCode(dto.code),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          basePrice: price,
          processingArea: dto.processingArea,
          status: dto.status ?? ProductStatus.ACTIVE,
          isFeatured: dto.isFeatured ?? false
        },
        include: this.productInclude()
      });
      await this.emitAvailabilityChanged(context.branch.id, product.id, "PRODUCT_CREATED");
      return this.toProductResponse(product);
    } catch (error) {
      this.rethrowUnique(error, "PRODUCT_CODE_EXISTS", "Product code already exists");
      throw error;
    }
  }

  async getProduct(id: string, context: BranchContext): Promise<ProductResponse> {
    return this.getProductForBranch(id, context.branch.id);
  }

  async getProductForQrSession(id: string, context: QrSessionContext): Promise<ProductResponse> {
    const product = await this.getProductForBranch(id, context.branchId);
    if (!product.availability.isAvailable) {
      throw notFound("PRODUCT_NOT_FOUND", "Product not found");
    }
    return product;
  }

  async getProductForBranch(id: string, branchId: string): Promise<ProductResponse> {
    this.authorizationService.validateUuid(id, "INVALID_PRODUCT_ID");
    const product = await this.prisma.product.findFirst({
      where: { id, branchId, deletedAt: null },
      include: this.productInclude()
    });
    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Product not found");
    }
    return this.toProductResponse(product);
  }

  async updateProduct(id: string, dto: UpdateProductDto, context: BranchContext): Promise<ProductResponse> {
    const before = await this.getProduct(id, context);
    if (dto.categoryId) {
      await this.assertCategoryInBranch(dto.categoryId, context.branch.id);
    }
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.basePrice !== undefined ? { basePrice: this.decimalMoney(dto.basePrice, "INVALID_PRODUCT_PRICE") } : {}),
        ...(dto.processingArea !== undefined ? { processingArea: dto.processingArea } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {})
      },
      include: this.productInclude()
    });
    if (dto.status !== undefined && dto.status !== before.status) {
      await this.emitAvailabilityChanged(context.branch.id, id, "PRODUCT_STATUS_UPDATED");
    }
    return this.toProductResponse(product);
  }

  async uploadProductImage(id: string, file: Express.Multer.File | undefined, context: BranchContext): Promise<ProductResponse> {
    if (!file) {
      throw badRequest("VALIDATION_ERROR", "Product image file is required");
    }
    await this.getProduct(id, context);
    const imagePath = await this.imageStorage.uploadProductImage(context.branch.id, id, file);
    const product = await this.prisma.product.update({
      where: { id },
      data: { imagePath },
      include: this.productInclude()
    });
    await this.emitAvailabilityChanged(context.branch.id, id, "PRODUCT_IMAGE_UPDATED");
    return this.toProductResponse(product);
  }

  async listOptionGroups(query: MenuListQueryDto, context: BranchContext): Promise<OptionGroupListResponse> {
    const groups = await this.prisma.optionGroup.findMany({
      where: {
        branchId: context.branch.id,
        deletedAt: null,
        ...(this.isActiveOnly(query) ? { isActive: true } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      include: { values: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    return { items: groups.map((group) => this.toOptionGroupResponse(group)) };
  }

  async createOptionGroup(dto: CreateOptionGroupDto, context: BranchContext): Promise<OptionGroupResponse> {
    try {
      const group = await this.prisma.optionGroup.create({
        data: {
          branchId: context.branch.id,
          code: this.normalizeCode(dto.code),
          name: dto.name.trim(),
          type: dto.type,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true
        },
        include: { values: true }
      });
      return this.toOptionGroupResponse(group);
    } catch (error) {
      this.rethrowUnique(error, "OPTION_GROUP_CODE_EXISTS", "Option group code already exists");
      throw error;
    }
  }

  async getOptionGroup(id: string, context: BranchContext): Promise<OptionGroupResponse> {
    this.authorizationService.validateUuid(id, "INVALID_OPTION_GROUP_ID");
    const group = await this.prisma.optionGroup.findFirst({
      where: { id, branchId: context.branch.id, deletedAt: null },
      include: { values: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } }
    });
    if (!group) {
      throw notFound("OPTION_GROUP_NOT_FOUND", "Option group not found");
    }
    return this.toOptionGroupResponse(group);
  }

  async updateOptionGroup(id: string, dto: UpdateOptionGroupDto, context: BranchContext): Promise<OptionGroupResponse> {
    await this.getOptionGroup(id, context);
    const group = await this.prisma.optionGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {})
      },
      include: { values: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } }
    });
    return this.toOptionGroupResponse(group);
  }

  async listOptionValues(query: MenuListQueryDto, context: BranchContext): Promise<OptionValueListResponse> {
    const values = await this.prisma.optionValue.findMany({
      where: {
        deletedAt: null,
        optionGroup: {
          branchId: context.branch.id,
          deletedAt: null
        },
        ...(this.isActiveOnly(query) ? { isActive: true, optionGroup: { branchId: context.branch.id, deletedAt: null, isActive: true } } : {}),
        ...(query.q ? { OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] } : {})
      },
      orderBy: [{ optionGroupId: "asc" }, { sortOrder: "asc" }, { name: "asc" }]
    });
    return { items: values.map((value) => this.toOptionValueResponse(value)) };
  }

  async createOptionValue(dto: CreateOptionValueDto, context: BranchContext): Promise<OptionValueResponse> {
    await this.assertOptionGroupInBranch(dto.optionGroupId, context.branch.id);
    try {
      const value = await this.prisma.optionValue.create({
        data: {
          optionGroupId: dto.optionGroupId,
          code: this.normalizeCode(dto.code),
          name: dto.name.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true
        }
      });
      return this.toOptionValueResponse(value);
    } catch (error) {
      this.rethrowUnique(error, "OPTION_VALUE_CODE_EXISTS", "Option value code already exists");
      throw error;
    }
  }

  async getOptionValue(id: string, context: BranchContext): Promise<OptionValueResponse> {
    this.authorizationService.validateUuid(id, "INVALID_OPTION_VALUE_ID");
    const value = await this.prisma.optionValue.findFirst({
      where: { id, deletedAt: null, optionGroup: { branchId: context.branch.id, deletedAt: null } }
    });
    if (!value) {
      throw notFound("OPTION_VALUE_NOT_FOUND", "Option value not found");
    }
    return this.toOptionValueResponse(value);
  }

  async updateOptionValue(id: string, dto: UpdateOptionValueDto, context: BranchContext): Promise<OptionValueResponse> {
    await this.getOptionValue(id, context);
    const value = await this.prisma.optionValue.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {})
      }
    });
    return this.toOptionValueResponse(value);
  }

  async replaceProductOptionRules(id: string, dto: ReplaceProductOptionRulesDto, context: BranchContext): Promise<ProductResponse> {
    await this.getProduct(id, context);
    this.assertProductOptionRuleShape(dto);

    return this.prisma.$transaction(async (tx) => {
      const optionGroupIds = dto.groups.map((group) => group.optionGroupId);
      const groups = await tx.optionGroup.findMany({
        where: { id: { in: optionGroupIds }, branchId: context.branch.id, deletedAt: null },
        include: { values: { where: { deletedAt: null } } }
      });
      if (groups.length !== optionGroupIds.length) {
        throw badRequest("INVALID_OPTION", "One or more option groups do not belong to this branch");
      }

      const groupById = new Map(groups.map((group) => [group.id, group]));
      await tx.productOptionGroup.deleteMany({ where: { productId: id } });
      for (const groupRule of dto.groups) {
        const optionGroup = groupById.get(groupRule.optionGroupId);
        if (!optionGroup) {
          throw badRequest("INVALID_OPTION", "Invalid option group");
        }
        const allowedValueIds = new Set(optionGroup.values.map((value) => value.id));
        const productGroup = await tx.productOptionGroup.create({
          data: {
            productId: id,
            optionGroupId: groupRule.optionGroupId,
            isRequired: groupRule.isRequired,
            minSelections: groupRule.minSelections,
            maxSelections: groupRule.maxSelections,
            sortOrder: groupRule.sortOrder ?? 0
          }
        });
        await tx.productOptionValue.createMany({
          data: groupRule.values.map((valueRule) => {
            if (!allowedValueIds.has(valueRule.optionValueId)) {
              throw badRequest("INVALID_OPTION", "Option value must belong to its configured group");
            }
            return {
              productOptionGroupId: productGroup.id,
              optionValueId: valueRule.optionValueId,
              priceDelta: this.decimalMoney(valueRule.priceDelta, "INVALID_OPTION"),
              isDefault: valueRule.isDefault ?? false,
              isActive: valueRule.isActive ?? true,
              sortOrder: valueRule.sortOrder ?? 0
            };
          })
        });
      }

      const product = await tx.product.findUniqueOrThrow({ where: { id }, include: this.productInclude() });
      await tx.realtimeOutbox.create({
        data: {
          branchId: context.branch.id,
          eventType: "PRODUCT_AVAILABILITY_CHANGED",
          aggregateType: "product",
          aggregateId: id,
          payload: {
            reason: "PRODUCT_OPTIONS_UPDATED",
            requestId: this.requestContext.getRequestId() ?? null
          }
        }
      });
      return this.toProductResponse(product);
    });
  }

  private productInclude() {
    return {
      category: true,
      optionGroups: {
        include: {
          optionGroup: true,
          values: {
            include: { optionValue: true },
            orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }]
          }
        },
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }]
      }
    };
  }

  private async assertCategoryInBranch(categoryId: string, branchId: string): Promise<void> {
    this.authorizationService.validateUuid(categoryId, "INVALID_CATEGORY_ID");
    const category = await this.prisma.category.findFirst({ where: { id: categoryId, branchId, deletedAt: null } });
    if (!category) {
      throw badRequest("INVALID_CATEGORY", "Category does not belong to this branch");
    }
  }

  private async assertOptionGroupInBranch(optionGroupId: string, branchId: string): Promise<void> {
    this.authorizationService.validateUuid(optionGroupId, "INVALID_OPTION_GROUP_ID");
    const group = await this.prisma.optionGroup.findFirst({ where: { id: optionGroupId, branchId, deletedAt: null } });
    if (!group) {
      throw badRequest("INVALID_OPTION", "Option group does not belong to this branch");
    }
  }

  private assertProductOptionRuleShape(dto: ReplaceProductOptionRulesDto): void {
    const seenGroups = new Set<string>();
    for (const group of dto.groups) {
      if (seenGroups.has(group.optionGroupId)) {
        throw badRequest("INVALID_OPTION", "Duplicate product option group");
      }
      seenGroups.add(group.optionGroupId);
      if (group.maxSelections < group.minSelections) {
        throw badRequest("INVALID_OPTION", "maxSelections must be greater than or equal to minSelections");
      }
      if (group.isRequired && group.minSelections < 1) {
        throw badRequest("INVALID_OPTION", "Required option groups must have minSelections of at least 1");
      }
      if (group.maxSelections > group.values.length) {
        throw badRequest("INVALID_OPTION", "maxSelections cannot exceed configured values");
      }
      const seenValues = new Set<string>();
      let defaults = 0;
      for (const value of group.values) {
        if (seenValues.has(value.optionValueId)) {
          throw badRequest("INVALID_OPTION", "Duplicate product option value");
        }
        seenValues.add(value.optionValueId);
        if (value.isDefault && (value.isActive ?? true)) {
          defaults += 1;
        }
      }
      if (defaults > 1) {
        throw badRequest("INVALID_OPTION", "Only one active default value is allowed per product option group");
      }
    }
  }

  private async emitAvailabilityChanged(branchId: string, productOrCategoryId: string, reason: string): Promise<void> {
    await this.prisma.realtimeOutbox.create({
      data: {
        branchId,
        eventType: "PRODUCT_AVAILABILITY_CHANGED",
        aggregateType: "product",
        aggregateId: productOrCategoryId,
        payload: {
          reason,
          requestId: this.requestContext.getRequestId() ?? null
        }
      }
    });
  }

  private decimalMoney(value: string, code: string): Prisma.Decimal {
    const money = new Prisma.Decimal(value);
    if (money.isNegative() || money.decimalPlaces() > 2) {
      throw unprocessable(code, "Money value must be a non-negative decimal with at most 2 fractional digits");
    }
    return money;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private isActiveOnly(query: MenuListQueryDto): boolean {
    return query.activeOnly === "true";
  }

  private rethrowUnique(error: unknown, code: string, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(code, message);
    }
  }

  private toCategoryResponse(category: { id: string; branchId: string; code: string; name: string; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date }): CategoryResponse {
    return {
      id: category.id,
      branchId: category.branchId,
      code: category.code,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString()
    };
  }

  private toOptionGroupResponse(group: OptionGroupWithValues): OptionGroupResponse {
    return {
      id: group.id,
      branchId: group.branchId,
      code: group.code,
      name: group.name,
      type: group.type,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      values: group.values.map((value) => this.toOptionValueResponse(value)),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString()
    };
  }

  private toOptionValueResponse(value: { id: string; optionGroupId: string; code: string; name: string; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date }): OptionValueResponse {
    return {
      id: value.id,
      optionGroupId: value.optionGroupId,
      code: value.code,
      name: value.name,
      sortOrder: value.sortOrder,
      isActive: value.isActive,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString()
    };
  }

  private toProductResponse(product: ProductWithRelations): ProductResponse {
    const productActive = product.status === ProductStatus.ACTIVE;
    const categoryActive = product.category.isActive;
    return {
      id: product.id,
      branchId: product.branchId,
      category: {
        id: product.category.id,
        code: product.category.code,
        name: product.category.name,
        isActive: product.category.isActive
      },
      code: product.code,
      name: product.name,
      description: product.description,
      imagePath: product.imagePath,
      basePrice: product.basePrice.toFixed(2),
      processingArea: product.processingArea,
      status: product.status,
      isFeatured: product.isFeatured,
      availability: {
        isAvailable: productActive && categoryActive,
        reason: productActive ? (categoryActive ? "AVAILABLE" : "CATEGORY_INACTIVE") : "PRODUCT_INACTIVE",
        inventoryAware: false
      },
      optionGroups: product.optionGroups.map((group) => ({
        id: group.id,
        optionGroupId: group.optionGroupId,
        code: group.optionGroup.code,
        name: group.optionGroup.name,
        type: group.optionGroup.type as OptionGroupType,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: group.sortOrder,
        values: group.values.map((value) => ({
          id: value.id,
          optionValueId: value.optionValueId,
          code: value.optionValue.code,
          name: value.optionValue.name,
          priceDelta: value.priceDelta.toFixed(2),
          isDefault: value.isDefault,
          isActive: value.isActive,
          sortOrder: value.sortOrder
        }))
      })),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString()
    };
  }
}

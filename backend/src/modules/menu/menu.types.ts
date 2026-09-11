import { OptionGroupType, ProcessingArea, ProductStatus } from "@prisma/client";

export interface CategoryResponse {
  id: string;
  branchId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryListResponse {
  items: CategoryResponse[];
}

export interface OptionValueResponse {
  id: string;
  optionGroupId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OptionGroupResponse {
  id: string;
  branchId: string;
  code: string;
  name: string;
  type: OptionGroupType;
  sortOrder: number;
  isActive: boolean;
  values: OptionValueResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface OptionGroupListResponse {
  items: OptionGroupResponse[];
}

export interface OptionValueListResponse {
  items: OptionValueResponse[];
}

export interface ProductOptionValueRuleResponse {
  id: string;
  optionValueId: string;
  code: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface ProductOptionGroupRuleResponse {
  id: string;
  optionGroupId: string;
  code: string;
  name: string;
  type: OptionGroupType;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  values: ProductOptionValueRuleResponse[];
}

export interface ProductAvailabilityResponse {
  isAvailable: boolean;
  reason: "AVAILABLE" | "PRODUCT_INACTIVE" | "CATEGORY_INACTIVE";
  inventoryAware: false;
}

export interface ProductResponse {
  id: string;
  branchId: string;
  category: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  };
  code: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  basePrice: string;
  processingArea: ProcessingArea;
  status: ProductStatus;
  isFeatured: boolean;
  availability: ProductAvailabilityResponse;
  optionGroups: ProductOptionGroupRuleResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  items: ProductResponse[];
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IngredientManagementPage, RecipeManagementPage, UnitManagementPage } from "./RecipePages";

const useAdminContextMock = vi.hoisted(() => vi.fn());
const listUnitsMock = vi.hoisted(() => vi.fn());
const createUnitMock = vi.hoisted(() => vi.fn());
const updateUnitMock = vi.hoisted(() => vi.fn());
const listIngredientsMock = vi.hoisted(() => vi.fn());
const createIngredientMock = vi.hoisted(() => vi.fn());
const updateIngredientMock = vi.hoisted(() => vi.fn());
const upsertIngredientUnitMock = vi.hoisted(() => vi.fn());
const listProductRecipesMock = vi.hoisted(() => vi.fn());
const createRecipeMock = vi.hoisted(() => vi.fn());
const activateRecipeMock = vi.hoisted(() => vi.fn());
const listProductsMock = vi.hoisted(() => vi.fn());

vi.mock("./admin-context", () => ({
  useAdminContext: () => useAdminContextMock()
}));

vi.mock("./recipe-api", () => ({
  listUnits: (...args: unknown[]) => listUnitsMock(...args),
  createUnit: (...args: unknown[]) => createUnitMock(...args),
  updateUnit: (...args: unknown[]) => updateUnitMock(...args),
  listIngredients: (...args: unknown[]) => listIngredientsMock(...args),
  createIngredient: (...args: unknown[]) => createIngredientMock(...args),
  updateIngredient: (...args: unknown[]) => updateIngredientMock(...args),
  upsertIngredientUnit: (...args: unknown[]) => upsertIngredientUnitMock(...args),
  listProductRecipes: (...args: unknown[]) => listProductRecipesMock(...args),
  createRecipe: (...args: unknown[]) => createRecipeMock(...args),
  activateRecipe: (...args: unknown[]) => activateRecipeMock(...args)
}));

vi.mock("./menu-api", () => ({
  listProducts: (...args: unknown[]) => listProductsMock(...args)
}));

describe("Recipe phase admin pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnitsMock.mockResolvedValue([unit]);
    createUnitMock.mockResolvedValue(unit);
    updateUnitMock.mockResolvedValue(unit);
    listIngredientsMock.mockResolvedValue([ingredient]);
    createIngredientMock.mockResolvedValue(ingredient);
    updateIngredientMock.mockResolvedValue(ingredient);
    upsertIngredientUnitMock.mockResolvedValue(ingredient.units[0]);
    listProductsMock.mockResolvedValue([product]);
    listProductRecipesMock.mockResolvedValue([recipe]);
    createRecipeMock.mockResolvedValue(recipe);
    activateRecipeMock.mockResolvedValue({ ...recipe, isActive: true });
    mockPermissions(["INVENTORY_READ", "INVENTORY_ADJUST", "RECIPE_READ", "RECIPE_MANAGE", "MENU_READ"]);
  });

  it("renders forbidden state without unit read permissions", () => {
    mockPermissions([]);
    renderPage(<UnitManagementPage />);

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
  });

  it("renders ingredients with base units and allowed conversions", async () => {
    renderPage(<IngredientManagementPage />);

    expect(await screen.findAllByText("COFFEE - Coffee")).toHaveLength(2);
    expect(screen.getByText("Base: G (g)")).toBeInTheDocument();
    expect(screen.getByText(/G: 1.000000/)).toBeInTheDocument();
  });

  it("creates units and activates recipe drafts from the admin screens", async () => {
    renderPage(<UnitManagementPage />);
    fireEvent.change(await screen.findByPlaceholderText("Code"), { target: { value: "kg" } });
    fireEvent.change(screen.getByPlaceholderText("Tên đơn vị"), { target: { value: "Kilogram" } });
    fireEvent.change(screen.getByPlaceholderText("Ký hiệu"), { target: { value: "kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createUnitMock).toHaveBeenCalled());

    renderPage(<RecipeManagementPage />);
    expect(await screen.findByText("Latte base")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => expect(activateRecipeMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "recipe-id"));
  });
});

const unit = {
  id: "unit-id",
  code: "G",
  name: "Gram",
  symbol: "g",
  dimension: "MASS",
  isActive: true
};

const ingredient = {
  id: "ingredient-id",
  code: "COFFEE",
  name: "Coffee",
  status: "ACTIVE",
  baseUnit: unit,
  units: [
    {
      id: "ingredient-unit-id",
      ingredientId: "ingredient-id",
      unit,
      label: null,
      isDefault: true,
      isActive: true,
      conversionFactorToBase: "1.000000"
    }
  ]
};

const product = {
  id: "product-id",
  code: "LATTE",
  name: "Latte",
  description: null,
  imagePath: null,
  basePrice: "25000.00",
  processingArea: "BAR",
  status: "ACTIVE",
  isFeatured: false,
  category: { id: "category-id", code: "DRINK", name: "Drink", sortOrder: 0, isActive: true },
  availability: { isAvailable: true, inventoryAware: false, reason: "AVAILABLE" },
  optionGroups: []
};

const recipe = {
  id: "recipe-id",
  productId: "product-id",
  productOptionValueId: null,
  type: "BASE",
  name: "Latte base",
  version: 1,
  isActive: false,
  items: [{ id: "recipe-item-id", ingredient, quantity: "15.000" }]
};

function mockPermissions(permissions: string[]): void {
  useAdminContextMock.mockReturnValue({
    accessToken: "access-token",
    activeBranchId: "branch-id",
    me: {},
    hasPermission: (permission: string) => permissions.includes(permission)
  });
}

function renderPage(element: ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryManagementPage } from "./InventoryPages";

const useAdminContextMock = vi.hoisted(() => vi.fn());
const listInventoryMock = vi.hoisted(() => vi.fn());
const listInventoryTransactionsMock = vi.hoisted(() => vi.fn());
const importInventoryMock = vi.hoisted(() => vi.fn());
const adjustInventoryMock = vi.hoisted(() => vi.fn());
const listStocktakesMock = vi.hoisted(() => vi.fn());
const createStocktakeMock = vi.hoisted(() => vi.fn());
const updateStocktakeItemMock = vi.hoisted(() => vi.fn());
const completeStocktakeMock = vi.hoisted(() => vi.fn());
const cancelStocktakeMock = vi.hoisted(() => vi.fn());
const listIngredientsMock = vi.hoisted(() => vi.fn());

vi.mock("./admin-context", () => ({
  useAdminContext: () => useAdminContextMock()
}));

vi.mock("./inventory-api", () => ({
  listInventory: (...args: unknown[]) => listInventoryMock(...args),
  listInventoryTransactions: (...args: unknown[]) => listInventoryTransactionsMock(...args),
  importInventory: (...args: unknown[]) => importInventoryMock(...args),
  adjustInventory: (...args: unknown[]) => adjustInventoryMock(...args),
  listStocktakes: (...args: unknown[]) => listStocktakesMock(...args),
  createStocktake: (...args: unknown[]) => createStocktakeMock(...args),
  updateStocktakeItem: (...args: unknown[]) => updateStocktakeItemMock(...args),
  completeStocktake: (...args: unknown[]) => completeStocktakeMock(...args),
  cancelStocktake: (...args: unknown[]) => cancelStocktakeMock(...args)
}));

vi.mock("./recipe-api", () => ({
  listIngredients: (...args: unknown[]) => listIngredientsMock(...args)
}));

describe("Inventory admin page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockPermissions(["INVENTORY_READ", "INVENTORY_IMPORT", "INVENTORY_ADJUST", "STOCKTAKE_MANAGE"]);
    listInventoryMock.mockResolvedValue([inventoryBalance]);
    listInventoryTransactionsMock.mockResolvedValue({ items: [ledgerEntry], nextCursor: null });
    importInventoryMock.mockResolvedValue(ledgerEntry);
    adjustInventoryMock.mockResolvedValue({ ...ledgerEntry, type: "WASTE" });
    listStocktakesMock.mockResolvedValue([stocktake]);
    createStocktakeMock.mockResolvedValue(stocktake);
    updateStocktakeItemMock.mockResolvedValue(stocktake);
    completeStocktakeMock.mockResolvedValue({ ...stocktake, status: "COMPLETED" });
    cancelStocktakeMock.mockResolvedValue({ ...stocktake, status: "CANCELLED" });
    listIngredientsMock.mockResolvedValue([ingredient]);
  });

  it("renders forbidden state without inventory permissions", () => {
    mockPermissions([]);
    renderPage(<InventoryManagementPage />);

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
  });

  it("renders inventory list with low-stock indicator and ledger", async () => {
    renderPage(<InventoryManagementPage />);

    expect(await screen.findAllByText("COFFEE - Coffee")).not.toHaveLength(0);
    expect(screen.getByText("200.000")).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();
    expect(screen.getAllByText("IMPORT")).not.toHaveLength(0);
    expect(screen.getByText("2.000 kg")).toBeInTheDocument();
  });

  it("submits import with conversion preview", async () => {
    renderPage(<InventoryManagementPage />);

    await screen.findByRole("heading", { name: "Import" });
    fireEvent.change(screen.getByLabelText("Import quantity"), { target: { value: "2.000" } });
    fireEvent.change(screen.getByLabelText("Input unit"), { target: { value: "kg-id" } });
    expect(screen.getByText("Preview: 2000.000 g")).toBeInTheDocument();
    fireEvent.change(screen.getAllByPlaceholderText("Reason")[0], { target: { value: "New stock" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(importInventoryMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), expect.objectContaining({ inputQuantity: "2.000", reason: "New stock" }))
    );
  });

  it("submits waste damaged staff-use and manual adjustment forms", async () => {
    renderPage(<InventoryManagementPage />);

    await screen.findByText("Adjustment");
    fireEvent.change(screen.getByDisplayValue("ADJUSTMENT"), { target: { value: "WASTE" } });
    fireEvent.change(screen.getByLabelText("Adjustment quantity"), { target: { value: "5.000" } });
    fireEvent.change(screen.getAllByPlaceholderText("Reason")[1], { target: { value: "Spilled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Adjustment" }));

    await waitFor(() =>
      expect(adjustInventoryMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), expect.objectContaining({ type: "WASTE", quantity: "5.000", reason: "Spilled" }))
    );
    expect(screen.getAllByRole("option", { name: "DAMAGED" })).not.toHaveLength(0);
    expect(screen.getAllByRole("option", { name: "STAFF_USE" })).not.toHaveLength(0);
  });

  it("handles stocktake create count complete and cancel actions", async () => {
    renderPage(<InventoryManagementPage />);

    expect(await screen.findAllByText("STK-001")).not.toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText("Stocktake code"), { target: { value: "STK-002" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createStocktakeMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Counted COFFEE"), { target: { value: "4800.000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateStocktakeItemMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "stocktake-id", "stocktake-item-id", expect.objectContaining({ countedQuantity: "4800.000" })));

    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(completeStocktakeMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "stocktake-id", expect.any(Object)));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelStocktakeMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "stocktake-id"));
  });

  it("shows empty and error states", async () => {
    listInventoryMock.mockResolvedValueOnce([]);
    renderPage(<InventoryManagementPage />);
    expect(await screen.findByText("Chưa có dữ liệu phù hợp.")).toBeInTheDocument();

    listInventoryMock.mockRejectedValueOnce(new Error("boom"));
    renderPage(<InventoryManagementPage />);
    expect(await screen.findByText("Không xử lý được yêu cầu.")).toBeInTheDocument();
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

const kilogram = {
  id: "kg-id",
  code: "KG",
  name: "Kilogram",
  symbol: "kg",
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
    { id: "iu-base", ingredientId: "ingredient-id", unit, label: null, isDefault: true, isActive: true, conversionFactorToBase: "1.000000" },
    { id: "iu-kg", ingredientId: "ingredient-id", unit: kilogram, label: null, isDefault: false, isActive: true, conversionFactorToBase: "1000.000000" }
  ]
};

const inventoryBalance = {
  id: "inventory-id",
  ingredient,
  physicalQuantity: "1000.000",
  reservedQuantity: "800.000",
  availableQuantity: "200.000",
  minimumQuantity: "300.000",
  lowStock: true,
  lastUnitCost: "120000.00",
  version: 1,
  updatedAt: "2026-09-12T00:00:00.000Z"
};

const ledgerEntry = {
  id: "transaction-id",
  inventoryId: "inventory-id",
  ingredient,
  type: "IMPORT",
  quantityDelta: "2000.000",
  physicalQuantityAfter: "2000.000",
  unitCost: "120000.00",
  inputQuantity: "2.000",
  inputUnit: kilogram,
  conversionFactor: "1000.000000",
  convertedBaseQuantity: "2000.000",
  actor: { id: "user-id", displayName: "Owner", email: "owner@example.com" },
  reference: { orderItemId: null, stocktakeItemId: null },
  reason: "New stock",
  occurredAt: "2026-09-12T00:00:00.000Z",
  createdAt: "2026-09-12T00:00:00.000Z"
};

const stocktake = {
  id: "stocktake-id",
  code: "STK-001",
  status: "COUNTING",
  note: null,
  startedBy: { id: "user-id", displayName: "Owner", email: "owner@example.com" },
  completedBy: null,
  startedAt: "2026-09-12T00:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-09-12T00:00:00.000Z",
  items: [
    {
      id: "stocktake-item-id",
      inventoryId: "inventory-id",
      ingredient,
      expectedQuantity: "5000.000",
      countedQuantity: "4900.000",
      difference: "-100.000",
      note: null,
      updatedAt: "2026-09-12T00:00:00.000Z"
    }
  ]
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

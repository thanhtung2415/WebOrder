import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { ApiClientError } from "../services/api-client";
import { useAdminContext } from "./admin-context";
import {
  AdjustmentPayload,
  InventoryTransactionType,
  Stocktake,
  adjustInventory,
  cancelStocktake,
  completeStocktake,
  createStocktake,
  importInventory,
  listInventory,
  listInventoryTransactions,
  listStocktakes,
  updateStocktakeItem
} from "./inventory-api";
import { Ingredient, listIngredients } from "./recipe-api";

const adjustmentTypes: AdjustmentPayload["type"][] = ["ADJUSTMENT", "WASTE", "DAMAGED", "STAFF_USE"];
const ledgerTypes: Array<InventoryTransactionType | ""> = ["", "IMPORT", "ADJUSTMENT", "WASTE", "DAMAGED", "STAFF_USE", "STOCKTAKE"];

export function InventoryManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("INVENTORY_READ");
  const canImport = admin.hasPermission("INVENTORY_IMPORT");
  const canAdjust = admin.hasPermission("INVENTORY_ADJUST");
  const canStocktake = admin.hasPermission("STOCKTAKE_MANAGE");
  const [filters, setFilters] = useState({ q: "", lowStockOnly: false });
  const [ledgerType, setLedgerType] = useState<InventoryTransactionType | "">("");
  const [selectedStocktakeId, setSelectedStocktakeId] = useState("");
  const [countEdits, setCountEdits] = useState<Record<string, { countedQuantity: string; note: string }>>({});
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [importForm, setImportForm] = useState({ ingredientId: "", inputQuantity: "1.000", inputUnitId: "", unitCost: "", reason: "" });
  const [adjustForm, setAdjustForm] = useState({ ingredientId: "", type: "ADJUSTMENT" as AdjustmentPayload["type"], quantity: "1.000", reason: "" });
  const [stocktakeForm, setStocktakeForm] = useState({ code: "", note: "" });

  const inventoryQuery = useQuery({ queryKey: ["phase5-inventory", context, filters], queryFn: () => listInventory(context, filters), enabled: canRead });
  const ingredientsQuery = useQuery({ queryKey: ["phase4-ingredients", context, { activeOnly: true }], queryFn: () => listIngredients(context, { activeOnly: true }), enabled: canRead && (canImport || canAdjust || canStocktake) });
  const ledgerQuery = useQuery({ queryKey: ["phase5-ledger", context, ledgerType], queryFn: () => listInventoryTransactions(context, { type: ledgerType || undefined, limit: 50 }), enabled: canRead });
  const stocktakesQuery = useQuery({ queryKey: ["phase5-stocktakes", context], queryFn: () => listStocktakes(context), enabled: canStocktake });

  const ingredients = ingredientsQuery.data ?? [];
  const selectedImportIngredient = findIngredient(ingredients, importForm.ingredientId);
  const selectedAdjustIngredient = findIngredient(ingredients, adjustForm.ingredientId);
  const importIngredientId = selectedImportIngredient?.id ?? ingredients[0]?.id ?? "";
  const adjustIngredientId = selectedAdjustIngredient?.id ?? ingredients[0]?.id ?? "";
  const importUnits = selectedImportIngredient?.units.filter((unit) => unit.isActive) ?? ingredients[0]?.units.filter((unit) => unit.isActive) ?? [];
  const inputUnitId = importForm.inputUnitId || importUnits[0]?.unit.id || "";
  const conversionPreview = previewConversion(importForm.inputQuantity, selectedImportIngredient ?? ingredients[0] ?? null, inputUnitId);
  const selectedStocktake = (stocktakesQuery.data ?? []).find((item) => item.id === selectedStocktakeId) ?? stocktakesQuery.data?.[0] ?? null;

  const refreshInventory = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["phase5-inventory"] }),
      queryClient.invalidateQueries({ queryKey: ["phase5-ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["phase5-stocktakes"] })
    ]);
  };
  const importMutation = useMutation({
    mutationFn: () => importInventory(context, { ingredientId: importIngredientId, inputQuantity: importForm.inputQuantity, inputUnitId, unitCost: importForm.unitCost || undefined, reason: importForm.reason }),
    onSuccess: async () => {
      setImportForm({ ingredientId: "", inputQuantity: "1.000", inputUnitId: "", unitCost: "", reason: "" });
      setFeedback({ type: "success", message: "Đã nhập kho." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const adjustMutation = useMutation({
    mutationFn: () =>
      adjustInventory(context, {
        ingredientId: adjustIngredientId,
        type: adjustForm.type,
        reason: adjustForm.reason,
        ...(adjustForm.type === "ADJUSTMENT" ? { quantityDelta: adjustForm.quantity } : { quantity: adjustForm.quantity })
      }),
    onSuccess: async () => {
      setAdjustForm({ ingredientId: "", type: "ADJUSTMENT", quantity: "1.000", reason: "" });
      setFeedback({ type: "success", message: "Đã ghi điều chỉnh tồn kho." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const createStocktakeMutation = useMutation({
    mutationFn: () => createStocktake(context, { code: stocktakeForm.code || undefined, note: stocktakeForm.note || undefined }),
    onSuccess: async (stocktake) => {
      setSelectedStocktakeId(stocktake.id);
      setStocktakeForm({ code: "", note: "" });
      setFeedback({ type: "success", message: "Đã mở kiểm kê." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateItemMutation = useMutation({
    mutationFn: ({ stocktake, itemId }: { stocktake: Stocktake; itemId: string }) => {
      const edit = countEdits[itemId];
      return updateStocktakeItem(context, stocktake.id, itemId, { countedQuantity: edit?.countedQuantity ?? "0.000", note: edit?.note || undefined });
    },
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã lưu số đếm." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const completeMutation = useMutation({
    mutationFn: (stocktake: Stocktake) => completeStocktake(context, stocktake.id, { note: stocktake.note ?? undefined }),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã hoàn tất kiểm kê." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const cancelMutation = useMutation({
    mutationFn: (stocktake: Stocktake) => cancelStocktake(context, stocktake.id),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã hủy kiểm kê." });
      await refreshInventory();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submitImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canImport && importIngredientId && inputUnitId) {
      importMutation.mutate();
    }
  }

  function submitAdjustment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canAdjust && adjustIngredientId) {
      adjustMutation.mutate();
    }
  }

  function submitStocktake(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canStocktake) {
      createStocktakeMutation.mutate();
    }
  }

  if (!canRead && !canStocktake) {
    return <ForbiddenPanel />;
  }

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tồn kho, nhập kho, điều chỉnh, kiểm kê và ledger.</p>
      </div>
      <Feedback value={feedback} />
      {canRead ? (
        <>
          <div className="flex flex-wrap gap-3">
            <input className={inputClass} placeholder="Search ingredient" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <input type="checkbox" checked={filters.lowStockOnly} onChange={(event) => setFilters({ ...filters, lowStockOnly: event.target.checked })} />
              Low stock
            </label>
          </div>
          <QueryState isLoading={inventoryQuery.isLoading} error={inventoryQuery.error} empty={(inventoryQuery.data ?? []).length === 0} />
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className={cellClass}>Ingredient</th>
                  <th className={cellClass}>Base Unit</th>
                  <th className={cellClass}>Physical</th>
                  <th className={cellClass}>Reserved</th>
                  <th className={cellClass}>Available</th>
                  <th className={cellClass}>Minimum</th>
                  <th className={cellClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(inventoryQuery.data ?? []).map((item) => (
                  <tr key={item.ingredient.id} className="border-t border-border">
                    <td className={cellClass}>{item.ingredient.code} - {item.ingredient.name}</td>
                    <td className={cellClass}>{item.ingredient.baseUnit.symbol}</td>
                    <td className={cellClass}>{item.physicalQuantity}</td>
                    <td className={cellClass}>{item.reservedQuantity}</td>
                    <td className={cellClass}>{item.availableQuantity}</td>
                    <td className={cellClass}>{item.minimumQuantity}</td>
                    <td className={cellClass}><StatusBadge danger={item.lowStock} label={item.lowStock ? "LOW" : "OK"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {canImport ? (
          <form className="grid gap-3 rounded-md border border-border p-4" onSubmit={submitImport}>
            <h2 className="text-lg font-semibold">Import</h2>
            <select className={inputClass} value={importIngredientId} onChange={(event) => setImportForm({ ...importForm, ingredientId: event.target.value, inputUnitId: "" })}>
              {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.code} - {ingredient.name}</option>)}
            </select>
            <div className="grid gap-3 md:grid-cols-2">
              <input className={inputClass} min="0.001" step="0.001" type="number" aria-label="Import quantity" value={importForm.inputQuantity} onChange={(event) => setImportForm({ ...importForm, inputQuantity: event.target.value })} />
              <select className={inputClass} aria-label="Input unit" value={inputUnitId} onChange={(event) => setImportForm({ ...importForm, inputUnitId: event.target.value })}>
                {importUnits.map((unit) => <option key={unit.unit.id} value={unit.unit.id}>{unit.unit.code} - {unit.unit.name}</option>)}
              </select>
            </div>
            <p className="rounded-md bg-muted px-3 py-2 text-sm">Preview: {conversionPreview}</p>
            <input className={inputClass} min="0" step="0.01" type="number" placeholder="Unit cost" value={importForm.unitCost} onChange={(event) => setImportForm({ ...importForm, unitCost: event.target.value })} />
            <input className={inputClass} placeholder="Reason" value={importForm.reason} onChange={(event) => setImportForm({ ...importForm, reason: event.target.value })} />
            <button className={buttonClass} disabled={!importForm.reason.trim() || importMutation.isPending} type="submit">Import</button>
          </form>
        ) : null}
        {canAdjust ? (
          <form className="grid gap-3 rounded-md border border-border p-4" onSubmit={submitAdjustment}>
            <h2 className="text-lg font-semibold">Adjustment</h2>
            <select className={inputClass} value={adjustIngredientId} onChange={(event) => setAdjustForm({ ...adjustForm, ingredientId: event.target.value })}>
              {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.code} - {ingredient.name}</option>)}
            </select>
            <select className={inputClass} value={adjustForm.type} onChange={(event) => setAdjustForm({ ...adjustForm, type: event.target.value as AdjustmentPayload["type"] })}>
              {adjustmentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input className={inputClass} step="0.001" type="number" aria-label="Adjustment quantity" value={adjustForm.quantity} onChange={(event) => setAdjustForm({ ...adjustForm, quantity: event.target.value })} />
            <input className={inputClass} placeholder="Reason" value={adjustForm.reason} onChange={(event) => setAdjustForm({ ...adjustForm, reason: event.target.value })} />
            <button className={buttonClass} disabled={!adjustForm.reason.trim() || adjustMutation.isPending} type="submit">Save Adjustment</button>
          </form>
        ) : null}
      </div>

      {canRead ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Ledger</h2>
            <select className={inputClass} aria-label="Ledger type" value={ledgerType} onChange={(event) => setLedgerType(event.target.value as InventoryTransactionType | "")}>
              {ledgerTypes.map((type) => <option key={type || "ALL"} value={type}>{type || "ALL"}</option>)}
            </select>
          </div>
          <QueryState isLoading={ledgerQuery.isLoading} error={ledgerQuery.error} empty={(ledgerQuery.data?.items ?? []).length === 0} />
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className={cellClass}>Date</th>
                  <th className={cellClass}>Ingredient</th>
                  <th className={cellClass}>Type</th>
                  <th className={cellClass}>Delta</th>
                  <th className={cellClass}>Input</th>
                  <th className={cellClass}>Factor</th>
                  <th className={cellClass}>Actor</th>
                  <th className={cellClass}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerQuery.data?.items ?? []).map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className={cellClass}>{formatDate(item.occurredAt)}</td>
                    <td className={cellClass}>{item.ingredient.code}</td>
                    <td className={cellClass}>{item.type}</td>
                    <td className={cellClass}>{item.quantityDelta} {item.ingredient.baseUnit.symbol}</td>
                    <td className={cellClass}>{item.inputQuantity && item.inputUnit ? `${item.inputQuantity} ${item.inputUnit.symbol}` : "-"}</td>
                    <td className={cellClass}>{item.conversionFactor ?? "-"}</td>
                    <td className={cellClass}>{item.actor?.displayName ?? "-"}</td>
                    <td className={cellClass}>{item.reason ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canStocktake ? (
        <section className="grid gap-4">
          <form className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[1fr_2fr_140px]" onSubmit={submitStocktake}>
            <input className={inputClass} placeholder="Stocktake code" value={stocktakeForm.code} onChange={(event) => setStocktakeForm({ ...stocktakeForm, code: event.target.value })} />
            <input className={inputClass} placeholder="Note" value={stocktakeForm.note} onChange={(event) => setStocktakeForm({ ...stocktakeForm, note: event.target.value })} />
            <button className={buttonClass} type="submit" disabled={createStocktakeMutation.isPending}>Create</button>
          </form>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="grid content-start gap-2">
              <h2 className="text-lg font-semibold">Stocktakes</h2>
              <QueryState isLoading={stocktakesQuery.isLoading} error={stocktakesQuery.error} empty={(stocktakesQuery.data ?? []).length === 0} />
              {(stocktakesQuery.data ?? []).map((stocktake) => (
                <button key={stocktake.id} className={`${buttonClass} justify-between`} type="button" onClick={() => setSelectedStocktakeId(stocktake.id)}>
                  <span>{stocktake.code}</span>
                  <span>{stocktake.status}</span>
                </button>
              ))}
            </div>
            {selectedStocktake ? (
              <div className="grid gap-3 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{selectedStocktake.code}</h2>
                  <StatusBadge label={selectedStocktake.status} danger={selectedStocktake.status === "CANCELLED"} />
                </div>
                <div className="grid gap-2">
                  {selectedStocktake.items.map((item) => {
                    const edit = countEdits[item.id] ?? { countedQuantity: item.countedQuantity, note: item.note ?? "" };
                    const locked = selectedStocktake.status === "COMPLETED" || selectedStocktake.status === "CANCELLED";
                    return (
                      <div key={item.id} className="grid gap-2 rounded-md bg-muted p-3 md:grid-cols-[1fr_120px_120px_120px_1fr_90px]">
                        <span className="text-sm font-medium">{item.ingredient.code}</span>
                        <span className="text-sm">Expected {item.expectedQuantity}</span>
                        <input className={inputClass} disabled={locked} step="0.001" type="number" aria-label={`Counted ${item.ingredient.code}`} value={edit.countedQuantity} onChange={(event) => setCountEdits({ ...countEdits, [item.id]: { ...edit, countedQuantity: event.target.value } })} />
                        <span className="text-sm">Diff {item.difference}</span>
                        <input className={inputClass} disabled={locked} placeholder="Note" value={edit.note} onChange={(event) => setCountEdits({ ...countEdits, [item.id]: { ...edit, note: event.target.value } })} />
                        <button className={buttonClass} disabled={locked || updateItemMutation.isPending} type="button" onClick={() => updateItemMutation.mutate({ stocktake: selectedStocktake, itemId: item.id })}>Save</button>
                      </div>
                    );
                  })}
                </div>
                {selectedStocktake.status === "DRAFT" || selectedStocktake.status === "COUNTING" ? (
                  <div className="flex flex-wrap gap-2">
                    <button className={buttonClass} disabled={completeMutation.isPending} type="button" onClick={() => window.confirm("Hoàn tất kiểm kê?") && completeMutation.mutate(selectedStocktake)}>Complete</button>
                    <button className={buttonClass} disabled={cancelMutation.isPending} type="button" onClick={() => cancelMutation.mutate(selectedStocktake)}>Cancel</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}

type FeedbackState = { type: "success" | "error"; message: string } | null;

function findIngredient(ingredients: Ingredient[], id: string): Ingredient | null {
  return ingredients.find((ingredient) => ingredient.id === id) ?? null;
}

function previewConversion(quantity: string, ingredient: Ingredient | null, unitId: string): string {
  if (!ingredient || !quantity || !unitId) {
    return "-";
  }
  const ingredientUnit = ingredient.units.find((item) => item.unit.id === unitId);
  const factor = Number(ingredientUnit?.conversionFactorToBase ?? 0);
  const converted = Number(quantity) * factor;
  if (!Number.isFinite(converted) || converted <= 0) {
    return "-";
  }
  return `${converted.toFixed(3)} ${ingredient.baseUnit.symbol}`;
}

function QueryState({ isLoading, error, empty }: { isLoading: boolean; error: unknown; empty: boolean }): ReactElement | null {
  if (isLoading) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải dữ liệu...</p>;
  }
  if (error) {
    return <p className="rounded-md border border-border p-4 text-sm text-red-600">{errorMessage(error)}</p>;
  }
  if (empty) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có dữ liệu phù hợp.</p>;
  }
  return null;
}

function ForbiddenPanel(): ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-md border border-border p-4">
        <h1 className="text-lg font-semibold">Không có quyền truy cập</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tài khoản hiện tại không có permission cho màn hình này.</p>
      </div>
    </section>
  );
}

function Feedback({ value }: { value: FeedbackState }): ReactElement | null {
  if (!value) {
    return null;
  }
  return <p className={`rounded-md border border-border p-3 text-sm ${value.type === "error" ? "text-red-600" : "text-green-700 dark:text-green-300"}`}>{value.message}</p>;
}

function StatusBadge({ label, danger }: { label: string; danger?: boolean }): ReactElement {
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${danger ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-muted text-foreground"}`}>{label}</span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Không xử lý được yêu cầu.";
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";
const buttonClass = "inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const cellClass = "px-3 py-2 align-middle";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ButtonHTMLAttributes, FormEvent, ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { ApiClientError } from "../services/api-client";
import { listProducts, Product } from "./menu-api";
import { useAdminContext } from "./admin-context";
import {
  Ingredient,
  IngredientStatus,
  Recipe,
  RecipeType,
  Unit,
  UnitDimension,
  activateRecipe,
  createIngredient,
  createRecipe,
  createUnit,
  listIngredients,
  listProductRecipes,
  listUnits,
  updateIngredient,
  updateUnit,
  upsertIngredientUnit
} from "./recipe-api";

const dimensions: UnitDimension[] = ["MASS", "VOLUME", "COUNT", "PACKAGE"];
const ingredientStatuses: IngredientStatus[] = ["ACTIVE", "INACTIVE"];
const recipeTypes: RecipeType[] = ["BASE", "SIZE", "ADD_ON"];

export function UnitManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("INVENTORY_READ") || admin.hasPermission("RECIPE_READ");
  const canManage = admin.hasPermission("INVENTORY_ADJUST");
  const [filters, setFilters] = useState({ q: "", activeOnly: false });
  const [form, setForm] = useState({ code: "", name: "", symbol: "", dimension: "MASS" as UnitDimension });
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const unitsQuery = useQuery({ queryKey: ["phase4-units", context, filters], queryFn: () => listUnits(context, filters), enabled: canRead });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["phase4-units"] });
    await queryClient.invalidateQueries({ queryKey: ["phase4-ingredients"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createUnit(context, form),
    onSuccess: async () => {
      setForm({ code: "", name: "", symbol: "", dimension: "MASS" });
      setFeedback({ type: "success", message: "Đã tạo đơn vị." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateMutation = useMutation({
    mutationFn: ({ unit, payload }: { unit: Unit; payload: Partial<Unit> }) => updateUnit(context, unit.id, payload),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật đơn vị." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canManage) {
      createMutation.mutate();
    }
  }

  function edit(unit: Unit): void {
    const name = window.prompt("Tên đơn vị", unit.name);
    if (!name?.trim()) {
      return;
    }
    const symbol = window.prompt("Ký hiệu", unit.symbol);
    if (!symbol?.trim()) {
      return;
    }
    updateMutation.mutate({ unit, payload: { name: name.trim(), symbol: symbol.trim() } });
  }

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Units" description="Quản lý đơn vị đo và nhóm quy đổi dùng cho nguyên liệu/công thức.">
      <Feedback value={feedback} />
      {canManage ? (
        <form className="grid gap-3 border-b border-border pb-4 md:grid-cols-[1fr_2fr_1fr_160px_120px]" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Tên đơn vị" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className={inputClass} placeholder="Ký hiệu" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} />
          <select className={inputClass} value={form.dimension} onChange={(event) => setForm({ ...form, dimension: event.target.value as UnitDimension })}>
            {dimensions.map((dimension) => <option key={dimension} value={dimension}>{dimension}</option>)}
          </select>
          <ActionButton type="submit" disabled={createMutation.isPending}>Create</ActionButton>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <input className={inputClass} placeholder="Search" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <input type="checkbox" checked={filters.activeOnly} onChange={(event) => setFilters({ ...filters, activeOnly: event.target.checked })} />
          Active only
        </label>
      </div>
      <QueryState isLoading={unitsQuery.isLoading} error={unitsQuery.error} empty={(unitsQuery.data ?? []).length === 0} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(unitsQuery.data ?? []).map((unit) => (
          <article key={unit.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{unit.code} - {unit.name}</h2>
                <p className="text-sm text-muted-foreground">{unit.symbol} / {unit.dimension}</p>
              </div>
              <StatusBadge active={unit.isActive} />
            </div>
            {canManage ? (
              <RowActions>
                <ActionButton onClick={() => edit(unit)}>Edit</ActionButton>
                <ActionButton onClick={() => updateMutation.mutate({ unit, payload: { isActive: !unit.isActive } })}>{unit.isActive ? "Disable" : "Enable"}</ActionButton>
              </RowActions>
            ) : null}
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function IngredientManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("INVENTORY_READ");
  const canManage = admin.hasPermission("INVENTORY_ADJUST");
  const [filters, setFilters] = useState({ q: "", activeOnly: false });
  const [form, setForm] = useState({ code: "", name: "", baseUnitId: "", status: "ACTIVE" as IngredientStatus });
  const [unitForm, setUnitForm] = useState({ ingredientId: "", unitId: "", label: "", conversionFactor: "", isDefault: false, isActive: true });
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const unitsQuery = useQuery({ queryKey: ["phase4-units", context], queryFn: () => listUnits(context, { activeOnly: true }), enabled: canRead });
  const ingredientsQuery = useQuery({ queryKey: ["phase4-ingredients", context, filters], queryFn: () => listIngredients(context, filters), enabled: canRead });
  const selectedBaseUnitId = form.baseUnitId || unitsQuery.data?.[0]?.id || "";
  const selectedIngredientId = unitForm.ingredientId || ingredientsQuery.data?.[0]?.id || "";
  const selectedUnitId = unitForm.unitId || unitsQuery.data?.[0]?.id || "";

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["phase4-ingredients"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createIngredient(context, { ...form, baseUnitId: selectedBaseUnitId }),
    onSuccess: async () => {
      setForm({ code: "", name: "", baseUnitId: "", status: "ACTIVE" });
      setFeedback({ type: "success", message: "Đã tạo nguyên liệu." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateMutation = useMutation({
    mutationFn: ({ ingredient, payload }: { ingredient: Ingredient; payload: Partial<{ name: string; status: IngredientStatus }> }) => updateIngredient(context, ingredient.id, payload),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật nguyên liệu." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const unitMutation = useMutation({
    mutationFn: () => upsertIngredientUnit(context, selectedIngredientId, selectedUnitId, {
      label: unitForm.label,
      conversionFactor: unitForm.conversionFactor || undefined,
      isDefault: unitForm.isDefault,
      isActive: unitForm.isActive
    }),
    onSuccess: async () => {
      setUnitForm({ ...unitForm, label: "", conversionFactor: "", isDefault: false, isActive: true });
      setFeedback({ type: "success", message: "Đã lưu đơn vị cho nguyên liệu." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canManage) {
      createMutation.mutate();
    }
  }

  function edit(ingredient: Ingredient): void {
    const name = window.prompt("Tên nguyên liệu", ingredient.name);
    if (!name?.trim()) {
      return;
    }
    updateMutation.mutate({ ingredient, payload: { name: name.trim() } });
  }

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Ingredients" description="Quản lý nguyên liệu, base unit và các đơn vị được phép nhập liệu.">
      <Feedback value={feedback} />
      {canManage ? (
        <div className="grid gap-4 border-b border-border pb-4 lg:grid-cols-2">
          <form className="grid gap-3 rounded-md border border-border p-4" onSubmit={submit}>
            <h2 className="text-base font-semibold">Ingredient</h2>
            <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            <input className={inputClass} placeholder="Tên nguyên liệu" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <select className={inputClass} value={selectedBaseUnitId} onChange={(event) => setForm({ ...form, baseUnitId: event.target.value })}>
              {(unitsQuery.data ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}
            </select>
            <select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as IngredientStatus })}>
              {ingredientStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <ActionButton type="submit" disabled={!selectedBaseUnitId || createMutation.isPending}>Create</ActionButton>
          </form>
          <section className="grid gap-3 rounded-md border border-border p-4">
            <h2 className="text-base font-semibold">Allowed unit</h2>
            <select className={inputClass} value={selectedIngredientId} onChange={(event) => setUnitForm({ ...unitForm, ingredientId: event.target.value })}>
              {(ingredientsQuery.data ?? []).map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.code} - {ingredient.name}</option>)}
            </select>
            <select className={inputClass} value={selectedUnitId} onChange={(event) => setUnitForm({ ...unitForm, unitId: event.target.value })}>
              {(unitsQuery.data ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}
            </select>
            <input className={inputClass} placeholder="Label" value={unitForm.label} onChange={(event) => setUnitForm({ ...unitForm, label: event.target.value })} />
            <input className={inputClass} min="0" step="0.000001" type="number" placeholder="Factor to base" value={unitForm.conversionFactor} onChange={(event) => setUnitForm({ ...unitForm, conversionFactor: event.target.value })} />
            <div className="flex flex-wrap gap-3">
              <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
                <input type="checkbox" checked={unitForm.isDefault} onChange={(event) => setUnitForm({ ...unitForm, isDefault: event.target.checked })} />
                Default
              </label>
              <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
                <input type="checkbox" checked={unitForm.isActive} onChange={(event) => setUnitForm({ ...unitForm, isActive: event.target.checked })} />
                Active
              </label>
            </div>
            <ActionButton disabled={!selectedIngredientId || !selectedUnitId || unitMutation.isPending} onClick={() => unitMutation.mutate()}>Save Unit</ActionButton>
          </section>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <input className={inputClass} placeholder="Search" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <input type="checkbox" checked={filters.activeOnly} onChange={(event) => setFilters({ ...filters, activeOnly: event.target.checked })} />
          Active only
        </label>
      </div>
      <QueryState isLoading={ingredientsQuery.isLoading} error={ingredientsQuery.error} empty={(ingredientsQuery.data ?? []).length === 0} />
      <div className="grid gap-3 lg:grid-cols-2">
        {(ingredientsQuery.data ?? []).map((ingredient) => (
          <article key={ingredient.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{ingredient.code} - {ingredient.name}</h2>
                <p className="text-sm text-muted-foreground">Base: {ingredient.baseUnit.code} ({ingredient.baseUnit.symbol})</p>
              </div>
              <StatusBadge active={ingredient.status === "ACTIVE"} label={ingredient.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ingredient.units.map((item) => (
                <span key={item.id} className="rounded-md bg-muted px-2 py-1 text-xs">
                  {item.unit.code}: {item.conversionFactorToBase ?? "no factor"} {item.isDefault ? "/ default" : ""} {item.isActive ? "" : "/ off"}
                </span>
              ))}
            </div>
            {canManage ? (
              <RowActions>
                <ActionButton onClick={() => edit(ingredient)}>Edit</ActionButton>
                <ActionButton onClick={() => updateMutation.mutate({ ingredient, payload: { status: ingredient.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } })}>
                  {ingredient.status === "ACTIVE" ? "Disable" : "Enable"}
                </ActionButton>
              </RowActions>
            ) : null}
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function RecipeManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("RECIPE_READ");
  const canManage = admin.hasPermission("RECIPE_MANAGE");
  const [form, setForm] = useState({ productId: "", type: "BASE" as RecipeType, productOptionValueId: "", name: "" });
  const [rows, setRows] = useState<RecipeItemForm[]>([{ ingredientId: "", quantity: "1.000" }]);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const productsQuery = useQuery({ queryKey: ["menu-products", context], queryFn: () => listProducts(context), enabled: canRead && admin.hasPermission("MENU_READ") });
  const ingredientsQuery = useQuery({ queryKey: ["phase4-ingredients", context], queryFn: () => listIngredients(context, { activeOnly: true }), enabled: canRead && admin.hasPermission("INVENTORY_READ") });
  const selectedProductId = form.productId || productsQuery.data?.[0]?.id || "";
  const selectedProduct = (productsQuery.data ?? []).find((product) => product.id === selectedProductId) ?? null;
  const productOptionValues = flattenProductOptionValues(selectedProduct);
  const selectedProductOptionValueId = form.productOptionValueId || productOptionValues[0]?.id || "";
  const recipesQuery = useQuery({ queryKey: ["phase4-recipes", context, selectedProductId], queryFn: () => listProductRecipes(context, selectedProductId), enabled: canRead && Boolean(selectedProductId) });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["phase4-recipes"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createRecipe(context, selectedProductId, {
      type: form.type,
      productOptionValueId: form.type === "BASE" ? undefined : selectedProductOptionValueId,
      name: form.name,
      items: rows.filter((row) => row.ingredientId && row.quantity).map((row) => ({ ingredientId: row.ingredientId, quantity: row.quantity }))
    }),
    onSuccess: async () => {
      setForm({ ...form, name: "" });
      setRows([{ ingredientId: "", quantity: "1.000" }]);
      setFeedback({ type: "success", message: "Đã tạo phiên bản công thức." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const activateMutation = useMutation({
    mutationFn: (recipe: Recipe) => activateRecipe(context, recipe.id),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã kích hoạt công thức." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canManage) {
      createMutation.mutate();
    }
  }

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Recipes" description="Quản lý phiên bản công thức base, size và topping theo base unit nguyên liệu.">
      <Feedback value={feedback} />
      {canManage ? (
        <form className="grid gap-4 border-b border-border pb-4" onSubmit={submit}>
          <div className="grid gap-3 md:grid-cols-4">
            <select className={inputClass} value={selectedProductId} onChange={(event) => setForm({ ...form, productId: event.target.value, productOptionValueId: "" })}>
              {(productsQuery.data ?? []).map((product) => <option key={product.id} value={product.id}>{product.code} - {product.name}</option>)}
            </select>
            <select className={inputClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as RecipeType, productOptionValueId: "" })}>
              {recipeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select className={inputClass} disabled={form.type === "BASE"} value={selectedProductOptionValueId} onChange={(event) => setForm({ ...form, productOptionValueId: event.target.value })}>
              {productOptionValues.map((option) => <option key={option.id} value={option.id}>{option.groupCode} - {option.name}</option>)}
            </select>
            <input className={inputClass} placeholder="Tên công thức" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </div>
          <div className="grid gap-2">
            {rows.map((row, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_160px_92px]">
                <select className={inputClass} value={row.ingredientId} onChange={(event) => setRows(replaceRow(rows, index, { ...row, ingredientId: event.target.value }))}>
                  <option value="">Chọn nguyên liệu</option>
                  {(ingredientsQuery.data ?? []).map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.code} - {ingredient.name} ({ingredient.baseUnit.symbol})</option>)}
                </select>
                <input className={inputClass} min="0.001" step="0.001" type="number" value={row.quantity} onChange={(event) => setRows(replaceRow(rows, index, { ...row, quantity: event.target.value }))} />
                <ActionButton disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</ActionButton>
              </div>
            ))}
          </div>
          <RowActions>
            <ActionButton onClick={() => setRows([...rows, { ingredientId: "", quantity: "1.000" }])}>Add Row</ActionButton>
            <ActionButton type="submit" disabled={!selectedProductId || !form.name.trim() || createMutation.isPending}>Create Draft</ActionButton>
          </RowActions>
        </form>
      ) : null}
      <QueryState isLoading={productsQuery.isLoading || recipesQuery.isLoading} error={productsQuery.error ?? recipesQuery.error} empty={(recipesQuery.data ?? []).length === 0} />
      <div className="grid gap-3">
        {(recipesQuery.data ?? []).map((recipe) => (
          <article key={recipe.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{recipe.name}</h2>
                <p className="text-sm text-muted-foreground">{recipe.type} / version {recipe.version}</p>
              </div>
              <StatusBadge active={recipe.isActive} label={recipe.isActive ? "ACTIVE" : "DRAFT"} />
            </div>
            <div className="mt-3 grid gap-2 text-sm">
              {recipe.items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
                  <span>{item.ingredient.code} - {item.ingredient.name}</span>
                  <span>{item.quantity} {item.ingredient.baseUnit.symbol}</span>
                </div>
              ))}
            </div>
            {canManage && !recipe.isActive ? <RowActions><ActionButton onClick={() => activateMutation.mutate(recipe)}>Activate</ActionButton></RowActions> : null}
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

type FeedbackState = { type: "success" | "error"; message: string } | null;
type RecipeItemForm = { ingredientId: string; quantity: string };

function flattenProductOptionValues(product: Product | null): Array<{ id: string; groupCode: string; name: string }> {
  return (product?.optionGroups ?? []).flatMap((group) => group.values.map((value) => ({ id: value.id, groupCode: group.code, name: value.name })));
}

function replaceRow(rows: RecipeItemForm[], index: number, value: RecipeItemForm): RecipeItemForm[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? value : row));
}

function AdminSection({ title, description, children }: { title: string; description: string; children: ReactNode }): ReactElement {
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
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

function RowActions({ children }: { children: ReactNode }): ReactElement {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
}

function StatusBadge({ active, label }: { active: boolean; label?: string }): ReactElement {
  return <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{label ?? (active ? "ACTIVE" : "INACTIVE")}</span>;
}

function ActionButton(props: ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
      type={props.type ?? "button"}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Không xử lý được yêu cầu.";
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";


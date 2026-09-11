import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ButtonHTMLAttributes, FormEvent, ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { ApiClientError } from "../services/api-client";
import {
  Category,
  OptionGroup,
  OptionGroupType,
  OptionValue,
  ProcessingArea,
  Product,
  ProductOptionRulesPayload,
  ProductStatus,
  createCategory,
  createOptionGroup,
  createOptionValue,
  createProduct,
  listCategories,
  listOptionGroups,
  listOptionValues,
  listProducts,
  replaceProductOptionRules,
  updateCategory,
  updateOptionGroup,
  updateOptionValue,
  updateProduct,
  uploadProductImage
} from "./menu-api";
import { useAdminContext } from "./admin-context";

const optionTypes: OptionGroupType[] = ["SIZE", "TOPPING", "SUGAR", "ICE", "CUSTOM"];

export function CategoryManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [filters, setFilters] = useState({ q: "", activeOnly: false });
  const [form, setForm] = useState({ code: "", name: "", sortOrder: "0" });
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const categoriesQuery = useQuery({
    queryKey: ["menu-categories", context, filters],
    queryFn: () => listCategories(context, filters),
    enabled: admin.hasPermission("MENU_READ")
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["menu-categories"] });
    await queryClient.invalidateQueries({ queryKey: ["menu-products"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createCategory(context, { code: form.code, name: form.name, sortOrder: Number(form.sortOrder) }),
    onSuccess: async () => {
      setForm({ code: "", name: "", sortOrder: "0" });
      setFeedback({ type: "success", message: "Đã tạo danh mục." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateMutation = useMutation({
    mutationFn: ({ category, payload }: { category: Category; payload: Partial<Category> }) => updateCategory(context, category.id, payload),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật danh mục." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("MENU_MANAGE")) {
      createMutation.mutate();
    }
  }

  function edit(category: Category): void {
    const name = window.prompt("Tên danh mục", category.name);
    if (!name?.trim()) {
      return;
    }
    const sortOrder = Number(window.prompt("Thứ tự sắp xếp", String(category.sortOrder)) ?? category.sortOrder);
    updateMutation.mutate({ category, payload: { name: name.trim(), sortOrder } });
  }

  if (!admin.hasPermission("MENU_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Menu Categories" description="Quản lý danh mục hiển thị trên menu QR và admin.">
      <Feedback value={feedback} />
      {admin.hasPermission("MENU_MANAGE") ? (
        <form className="grid gap-3 border-b border-border pb-4 md:grid-cols-[1fr_2fr_120px_140px]" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Tên danh mục" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className={inputClass} min="0" type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
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
      <QueryState isLoading={categoriesQuery.isLoading} error={categoriesQuery.error} empty={(categoriesQuery.data ?? []).length === 0} />
      <div className="grid gap-3">
        {(categoriesQuery.data ?? []).map((category) => (
          <article key={category.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{category.code} - {category.name}</h2>
                <p className="text-sm text-muted-foreground">Sort: {category.sortOrder}</p>
              </div>
              <RowActions>
                <StatusBadge active={category.isActive} />
                {admin.hasPermission("MENU_MANAGE") ? <ActionButton onClick={() => edit(category)}>Edit</ActionButton> : null}
                {admin.hasPermission("MENU_MANAGE") ? (
                  <ActionButton onClick={() => updateMutation.mutate({ category, payload: { isActive: !category.isActive } })}>
                    {category.isActive ? "Disable" : "Enable"}
                  </ActionButton>
                ) : null}
              </RowActions>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function ProductManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [filters, setFilters] = useState({ q: "", categoryId: "", activeOnly: false });
  const [form, setForm] = useState({
    code: "",
    name: "",
    categoryId: "",
    basePrice: "0",
    description: "",
    processingArea: "BAR" as ProcessingArea,
    status: "ACTIVE" as ProductStatus,
    isFeatured: false
  });
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const categoriesQuery = useQuery({ queryKey: ["menu-categories", context], queryFn: () => listCategories(context), enabled: admin.hasPermission("MENU_READ") });
  const productsQuery = useQuery({
    queryKey: ["menu-products", context, filters],
    queryFn: () => listProducts(context, filters),
    enabled: admin.hasPermission("MENU_READ")
  });
  const selectedCategoryId = form.categoryId || categoriesQuery.data?.[0]?.id || "";

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["menu-products"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createProduct(context, { ...form, categoryId: selectedCategoryId }),
    onSuccess: async () => {
      setForm({ ...form, code: "", name: "", basePrice: "0", description: "", isFeatured: false });
      setFeedback({ type: "success", message: "Đã tạo món." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateMutation = useMutation({
    mutationFn: ({ product, payload }: { product: Product; payload: ProductUpdatePayload }) => updateProduct(context, product.id, payload),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật món." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const imageMutation = useMutation({
    mutationFn: ({ product, file }: { product: Product; file: File }) => uploadProductImage(context, product.id, file),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật ảnh món." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("MENU_MANAGE")) {
      createMutation.mutate();
    }
  }

  function edit(product: Product): void {
    const name = window.prompt("Tên món", product.name);
    if (!name?.trim()) {
      return;
    }
    const basePrice = window.prompt("Giá cơ bản", product.basePrice);
    if (!basePrice?.trim()) {
      return;
    }
    const description = window.prompt("Mô tả", product.description ?? "") ?? "";
    updateMutation.mutate({ product, payload: { name: name.trim(), basePrice: basePrice.trim(), description: description.trim() } });
  }

  if (!admin.hasPermission("MENU_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Products" description="Quản lý món, giá, ảnh, trạng thái bán và khu vực pha chế.">
      <Feedback value={feedback} />
      {admin.hasPermission("MENU_MANAGE") ? (
        <form className="grid gap-3 border-b border-border pb-4 md:grid-cols-3 lg:grid-cols-6" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Tên món" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select className={inputClass} value={selectedCategoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
            {(categoriesQuery.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <input className={inputClass} min="0" step="1000" type="number" value={form.basePrice} onChange={(event) => setForm({ ...form, basePrice: event.target.value })} />
          <select className={inputClass} value={form.processingArea} onChange={(event) => setForm({ ...form, processingArea: event.target.value as ProcessingArea })}>
            <option value="BAR">BAR</option>
            <option value="KITCHEN">KITCHEN</option>
          </select>
          <ActionButton type="submit" disabled={createMutation.isPending || !selectedCategoryId}>Create</ActionButton>
          <textarea className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm md:col-span-2 lg:col-span-3" placeholder="Mô tả" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })} />
            Featured
          </label>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <input className={inputClass} placeholder="Search" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <select className={inputClass} value={filters.categoryId} onChange={(event) => setFilters({ ...filters, categoryId: event.target.value })}>
          <option value="">All categories</option>
          {(categoriesQuery.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <input type="checkbox" checked={filters.activeOnly} onChange={(event) => setFilters({ ...filters, activeOnly: event.target.checked })} />
          Available only
        </label>
      </div>
      <QueryState isLoading={productsQuery.isLoading} error={productsQuery.error} empty={(productsQuery.data ?? []).length === 0} />
      <div className="grid gap-3 lg:grid-cols-2">
        {(productsQuery.data ?? []).map((product) => (
          <article key={product.id} className="rounded-md border border-border p-4">
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              {product.imagePath ? <img alt={product.name} className="h-28 w-full rounded-md object-cover" src={product.imagePath} /> : <div className="flex h-28 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">No image</div>}
              <div className="grid gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{product.code} - {product.name}</h2>
                    <p className="text-sm text-muted-foreground">{product.category.name} / {product.processingArea}</p>
                  </div>
                  <StatusBadge active={product.availability.isAvailable} label={product.status} />
                </div>
                <p className="text-sm text-muted-foreground">{product.description ?? "No description"}</p>
                <p className="text-sm font-semibold">{formatMoney(product.basePrice)}</p>
                <RowActions>
                  {admin.hasPermission("MENU_MANAGE") ? <ActionButton onClick={() => edit(product)}>Edit</ActionButton> : null}
                  {admin.hasPermission("MENU_MANAGE") ? (
                    <ActionButton onClick={() => updateMutation.mutate({ product, payload: { status: product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } })}>
                      {product.status === "ACTIVE" ? "Stop selling" : "Sell again"}
                    </ActionButton>
                  ) : null}
                  {admin.hasPermission("MENU_MANAGE") ? (
                    <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
                      Upload
                      <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          imageMutation.mutate({ product, file });
                        }
                      }} />
                    </label>
                  ) : null}
                </RowActions>
              </div>
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function OptionManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [groupForm, setGroupForm] = useState({ code: "", name: "", type: "SIZE" as OptionGroupType, sortOrder: "0" });
  const [valueForm, setValueForm] = useState({ optionGroupId: "", code: "", name: "", sortOrder: "0" });
  const [ruleForm, setRuleForm] = useState({ productId: "", optionGroupId: "", isRequired: false, minSelections: "0", maxSelections: "1" });
  const [selectedValues, setSelectedValues] = useState<Record<string, { selected: boolean; priceDelta: string; isDefault: boolean }>>({});
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const groupsQuery = useQuery({ queryKey: ["menu-option-groups", context], queryFn: () => listOptionGroups(context), enabled: admin.hasPermission("MENU_READ") });
  const valuesQuery = useQuery({ queryKey: ["menu-option-values", context], queryFn: () => listOptionValues(context), enabled: admin.hasPermission("MENU_READ") });
  const productsQuery = useQuery({ queryKey: ["menu-products", context], queryFn: () => listProducts(context), enabled: admin.hasPermission("MENU_READ") });
  const selectedValueGroupId = valueForm.optionGroupId || groupsQuery.data?.[0]?.id || "";
  const selectedRuleGroupId = ruleForm.optionGroupId || groupsQuery.data?.[0]?.id || "";
  const selectedRuleProductId = ruleForm.productId || productsQuery.data?.[0]?.id || "";

  const refreshGroups = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["menu-option-groups"] });
    await queryClient.invalidateQueries({ queryKey: ["menu-option-values"] });
    await queryClient.invalidateQueries({ queryKey: ["menu-products"] });
  };
  const groupMutation = useMutation({
    mutationFn: () => createOptionGroup(context, { ...groupForm, sortOrder: Number(groupForm.sortOrder) }),
    onSuccess: async () => {
      setGroupForm({ code: "", name: "", type: "SIZE", sortOrder: "0" });
      setFeedback({ type: "success", message: "Đã tạo nhóm tùy chọn." });
      await refreshGroups();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const valueMutation = useMutation({
    mutationFn: () => createOptionValue(context, { ...valueForm, optionGroupId: selectedValueGroupId, sortOrder: Number(valueForm.sortOrder) }),
    onSuccess: async () => {
      setValueForm({ ...valueForm, code: "", name: "", sortOrder: "0" });
      setFeedback({ type: "success", message: "Đã tạo giá trị tùy chọn." });
      await refreshGroups();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateGroupMutation = useMutation({
    mutationFn: ({ group, payload }: { group: OptionGroup; payload: OptionGroupUpdatePayload }) => updateOptionGroup(context, group.id, payload),
    onSuccess: refreshGroups,
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateValueMutation = useMutation({
    mutationFn: ({ value, payload }: { value: OptionValue; payload: OptionValueUpdatePayload }) => updateOptionValue(context, value.id, payload),
    onSuccess: refreshGroups,
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const ruleMutation = useMutation({
    mutationFn: () => replaceProductOptionRules(context, selectedRuleProductId, buildRulePayload({ ...ruleForm, optionGroupId: selectedRuleGroupId }, selectedValues)),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã lưu tùy chọn cho món." });
      await queryClient.invalidateQueries({ queryKey: ["menu-products"] });
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const valuesForGroup = (valuesQuery.data ?? []).filter((value) => value.optionGroupId === selectedRuleGroupId);

  function submitGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("MENU_MANAGE")) {
      groupMutation.mutate();
    }
  }

  function submitValue(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("MENU_MANAGE")) {
      valueMutation.mutate();
    }
  }

  if (!admin.hasPermission("MENU_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Options" description="Cấu hình size, topping, đá, đường và giá cộng thêm cho từng món.">
      <Feedback value={feedback} />
      {admin.hasPermission("MENU_MANAGE") ? (
        <div className="grid gap-4 border-b border-border pb-4 lg:grid-cols-2">
          <form className="grid gap-3 rounded-md border border-border p-4" onSubmit={submitGroup}>
            <h2 className="text-base font-semibold">Option group</h2>
            <input className={inputClass} placeholder="Code" value={groupForm.code} onChange={(event) => setGroupForm({ ...groupForm, code: event.target.value })} />
            <input className={inputClass} placeholder="Tên nhóm" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
            <select className={inputClass} value={groupForm.type} onChange={(event) => setGroupForm({ ...groupForm, type: event.target.value as OptionGroupType })}>
              {optionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input className={inputClass} min="0" type="number" value={groupForm.sortOrder} onChange={(event) => setGroupForm({ ...groupForm, sortOrder: event.target.value })} />
            <ActionButton type="submit">Create Group</ActionButton>
          </form>
          <form className="grid gap-3 rounded-md border border-border p-4" onSubmit={submitValue}>
            <h2 className="text-base font-semibold">Option value</h2>
            <select className={inputClass} value={selectedValueGroupId} onChange={(event) => setValueForm({ ...valueForm, optionGroupId: event.target.value })}>
              {(groupsQuery.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <input className={inputClass} placeholder="Code" value={valueForm.code} onChange={(event) => setValueForm({ ...valueForm, code: event.target.value })} />
            <input className={inputClass} placeholder="Tên giá trị" value={valueForm.name} onChange={(event) => setValueForm({ ...valueForm, name: event.target.value })} />
            <input className={inputClass} min="0" type="number" value={valueForm.sortOrder} onChange={(event) => setValueForm({ ...valueForm, sortOrder: event.target.value })} />
            <ActionButton type="submit" disabled={!selectedValueGroupId}>Create Value</ActionButton>
          </form>
        </div>
      ) : null}
      <QueryState isLoading={groupsQuery.isLoading || valuesQuery.isLoading} error={groupsQuery.error ?? valuesQuery.error} empty={(groupsQuery.data ?? []).length === 0} />
      <div className="grid gap-3 lg:grid-cols-2">
        {(groupsQuery.data ?? []).map((group) => (
          <article key={group.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{group.code} - {group.name}</h2>
                <p className="text-sm text-muted-foreground">{group.type}</p>
              </div>
              <RowActions>
                <StatusBadge active={group.isActive} />
                {admin.hasPermission("MENU_MANAGE") ? (
                  <ActionButton onClick={() => updateGroupMutation.mutate({ group, payload: { isActive: !group.isActive } })}>
                    {group.isActive ? "Disable" : "Enable"}
                  </ActionButton>
                ) : null}
              </RowActions>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(valuesQuery.data ?? []).filter((value) => value.optionGroupId === group.id).map((value) => (
                <button key={value.id} className="rounded-md border border-border px-3 py-1 text-sm" type="button" onClick={() => {
                  if (admin.hasPermission("MENU_MANAGE")) {
                    updateValueMutation.mutate({ value, payload: { isActive: !value.isActive } });
                  }
                }}>
                  {value.name} {value.isActive ? "" : "(off)"}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      {admin.hasPermission("MENU_MANAGE") ? (
        <section className="grid gap-3 rounded-md border border-border p-4">
          <h2 className="text-base font-semibold">Product option rules</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <select className={inputClass} value={selectedRuleProductId} onChange={(event) => setRuleForm({ ...ruleForm, productId: event.target.value })}>
              {(productsQuery.data ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <select className={inputClass} value={selectedRuleGroupId} onChange={(event) => {
              setRuleForm({ ...ruleForm, optionGroupId: event.target.value });
              setSelectedValues({});
            }}>
              {(groupsQuery.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <input className={inputClass} min="0" type="number" value={ruleForm.minSelections} onChange={(event) => setRuleForm({ ...ruleForm, minSelections: event.target.value })} />
            <input className={inputClass} min="1" type="number" value={ruleForm.maxSelections} onChange={(event) => setRuleForm({ ...ruleForm, maxSelections: event.target.value })} />
          </div>
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" checked={ruleForm.isRequired} onChange={(event) => setRuleForm({ ...ruleForm, isRequired: event.target.checked })} />
            Required
          </label>
          <div className="grid gap-2">
            {valuesForGroup.map((value) => {
              const current = selectedValues[value.id] ?? { selected: false, priceDelta: "0", isDefault: false };
              return (
                <label key={value.id} className="grid gap-2 rounded-md border border-border p-3 text-sm md:grid-cols-[1fr_140px_100px]">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={current.selected} onChange={(event) => setSelectedValues({ ...selectedValues, [value.id]: { ...current, selected: event.target.checked } })} />
                    {value.name}
                  </span>
                  <input className={inputClass} min="0" step="1000" type="number" value={current.priceDelta} onChange={(event) => setSelectedValues({ ...selectedValues, [value.id]: { ...current, priceDelta: event.target.value } })} />
                  <span className="flex items-center gap-2">
                    <input type="radio" name="default-option-value" checked={current.isDefault} onChange={() => setDefaultValue(selectedValues, setSelectedValues, value.id)} />
                    Default
                  </span>
                </label>
              );
            })}
          </div>
          <ActionButton disabled={!selectedRuleProductId || !selectedRuleGroupId || Object.values(selectedValues).every((value) => !value.selected)} onClick={() => ruleMutation.mutate()}>
            Save Rules
          </ActionButton>
        </section>
      ) : null}
    </AdminSection>
  );
}

type FeedbackState = { type: "success" | "error"; message: string } | null;
type ProductUpdatePayload = {
  name?: string;
  basePrice?: string;
  description?: string;
  categoryId?: string;
  processingArea?: ProcessingArea;
  status?: ProductStatus;
  isFeatured?: boolean;
};
type OptionGroupUpdatePayload = { name?: string; type?: OptionGroupType; sortOrder?: number; isActive?: boolean };
type OptionValueUpdatePayload = { optionGroupId?: string; name?: string; sortOrder?: number; isActive?: boolean };

function buildRulePayload(ruleForm: { optionGroupId: string; isRequired: boolean; minSelections: string; maxSelections: string }, values: Record<string, { selected: boolean; priceDelta: string; isDefault: boolean }>): ProductOptionRulesPayload {
  return {
    groups: [
      {
        optionGroupId: ruleForm.optionGroupId,
        isRequired: ruleForm.isRequired,
        minSelections: Number(ruleForm.minSelections),
        maxSelections: Number(ruleForm.maxSelections),
        values: Object.entries(values)
          .filter(([, value]) => value.selected)
          .map(([optionValueId, value], index) => ({
            optionValueId,
            priceDelta: value.priceDelta || "0",
            isDefault: value.isDefault,
            isActive: true,
            sortOrder: index
          }))
      }
    ]
  };
}

function setDefaultValue(
  values: Record<string, { selected: boolean; priceDelta: string; isDefault: boolean }>,
  setValues: (values: Record<string, { selected: boolean; priceDelta: string; isDefault: boolean }>) => void,
  optionValueId: string
): void {
  const next = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { ...value, isDefault: key === optionValueId }]));
  setValues({ ...next, [optionValueId]: { ...(next[optionValueId] ?? { priceDelta: "0" }), selected: true, isDefault: true } });
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
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
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

function formatMoney(value: string): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value));
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";

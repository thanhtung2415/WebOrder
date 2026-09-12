import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Product, ProductOptionGroup } from "../admin/menu-api";
import { useOrderRealtime } from "../orders/use-order-realtime";
import { ApiClientError } from "../services/api-client";
import {
  addCustomerCartItem,
  deleteCustomerCartItem,
  fetchCustomerCart,
  type Cart,
  type CartItem,
  updateCustomerCartItem
} from "./customer-cart-api";
import { fetchCustomerMenu } from "./customer-menu-api";
import { confirmCustomerOrder, fetchCustomerSessionOrders, type Order, type OrderItemStatus } from "./customer-order-api";

interface ProductDraft {
  quantity: number;
  optionValueIds: string[];
  note: string;
}

export function CustomerMenuPage({
  branchIdOverride,
  qrSessionTokenOverride,
  sessionLabel
}: {
  branchIdOverride?: string;
  qrSessionTokenOverride?: string;
  sessionLabel?: string;
}): ReactElement {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const branchId = branchIdOverride ?? searchParams.get("branchId") ?? window.sessionStorage.getItem("qrBranchId") ?? "";
  const qrSessionToken = qrSessionTokenOverride ?? searchParams.get("qrSessionToken") ?? searchParams.get("token") ?? window.sessionStorage.getItem("qrSessionToken") ?? "";
  const cartStorageKey = useMemo(() => (qrSessionToken ? `weborder.cartToken.${qrSessionToken}` : "weborder.cartToken"), [qrSessionToken]);
  const [cartToken, setCartToken] = useState(() => (qrSessionToken ? window.sessionStorage.getItem(`weborder.cartToken.${qrSessionToken}`) ?? undefined : undefined));
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>({ quantity: 1, optionValueIds: [], note: "" });
  const [cartError, setCartError] = useState<string | null>(null);

  const menuQuery = useQuery({
    queryKey: ["customer-menu", branchId, qrSessionToken],
    queryFn: () => fetchCustomerMenu(branchId, qrSessionToken),
    enabled: Boolean(branchId && qrSessionToken)
  });

  const cartQuery = useQuery({
    queryKey: ["customer-cart", qrSessionToken],
    queryFn: () => fetchCustomerCart(qrSessionToken, cartToken ?? window.sessionStorage.getItem(cartStorageKey) ?? undefined),
    enabled: Boolean(qrSessionToken)
  });
  const tableSessionId = cartQuery.data?.tableSessionId;
  const ordersQuery = useQuery({
    queryKey: ["customer-orders", qrSessionToken, tableSessionId],
    queryFn: () => fetchCustomerSessionOrders(qrSessionToken, tableSessionId ?? ""),
    enabled: Boolean(qrSessionToken && tableSessionId),
    refetchInterval: 5_000
  });
  const refetchOrderState = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["customer-orders", qrSessionToken] });
    void queryClient.invalidateQueries({ queryKey: ["customer-cart", qrSessionToken] });
  }, [queryClient, qrSessionToken]);
  useOrderRealtime(branchId, refetchOrderState);

  useEffect(() => {
    if (!cartQuery.data?.token) {
      return;
    }
    window.sessionStorage.setItem(cartStorageKey, cartQuery.data.token);
  }, [cartQuery.data?.token, cartStorageKey]);

  const syncCart = (cart: Cart): void => {
    window.sessionStorage.setItem(cartStorageKey, cart.token);
    setCartToken(cart.token);
    queryClient.setQueryData(["customer-cart", qrSessionToken], cart);
  };

  const addMutation = useMutation({
    mutationFn: (payload: ProductDraft & { productId: string }) =>
      addCustomerCartItem(
        qrSessionToken,
        {
          productId: payload.productId,
          quantity: payload.quantity,
          optionValueIds: payload.optionValueIds,
          note: payload.note.trim() || undefined
        },
        cartToken ?? window.sessionStorage.getItem(cartStorageKey) ?? undefined
      ),
    onSuccess: (cart) => {
      syncCart(cart);
      setSelectedProduct(null);
      setCartError(null);
    },
    onError: (error) => setCartError(errorMessage(error, "Không thêm được món."))
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, quantity, note }: { itemId: string; quantity?: number; note?: string }) => updateCustomerCartItem(qrSessionToken, itemId, { quantity, note }),
    onSuccess: (cart) => {
      syncCart(cart);
      setCartError(null);
    },
    onError: (error) => setCartError(errorMessage(error, "Không cập nhật được giỏ."))
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteCustomerCartItem(qrSessionToken, itemId),
    onSuccess: (cart) => {
      syncCart(cart);
      setCartError(null);
    },
    onError: (error) => setCartError(errorMessage(error, "Không xoá được món."))
  });
  const confirmMutation = useMutation({
    mutationFn: (token: string) => confirmCustomerOrder(qrSessionToken, token, createIdempotencyKey()),
    onSuccess: async () => {
      window.sessionStorage.removeItem(cartStorageKey);
      setCartToken(undefined);
      setCartError(null);
      await queryClient.invalidateQueries({ queryKey: ["customer-cart", qrSessionToken] });
      await queryClient.invalidateQueries({ queryKey: ["customer-orders", qrSessionToken] });
    },
    onError: (error) => setCartError(errorMessage(error, "Không gửi được order."))
  });
  const confirmCurrentCart = (): void => {
    const token = cartQuery.data?.token ?? cartToken ?? window.sessionStorage.getItem(cartStorageKey) ?? "";
    if (!token) {
      setCartError("Không tìm thấy giỏ để gửi order.");
      return;
    }
    confirmMutation.mutate(token);
  };

  const products = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);
  const categories = useMemo(() => {
    const unique = new Map<string, Product["category"]>();
    products.forEach((product) => unique.set(product.category.id, product.category));
    return Array.from(unique.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [products]);
  const visibleProducts = selectedCategoryId ? products.filter((product) => product.category.id === selectedCategoryId) : products;

  const openProduct = (product: Product): void => {
    setSelectedProduct(product);
    setDraft({ quantity: 1, optionValueIds: defaultOptionValueIds(product), note: "" });
  };

  if (!branchId || !qrSessionToken) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold">Menu tại bàn</h1>
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Cần QR hợp lệ để xem menu.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Menu tại bàn</h1>
          <p className="mt-1 text-sm text-muted-foreground">{sessionLabel ?? "Chọn món, tùy chọn và gửi order khi phiên bàn còn mở."}</p>
        </div>
        <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" type="button">
          Gọi nhân viên
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          {menuQuery.isLoading ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải menu...</p> : null}
          {menuQuery.error ? (
            <p className="rounded-md border border-border p-4 text-sm text-red-600">
              {menuQuery.error instanceof ApiClientError ? menuQuery.error.message : "Không tải được menu."}
            </p>
          ) : null}

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button className={tabClass(!selectedCategoryId)} type="button" onClick={() => setSelectedCategoryId("")}>
              Tất cả
            </button>
            {categories.map((category) => (
              <button key={category.id} className={tabClass(selectedCategoryId === category.id)} type="button" onClick={() => setSelectedCategoryId(category.id)}>
                {category.name}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {visibleProducts.map((product) => {
              const unavailable = !product.availability.isAvailable;
              return (
                <button
                  key={product.id}
                  className="grid min-h-36 gap-3 rounded-md border border-border p-3 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={() => openProduct(product)}
                  disabled={unavailable}
                >
                  {product.imagePath ? <img alt={product.name} className="h-32 w-full rounded-md object-cover" src={product.imagePath} /> : <div className="flex h-32 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">Chưa có ảnh</div>}
                  <span className="text-base font-semibold">{product.name}</span>
                  <span className="text-sm text-muted-foreground">{product.description ?? product.category.name}</span>
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    {formatMoney(product.basePrice)}
                    {unavailable ? <span className="text-xs text-red-600">Tạm hết</span> : null}
                  </span>
                </button>
              );
            })}
          </div>

          {!menuQuery.isLoading && !menuQuery.error && visibleProducts.length === 0 ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có món phù hợp.</p> : null}
        </div>

        <div className="grid content-start gap-4">
          <CustomerCartPanel
            cart={cartQuery.data}
            isLoading={cartQuery.isLoading}
            error={cartError ?? (cartQuery.error ? errorMessage(cartQuery.error, "Không tải được giỏ.") : null)}
            isMutating={updateMutation.isPending || deleteMutation.isPending || confirmMutation.isPending}
            isConfirming={confirmMutation.isPending}
            onConfirm={confirmCurrentCart}
            onUpdateQuantity={(itemId, quantity) => updateMutation.mutate({ itemId, quantity })}
            onUpdateNote={(itemId, note) => updateMutation.mutate({ itemId, note })}
            onDelete={(itemId) => deleteMutation.mutate(itemId)}
          />
          <CustomerOrderStatusPanel orders={ordersQuery.data?.items ?? []} isLoading={ordersQuery.isLoading} error={ordersQuery.error} />
        </div>
      </div>

      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct}
          draft={draft}
          isSaving={addMutation.isPending}
          onDraftChange={setDraft}
          onClose={() => setSelectedProduct(null)}
          onSubmit={() => addMutation.mutate({ ...draft, productId: selectedProduct.id })}
        />
      ) : null}
    </section>
  );
}

function ProductDialog({
  product,
  draft,
  isSaving,
  onDraftChange,
  onClose,
  onSubmit
}: {
  product: Product;
  draft: ProductDraft;
  isSaving: boolean;
  onDraftChange: (draft: ProductDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}): ReactElement {
  const setQuantity = (quantity: number): void => onDraftChange({ ...draft, quantity: Math.max(1, quantity) });
  const setNote = (note: string): void => onDraftChange({ ...draft, note });
  const setGroupValue = (group: ProductOptionGroup, optionValueId: string, checked: boolean): void => {
    const otherGroups = new Set((product.optionGroups ?? []).filter((candidate) => candidate.id !== group.id).flatMap((candidate) => candidate.values.map((value) => value.id)));
    const kept = draft.optionValueIds.filter((id) => otherGroups.has(id));
    const selectedInGroup = group.maxSelections === 1 ? (checked ? [optionValueId] : []) : checked ? [...draft.optionValueIds.filter((id) => group.values.some((value) => value.id === id)), optionValueId] : draft.optionValueIds.filter((id) => id !== optionValueId);
    onDraftChange({ ...draft, optionValueIds: [...kept, ...selectedInGroup.slice(0, group.maxSelections)] });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/35 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true">
      <section className="grid max-h-[90vh] w-full max-w-xl gap-4 overflow-y-auto rounded-t-md border border-border bg-background p-4 shadow-lg sm:rounded-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{product.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{product.description ?? product.category.name}</p>
          </div>
          <button className="h-9 rounded-md border border-border px-3 text-sm" type="button" onClick={onClose}>
            Đóng
          </button>
        </div>
        <p className="text-base font-semibold">{formatMoney(product.basePrice)}</p>
        {(product.optionGroups ?? []).map((group) => (
          <fieldset key={group.id} className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{group.name}</legend>
            {group.values.map((value) => (
              <label key={value.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-2">
                  <input
                    type={group.maxSelections === 1 ? "radio" : "checkbox"}
                    name={group.id}
                    checked={draft.optionValueIds.includes(value.id)}
                    onChange={(event) => setGroupValue(group, value.id, event.target.checked)}
                  />
                  {value.name}
                </span>
                <span className="text-muted-foreground">{formatDelta(value.priceDelta)}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <label className="grid gap-1 text-sm">
          Số lượng
          <input className="h-10 rounded-md border border-border bg-background px-3" type="number" min={1} value={draft.quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
        </label>
        <textarea className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Ghi chú riêng" value={draft.note} onChange={(event) => setNote(event.target.value)} />
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60" type="button" disabled={isSaving} onClick={onSubmit}>
          {isSaving ? "Đang giữ món..." : "Thêm vào giỏ"}
        </button>
      </section>
    </div>
  );
}

function CustomerCartPanel({
  cart,
  isLoading,
  error,
  isMutating,
  isConfirming,
  onConfirm,
  onUpdateQuantity,
  onUpdateNote,
  onDelete
}: {
  cart?: Cart;
  isLoading: boolean;
  error: string | null;
  isMutating: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onUpdateNote: (itemId: string, note: string) => void;
  onDelete: (itemId: string) => void;
}): ReactElement {
  const hasItems = Boolean(cart?.items.length);
  const hasBlockedItem = Boolean(cart?.items.some((item) => item.reservationStatus === "EXPIRED" || item.reservationStatus === "UNAVAILABLE"));
  return (
    <aside className="grid content-start gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Giỏ món</h2>
        <span className="text-sm font-semibold">{formatMoney(cart?.subtotal ?? "0")}</span>
      </div>
      {isLoading ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Đang tải giỏ...</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!isLoading && !cart?.items.length ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Chưa có món trong giỏ.</p> : null}
      {cart?.items.map((item) => (
        <CartItemRow key={item.id} item={item} isMutating={isMutating} onUpdateQuantity={onUpdateQuantity} onUpdateNote={onUpdateNote} onDelete={onDelete} />
      ))}
      {cart?.items.some((item) => item.reservationStatus === "EXPIRED" || item.reservationStatus === "UNAVAILABLE") ? (
        <p className="text-xs text-red-700">Có món đã hết thời gian giữ hoặc không còn đủ nguyên liệu. Vui lòng cập nhật lại số lượng hoặc xoá món.</p>
      ) : null}
      <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={!hasItems || hasBlockedItem || isMutating} onClick={onConfirm}>
        {isConfirming ? "Đang gửi order..." : "Xác nhận order"}
      </button>
    </aside>
  );
}

function CustomerOrderStatusPanel({ orders, isLoading, error }: { orders: Order[]; isLoading: boolean; error: unknown }): ReactElement {
  return (
    <aside className="grid content-start gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Đơn đã gửi</h2>
        <span className="text-xs text-muted-foreground">{orders.length} order</span>
      </div>
      {isLoading ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Đang tải trạng thái...</p> : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage(error, "Không tải được trạng thái order.")}</p> : null}
      {!isLoading && !orders.length ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Chưa có order nào được gửi.</p> : null}
      {orders.map((order) => (
        <article key={order.id} className="grid gap-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{order.orderNumber}</h3>
            <span className="text-sm font-semibold">{formatMoney(order.subtotal)}</span>
          </div>
          <div className="grid gap-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {item.quantity} x {item.productNameSnapshot}
                  {item.options.length ? <span className="block text-xs text-muted-foreground">{item.options.map((option) => option.optionNameSnapshot).join(", ")}</span> : null}
                </span>
                <StatusPill status={item.status} />
              </div>
            ))}
          </div>
        </article>
      ))}
    </aside>
  );
}

function StatusPill({ status }: { status: OrderItemStatus }): ReactElement {
  const tone = status === "SERVED" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" : status === "CANCELLED" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : status === "READY" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone}`}>{statusLabel(status)}</span>;
}

function CartItemRow({
  item,
  isMutating,
  onUpdateQuantity,
  onUpdateNote,
  onDelete
}: {
  item: CartItem;
  isMutating: boolean;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onUpdateNote: (itemId: string, note: string) => void;
  onDelete: (itemId: string) => void;
}): ReactElement {
  const isExpired = item.reservationStatus === "EXPIRED";
  const isUnavailable = item.reservationStatus === "UNAVAILABLE";

  return (
    <article className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{item.product.name}</h3>
          {item.options.length ? <p className="mt-1 text-xs text-muted-foreground">{item.options.map((option) => option.optionValueName).join(", ")}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">{reservationText(item)}</p>
        </div>
        <span className="text-sm font-semibold">{formatMoney(item.lineSubtotal)}</span>
      </div>
      {(isExpired || isUnavailable) && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{isExpired ? "Giữ món đã hết hạn." : "Món chưa giữ được nguyên liệu."}</p>}
      <div className="grid grid-cols-[96px_1fr] gap-2">
        <input
          key={`${item.id}-quantity-${item.updatedAt}`}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          type="number"
          min={1}
          defaultValue={item.quantity}
          onBlur={(event) => onUpdateQuantity(item.id, Math.max(1, Number(event.currentTarget.value)))}
          disabled={isMutating}
        />
        <input
          key={`${item.id}-note-${item.updatedAt}`}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          defaultValue={item.note ?? ""}
          placeholder="Ghi chú"
          onBlur={(event) => onUpdateNote(item.id, event.currentTarget.value)}
          disabled={isMutating}
        />
      </div>
      <button className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-60" type="button" disabled={isMutating} onClick={() => onDelete(item.id)}>
        Xoá món
      </button>
    </article>
  );
}

function defaultOptionValueIds(product: Product): string[] {
  return (product.optionGroups ?? []).flatMap((group) => group.values.filter((value) => value.isDefault).slice(0, group.maxSelections).map((value) => value.id));
}

function tabClass(active: boolean): string {
  return `h-9 shrink-0 rounded-md border border-border px-3 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
}

function reservationText(item: CartItem): string {
  if (item.reservationStatus === "EXPIRED") {
    return "Đã hết thời gian giữ món";
  }
  if (item.reservationStatus === "UNAVAILABLE") {
    return "Chưa giữ được nguyên liệu";
  }
  if (!item.reservationExpiresAt) {
    return "Đang chờ giữ món";
  }
  return `Giữ đến ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.reservationExpiresAt))}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function formatMoney(value: string): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value));
}

function formatDelta(value: string): string {
  const amount = Number(value);
  return amount > 0 ? `+${formatMoney(value)}` : "Không đổi giá";
}

function statusLabel(status: OrderItemStatus): string {
  const labels: Record<OrderItemStatus, string> = {
    NEW: "Mới",
    PREPARING: "Đang làm",
    READY: "Sẵn sàng",
    SERVED: "Đã phục vụ",
    CANCELLED: "Đã hủy"
  };
  return labels[status];
}

function createIdempotencyKey(): string {
  try {
    const key = globalThis.crypto?.randomUUID?.();
    if (key) {
      return key;
    }
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

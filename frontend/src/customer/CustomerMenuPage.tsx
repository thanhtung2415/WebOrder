import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Product } from "../admin/menu-api";
import { ApiClientError } from "../services/api-client";
import { fetchCustomerMenu } from "./customer-menu-api";

export function CustomerMenuPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get("branchId") ?? "";
  const qrSessionToken = searchParams.get("qrSessionToken") ?? searchParams.get("token") ?? "";
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const menuQuery = useQuery({
    queryKey: ["customer-menu", branchId, qrSessionToken],
    queryFn: () => fetchCustomerMenu(branchId, qrSessionToken),
    enabled: Boolean(branchId && qrSessionToken)
  });

  const products = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);
  const categories = useMemo(() => {
    const unique = new Map<string, Product["category"]>();
    products.forEach((product) => unique.set(product.category.id, product.category));
    return Array.from(unique.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [products]);
  const visibleProducts = selectedCategoryId ? products.filter((product) => product.category.id === selectedCategoryId) : products;

  if (!branchId || !qrSessionToken) {
    return (
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold">Menu tại bàn</h1>
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Cần QR hợp lệ để xem menu.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Menu tại bàn</h1>
          <p className="mt-1 text-sm text-muted-foreground">Chọn món, tùy chọn và gửi order khi phiên bàn còn mở.</p>
        </div>
        <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" type="button">
          Gọi nhân viên
        </button>
      </div>

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleProducts.map((product) => (
          <button key={product.id} className="grid min-h-36 gap-3 rounded-md border border-border p-3 text-left hover:bg-muted" type="button" onClick={() => setSelectedProduct(product)}>
            {product.imagePath ? <img alt={product.name} className="h-32 w-full rounded-md object-cover" src={product.imagePath} /> : <div className="flex h-32 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">Chưa có ảnh</div>}
            <span className="text-base font-semibold">{product.name}</span>
            <span className="text-sm text-muted-foreground">{product.description ?? product.category.name}</span>
            <span className="text-sm font-semibold">{formatMoney(product.basePrice)}</span>
          </button>
        ))}
      </div>

      {!menuQuery.isLoading && !menuQuery.error && visibleProducts.length === 0 ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có món phù hợp.</p> : null}

      {selectedProduct ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/35 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true">
          <section className="grid max-h-[90vh] w-full max-w-xl gap-4 overflow-y-auto rounded-t-md border border-border bg-background p-4 shadow-lg sm:rounded-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{selectedProduct.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{selectedProduct.description ?? selectedProduct.category.name}</p>
              </div>
              <button className="h-9 rounded-md border border-border px-3 text-sm" type="button" onClick={() => setSelectedProduct(null)}>
                Đóng
              </button>
            </div>
            <p className="text-base font-semibold">{formatMoney(selectedProduct.basePrice)}</p>
            {(selectedProduct.optionGroups ?? []).map((group) => (
              <fieldset key={group.id} className="grid gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">{group.name}</legend>
                {group.values.map((value) => (
                  <label key={value.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{value.name}</span>
                    <span className="text-muted-foreground">{formatDelta(value.priceDelta)}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <textarea className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Ghi chú riêng" />
            <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-60" type="button" disabled>
              Thêm vào giỏ
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function tabClass(active: boolean): string {
  return `h-9 shrink-0 rounded-md border border-border px-3 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
}

function formatMoney(value: string): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value));
}

function formatDelta(value: string): string {
  const amount = Number(value);
  return amount > 0 ? `+${formatMoney(value)}` : "Không đổi giá";
}

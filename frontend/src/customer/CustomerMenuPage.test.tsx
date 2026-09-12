import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerMenuPage } from "./CustomerMenuPage";

const fetchCustomerMenuMock = vi.fn();
const fetchCustomerCartMock = vi.fn();
const addCustomerCartItemMock = vi.fn();
const updateCustomerCartItemMock = vi.fn();
const deleteCustomerCartItemMock = vi.fn();
const confirmCustomerOrderMock = vi.fn();
const fetchCustomerSessionOrdersMock = vi.fn();

vi.mock("./customer-menu-api", () => ({
  fetchCustomerMenu: (...args: unknown[]) => fetchCustomerMenuMock(...args)
}));

vi.mock("./customer-cart-api", () => ({
  fetchCustomerCart: (...args: unknown[]) => fetchCustomerCartMock(...args),
  addCustomerCartItem: (...args: unknown[]) => addCustomerCartItemMock(...args),
  updateCustomerCartItem: (...args: unknown[]) => updateCustomerCartItemMock(...args),
  deleteCustomerCartItem: (...args: unknown[]) => deleteCustomerCartItemMock(...args)
}));

vi.mock("./customer-order-api", () => ({
  confirmCustomerOrder: (...args: unknown[]) => confirmCustomerOrderMock(...args),
  fetchCustomerSessionOrders: (...args: unknown[]) => fetchCustomerSessionOrdersMock(...args)
}));

vi.mock("../orders/use-order-realtime", () => ({
  useOrderRealtime: vi.fn()
}));

function renderCustomerMenu(path: string): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customer" element={<CustomerMenuPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CustomerMenuPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    fetchCustomerMenuMock.mockReset();
    fetchCustomerCartMock.mockReset();
    addCustomerCartItemMock.mockReset();
    updateCustomerCartItemMock.mockReset();
    deleteCustomerCartItemMock.mockReset();
    confirmCustomerOrderMock.mockReset();
    fetchCustomerSessionOrdersMock.mockReset();
    fetchCustomerCartMock.mockResolvedValue(emptyCart());
    fetchCustomerSessionOrdersMock.mockResolvedValue({ items: [] });
  });

  it("requires a QR session token before loading menu data", async () => {
    renderCustomerMenu("/customer");

    expect(await screen.findByText("Cần QR hợp lệ để xem menu.")).toBeInTheDocument();
    expect(fetchCustomerMenuMock).not.toHaveBeenCalled();
    expect(fetchCustomerCartMock).not.toHaveBeenCalled();
  });

  it("renders active menu products from the QR session and loads the cart", async () => {
    fetchCustomerMenuMock.mockResolvedValue([sampleProduct()]);

    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    expect(await screen.findByText("Bạc xỉu")).toBeInTheDocument();
    expect(screen.getByText("Cà phê")).toBeInTheDocument();
    expect(fetchCustomerMenuMock).toHaveBeenCalledWith("branch-id", "qr-token");
    await waitFor(() => expect(fetchCustomerCartMock).toHaveBeenCalledWith("qr-token", undefined));
  });

  it("adds a product with selected options and stores the returned cart token", async () => {
    fetchCustomerMenuMock.mockResolvedValue([sampleProduct()]);
    addCustomerCartItemMock.mockResolvedValue(cartWithItem({ token: "new-cart-token" }));

    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    fireEvent.click(await screen.findByRole("button", { name: /Bạc xỉu/i }));
    fireEvent.click(screen.getByRole("radio", { name: /Large/i }));
    fireEvent.change(screen.getByLabelText("Số lượng"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("Ghi chú riêng"), { target: { value: "ít đá" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào giỏ" }));

    await waitFor(() =>
      expect(addCustomerCartItemMock).toHaveBeenCalledWith(
        "qr-token",
        {
          productId: "product-id",
          quantity: 2,
          optionValueIds: ["large-option"],
          note: "ít đá"
        },
        "cart-token"
      )
    );
    expect(window.sessionStorage.getItem("weborder.cartToken.qr-token")).toBe("new-cart-token");
  });

  it("shows cart loading state", async () => {
    fetchCustomerMenuMock.mockResolvedValue([]);
    fetchCustomerCartMock.mockReturnValue(new Promise(() => undefined));
    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    expect(await screen.findByText("Đang tải giỏ...")).toBeInTheDocument();
  });

  it("shows cart error state", async () => {
    fetchCustomerMenuMock.mockResolvedValue([]);
    fetchCustomerCartMock.mockRejectedValue(new Error("down"));
    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    expect(await screen.findByText("Không tải được giỏ.")).toBeInTheDocument();
  });

  it("shows expired cart item state", async () => {
    fetchCustomerMenuMock.mockResolvedValue([]);
    fetchCustomerCartMock.mockImplementation(() => Promise.resolve(cartWithItem({ reservationStatus: "EXPIRED" })));
    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    await waitFor(() => expect(screen.queryByText("Đang tải giỏ...")).not.toBeInTheDocument());
    expect(screen.getByText("Giữ món đã hết hạn.")).toBeInTheDocument();
  });

  it("confirms the current cart and refreshes customer order status", async () => {
    fetchCustomerMenuMock.mockResolvedValue([]);
    fetchCustomerCartMock.mockImplementation(() => Promise.resolve(cartWithItem()));
    confirmCustomerOrderMock.mockResolvedValue(sampleOrder());
    fetchCustomerSessionOrdersMock.mockResolvedValue({ items: [sampleOrder()] });
    renderCustomerMenu("/customer?branchId=branch-id&qrSessionToken=qr-token");

    await screen.findByText("Bạc xỉu");
    const confirmButton = screen.getByRole("button", { name: "Xác nhận order" });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    await waitFor(() => expect(confirmCustomerOrderMock).toHaveBeenCalledWith("qr-token", "cart-token", expect.any(String)));
    expect(await screen.findByText("ORD-1")).toBeInTheDocument();
    expect(screen.getByText("Mới")).toBeInTheDocument();
  });
});

function sampleProduct() {
  return {
    id: "product-id",
    code: "BAC_XIU",
    name: "Bạc xỉu",
    description: "Ít cà phê, nhiều sữa",
    imagePath: null,
    basePrice: "35000.00",
    processingArea: "BAR",
    status: "ACTIVE",
    isFeatured: true,
    category: { id: "category-id", code: "COFFEE", name: "Cà phê", sortOrder: 1, isActive: true },
    availability: { isAvailable: true, inventoryAware: false, reason: "AVAILABLE" },
    optionGroups: [
      {
        id: "size-group",
        optionGroupId: "size-source",
        code: "SIZE",
        name: "Size",
        type: "SIZE",
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        sortOrder: 1,
        values: [
          { id: "small-option", optionValueId: "small", code: "SMALL", name: "Small", priceDelta: "0.00", isDefault: true, isActive: true, sortOrder: 1 },
          { id: "large-option", optionValueId: "large", code: "LARGE", name: "Large", priceDelta: "5000.00", isDefault: false, isActive: true, sortOrder: 2 }
        ]
      }
    ]
  };
}

function emptyCart() {
  return {
    id: "cart-id",
    token: "cart-token",
    branchId: "branch-id",
    tableSessionId: "session-id",
    status: "ACTIVE",
    items: [],
    subtotal: "0.00",
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function cartWithItem(overrides: { token?: string; reservationStatus?: "ACTIVE" | "EXPIRED" | "RELEASED" | "UNAVAILABLE" } = {}) {
  return {
    ...emptyCart(),
    token: overrides.token ?? "cart-token",
    subtotal: "35000.00",
    items: [
      {
        id: "item-id",
        product: { id: "product-id", code: "BAC_XIU", name: "Bạc xỉu", imagePath: null },
        quantity: 1,
        note: null,
        isTakeaway: false,
        unitPrice: "35000.00",
        lineSubtotal: "35000.00",
        reservationStatus: overrides.reservationStatus ?? "ACTIVE",
        reservationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        options: [],
        reservations: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };
}

function sampleOrder() {
  return {
    id: "order-id",
    branchId: "branch-id",
    tableSessionId: "session-id",
    cartId: "cart-id",
    orderNumber: "ORD-1",
    source: "CUSTOMER",
    createdById: null,
    table: { id: "table-id", code: "T01", displayName: "T01" },
    items: [
      {
        id: "order-item-id",
        productId: "product-id",
        productCodeSnapshot: "BAC_XIU",
        productNameSnapshot: "Bạc xỉu",
        processingArea: "BAR",
        quantity: 1,
        baseUnitPrice: "35000.00",
        optionUnitPrice: "0.00",
        finalUnitPrice: "35000.00",
        lineSubtotal: "35000.00",
        note: null,
        isTakeaway: false,
        status: "NEW",
        preparingAt: null,
        readyAt: null,
        servedAt: null,
        cancelledAt: null,
        cancelReason: null,
        options: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    subtotal: "35000.00",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

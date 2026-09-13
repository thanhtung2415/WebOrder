import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingPage } from "./BillingPage";
import type { Bill, SessionBilling } from "./billing-api";

const fetchSessionBillingMock = vi.fn();
const createBillMock = vi.fn();
const issueBillMock = vi.fn();
const splitBillMock = vi.fn();
const mergeBillsMock = vi.fn();
const voidBillMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock("../admin/admin-context", () => ({
  useAdminContext: () => ({
    accessToken: "staff-token",
    activeBranchId: "branch-id",
    hasPermission: hasPermissionMock,
    me: {}
  })
}));

vi.mock("../orders/use-order-realtime", () => ({
  useOrderRealtime: vi.fn()
}));

vi.mock("./billing-api", async () => {
  const actual = await vi.importActual<typeof import("./billing-api")>("./billing-api");
  return {
    ...actual,
    fetchSessionBilling: (...args: unknown[]) => fetchSessionBillingMock(...args),
    createBill: (...args: unknown[]) => createBillMock(...args),
    issueBill: (...args: unknown[]) => issueBillMock(...args),
    splitBill: (...args: unknown[]) => splitBillMock(...args),
    mergeBills: (...args: unknown[]) => mergeBillsMock(...args),
    voidBill: (...args: unknown[]) => voidBillMock(...args)
  };
});

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <BillingPage />
    </QueryClientProvider>
  );
}

async function loadBilling(): Promise<void> {
  renderPage();
  fireEvent.change(screen.getByPlaceholderText("Dán tableSessionId đang mở"), { target: { value: "session-id" } });
  await screen.findAllByText("Cà phê sữa");
}

describe("BillingPage", () => {
  beforeEach(() => {
    fetchSessionBillingMock.mockReset();
    createBillMock.mockReset();
    issueBillMock.mockReset();
    splitBillMock.mockReset();
    mergeBillsMock.mockReset();
    voidBillMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    fetchSessionBillingMock.mockResolvedValue(sessionBilling());
    createBillMock.mockResolvedValue(billFixture());
    issueBillMock.mockResolvedValue(billFixture({ status: "ISSUED" }));
    splitBillMock.mockResolvedValue({ sourceBill: billFixture({ items: [] }), bills: [billFixture(), billFixture({ id: "bill-3", billNumber: "BILL-003" })] });
    mergeBillsMock.mockResolvedValue(billFixture());
    voidBillMock.mockResolvedValue(billFixture({ status: "VOID", voidReason: "Hủy hóa đơn theo yêu cầu thu ngân" }));
  });

  it("loads session billing and creates a draft bill", async () => {
    await loadBilling();

    expect(fetchSessionBillingMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "session-id");

    fireEvent.click(screen.getByRole("button", { name: "Tạo bill nháp" }));

    await waitFor(() => expect(createBillMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "session-id"));
    expect(await screen.findByText("Đã tạo bill nháp.")).toBeInTheDocument();
  });

  it("issues, splits and voids mutable bills", async () => {
    await loadBilling();

    fireEvent.click(screen.getAllByRole("button", { name: "Issue" })[0]);
    await waitFor(() => expect(issueBillMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1"));

    fireEvent.click(screen.getAllByRole("button", { name: "Split" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận tách bill" }));
    await waitFor(() =>
      expect(splitBillMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1", [
        { items: [{ orderItemId: "order-item-1", quantity: 1 }] },
        { items: [{ orderItemId: "order-item-1", quantity: 1 }] }
      ])
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Void" })[0]);
    await waitFor(() => expect(voidBillMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1", "Hủy hóa đơn theo yêu cầu thu ngân"));
  });

  it("merges selected bills with a reason", async () => {
    await loadBilling();

    fireEvent.change(screen.getByDisplayValue("Chọn bill đích"), { target: { value: "bill-1" } });
    fireEvent.click(screen.getByLabelText("BILL-002"));
    fireEvent.click(screen.getByRole("button", { name: "Gộp bill" }));

    await waitFor(() =>
      expect(mergeBillsMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1", ["bill-2"], "Gộp hóa đơn theo yêu cầu thu ngân")
    );
  });

  it("shows loading, error and empty states", async () => {
    fetchSessionBillingMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Dán tableSessionId đang mở"), { target: { value: "session-id" } });
    expect(await screen.findByText("Đang tải bill...")).toBeInTheDocument();

    fetchSessionBillingMock.mockReset();
    fetchSessionBillingMock.mockRejectedValue(new Error("billing down"));
    cleanup();
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Dán tableSessionId đang mở"), { target: { value: "session-id" } });
    expect(await screen.findByText("billing down")).toBeInTheDocument();

    fetchSessionBillingMock.mockReset();
    fetchSessionBillingMock.mockResolvedValue(sessionBilling({ bills: [], unbilledItems: [] }));
    cleanup();
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Dán tableSessionId đang mở"), { target: { value: "session-id" } });
    expect(await screen.findByText("Chưa có bill cho phiên bàn này.")).toBeInTheDocument();
    expect(screen.getByText("Không còn món chưa lên bill.")).toBeInTheDocument();
  });

  it("blocks staff without bill read permission", () => {
    hasPermissionMock.mockImplementation((permission: string) => permission !== "BILL_READ");
    renderPage();

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(fetchSessionBillingMock).not.toHaveBeenCalled();
  });
});

function sessionBilling(overrides: Partial<SessionBilling> = {}): SessionBilling {
  return {
    tableSessionId: "session-id",
    bills: overrides.bills ?? [billFixture(), billFixture({ id: "bill-2", billNumber: "BILL-002", total: "30000" })],
    unbilledItems:
      overrides.unbilledItems ??
      [
        {
          orderItemId: "order-item-2",
          productId: "product-2",
          productNameSnapshot: "Trà đào",
          orderedQuantity: 1,
          billedQuantity: 0,
          remainingQuantity: 1,
          unitPrice: "25000",
          remainingAmount: "25000"
        }
      ]
  };
}

function billFixture(overrides: Partial<Bill> = {}): Bill {
  return {
    id: overrides.id ?? "bill-1",
    branchId: "branch-id",
    tableSessionId: "session-id",
    mergedIntoBillId: null,
    billNumber: overrides.billNumber ?? "BILL-001",
    status: overrides.status ?? "DRAFT",
    subtotal: "50000",
    voucherDiscountAmount: "0",
    directDiscountAmount: "0",
    discountedAmount: "50000",
    vatRate: "0",
    vatAmount: "0",
    total: overrides.total ?? "50000",
    issuedById: null,
    issuedAt: null,
    paidAt: null,
    voidedById: null,
    voidedAt: null,
    voidReason: overrides.voidReason ?? null,
    mergedById: null,
    mergedAt: null,
    mergeReason: null,
    items:
      overrides.items ??
      [
        {
          id: "bill-item-1",
          orderItemId: "order-item-1",
          productId: "product-1",
          productNameSnapshot: "Cà phê sữa",
          quantity: 2,
          orderedQuantity: 2,
          unitPriceSnapshot: "25000",
          lineAmount: "50000",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

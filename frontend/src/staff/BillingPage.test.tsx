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
const fetchVouchersMock = vi.fn();
const createVoucherMock = vi.fn();
const updateVoucherStatusMock = vi.fn();
const applyVoucherMock = vi.fn();
const applyDirectDiscountMock = vi.fn();
const reverseAdjustmentMock = vi.fn();
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
    voidBill: (...args: unknown[]) => voidBillMock(...args),
    fetchVouchers: (...args: unknown[]) => fetchVouchersMock(...args),
    createVoucher: (...args: unknown[]) => createVoucherMock(...args),
    updateVoucherStatus: (...args: unknown[]) => updateVoucherStatusMock(...args),
    applyVoucher: (...args: unknown[]) => applyVoucherMock(...args),
    applyDirectDiscount: (...args: unknown[]) => applyDirectDiscountMock(...args),
    reverseAdjustment: (...args: unknown[]) => reverseAdjustmentMock(...args)
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
    fetchVouchersMock.mockReset();
    createVoucherMock.mockReset();
    updateVoucherStatusMock.mockReset();
    applyVoucherMock.mockReset();
    applyDirectDiscountMock.mockReset();
    reverseAdjustmentMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    fetchSessionBillingMock.mockResolvedValue(sessionBilling());
    fetchVouchersMock.mockResolvedValue({ items: [voucherFixture()] });
    createBillMock.mockResolvedValue(billFixture());
    issueBillMock.mockResolvedValue(billFixture({ status: "ISSUED" }));
    splitBillMock.mockResolvedValue({ sourceBill: billFixture({ items: [] }), bills: [billFixture(), billFixture({ id: "bill-3", billNumber: "BILL-003" })] });
    mergeBillsMock.mockResolvedValue(billFixture());
    voidBillMock.mockResolvedValue(billFixture({ status: "VOID", voidReason: "Hủy hóa đơn theo yêu cầu thu ngân" }));
    createVoucherMock.mockResolvedValue(voucherFixture());
    updateVoucherStatusMock.mockResolvedValue(voucherFixture({ status: "INACTIVE" }));
    applyVoucherMock.mockResolvedValue(billFixture({ voucherDiscountAmount: "5000", discountedAmount: "45000", vatAmount: "3600", total: "48600" }));
    applyDirectDiscountMock.mockResolvedValue(billFixture({ directDiscountAmount: "5000", discountedAmount: "45000", vatAmount: "3600", total: "48600" }));
    reverseAdjustmentMock.mockResolvedValue(billFixture());
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

  it("manages vouchers and applies bill discounts", async () => {
    await loadBilling();

    expect(await screen.findAllByText("SUMMER10")).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText("Mã voucher"), { target: { value: "NEW10" } });
    fireEvent.change(screen.getByPlaceholderText("Tên voucher"), { target: { value: "New voucher" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo voucher" }));
    await waitFor(() => expect(createVoucherMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Tắt" }));
    await waitFor(() => expect(updateVoucherStatusMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "voucher-id", "INACTIVE"));

    fireEvent.click(screen.getAllByRole("button", { name: "Discount" })[0]);
    fireEvent.change(screen.getAllByPlaceholderText("Mã voucher")[1], { target: { value: "SUMMER10" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng voucher" }));
    await waitFor(() => expect(applyVoucherMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1", "SUMMER10", ""));

    fireEvent.change(screen.getByPlaceholderText("Bắt buộc khi dùng voucher + direct discount"), { target: { value: "Manager override" } });
    fireEvent.change(screen.getByPlaceholderText("Lý do chiết khấu"), { target: { value: "Service recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chiết khấu" }));
    await waitFor(() => expect(applyDirectDiscountMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bill-1", "FIXED_AMOUNT", 1000, "Service recovery", "Manager override"));

    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    await waitFor(() => expect(reverseAdjustmentMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "adjustment-id", "Hoàn tác chiết khấu"));
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
    voucherDiscountAmount: overrides.voucherDiscountAmount ?? "0",
    directDiscountAmount: overrides.directDiscountAmount ?? "0",
    discountedAmount: overrides.discountedAmount ?? "50000",
    vatRate: "8",
    vatAmount: overrides.vatAmount ?? "4000",
    total: overrides.total ?? "54000",
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
    adjustments:
      overrides.adjustments ??
      [
        {
          id: "adjustment-id",
          billId: overrides.id ?? "bill-1",
          source: "VOUCHER",
          discountType: "PERCENT",
          discountValue: "10",
          discountAmount: "0",
          voucherId: "voucher-id",
          codeSnapshot: "SUMMER10",
          status: "ACTIVE",
          appliedById: "staff-id",
          reversedById: null,
          reversedAt: null,
          reverseReason: null,
          isOverride: false,
          overrideById: null,
          overrideReason: null,
          overrideBefore: null,
          overrideAfter: null,
          createdAt: new Date().toISOString()
        }
      ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function voucherFixture(overrides: Partial<import("./billing-api").Voucher> = {}) {
  return {
    id: "voucher-id",
    branchId: "branch-id",
    code: "SUMMER10",
    name: "Summer",
    discountType: "PERCENT" as const,
    discountValue: "10",
    maximumDiscount: null,
    minimumSubtotal: "0",
    usageLimit: null,
    startsAt: new Date().toISOString(),
    endsAt: null,
    status: overrides.status ?? ("ACTIVE" as const),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

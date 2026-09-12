import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarQueuePage, KitchenQueuePage } from "./QueuePages";

const fetchQueueMock = vi.fn();
const updateOrderItemStatusMock = vi.fn();
const cancelOrderItemMock = vi.fn();
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

vi.mock("./order-api", () => ({
  fetchQueue: (...args: unknown[]) => fetchQueueMock(...args),
  updateOrderItemStatus: (...args: unknown[]) => updateOrderItemStatusMock(...args),
  cancelOrderItem: (...args: unknown[]) => cancelOrderItemMock(...args)
}));

function renderQueue(element: React.ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("QueuePages", () => {
  beforeEach(() => {
    fetchQueueMock.mockReset();
    updateOrderItemStatusMock.mockReset();
    cancelOrderItemMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    fetchQueueMock.mockResolvedValue({ items: [queueItem()] });
    updateOrderItemStatusMock.mockResolvedValue({});
    cancelOrderItemMock.mockResolvedValue({});
    vi.spyOn(window, "prompt").mockReturnValue("Khách đổi món");
  });

  it("renders the bar queue and updates an item status", async () => {
    renderQueue(<BarQueuePage />);

    expect(await screen.findByText("1 x Bạc xỉu")).toBeInTheDocument();
    expect(fetchQueueMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "bar");
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu làm" }));

    await waitFor(() => expect(updateOrderItemStatusMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "item-id", "PREPARING"));
  });

  it("cancels an item with a staff reason", async () => {
    renderQueue(<KitchenQueuePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Hủy món" }));

    await waitFor(() => expect(cancelOrderItemMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "item-id", "Khách đổi món"));
  });

  it("shows queue loading and error states", async () => {
    fetchQueueMock.mockReturnValue(new Promise(() => undefined));
    renderQueue(<BarQueuePage />);
    expect(await screen.findByText("Đang tải queue...")).toBeInTheDocument();

    fetchQueueMock.mockReset();
    fetchQueueMock.mockRejectedValue(new Error("down"));
    renderQueue(<BarQueuePage />);
    expect(await screen.findByText("down")).toBeInTheDocument();
  });

  it("blocks staff without queue permission", () => {
    hasPermissionMock.mockImplementation((permission: string) => permission !== "BAR_QUEUE_READ");
    renderQueue(<BarQueuePage />);

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(fetchQueueMock).not.toHaveBeenCalled();
  });
});

function queueItem() {
  return {
    id: "item-id",
    orderId: "order-id",
    orderNumber: "ORD-1",
    tableSessionId: "session-id",
    table: { id: "table-id", code: "T01", displayName: "T01" },
    processingArea: "BAR",
    productNameSnapshot: "Bạc xỉu",
    quantity: 1,
    note: "Ít đá",
    status: "NEW",
    options: [{ id: "option-id", optionNameSnapshot: "Large", priceDeltaSnapshot: "5000.00" }],
    orderCreatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    elapsedSeconds: 120,
    urgency: "GREEN"
  };
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffServiceRequestPage } from "./ServiceRequestPage";

const fetchServiceRequestsMock = vi.fn();
const updateServiceRequestStatusMock = vi.fn();
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

vi.mock("./service-request-api", () => ({
  fetchServiceRequests: (...args: unknown[]) => fetchServiceRequestsMock(...args),
  updateServiceRequestStatus: (...args: unknown[]) => updateServiceRequestStatusMock(...args)
}));

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <StaffServiceRequestPage />
    </QueryClientProvider>
  );
}

describe("StaffServiceRequestPage", () => {
  beforeEach(() => {
    fetchServiceRequestsMock.mockReset();
    updateServiceRequestStatusMock.mockReset();
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    fetchServiceRequestsMock.mockResolvedValue({ items: [serviceRequest()] });
    updateServiceRequestStatusMock.mockResolvedValue(serviceRequest({ status: "ACKNOWLEDGED" }));
  });

  it("renders branch service requests and acknowledges a pending request", async () => {
    renderPage();

    expect(await screen.findByText("Gọi nhân viên")).toBeInTheDocument();
    expect(screen.getByText(/Bàn 1/)).toBeInTheDocument();
    expect(fetchServiceRequestsMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" });

    fireEvent.click(screen.getByRole("button", { name: "Nhận yêu cầu" }));

    await waitFor(() => expect(updateServiceRequestStatusMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "request-id", "ACKNOWLEDGED"));
    expect(await screen.findByText("Đã cập nhật yêu cầu.")).toBeInTheDocument();
  });

  it("resolves acknowledged requests", async () => {
    fetchServiceRequestsMock.mockResolvedValue({ items: [serviceRequest({ status: "ACKNOWLEDGED", type: "REQUEST_PAYMENT" })] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Hoàn tất" }));

    await waitFor(() => expect(updateServiceRequestStatusMock).toHaveBeenCalledWith({ accessToken: "staff-token", branchId: "branch-id" }, "request-id", "RESOLVED"));
  });

  it("shows loading, error and empty states", async () => {
    fetchServiceRequestsMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(await screen.findByText("Đang tải yêu cầu...")).toBeInTheDocument();

    fetchServiceRequestsMock.mockReset();
    fetchServiceRequestsMock.mockRejectedValue(new Error("down"));
    renderPage();
    expect(await screen.findByText("down")).toBeInTheDocument();

    fetchServiceRequestsMock.mockReset();
    fetchServiceRequestsMock.mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByText("Không có yêu cầu đang mở.")).toBeInTheDocument();
  });

  it("blocks staff without service request read permission", () => {
    hasPermissionMock.mockImplementation((permission: string) => permission !== "SERVICE_REQUEST_READ");
    renderPage();

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(fetchServiceRequestsMock).not.toHaveBeenCalled();
  });
});

function serviceRequest(overrides: Partial<{ status: "PENDING" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED"; type: "CALL_STAFF" | "REQUEST_PAYMENT" }> = {}) {
  return {
    id: "request-id",
    branchId: "branch-id",
    tableSessionId: "session-id",
    type: overrides.type ?? "CALL_STAFF",
    status: overrides.status ?? "PENDING",
    handledById: null,
    acknowledgedAt: overrides.status === "ACKNOWLEDGED" ? new Date().toISOString() : null,
    resolvedAt: null,
    table: { id: "table-id", code: "T01", displayName: "Bàn 1" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../services/api-client";
import { CustomerQrEntryPage } from "./CustomerQrEntryPage";

const createQrSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../admin/tables-api", async () => {
  const actual = await vi.importActual<typeof import("../admin/tables-api")>("../admin/tables-api");
  return {
    ...actual,
    createQrSession: (...args: unknown[]) => createQrSessionMock(...args)
  };
});

vi.mock("./CustomerMenuPage", () => ({
  CustomerMenuPage: ({ sessionLabel }: { sessionLabel?: string }) => <div>Menu for {sessionLabel}</div>
}));

describe("CustomerQrEntryPage", () => {
  beforeEach(() => {
    createQrSessionMock.mockReset();
    sessionStorage.clear();
  });

  it("shows loading while validating the QR token", () => {
    createQrSessionMock.mockReturnValue(new Promise(() => undefined));
    renderQr("/table/qr-token");

    expect(screen.getByText("Đang mở phiên bàn")).toBeInTheDocument();
    expect(screen.getByText("Hệ thống đang kiểm tra QR và bàn của bạn.")).toBeInTheDocument();
  });

  it("shows invalid QR errors from the API", async () => {
    createQrSessionMock.mockRejectedValue(new ApiClientError("INVALID_QR", "QR không hợp lệ", "req-id"));
    renderQr("/table/bad-token");

    expect(await screen.findByText("Không mở được QR")).toBeInTheDocument();
    expect(screen.getByText("QR không hợp lệ")).toBeInTheDocument();
  });

  it("shows inactive table errors from the API", async () => {
    createQrSessionMock.mockRejectedValue(new ApiClientError("TABLE_INACTIVE", "Bàn đang tạm ngưng", "req-id"));
    renderQr("/table/inactive-token");

    expect(await screen.findByText("Bàn đang tạm ngưng")).toBeInTheDocument();
  });

  it("joins an existing session and stores QR session context", async () => {
    createQrSessionMock.mockResolvedValue(qrSession);
    renderQr("/table/qr-token");

    expect(await screen.findByText("Main Branch")).toBeInTheDocument();
    expect(screen.getAllByText("Bàn 01 • ACTIVE")).not.toHaveLength(0);
    expect(screen.getByText("Menu for Bàn 01 • ACTIVE")).toBeInTheDocument();
    expect(createQrSessionMock).toHaveBeenCalledWith("qr-token");
    await waitFor(() => expect(sessionStorage.getItem("qrSessionToken")).toBe("signed-session-token"));
    expect(sessionStorage.getItem("qrBranchId")).toBe("branch-id");
  });
});

const qrSession = {
  qrSessionToken: "signed-session-token",
  branch: {
    id: "branch-id",
    code: "MAIN",
    name: "Main Branch",
    timezone: "Asia/Ho_Chi_Minh"
  },
  table: {
    code: "B01",
    displayName: "Bàn 01",
    status: "ACTIVE"
  },
  session: {
    id: "session-id",
    branchId: "branch-id",
    tableId: "table-id",
    sessionNumber: "S-0001",
    status: "ACTIVE",
    openedAt: "2026-09-12T01:00:00.000Z",
    paymentRequestedAt: null,
    lockedAt: null,
    lockReason: null,
    closedAt: null,
    durationSeconds: 120
  }
};

function renderQr(path: string): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/table/:qrToken" element={<CustomerQrEntryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

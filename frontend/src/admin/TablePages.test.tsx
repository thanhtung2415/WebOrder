import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../services/api-client";
import { TableManagementPage } from "./TablePages";
import type { DiningTable, QrCode, TableSessionSummary } from "./tables-api";

const useAdminContextMock = vi.hoisted(() => vi.fn());
const listTablesMock = vi.hoisted(() => vi.fn());
const createTableMock = vi.hoisted(() => vi.fn());
const updateTableMock = vi.hoisted(() => vi.fn());
const getTableQrMock = vi.hoisted(() => vi.fn());
const rotateTableQrMock = vi.hoisted(() => vi.fn());
const disableTableQrMock = vi.hoisted(() => vi.fn());
const lockTableSessionMock = vi.hoisted(() => vi.fn());
const unlockTableSessionMock = vi.hoisted(() => vi.fn());
const requestTableSessionPaymentMock = vi.hoisted(() => vi.fn());
const transferTableSessionMock = vi.hoisted(() => vi.fn());
const closeTableSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./admin-context", () => ({
  useAdminContext: () => useAdminContextMock()
}));

vi.mock("./tables-api", async () => {
  const actual = await vi.importActual<typeof import("./tables-api")>("./tables-api");
  return {
    ...actual,
    listTables: (...args: unknown[]) => listTablesMock(...args),
    createTable: (...args: unknown[]) => createTableMock(...args),
    updateTable: (...args: unknown[]) => updateTableMock(...args),
    getTableQr: (...args: unknown[]) => getTableQrMock(...args),
    rotateTableQr: (...args: unknown[]) => rotateTableQrMock(...args),
    disableTableQr: (...args: unknown[]) => disableTableQrMock(...args),
    lockTableSession: (...args: unknown[]) => lockTableSessionMock(...args),
    unlockTableSession: (...args: unknown[]) => unlockTableSessionMock(...args),
    requestTableSessionPayment: (...args: unknown[]) => requestTableSessionPaymentMock(...args),
    transferTableSession: (...args: unknown[]) => transferTableSessionMock(...args),
    closeTableSession: (...args: unknown[]) => closeTableSessionMock(...args)
  };
});

describe("TableManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("Khách cần hỗ trợ");
    mockPermissions(["TABLE_READ", "TABLE_MANAGE", "QR_MANAGE", "SESSION_MANAGE", "SESSION_TRANSFER", "SESSION_CLOSE"]);
    listTablesMock.mockResolvedValue([occupiedTable, availableTable]);
    createTableMock.mockResolvedValue(availableTable);
    updateTableMock.mockResolvedValue(availableTable);
    getTableQrMock.mockResolvedValue(qrCode);
    rotateTableQrMock.mockResolvedValue({ ...qrCode, token: "new-token", url: "http://localhost:5173/table/new-token" });
    disableTableQrMock.mockResolvedValue({ tableId: "table-a", disabled: true });
    lockTableSessionMock.mockResolvedValue({ ...openSession, status: "LOCKED" });
    unlockTableSessionMock.mockResolvedValue(openSession);
    requestTableSessionPaymentMock.mockResolvedValue({ ...openSession, status: "PAYMENT_REQUESTED" });
    transferTableSessionMock.mockResolvedValue({ ...openSession, tableId: "table-b" });
    closeTableSessionMock.mockResolvedValue({ ...openSession, status: "CLOSED", closedAt: "2026-09-12T01:00:00.000Z" });
  });

  it("renders forbidden state without table read permission", () => {
    mockPermissions([]);
    renderPage(<TableManagementPage />);

    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
  });

  it("renders table list with session and QR status indicators", async () => {
    renderPage(<TableManagementPage />);

    expect(await screen.findByText("B01 - Bàn 01")).toBeInTheDocument();
    expect(screen.getByText("B02 - Bàn 02")).toBeInTheDocument();
    expect(screen.getByText("S-0001")).toBeInTheDocument();
    expect(screen.getByText(/Opened .*12 phút/)).toBeInTheDocument();
    expect(screen.getByText("QR: ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("No open session")).toBeInTheDocument();
  });

  it("creates and edits a table", async () => {
    renderPage(<TableManagementPage />);

    fireEvent.change(await screen.findByPlaceholderText("Code"), { target: { value: "B03" } });
    fireEvent.change(screen.getByPlaceholderText("Display name"), { target: { value: "Bàn 03" } });
    const createForm = screen.getByRole("button", { name: "Create" }).closest("form");
    expect(createForm).not.toBeNull();
    fireEvent.change(within(createForm as HTMLElement).getByDisplayValue("4"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createTableMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), expect.objectContaining({ code: "B03", displayName: "Bàn 03", capacity: 6 }))
    );

    fireEvent.change(screen.getByLabelText("Name B01"), { target: { value: "Bàn chính" } });
    fireEvent.blur(screen.getByLabelText("Name B01"));

    await waitFor(() =>
      expect(updateTableMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "table-a", expect.objectContaining({ displayName: "Bàn chính" }))
    );
  });

  it("views rotates and disables QR", async () => {
    renderPage(<TableManagementPage />);

    const tableCard = (await screen.findByText("B01 - Bàn 01")).closest("article");
    expect(tableCard).not.toBeNull();
    const tableScope = within(tableCard as HTMLElement);

    fireEvent.click(tableScope.getByRole("button", { name: "View QR" }));
    expect(await screen.findByDisplayValue("http://localhost:5173/table/qr-token")).toBeInTheDocument();
    expect(getTableQrMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "table-a");

    fireEvent.click(tableScope.getByRole("button", { name: "Rotate QR" }));
    await waitFor(() => expect(rotateTableQrMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "table-a"));
    expect(await screen.findByDisplayValue("http://localhost:5173/table/new-token")).toBeInTheDocument();

    fireEvent.click(tableScope.getByRole("button", { name: "Disable QR" }));
    await waitFor(() => expect(disableTableQrMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "table-a"));
    expect(await screen.findByText("Đã vô hiệu hóa QR.")).toBeInTheDocument();
  });

  it("locks requests payment transfers and closes an open session", async () => {
    renderPage(<TableManagementPage />);

    const tableCard = (await screen.findByText("B01 - Bàn 01")).closest("article");
    expect(tableCard).not.toBeNull();
    const tableScope = within(tableCard as HTMLElement);

    fireEvent.click(tableScope.getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(lockTableSessionMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "session-a", "Khách cần hỗ trợ"));

    fireEvent.click(tableScope.getByRole("button", { name: "Payment Request" }));
    await waitFor(() => expect(requestTableSessionPaymentMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "session-a"));

    fireEvent.change(tableScope.getByLabelText("Transfer B01"), { target: { value: "table-b" } });
    fireEvent.click(tableScope.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(transferTableSessionMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "session-a", "table-b"));

    fireEvent.click(tableScope.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(closeTableSessionMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: "branch-id" }), "session-a", "Closed from table screen"));
  });

  it("renders backend authorization errors", async () => {
    listTablesMock.mockRejectedValueOnce(new ApiClientError("BRANCH_ACCESS_DENIED", "Không có quyền chi nhánh", "req-id"));
    renderPage(<TableManagementPage />);

    expect(await screen.findByText("Không có quyền chi nhánh")).toBeInTheDocument();
  });
});

const openSession: TableSessionSummary = {
  id: "session-a",
  branchId: "branch-id",
  tableId: "table-a",
  sessionNumber: "S-0001",
  status: "ACTIVE",
  openedAt: "2026-09-12T01:00:00.000Z",
  paymentRequestedAt: null,
  lockedAt: null,
  lockReason: null,
  closedAt: null,
  durationSeconds: 720
};

const occupiedTable: DiningTable = {
  id: "table-a",
  branchId: "branch-id",
  code: "B01",
  displayName: "Bàn 01",
  capacity: 4,
  status: "ACTIVE",
  derivedStatus: "OCCUPIED",
  currentSession: openSession,
  activeQr: { id: "qr-id", status: "ACTIVE", activatedAt: "2026-09-12T00:50:00.000Z" },
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T01:00:00.000Z"
};

const availableTable: DiningTable = {
  id: "table-b",
  branchId: "branch-id",
  code: "B02",
  displayName: "Bàn 02",
  capacity: 2,
  status: "ACTIVE",
  derivedStatus: "AVAILABLE",
  currentSession: null,
  activeQr: null,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T01:00:00.000Z"
};

const qrCode: QrCode = {
  id: "qr-id",
  tableId: "table-a",
  token: "qr-token",
  status: "ACTIVE",
  url: "http://localhost:5173/table/qr-token",
  activatedAt: "2026-09-12T00:50:00.000Z",
  disabledAt: null,
  createdAt: "2026-09-12T00:50:00.000Z"
};

function mockPermissions(permissions: string[]): void {
  useAdminContextMock.mockReturnValue({
    accessToken: "access-token",
    activeBranchId: "branch-id",
    me: {},
    hasPermission: (permission: string) => permissions.includes(permission)
  });
}

function renderPage(element: ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

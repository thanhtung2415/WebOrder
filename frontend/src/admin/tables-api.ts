import { apiClient } from "../services/api-client";
import { RequestContext } from "./menu-api";

export type TableStatus = "ACTIVE" | "INACTIVE" | "OUT_OF_SERVICE";
export type SessionStatus = "ACTIVE" | "PAYMENT_REQUESTED" | "LOCKED" | "CLOSED";
export type DerivedTableStatus = "AVAILABLE" | "OCCUPIED" | "INACTIVE" | "OUT_OF_SERVICE";

export interface TableSessionSummary {
  id: string;
  branchId: string;
  tableId: string;
  sessionNumber: string;
  status: SessionStatus;
  openedAt: string;
  paymentRequestedAt: string | null;
  lockedAt: string | null;
  lockReason: string | null;
  closedAt: string | null;
  durationSeconds: number | null;
}

export interface DiningTable {
  id: string;
  branchId: string;
  code: string;
  displayName: string;
  capacity: number | null;
  status: TableStatus;
  derivedStatus: DerivedTableStatus;
  currentSession: TableSessionSummary | null;
  activeQr: { id: string; status: "ACTIVE" | "DISABLED"; activatedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface QrCode {
  id: string;
  tableId: string;
  token: string;
  status: "ACTIVE" | "DISABLED";
  url: string;
  activatedAt: string;
  disabledAt: string | null;
  createdAt: string;
}

export interface QrSession {
  qrSessionToken: string;
  branch: { id: string; code: string; name: string; timezone: string };
  table: { code: string; displayName: string; status: TableStatus };
  session: TableSessionSummary;
}

export interface TablePayload {
  code: string;
  displayName: string;
  capacity?: number;
  status?: TableStatus;
}

function queryString(params: object): string {
  const query = new URLSearchParams();
  Object.entries(params as Record<string, string | number | boolean | null | undefined>).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function listTables(context: RequestContext, params: { q?: string; status?: TableStatus | "" } = {}): Promise<DiningTable[]> {
  const response = await apiClient.request<{ items: DiningTable[] }>(`/tables${queryString(params)}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createTable(context: RequestContext, payload: TablePayload): Promise<DiningTable> {
  const response = await apiClient.request<DiningTable>("/tables", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateTable(context: RequestContext, tableId: string, payload: Partial<TablePayload>): Promise<DiningTable> {
  const response = await apiClient.request<DiningTable>(`/tables/${tableId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function getTableQr(context: RequestContext, tableId: string): Promise<QrCode> {
  const response = await apiClient.request<QrCode>(`/tables/${tableId}/qr`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function rotateTableQr(context: RequestContext, tableId: string): Promise<QrCode> {
  const response = await apiClient.request<QrCode>(`/tables/${tableId}/qr-rotation`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}

export async function disableTableQr(context: RequestContext, tableId: string): Promise<{ tableId: string; disabled: boolean }> {
  const response = await apiClient.request<{ tableId: string; disabled: boolean }>(`/tables/${tableId}/qr-disablement`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}

export async function lockTableSession(context: RequestContext, sessionId: string, reason: string): Promise<TableSessionSummary> {
  const response = await apiClient.request<TableSessionSummary>(`/table-sessions/${sessionId}/lock`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { reason }
  });
  return response.data;
}

export async function unlockTableSession(context: RequestContext, sessionId: string): Promise<TableSessionSummary> {
  const response = await apiClient.request<TableSessionSummary>(`/table-sessions/${sessionId}/unlock`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}

export async function requestTableSessionPayment(context: RequestContext, sessionId: string): Promise<TableSessionSummary> {
  const response = await apiClient.request<TableSessionSummary>(`/table-sessions/${sessionId}/payment-request`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: {}
  });
  return response.data;
}

export async function transferTableSession(context: RequestContext, sessionId: string, destinationTableId: string): Promise<TableSessionSummary> {
  const response = await apiClient.request<TableSessionSummary>(`/table-sessions/${sessionId}/transfer`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { destinationTableId }
  });
  return response.data;
}

export async function closeTableSession(context: RequestContext, sessionId: string, reason?: string): Promise<TableSessionSummary> {
  const response = await apiClient.request<TableSessionSummary>(`/table-sessions/${sessionId}/closure`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { reason }
  });
  return response.data;
}

export async function createQrSession(qrToken: string): Promise<QrSession> {
  const response = await apiClient.request<QrSession>("/qr-sessions", {
    method: "POST",
    body: { qrToken }
  });
  return response.data;
}

export async function getQrSession(qrSessionToken: string): Promise<QrSession> {
  const response = await apiClient.request<QrSession>("/qr-sessions/current", {
    qrSessionToken
  });
  return response.data;
}

import { QrStatus, SessionStatus, TableStatus } from "@prisma/client";

export interface TableSessionSummaryResponse {
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

export interface TableResponse {
  id: string;
  branchId: string;
  code: string;
  displayName: string;
  capacity: number | null;
  status: TableStatus;
  derivedStatus: "AVAILABLE" | "OCCUPIED" | "INACTIVE" | "OUT_OF_SERVICE";
  currentSession: TableSessionSummaryResponse | null;
  activeQr: {
    id: string;
    status: QrStatus;
    activatedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TableListResponse {
  items: TableResponse[];
}

export interface QrCodeResponse {
  id: string;
  tableId: string;
  token: string;
  status: QrStatus;
  url: string;
  activatedAt: string;
  disabledAt: string | null;
  createdAt: string;
}

export interface QrSessionResponse {
  qrSessionToken: string;
  table: {
    code: string;
    displayName: string;
    status: TableStatus;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    timezone: string;
  };
  session: TableSessionSummaryResponse;
}

export interface QrSessionContext {
  branchId: string;
  tableId: string;
  tableSessionId: string;
}

export interface TableSessionListResponse {
  items: TableSessionSummaryResponse[];
}

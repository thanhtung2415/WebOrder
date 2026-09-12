import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactElement } from "react";
import { useMemo, useState } from "react";
import { ApiClientError } from "../services/api-client";
import { useAdminContext } from "./admin-context";
import {
  DiningTable,
  QrCode,
  TableStatus,
  closeTableSession,
  createTable,
  disableTableQr,
  getTableQr,
  listTables,
  lockTableSession,
  requestTableSessionPayment,
  rotateTableQr,
  transferTableSession,
  unlockTableSession,
  updateTable
} from "./tables-api";

const tableStatuses: TableStatus[] = ["ACTIVE", "INACTIVE", "OUT_OF_SERVICE"];

export function TableManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("TABLE_READ");
  const canManage = admin.hasPermission("TABLE_MANAGE");
  const canManageQr = admin.hasPermission("QR_MANAGE");
  const canManageSession = admin.hasPermission("SESSION_MANAGE");
  const canTransfer = admin.hasPermission("SESSION_TRANSFER");
  const canClose = admin.hasPermission("SESSION_CLOSE");
  const [filters, setFilters] = useState({ q: "", status: "" as TableStatus | "" });
  const [form, setForm] = useState({ code: "", displayName: "", capacity: "4", status: "ACTIVE" as TableStatus });
  const [qr, setQr] = useState<QrCode | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const tablesQuery = useQuery({
    queryKey: ["phase6-tables", context, filters],
    queryFn: () => listTables(context, filters),
    enabled: canRead
  });

  const tables = tablesQuery.data ?? [];
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["phase6-tables"] });
  };
  const createMutation = useMutation({
    mutationFn: () => createTable(context, { code: form.code, displayName: form.displayName, capacity: Number(form.capacity), status: form.status }),
    onSuccess: async () => {
      setForm({ code: "", displayName: "", capacity: "4", status: "ACTIVE" });
      setFeedback({ type: "success", message: "Đã tạo bàn." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const updateMutation = useMutation({
    mutationFn: ({ table, payload }: { table: DiningTable; payload: Partial<{ displayName: string; capacity: number; status: TableStatus }> }) => updateTable(context, table.id, payload),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật bàn." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const qrMutation = useMutation({
    mutationFn: (table: DiningTable) => getTableQr(context, table.id),
    onSuccess: setQr,
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const rotateMutation = useMutation({
    mutationFn: (table: DiningTable) => rotateTableQr(context, table.id),
    onSuccess: async (value) => {
      setQr(value);
      setFeedback({ type: "success", message: "Đã rotate QR." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const disableMutation = useMutation({
    mutationFn: (table: DiningTable) => disableTableQr(context, table.id),
    onSuccess: async () => {
      setQr(null);
      setFeedback({ type: "success", message: "Đã vô hiệu hóa QR." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const sessionMutation = useMutation({
    mutationFn: ({ action, table }: { action: "lock" | "unlock" | "payment" | "close"; table: DiningTable }) => {
      const sessionId = table.currentSession?.id ?? "";
      if (action === "lock") {
        const reason = window.prompt("Lý do lock session")?.trim() ?? "";
        return reason ? lockTableSession(context, sessionId, reason) : Promise.reject(new Error("Cần nhập lý do."));
      }
      if (action === "unlock") {
        return unlockTableSession(context, sessionId);
      }
      if (action === "payment") {
        return requestTableSessionPayment(context, sessionId);
      }
      return closeTableSession(context, sessionId, "Closed from table screen");
    },
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã cập nhật session." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const transferMutation = useMutation({
    mutationFn: ({ table, destinationTableId }: { table: DiningTable; destinationTableId: string }) => transferTableSession(context, table.currentSession?.id ?? "", destinationTableId),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Đã chuyển bàn." });
      await refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canManage && form.code.trim() && form.displayName.trim()) {
      createMutation.mutate();
    }
  }

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Tables</h1>
        <p className="mt-1 text-sm text-muted-foreground">Quản lý bàn, QR và phiên phục vụ hiện tại.</p>
      </div>
      <Feedback value={feedback} />
      <div className="flex flex-wrap gap-3">
        <input className={inputClass} placeholder="Search table" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <select className={inputClass} aria-label="Table status filter" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as TableStatus | "" })}>
          <option value="">ALL</option>
          {tableStatuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>
      {canManage ? (
        <form className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[120px_1fr_120px_170px_120px]" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          <input className={inputClass} min="1" type="number" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
          <select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TableStatus })}>
            {tableStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <button className={buttonClass} disabled={createMutation.isPending} type="submit">Create</button>
        </form>
      ) : null}
      <QueryState isLoading={tablesQuery.isLoading} error={tablesQuery.error} empty={tables.length === 0} />
      <div className="grid gap-3 lg:grid-cols-2">
        {tables.map((table) => (
          <article key={table.id} className="grid gap-4 rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{table.code} - {table.displayName}</h2>
                <p className="text-sm text-muted-foreground">Capacity {table.capacity ?? "-"} • {formatDate(table.updatedAt)}</p>
              </div>
              <StatusBadge label={table.derivedStatus} tone={table.derivedStatus === "OCCUPIED" ? "warn" : table.derivedStatus === "AVAILABLE" ? "good" : "danger"} />
            </div>
            {canManage ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_100px_170px]">
                <input className={inputClass} aria-label={`Name ${table.code}`} defaultValue={table.displayName} onBlur={(event) => event.target.value !== table.displayName && updateMutation.mutate({ table, payload: { displayName: event.target.value } })} />
                <input className={inputClass} aria-label={`Capacity ${table.code}`} defaultValue={table.capacity ?? ""} min="1" type="number" onBlur={(event) => updateMutation.mutate({ table, payload: { capacity: Number(event.target.value) || undefined } })} />
                <select className={inputClass} aria-label={`Status ${table.code}`} value={table.status} onChange={(event) => updateMutation.mutate({ table, payload: { status: event.target.value as TableStatus } })}>
                  {tableStatuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-2 text-sm">
              <span>QR: {table.activeQr ? "ACTIVE" : "NONE"}</span>
              {table.currentSession ? (
                <div className="rounded-md bg-muted p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{table.currentSession.sessionNumber}</span>
                    <StatusBadge label={table.currentSession.status} tone={table.currentSession.status === "LOCKED" ? "danger" : table.currentSession.status === "PAYMENT_REQUESTED" ? "warn" : "good"} />
                  </div>
                  <p className="mt-1 text-muted-foreground">Opened {formatDate(table.currentSession.openedAt)} • {formatDuration(table.currentSession.durationSeconds)}</p>
                </div>
              ) : (
                <p className="rounded-md bg-muted p-3 text-muted-foreground">No open session</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManageQr ? <button className={buttonClass} type="button" onClick={() => qrMutation.mutate(table)}>View QR</button> : null}
              {canManageQr ? <button className={buttonClass} type="button" onClick={() => window.confirm("Rotate QR?") && rotateMutation.mutate(table)}>Rotate QR</button> : null}
              {canManageQr ? <button className={buttonClass} type="button" onClick={() => window.confirm("Disable QR?") && disableMutation.mutate(table)}>Disable QR</button> : null}
              {table.currentSession && canManageSession ? <button className={buttonClass} type="button" onClick={() => sessionMutation.mutate({ table, action: table.currentSession?.status === "LOCKED" ? "unlock" : "lock" })}>{table.currentSession.status === "LOCKED" ? "Unlock" : "Lock"}</button> : null}
              {table.currentSession && canManageSession ? <button className={buttonClass} type="button" onClick={() => sessionMutation.mutate({ table, action: "payment" })}>Payment Request</button> : null}
              {table.currentSession && canTransfer ? <TransferButton table={table} tables={tables} onTransfer={(destinationTableId) => transferMutation.mutate({ table, destinationTableId })} /> : null}
              {table.currentSession && canClose ? <button className={buttonClass} type="button" onClick={() => window.confirm("Close session?") && sessionMutation.mutate({ table, action: "close" })}>Close</button> : null}
            </div>
          </article>
        ))}
      </div>
      {qr ? <QrPanel qr={qr} onClose={() => setQr(null)} /> : null}
    </section>
  );
}

function TransferButton({ table, tables, onTransfer }: { table: DiningTable; tables: DiningTable[]; onTransfer: (destinationTableId: string) => void }): ReactElement {
  const [destinationTableId, setDestinationTableId] = useState("");
  const destinations = tables.filter((candidate) => candidate.id !== table.id && candidate.status === "ACTIVE" && candidate.derivedStatus === "AVAILABLE");
  return (
    <span className="inline-flex flex-wrap gap-2">
      <select className={inputClass} aria-label={`Transfer ${table.code}`} value={destinationTableId} onChange={(event) => setDestinationTableId(event.target.value)}>
        <option value="">Destination</option>
        {destinations.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{candidate.code}</option>
        ))}
      </select>
      <button className={buttonClass} disabled={!destinationTableId} type="button" onClick={() => onTransfer(destinationTableId)}>Transfer</button>
    </span>
  );
}

function QrPanel({ qr, onClose }: { qr: QrCode; onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <section className="grid w-full max-w-md gap-4 rounded-md border border-border bg-background p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Table QR</h2>
            <p className="text-sm text-muted-foreground">{qr.status} • {formatDate(qr.activatedAt)}</p>
          </div>
          <button className={buttonClass} type="button" onClick={onClose}>Close</button>
        </div>
        <div className="grid aspect-square place-items-center rounded-md border border-border bg-muted text-center text-xs font-medium">
          <span className="break-all px-6">{qr.token}</span>
        </div>
        <input className={inputClass} readOnly value={qr.url} />
        <button className={buttonClass} type="button" onClick={() => window.print()}>Print</button>
      </section>
    </div>
  );
}

type FeedbackState = { type: "success" | "error"; message: string } | null;

function QueryState({ isLoading, error, empty }: { isLoading: boolean; error: unknown; empty: boolean }): ReactElement | null {
  if (isLoading) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải dữ liệu...</p>;
  }
  if (error) {
    return <p className="rounded-md border border-border p-4 text-sm text-red-600">{errorMessage(error)}</p>;
  }
  if (empty) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có bàn.</p>;
  }
  return null;
}

function ForbiddenPanel(): ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-md border border-border p-4">
        <h1 className="text-lg font-semibold">Không có quyền truy cập</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tài khoản hiện tại không có permission cho màn hình này.</p>
      </div>
    </section>
  );
}

function Feedback({ value }: { value: FeedbackState }): ReactElement | null {
  if (!value) {
    return null;
  }
  return <p className={`rounded-md border border-border p-3 text-sm ${value.type === "error" ? "text-red-600" : "text-green-700 dark:text-green-300"}`}>{value.message}</p>;
}

function StatusBadge({ label, tone }: { label: string; tone: "good" | "warn" | "danger" }): ReactElement {
  const toneClass = tone === "good" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" : tone === "warn" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${toneClass}`}>{label}</span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  const minutes = Math.floor(value / 60);
  return `${minutes} phút`;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Không xử lý được yêu cầu.";
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";
const buttonClass = "inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

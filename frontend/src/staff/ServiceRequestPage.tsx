import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { useAdminContext } from "../admin/admin-context";
import type { ServiceRequest, ServiceRequestStatus, ServiceRequestType } from "../customer/customer-service-request-api";
import { useOrderRealtime } from "../orders/use-order-realtime";
import { ApiClientError } from "../services/api-client";
import { fetchServiceRequests, updateServiceRequestStatus } from "./service-request-api";

export function StaffServiceRequestPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("SERVICE_REQUEST_READ");
  const canHandle = admin.hasPermission("SERVICE_REQUEST_HANDLE");
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const requestQuery = useQuery({
    queryKey: ["service-requests", context],
    queryFn: () => fetchServiceRequests(context),
    enabled: canRead,
    refetchInterval: 5_000
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
  }, [queryClient]);
  useOrderRealtime(admin.activeBranchId, refresh);

  const statusMutation = useMutation({
    mutationFn: ({ requestId, status }: { requestId: string; status: Extract<ServiceRequestStatus, "ACKNOWLEDGED" | "RESOLVED"> }) =>
      updateServiceRequestStatus(context, requestId, status),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã cập nhật yêu cầu." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  const items = requestQuery.data?.items ?? [];
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Yêu cầu phục vụ</h1>
          <p className="mt-1 text-sm text-muted-foreground">Theo dõi khách gọi nhân viên và yêu cầu thanh toán.</p>
        </div>
        <button className={buttonClass} type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      <Feedback value={feedback} />
      {requestQuery.isLoading ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải yêu cầu...</p> : null}
      {requestQuery.error ? <p className="rounded-md border border-border p-4 text-sm text-red-600">{errorMessage(requestQuery.error)}</p> : null}
      {!requestQuery.isLoading && !items.length ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Không có yêu cầu đang mở.</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <ServiceRequestCard
            key={item.id}
            item={item}
            canHandle={canHandle}
            isBusy={statusMutation.isPending}
            onStatus={(status) => statusMutation.mutate({ requestId: item.id, status })}
          />
        ))}
      </div>
    </section>
  );
}

function ServiceRequestCard({
  item,
  canHandle,
  isBusy,
  onStatus
}: {
  item: ServiceRequest;
  canHandle: boolean;
  isBusy: boolean;
  onStatus: (status: Extract<ServiceRequestStatus, "ACKNOWLEDGED" | "RESOLVED">) => void;
}): ReactElement {
  return (
    <article className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{typeLabel(item.type)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.table.displayName} • {formatTime(item.createdAt)}
          </p>
        </div>
        <StatusPill status={item.status} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {item.status === "PENDING" && canHandle ? (
          <button className={buttonClass} type="button" disabled={isBusy} onClick={() => onStatus("ACKNOWLEDGED")}>
            Nhận yêu cầu
          </button>
        ) : null}
        {item.status === "ACKNOWLEDGED" && canHandle ? (
          <button className={buttonClass} type="button" disabled={isBusy} onClick={() => onStatus("RESOLVED")}>
            Hoàn tất
          </button>
        ) : null}
      </div>
    </article>
  );
}

type FeedbackState = { type: "success" | "error"; message: string } | null;

function Feedback({ value }: { value: FeedbackState }): ReactElement | null {
  if (!value) {
    return null;
  }
  return <p className={`rounded-md border border-border p-3 text-sm ${value.type === "error" ? "text-red-600" : "text-green-700 dark:text-green-300"}`}>{value.message}</p>;
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

function StatusPill({ status }: { status: ServiceRequestStatus }): ReactElement {
  const tone = status === "PENDING" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" : status === "ACKNOWLEDGED" ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone}`}>{statusLabel(status)}</span>;
}

function typeLabel(type: ServiceRequestType): string {
  return type === "CALL_STAFF" ? "Gọi nhân viên" : "Yêu cầu thanh toán";
}

function statusLabel(status: ServiceRequestStatus): string {
  const labels: Record<ServiceRequestStatus, string> = {
    PENDING: "Đang chờ",
    ACKNOWLEDGED: "Đã nhận",
    RESOLVED: "Đã xong",
    CANCELLED: "Đã hủy"
  };
  return labels[status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Không xử lý được yêu cầu.";
}

const buttonClass = "inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

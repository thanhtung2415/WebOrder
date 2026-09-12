import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { useAdminContext } from "../admin/admin-context";
import { useOrderRealtime } from "../orders/use-order-realtime";
import { ApiClientError } from "../services/api-client";
import { cancelOrderItem, fetchQueue, updateOrderItemStatus, type QueueItem } from "./order-api";
import type { OrderItemStatus, ProcessingArea } from "../customer/customer-order-api";

export function BarQueuePage(): ReactElement {
  return <QueuePage area="BAR" title="Bar Queue" />;
}

export function KitchenQueuePage(): ReactElement {
  return <QueuePage area="KITCHEN" title="Kitchen Queue" />;
}

function QueuePage({ area, title }: { area: ProcessingArea; title: string }): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const queueKey = ["order-queue", area, context];
  const canRead = admin.hasPermission(area === "BAR" ? "BAR_QUEUE_READ" : "KITCHEN_QUEUE_READ");
  const canUpdate = admin.hasPermission("ORDER_STATUS_UPDATE");
  const canCancel = admin.hasPermission("ORDER_CANCEL");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [ticket, setTicket] = useState<QueueItem | null>(null);

  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchQueue(context, area.toLowerCase() as Lowercase<ProcessingArea>),
    enabled: canRead,
    refetchInterval: 5_000
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["order-queue", area] });
  }, [area, queryClient]);
  useOrderRealtime(admin.activeBranchId, refresh);

  const statusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: OrderItemStatus }) => updateOrderItemStatus(context, itemId, status),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã cập nhật trạng thái." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });
  const cancelMutation = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: string }) => cancelOrderItem(context, itemId, reason),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã hủy món." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  const items = queueQuery.data?.items ?? [];
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Theo dõi món đang chờ, đang làm và sẵn sàng phục vụ.</p>
        </div>
        <button className={buttonClass} type="button" onClick={refresh}>Refresh</button>
      </div>
      <Feedback value={feedback} />
      {queueQuery.isLoading ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải queue...</p> : null}
      {queueQuery.error ? <p className="rounded-md border border-border p-4 text-sm text-red-600">{errorMessage(queueQuery.error)}</p> : null}
      {!queueQuery.isLoading && !items.length ? <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Không có món trong queue.</p> : null}
      <div className="grid gap-3 xl:grid-cols-2">
        {items.map((item) => (
          <QueueCard
            key={item.id}
            item={item}
            canUpdate={canUpdate}
            canCancel={canCancel}
            isBusy={statusMutation.isPending || cancelMutation.isPending}
            onStatus={(status) => statusMutation.mutate({ itemId: item.id, status })}
            onCancel={(reason) => cancelMutation.mutate({ itemId: item.id, reason })}
            onTicket={() => setTicket(item)}
          />
        ))}
      </div>
      {ticket ? <TicketDialog item={ticket} onClose={() => setTicket(null)} /> : null}
    </section>
  );
}

function QueueCard({
  item,
  canUpdate,
  canCancel,
  isBusy,
  onStatus,
  onCancel,
  onTicket
}: {
  item: QueueItem;
  canUpdate: boolean;
  canCancel: boolean;
  isBusy: boolean;
  onStatus: (status: OrderItemStatus) => void;
  onCancel: (reason: string) => void;
  onTicket: () => void;
}): ReactElement {
  const nextStatus = nextStatusFor(item.status);
  const cancel = (): void => {
    const reason = window.prompt("Lý do hủy món")?.trim();
    if (reason) {
      onCancel(reason);
    }
  };
  return (
    <article className={`grid gap-4 rounded-md border p-4 ${urgencyClass(item.urgency)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{item.quantity} x {item.productNameSnapshot}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{item.table.displayName} • {item.orderNumber}</p>
        </div>
        <span className="rounded-md bg-background/70 px-2 py-1 text-xs font-semibold">{urgencyLabel(item.urgency, item.elapsedSeconds)}</span>
      </div>
      {item.options.length ? <p className="text-sm text-muted-foreground">{item.options.map((option) => option.optionNameSnapshot).join(", ")}</p> : null}
      {item.note ? <p className="rounded-md bg-background/70 p-3 text-sm">{item.note}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={item.status} />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} type="button" onClick={onTicket}>Ticket</button>
          {nextStatus && canUpdate ? <button className={buttonClass} type="button" disabled={isBusy} onClick={() => onStatus(nextStatus)}>{statusActionLabel(nextStatus)}</button> : null}
          {canCancel && item.status !== "SERVED" ? <button className={buttonClass} type="button" disabled={isBusy} onClick={cancel}>Hủy món</button> : null}
        </div>
      </div>
    </article>
  );
}

function TicketDialog({ item, onClose }: { item: QueueItem; onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <section className="grid w-full max-w-sm gap-4 rounded-md border border-border bg-background p-4 shadow-lg print:border-0 print:shadow-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{item.orderNumber}</h2>
            <p className="text-sm text-muted-foreground">{item.table.displayName}</p>
          </div>
          <button className={buttonClass} type="button" onClick={onClose}>Đóng</button>
        </div>
        <div className="grid gap-2 border-y border-dashed border-border py-3">
          <p className="text-xl font-semibold">{item.quantity} x {item.productNameSnapshot}</p>
          {item.options.length ? <p className="text-sm">{item.options.map((option) => option.optionNameSnapshot).join(", ")}</p> : null}
          {item.note ? <p className="text-sm">Ghi chú: {item.note}</p> : null}
        </div>
        <button className={buttonClass} type="button" onClick={() => window.print()}>Print</button>
      </section>
    </div>
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

function StatusPill({ status }: { status: OrderItemStatus }): ReactElement {
  const tone = status === "READY" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" : status === "PREPARING" ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone}`}>{statusLabel(status)}</span>;
}

function nextStatusFor(status: OrderItemStatus): OrderItemStatus | null {
  if (status === "NEW") {
    return "PREPARING";
  }
  if (status === "PREPARING") {
    return "READY";
  }
  if (status === "READY") {
    return "SERVED";
  }
  return null;
}

function statusActionLabel(status: OrderItemStatus): string {
  if (status === "PREPARING") {
    return "Bắt đầu làm";
  }
  if (status === "READY") {
    return "Sẵn sàng";
  }
  return "Đã phục vụ";
}

function statusLabel(status: OrderItemStatus): string {
  const labels: Record<OrderItemStatus, string> = {
    NEW: "Mới",
    PREPARING: "Đang làm",
    READY: "Sẵn sàng",
    SERVED: "Đã phục vụ",
    CANCELLED: "Đã hủy"
  };
  return labels[status];
}

function urgencyClass(urgency: QueueItem["urgency"]): string {
  if (urgency === "GREEN") {
    return "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/30";
  }
  if (urgency === "ORANGE") {
    return "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30";
  }
  if (urgency === "RED") {
    return "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30";
  }
  return "border-red-600 bg-red-100 dark:border-red-700 dark:bg-red-950/50";
}

function urgencyLabel(urgency: QueueItem["urgency"], elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  return urgency === "OVERDUE" ? `Trễ ${minutes}p` : `${minutes}p`;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Không xử lý được yêu cầu.";
}

const buttonClass = "inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

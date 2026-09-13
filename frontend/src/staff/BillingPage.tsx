import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { useAdminContext } from "../admin/admin-context";
import { useOrderRealtime } from "../orders/use-order-realtime";
import { ApiClientError } from "../services/api-client";
import type { Bill, BillAdjustment, BillItem, BillStatus, DiscountType, SessionBilling, Voucher, VoucherStatus } from "./billing-api";
import { applyDirectDiscount, applyVoucher, createBill, createVoucher, fetchSessionBilling, fetchVouchers, issueBill, mergeBills, reverseAdjustment, splitBill, updateVoucherStatus, voidBill } from "./billing-api";

type FeedbackState = { type: "success" | "error"; message: string } | null;

export function BillingPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const canRead = admin.hasPermission("BILL_READ");
  const canManage = admin.hasPermission("BILL_MANAGE");
  const canIssue = admin.hasPermission("BILL_ISSUE");
  const canSplit = admin.hasPermission("BILL_SPLIT");
  const canMerge = admin.hasPermission("BILL_MERGE");
  const canVoid = admin.hasPermission("BILL_VOID");
  const canVoucherManage = admin.hasPermission("VOUCHER_MANAGE");
  const canDiscountApply = admin.hasPermission("DISCOUNT_APPLY");
  const canDiscountOverride = admin.hasPermission("DISCOUNT_OVERRIDE");
  const [tableSessionId, setTableSessionId] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [splitBillId, setSplitBillId] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<Record<string, number>>({});
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeReason, setMergeReason] = useState("Gộp hóa đơn theo yêu cầu thu ngân");
  const [voidReason, setVoidReason] = useState("Hủy hóa đơn theo yêu cầu thu ngân");
  const [discountBillId, setDiscountBillId] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [directDiscountType, setDirectDiscountType] = useState<DiscountType>("FIXED_AMOUNT");
  const [directDiscountValue, setDirectDiscountValue] = useState(1000);
  const [directDiscountReason, setDirectDiscountReason] = useState("Chiết khấu trực tiếp");
  const [overrideReason, setOverrideReason] = useState("");
  const [reverseReason, setReverseReason] = useState("Hoàn tác chiết khấu");
  const [voucherDraft, setVoucherDraft] = useState({
    code: "",
    name: "",
    discountType: "FIXED_AMOUNT" as DiscountType,
    discountValue: 1000,
    maximumDiscount: "",
    minimumSubtotal: 0,
    usageLimit: "",
    startsAt: toLocalInputValue(new Date()),
    endsAt: "",
    status: "ACTIVE" as VoucherStatus
  });

  const trimmedSessionId = tableSessionId.trim();
  const billingQuery = useQuery({
    queryKey: ["billing", context, trimmedSessionId],
    queryFn: () => fetchSessionBilling(context, trimmedSessionId),
    enabled: canRead && trimmedSessionId.length > 0,
    refetchInterval: trimmedSessionId ? 5_000 : false
  });
  const voucherQuery = useQuery({
    queryKey: ["vouchers", context],
    queryFn: () => fetchVouchers(context),
    enabled: canVoucherManage
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["billing"] });
    void queryClient.invalidateQueries({ queryKey: ["vouchers"] });
  }, [queryClient]);
  useOrderRealtime(admin.activeBranchId, refresh);

  const createMutation = useMutation({
    mutationFn: () => createBill(context, trimmedSessionId),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã tạo bill nháp." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const issueMutation = useMutation({
    mutationFn: (billId: string) => issueBill(context, billId),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã phát hành bill." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const splitMutation = useMutation({
    mutationFn: (bill: Bill) => splitBill(context, bill.id, buildSplitParts(bill, splitDraft)),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã tách bill." });
      setSplitBillId(null);
      setSplitDraft({});
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const mergeMutation = useMutation({
    mutationFn: () => {
      if (!mergeTargetId) {
        throw new Error("Chưa chọn bill đích.");
      }
      return mergeBills(context, mergeTargetId, mergeSourceIds.filter((billId) => billId !== mergeTargetId), mergeReason.trim());
    },
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã gộp bill." });
      setMergeSourceIds([]);
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const voidMutation = useMutation({
    mutationFn: (billId: string) => voidBill(context, billId, voidReason.trim()),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã hủy bill." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const voucherCreateMutation = useMutation({
    mutationFn: () =>
      createVoucher(context, {
        code: voucherDraft.code,
        name: voucherDraft.name,
        discountType: voucherDraft.discountType,
        discountValue: voucherDraft.discountValue,
        ...(voucherDraft.maximumDiscount.trim() ? { maximumDiscount: Number(voucherDraft.maximumDiscount) } : {}),
        minimumSubtotal: voucherDraft.minimumSubtotal,
        ...(voucherDraft.usageLimit.trim() ? { usageLimit: Number(voucherDraft.usageLimit) } : {}),
        startsAt: new Date(voucherDraft.startsAt).toISOString(),
        ...(voucherDraft.endsAt.trim() ? { endsAt: new Date(voucherDraft.endsAt).toISOString() } : {}),
        status: voucherDraft.status
      }),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã tạo voucher." });
      setVoucherDraft((current) => ({ ...current, code: "", name: "" }));
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const voucherStatusMutation = useMutation({
    mutationFn: ({ voucherId, status }: { voucherId: string; status: "ACTIVE" | "INACTIVE" }) => updateVoucherStatus(context, voucherId, status),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã cập nhật voucher." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const applyVoucherMutation = useMutation({
    mutationFn: (billId: string) => applyVoucher(context, billId, voucherCode, overrideReason),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã áp dụng voucher." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const directDiscountMutation = useMutation({
    mutationFn: (billId: string) => applyDirectDiscount(context, billId, directDiscountType, directDiscountValue, directDiscountReason, overrideReason),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã áp dụng chiết khấu." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  const reverseAdjustmentMutation = useMutation({
    mutationFn: (adjustmentId: string) => reverseAdjustment(context, adjustmentId, reverseReason),
    onSuccess: () => {
      setFeedback({ type: "success", message: "Đã hoàn tác adjustment." });
      refresh();
    },
    onError: (error) => setFeedback({ type: "error", message: errorMessage(error) })
  });

  if (!canRead) {
    return <ForbiddenPanel />;
  }

  const billing = billingQuery.data;
  const mutableBills = billing?.bills.filter(isMutableBill) ?? [];
  const splitTarget = billing?.bills.find((bill) => bill.id === splitBillId) ?? null;
  const discountTarget = billing?.bills.find((bill) => bill.id === discountBillId) ?? null;
  const isBusy =
    createMutation.isPending ||
    issueMutation.isPending ||
    splitMutation.isPending ||
    mergeMutation.isPending ||
    voidMutation.isPending ||
    voucherCreateMutation.isPending ||
    voucherStatusMutation.isPending ||
    applyVoucherMutation.isPending ||
    directDiscountMutation.isPending ||
    reverseAdjustmentMutation.isPending;

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quản lý bill theo phiên bàn, tách/gộp/hủy trước khi thanh toán.</p>
        </div>
        <button className={buttonClass} type="button" disabled={!trimmedSessionId} onClick={refresh}>
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[1fr_auto] md:items-end">
        <label className="grid gap-2 text-sm font-medium">
          Table session ID
          <input
            className={inputClass}
            placeholder="Dán tableSessionId đang mở"
            value={tableSessionId}
            onChange={(event) => setTableSessionId(event.target.value)}
          />
        </label>
        <button className={buttonClass} type="button" disabled={!trimmedSessionId || billingQuery.isFetching} onClick={refresh}>
          Tải bill
        </button>
      </div>

      <Feedback value={feedback} />
      {!trimmedSessionId ? <p className={panelClass}>Nhập table session ID để xem bill của bàn.</p> : null}
      {billingQuery.isLoading ? <p className={panelClass}>Đang tải bill...</p> : null}
      {billingQuery.error ? <p className="rounded-md border border-border p-4 text-sm text-red-600">{errorMessage(billingQuery.error)}</p> : null}

      {billing ? (
        <>
          {canVoucherManage ? (
            <VoucherManagementPanel
              vouchers={voucherQuery.data?.items ?? []}
              draft={voucherDraft}
              isLoading={voucherQuery.isLoading}
              isBusy={isBusy}
              onDraft={setVoucherDraft}
              onCreate={() => voucherCreateMutation.mutate()}
              onStatus={(voucherId, status) => voucherStatusMutation.mutate({ voucherId, status })}
            />
          ) : null}
          <UnbilledPanel billing={billing} canManage={canManage} isBusy={isBusy} onCreate={() => createMutation.mutate()} />
          <MergePanel
            bills={mutableBills}
            targetId={mergeTargetId}
            sourceIds={mergeSourceIds}
            reason={mergeReason}
            canMerge={canMerge}
            isBusy={isBusy}
            onTarget={setMergeTargetId}
            onReason={setMergeReason}
            onToggleSource={(billId) => setMergeSourceIds((current) => toggleSource(current, billId, mergeTargetId))}
            onMerge={() => mergeMutation.mutate()}
          />
          <SplitPanel
            bill={splitTarget}
            draft={splitDraft}
            canSplit={canSplit}
            isBusy={isBusy}
            onChange={(itemId, quantity) => setSplitDraft((current) => ({ ...current, [itemId]: quantity }))}
            onCancel={() => {
              setSplitBillId(null);
              setSplitDraft({});
            }}
            onSubmit={() => splitTarget && splitMutation.mutate(splitTarget)}
          />
          <DiscountPanel
            bill={discountTarget}
            canApply={canDiscountApply}
            canOverride={canDiscountOverride}
            isBusy={isBusy}
            voucherCode={voucherCode}
            directDiscountType={directDiscountType}
            directDiscountValue={directDiscountValue}
            directDiscountReason={directDiscountReason}
            overrideReason={overrideReason}
            reverseReason={reverseReason}
            onVoucherCode={setVoucherCode}
            onDirectDiscountType={setDirectDiscountType}
            onDirectDiscountValue={setDirectDiscountValue}
            onDirectDiscountReason={setDirectDiscountReason}
            onOverrideReason={setOverrideReason}
            onReverseReason={setReverseReason}
            onApplyVoucher={() => discountTarget && applyVoucherMutation.mutate(discountTarget.id)}
            onApplyDirect={() => discountTarget && directDiscountMutation.mutate(discountTarget.id)}
            onReverse={(adjustmentId) => reverseAdjustmentMutation.mutate(adjustmentId)}
            onClose={() => setDiscountBillId(null)}
          />
          <section className="grid gap-3 lg:grid-cols-2">
            {billing.bills.length ? (
              billing.bills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  canIssue={canIssue}
                  canSplit={canSplit}
                  canVoid={canVoid}
                  canDiscountApply={canDiscountApply}
                  isBusy={isBusy}
                  voidReason={voidReason}
                  onVoidReason={setVoidReason}
                  onIssue={() => issueMutation.mutate(bill.id)}
                  onSplit={() => {
                    setSplitBillId(bill.id);
                    setSplitDraft(defaultSplitDraft(bill));
                  }}
                  onDiscount={() => setDiscountBillId(bill.id)}
                  onVoid={() => voidMutation.mutate(bill.id)}
                />
              ))
            ) : (
              <p className={panelClass}>Chưa có bill cho phiên bàn này.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function UnbilledPanel({
  billing,
  canManage,
  isBusy,
  onCreate
}: {
  billing: SessionBilling;
  canManage: boolean;
  isBusy: boolean;
  onCreate: () => void;
}): ReactElement {
  return (
    <section className="grid gap-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Món chưa lên bill</h2>
        {canManage ? (
          <button className={buttonClass} type="button" disabled={isBusy || billing.unbilledItems.length === 0} onClick={onCreate}>
            Tạo bill nháp
          </button>
        ) : null}
      </div>
      {billing.unbilledItems.length ? (
        <div className="grid gap-2">
          {billing.unbilledItems.map((item) => (
            <div key={item.orderItemId} className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-[1fr_repeat(4,auto)] md:items-center md:gap-4">
              <span className="font-medium">{item.productNameSnapshot}</span>
              <span>Đã order: {item.orderedQuantity}</span>
              <span>Đã bill: {item.billedQuantity}</span>
              <span>Còn: {item.remainingQuantity}</span>
              <span>{formatMoney(item.remainingAmount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Không còn món chưa lên bill.</p>
      )}
    </section>
  );
}

function VoucherManagementPanel({
  vouchers,
  draft,
  isLoading,
  isBusy,
  onDraft,
  onCreate,
  onStatus
}: {
  vouchers: Voucher[];
  draft: {
    code: string;
    name: string;
    discountType: DiscountType;
    discountValue: number;
    maximumDiscount: string;
    minimumSubtotal: number;
    usageLimit: string;
    startsAt: string;
    endsAt: string;
    status: VoucherStatus;
  };
  isLoading: boolean;
  isBusy: boolean;
  onDraft: (draft: {
    code: string;
    name: string;
    discountType: DiscountType;
    discountValue: number;
    maximumDiscount: string;
    minimumSubtotal: number;
    usageLimit: string;
    startsAt: string;
    endsAt: string;
    status: VoucherStatus;
  }) => void;
  onCreate: () => void;
  onStatus: (voucherId: string, status: "ACTIVE" | "INACTIVE") => void;
}): ReactElement {
  const canCreate = Boolean(draft.code.trim() && draft.name.trim() && draft.discountValue > 0 && draft.startsAt);
  return (
    <section className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Voucher</h2>
        <button className={buttonClass} type="button" disabled={isBusy || !canCreate} onClick={onCreate}>
          Tạo voucher
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <input className={inputClass} placeholder="Mã voucher" value={draft.code} onChange={(event) => onDraft({ ...draft, code: event.target.value })} />
        <input className={inputClass} placeholder="Tên voucher" value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
        <select className={inputClass} value={draft.discountType} onChange={(event) => onDraft({ ...draft, discountType: event.target.value as DiscountType })}>
          <option value="FIXED_AMOUNT">Giảm tiền</option>
          <option value="PERCENT">Giảm %</option>
        </select>
        <input className={inputClass} min={1} type="number" value={draft.discountValue} onChange={(event) => onDraft({ ...draft, discountValue: positiveNumber(event.target.value, 1) })} />
        <input className={inputClass} placeholder="Giảm tối đa" value={draft.maximumDiscount} onChange={(event) => onDraft({ ...draft, maximumDiscount: event.target.value })} />
        <input className={inputClass} min={0} type="number" value={draft.minimumSubtotal} onChange={(event) => onDraft({ ...draft, minimumSubtotal: positiveNumber(event.target.value, 0) })} />
        <input className={inputClass} placeholder="Giới hạn lượt" value={draft.usageLimit} onChange={(event) => onDraft({ ...draft, usageLimit: event.target.value })} />
        <select className={inputClass} value={draft.status} onChange={(event) => onDraft({ ...draft, status: event.target.value as VoucherStatus })}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Bắt đầu
          <input className={inputClass} type="datetime-local" value={draft.startsAt} onChange={(event) => onDraft({ ...draft, startsAt: event.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Kết thúc
          <input className={inputClass} type="datetime-local" value={draft.endsAt} onChange={(event) => onDraft({ ...draft, endsAt: event.target.value })} />
        </label>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Đang tải voucher...</p> : null}
      <div className="grid gap-2">
        {vouchers.map((voucher) => (
          <div key={voucher.id} className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-[1fr_repeat(5,auto)] md:items-center md:gap-4">
            <span className="font-medium">{voucher.code}</span>
            <span>{voucher.name}</span>
            <span>{discountLabel(voucher.discountType, voucher.discountValue)}</span>
            <span>Tối thiểu {formatMoney(voucher.minimumSubtotal)}</span>
            <span>{voucher.status}</span>
            <button className={buttonClass} type="button" disabled={isBusy} onClick={() => onStatus(voucher.id, voucher.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>
              {voucher.status === "ACTIVE" ? "Tắt" : "Bật"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MergePanel({
  bills,
  targetId,
  sourceIds,
  reason,
  canMerge,
  isBusy,
  onTarget,
  onReason,
  onToggleSource,
  onMerge
}: {
  bills: Bill[];
  targetId: string | null;
  sourceIds: string[];
  reason: string;
  canMerge: boolean;
  isBusy: boolean;
  onTarget: (billId: string | null) => void;
  onReason: (reason: string) => void;
  onToggleSource: (billId: string) => void;
  onMerge: () => void;
}): ReactElement | null {
  if (!canMerge || bills.length < 2) {
    return null;
  }
  const cleanSourceIds = sourceIds.filter((billId) => billId !== targetId);
  return (
    <section className="grid gap-3 rounded-md border border-border p-4">
      <h2 className="text-lg font-semibold">Gộp bill</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Bill đích
          <select className={inputClass} value={targetId ?? ""} onChange={(event) => onTarget(event.target.value || null)}>
            <option value="">Chọn bill đích</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id}>
                {bill.billNumber} - {formatMoney(bill.total)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Lý do gộp
          <input className={inputClass} value={reason} onChange={(event) => onReason(event.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {bills
          .filter((bill) => bill.id !== targetId)
          .map((bill) => (
            <label key={bill.id} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <input checked={cleanSourceIds.includes(bill.id)} type="checkbox" onChange={() => onToggleSource(bill.id)} />
              {bill.billNumber}
            </label>
          ))}
      </div>
      <button className={buttonClass} type="button" disabled={isBusy || !targetId || cleanSourceIds.length === 0 || !reason.trim()} onClick={onMerge}>
        Gộp bill
      </button>
    </section>
  );
}

function SplitPanel({
  bill,
  draft,
  canSplit,
  isBusy,
  onChange,
  onCancel,
  onSubmit
}: {
  bill: Bill | null;
  draft: Record<string, number>;
  canSplit: boolean;
  isBusy: boolean;
  onChange: (itemId: string, quantity: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): ReactElement | null {
  if (!bill || !canSplit) {
    return null;
  }
  const valid = isValidSplit(bill, draft);
  return (
    <section className="grid gap-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Tách {bill.billNumber}</h2>
        <button className={buttonClass} type="button" onClick={onCancel}>
          Đóng
        </button>
      </div>
      <div className="grid gap-2">
        {bill.items.map((item) => {
          const firstQuantity = draft[item.id] ?? 0;
          const secondQuantity = item.quantity - firstQuantity;
          return (
            <div key={item.id} className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-[1fr_9rem_auto] md:items-center">
              <span className="font-medium">
                {item.productNameSnapshot} x {item.quantity}
              </span>
              <input
                aria-label={`Số lượng bill 1 ${item.productNameSnapshot}`}
                className={inputClass}
                max={item.quantity}
                min={0}
                type="number"
                value={firstQuantity}
                onChange={(event) => onChange(item.id, clampNumber(event.target.value, 0, item.quantity))}
              />
              <span>Bill 2: {secondQuantity}</span>
            </div>
          );
        })}
      </div>
      <button className={buttonClass} type="button" disabled={isBusy || !valid} onClick={onSubmit}>
        Xác nhận tách bill
      </button>
    </section>
  );
}

function DiscountPanel({
  bill,
  canApply,
  canOverride,
  isBusy,
  voucherCode,
  directDiscountType,
  directDiscountValue,
  directDiscountReason,
  overrideReason,
  reverseReason,
  onVoucherCode,
  onDirectDiscountType,
  onDirectDiscountValue,
  onDirectDiscountReason,
  onOverrideReason,
  onReverseReason,
  onApplyVoucher,
  onApplyDirect,
  onReverse,
  onClose
}: {
  bill: Bill | null;
  canApply: boolean;
  canOverride: boolean;
  isBusy: boolean;
  voucherCode: string;
  directDiscountType: DiscountType;
  directDiscountValue: number;
  directDiscountReason: string;
  overrideReason: string;
  reverseReason: string;
  onVoucherCode: (value: string) => void;
  onDirectDiscountType: (value: DiscountType) => void;
  onDirectDiscountValue: (value: number) => void;
  onDirectDiscountReason: (value: string) => void;
  onOverrideReason: (value: string) => void;
  onReverseReason: (value: string) => void;
  onApplyVoucher: () => void;
  onApplyDirect: () => void;
  onReverse: (adjustmentId: string) => void;
  onClose: () => void;
}): ReactElement | null {
  if (!bill || !canApply) {
    return null;
  }
  const activeVoucher = bill.adjustments.find((adjustment) => adjustment.status === "ACTIVE" && adjustment.source === "VOUCHER");
  const activeDirect = bill.adjustments.find((adjustment) => adjustment.status === "ACTIVE" && adjustment.source === "DIRECT_DISCOUNT");
  const needsVoucherOverride = Boolean(activeDirect);
  const needsDirectOverride = Boolean(activeVoucher);
  return (
    <section className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Discount/VAT cho {bill.billNumber}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Backend trả về số tiền cuối cùng sau mỗi thao tác.</p>
        </div>
        <button className={buttonClass} type="button" onClick={onClose}>
          Đóng
        </button>
      </div>
      <BillBreakdown bill={bill} />
      {canOverride ? (
        <label className="grid gap-2 text-sm font-medium">
          Lý do override
          <input className={inputClass} placeholder="Bắt buộc khi dùng voucher + direct discount" value={overrideReason} onChange={(event) => onOverrideReason(event.target.value)} />
        </label>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          <h3 className="text-sm font-semibold">Apply Voucher</h3>
          <input className={inputClass} placeholder="Mã voucher" value={voucherCode} onChange={(event) => onVoucherCode(event.target.value)} />
          <button className={buttonClass} type="button" disabled={isBusy || !voucherCode.trim() || (needsVoucherOverride && (!canOverride || !overrideReason.trim()))} onClick={onApplyVoucher}>
            Áp dụng voucher
          </button>
        </div>
        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          <h3 className="text-sm font-semibold">Direct Discount</h3>
          <select className={inputClass} value={directDiscountType} onChange={(event) => onDirectDiscountType(event.target.value as DiscountType)}>
            <option value="FIXED_AMOUNT">Giảm tiền</option>
            <option value="PERCENT">Giảm %</option>
          </select>
          <input className={inputClass} min={1} type="number" value={directDiscountValue} onChange={(event) => onDirectDiscountValue(positiveNumber(event.target.value, 1))} />
          <input className={inputClass} placeholder="Lý do chiết khấu" value={directDiscountReason} onChange={(event) => onDirectDiscountReason(event.target.value)} />
          <button className={buttonClass} type="button" disabled={isBusy || directDiscountValue <= 0 || !directDiscountReason.trim() || (needsDirectOverride && (!canOverride || !overrideReason.trim()))} onClick={onApplyDirect}>
            Áp dụng chiết khấu
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        <label className="grid gap-2 text-sm font-medium">
          Lý do hoàn tác
          <input className={inputClass} value={reverseReason} onChange={(event) => onReverseReason(event.target.value)} />
        </label>
        {bill.adjustments.length ? (
          bill.adjustments.map((adjustment) => (
            <AdjustmentRow key={adjustment.id} adjustment={adjustment} isBusy={isBusy} reverseReason={reverseReason} onReverse={onReverse} />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Bill chưa có adjustment.</p>
        )}
      </div>
    </section>
  );
}

function BillBreakdown({ bill }: { bill: Bill }): ReactElement {
  return (
    <dl className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-2">
      <BreakdownTerm label="Subtotal" value={formatMoney(bill.subtotal)} />
      <BreakdownTerm label="Voucher" value={`-${formatMoney(bill.voucherDiscountAmount)}`} />
      <BreakdownTerm label="Direct Discount" value={`-${formatMoney(bill.directDiscountAmount)}`} />
      <BreakdownTerm label="Pre-VAT" value={formatMoney(bill.discountedAmount)} />
      <BreakdownTerm label={`VAT ${Number(bill.vatRate).toFixed(0)}%`} value={formatMoney(bill.vatAmount)} />
      <BreakdownTerm label="Total" value={formatMoney(bill.total)} />
    </dl>
  );
}

function BreakdownTerm({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function AdjustmentRow({
  adjustment,
  isBusy,
  reverseReason,
  onReverse
}: {
  adjustment: BillAdjustment;
  isBusy: boolean;
  reverseReason: string;
  onReverse: (adjustmentId: string) => void;
}): ReactElement {
  return (
    <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-[1fr_repeat(4,auto)] md:items-center md:gap-4">
      <span className="font-medium">{adjustment.source === "VOUCHER" ? adjustment.codeSnapshot ?? "Voucher" : "Direct discount"}</span>
      <span>{discountLabel(adjustment.discountType, adjustment.discountValue)}</span>
      <span>-{formatMoney(adjustment.discountAmount)}</span>
      <span>{adjustment.status}</span>
      {adjustment.status === "ACTIVE" ? (
        <button className={buttonClass} type="button" disabled={isBusy || !reverseReason.trim()} onClick={() => onReverse(adjustment.id)}>
          Hoàn tác
        </button>
      ) : null}
    </div>
  );
}

function BillCard({
  bill,
  canIssue,
  canSplit,
  canVoid,
  canDiscountApply,
  isBusy,
  voidReason,
  onVoidReason,
  onIssue,
  onSplit,
  onDiscount,
  onVoid
}: {
  bill: Bill;
  canIssue: boolean;
  canSplit: boolean;
  canVoid: boolean;
  canDiscountApply: boolean;
  isBusy: boolean;
  voidReason: string;
  onVoidReason: (reason: string) => void;
  onIssue: () => void;
  onSplit: () => void;
  onDiscount: () => void;
  onVoid: () => void;
}): ReactElement {
  const mutable = isMutableBill(bill);
  return (
    <article className="grid gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{bill.billNumber}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tổng: {formatMoney(bill.total)}</p>
        </div>
        <StatusPill status={bill.status} />
      </div>
      <BillBreakdown bill={bill} />
      <div className="grid gap-2">
        {bill.items.length ? bill.items.map((item) => <BillItemRow key={item.id} item={item} />) : <p className="text-sm text-muted-foreground">Bill không còn dòng món.</p>}
      </div>
      {bill.status === "VOID" && bill.voidReason ? <p className="text-sm text-muted-foreground">Lý do hủy: {bill.voidReason}</p> : null}
      {bill.status === "MERGED" && bill.mergeReason ? <p className="text-sm text-muted-foreground">Đã gộp: {bill.mergeReason}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {bill.status === "DRAFT" && canIssue ? (
          <button className={buttonClass} type="button" disabled={isBusy} onClick={onIssue}>
            Issue
          </button>
        ) : null}
        {mutable && canSplit && bill.items.length ? (
          <button className={buttonClass} type="button" disabled={isBusy} onClick={onSplit}>
            Split
          </button>
        ) : null}
        {mutable && canDiscountApply ? (
          <button className={buttonClass} type="button" disabled={isBusy} onClick={onDiscount}>
            Discount
          </button>
        ) : null}
      </div>
      {mutable && canVoid ? (
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input className={inputClass} value={voidReason} onChange={(event) => onVoidReason(event.target.value)} />
          <button className={dangerButtonClass} type="button" disabled={isBusy || !voidReason.trim()} onClick={onVoid}>
            Void
          </button>
        </div>
      ) : null}
    </article>
  );
}

function BillItemRow({ item }: { item: BillItem }): ReactElement {
  return (
    <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm md:grid-cols-[1fr_repeat(3,auto)] md:items-center md:gap-4">
      <span className="font-medium">{item.productNameSnapshot}</span>
      <span>SL: {item.quantity}</span>
      <span>Đơn giá: {formatMoney(item.unitPriceSnapshot)}</span>
      <span>{formatMoney(item.lineAmount)}</span>
    </div>
  );
}

function StatusPill({ status }: { status: BillStatus }): ReactElement {
  const tone: Record<BillStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100",
    ISSUED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    PAID: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    MERGED: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
    VOID: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone[status]}`}>{status}</span>;
}

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
        <p className="mt-1 text-sm text-muted-foreground">Tài khoản hiện tại không có permission cho màn hình billing.</p>
      </div>
    </section>
  );
}

function defaultSplitDraft(bill: Bill): Record<string, number> {
  return Object.fromEntries(bill.items.map((item) => [item.id, Math.floor(item.quantity / 2)]));
}

function buildSplitParts(bill: Bill, draft: Record<string, number>) {
  const firstItems = bill.items
    .map((item) => ({ orderItemId: item.orderItemId, quantity: draft[item.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const secondItems = bill.items
    .map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity - (draft[item.id] ?? 0) }))
    .filter((item) => item.quantity > 0);
  return [{ items: firstItems }, { items: secondItems }];
}

function isValidSplit(bill: Bill, draft: Record<string, number>): boolean {
  let firstTotal = 0;
  let secondTotal = 0;
  for (const item of bill.items) {
    const firstQuantity = draft[item.id] ?? 0;
    if (!Number.isInteger(firstQuantity) || firstQuantity < 0 || firstQuantity > item.quantity) {
      return false;
    }
    firstTotal += firstQuantity;
    secondTotal += item.quantity - firstQuantity;
  }
  return firstTotal > 0 && secondTotal > 0;
}

function toggleSource(sourceIds: string[], billId: string, targetId: string | null): string[] {
  if (billId === targetId) {
    return sourceIds;
  }
  return sourceIds.includes(billId) ? sourceIds.filter((id) => id !== billId) : [...sourceIds, billId];
}

function isMutableBill(bill: Bill): boolean {
  return bill.status === "DRAFT" || bill.status === "ISSUED";
}

function clampNumber(value: string, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function discountLabel(type: DiscountType, value: string): string {
  return type === "PERCENT" ? `${Number(value).toFixed(0)}%` : formatMoney(value);
}

function formatMoney(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : error instanceof Error ? error.message : "Không xử lý được yêu cầu.";
}

const buttonClass = "inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const dangerButtonClass = "inline-flex h-9 items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const panelClass = "rounded-md border border-border p-4 text-sm text-muted-foreground";

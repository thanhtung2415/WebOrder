import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiClientError } from "../services/api-client";
import { createQrSession } from "../admin/tables-api";
import { CustomerMenuPage } from "./CustomerMenuPage";

export function CustomerQrEntryPage(): ReactElement {
  const params = useParams();
  const qrToken = params.qrToken ?? "";
  const sessionQuery = useQuery({
    queryKey: ["phase6-customer-qr", qrToken],
    queryFn: () => createQrSession(qrToken),
    enabled: Boolean(qrToken),
    retry: false
  });
  const session = sessionQuery.data;

  useEffect(() => {
    if (!session) {
      return;
    }
    window.sessionStorage.setItem("qrSessionToken", session.qrSessionToken);
    window.sessionStorage.setItem("qrBranchId", session.branch.id);
  }, [session]);

  if (!qrToken) {
    return <Message title="QR không hợp lệ" message="Mã QR thiếu token bàn." />;
  }

  if (sessionQuery.isLoading) {
    return <Message title="Đang mở phiên bàn" message="Hệ thống đang kiểm tra QR và bàn của bạn." />;
  }

  if (sessionQuery.error) {
    return <Message title="Không mở được QR" message={errorMessage(sessionQuery.error)} />;
  }

  if (!session) {
    return <Message title="Không mở được QR" message="Không nhận được dữ liệu phiên bàn." />;
  }

  return (
    <section className="grid gap-4">
      <div className="border-b border-border bg-muted/45">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <p className="font-semibold">{session.branch.name}</p>
            <p className="text-muted-foreground">{session.table.displayName} • {session.session.status}</p>
          </div>
          <Link className="rounded-md border border-border bg-background px-3 py-2 font-medium hover:bg-muted" to={`/customer?branchId=${session.branch.id}&qrSessionToken=${encodeURIComponent(session.qrSessionToken)}`}>
            Mở menu
          </Link>
        </div>
      </div>
      <CustomerMenuPage branchIdOverride={session.branch.id} qrSessionTokenOverride={session.qrSessionToken} sessionLabel={`${session.table.displayName} • ${session.session.status}`} />
    </section>
  );
}

function Message({ title, message }: { title: string; message: string }): ReactElement {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "QR không còn hợp lệ hoặc bàn đang tạm ngưng.";
}

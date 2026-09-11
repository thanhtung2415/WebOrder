import type { ReactElement } from "react";
import { Button } from "../components/ui/button";
import { AuthMeData } from "../setup/setup-api";
import { useAuthSession } from "./use-auth-session";

const copyByStatus: Record<AuthMeData["accountStatus"], { title: string; description: string }> = {
  PENDING: {
    title: "Tài khoản đang chờ duyệt",
    description: "Admin cần duyệt tài khoản và gán chi nhánh trước khi bạn có thể vào khu vực nhân viên."
  },
  ACTIVE: {
    title: "Tài khoản hoạt động",
    description: "Bạn có thể tiếp tục sử dụng hệ thống."
  },
  REJECTED: {
    title: "Tài khoản đã bị từ chối",
    description: "Tài khoản này chưa được phép truy cập hệ thống nội bộ."
  },
  LOCKED: {
    title: "Tài khoản bị khóa",
    description: "Vui lòng liên hệ admin để mở khóa trước khi tiếp tục."
  },
  INACTIVE: {
    title: "Tài khoản ngưng hoạt động",
    description: "Tài khoản này đã được đưa về trạng thái không hoạt động."
  }
};

interface AccountStatePageProps {
  status: AuthMeData["accountStatus"];
}

export function AccountStatePage({ status }: AccountStatePageProps): ReactElement {
  const { signOut } = useAuthSession();
  const copy = copyByStatus[status];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
      <section className="space-y-4">
        <p className="text-sm font-medium text-primary">{status}</p>
        <h1 className="text-3xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
        <Button type="button" variant="outline" onClick={signOut}>
          Đăng xuất
        </Button>
      </section>
    </main>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBranchStore } from "../admin/branch-store";
import { Button } from "../components/ui/button";
import type { AuthMeData } from "../setup/setup-api";
import { isAuthorizedAdmin } from "./auth-routing";
import { useAuthSession } from "./use-auth-session";

interface AccountMenuProps {
  area: "ADMIN" | "STAFF";
  me: AuthMeData;
}

export function AccountMenu({ area, me }: AccountMenuProps): ReactElement {
  const { signOut } = useAuthSession();
  const queryClient = useQueryClient();
  const setActiveBranchId = useBranchStore((state) => state.setActiveBranchId);
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const areaLabel = area === "ADMIN" ? "Admin" : "Staff";

  const handleLogout = async (): Promise<void> => {
    setIsSigningOut(true);
    setLogoutError(false);
    try {
      await signOut();
      queryClient.clear();
      setActiveBranchId(null);
      navigate("/login", { replace: true });
    } catch {
      setLogoutError(true);
      setIsSigningOut(false);
    }
  };

  return (
    <details className="relative">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-sm hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span className="max-w-40 truncate font-medium">{me.profile.displayName || me.profile.email}</span>
        <span className="text-xs text-muted-foreground">{areaLabel}</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-border bg-background p-3 shadow-lg">
        <div className="border-b border-border pb-3">
          <p className="truncate text-sm font-medium">{me.profile.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{me.profile.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">{me.roles.join(", ") || areaLabel}</p>
        </div>
        <div className="grid gap-1 py-2 text-sm">
          {area !== "ADMIN" && isAuthorizedAdmin(me) ? (
            <Link className="rounded-md px-2 py-2 hover:bg-muted" to="/admin">
              Chuyển sang Admin
            </Link>
          ) : null}
          {area !== "STAFF" ? (
            <Link className="rounded-md px-2 py-2 hover:bg-muted" to="/staff">
              Chuyển sang Staff
            </Link>
          ) : null}
        </div>
        <Button className="w-full" type="button" variant="outline" disabled={isSigningOut} onClick={() => void handleLogout()}>
          {isSigningOut ? "Đang đăng xuất..." : "Đăng xuất"}
        </Button>
        {logoutError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">Không thể đăng xuất. Vui lòng thử lại.</p> : null}
      </div>
    </details>
  );
}

import type { ReactElement } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ThemeToggle } from "../components/theme-toggle";
import { Button } from "../components/ui/button";
import { AccountStatePage } from "../auth/account-state-page";
import { useAuthSession } from "../auth/use-auth-session";
import { fetchAuthMe } from "../setup/setup-api";
import { AdminOutletContext } from "./admin-context";
import { useBranchStore } from "./branch-store";

export function AdminLayout(): ReactElement {
  const { accessToken, isLoading, signInWithGoogle, signOut } = useAuthSession();
  const { activeBranchId, setActiveBranchId } = useBranchStore();
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: Boolean(accessToken)
  });

  const me = meQuery.data;
  const activeMemberships = useMemo(() => me?.memberships.filter((membership) => membership.isActive) ?? [], [me]);

  useEffect(() => {
    if (!me || me.accountStatus !== "ACTIVE") {
      return;
    }
    const branchStillAllowed = activeMemberships.some((membership) => membership.branch.id === activeBranchId);
    const fallbackBranchId = me.activeBranch?.id ?? activeMemberships[0]?.branch.id ?? null;
    if (!activeBranchId || !branchStillAllowed) {
      setActiveBranchId(fallbackBranchId);
    }
  }, [activeBranchId, activeMemberships, me, setActiveBranchId]);

  if (isLoading || meQuery.isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Đang tải tài khoản...</main>;
  }

  if (!accessToken) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
        <section className="space-y-4">
          <h1 className="text-3xl font-semibold">Đăng nhập admin</h1>
          <p className="text-sm text-muted-foreground">Dùng Google để vào khu vực quản trị.</p>
          <Button type="button" onClick={signInWithGoogle}>
            Đăng nhập Google
          </Button>
        </section>
      </main>
    );
  }

  if (meQuery.isError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10">
        <section className="space-y-4">
          <h1 className="text-3xl font-semibold">Không tải được tài khoản</h1>
          <p className="text-sm text-muted-foreground">Hãy đăng ký staff hoặc thử đăng nhập lại.</p>
          <Button type="button" variant="outline" onClick={signOut}>
            Đăng xuất
          </Button>
        </section>
      </main>
    );
  }

  if (!me || me.accountStatus !== "ACTIVE") {
    return <AccountStatePage status={me?.accountStatus ?? "PENDING"} />;
  }

  const selectedBranchId = activeBranchId ?? me.activeBranch?.id ?? activeMemberships[0]?.branch.id ?? null;

  if (!selectedBranchId) {
    return <AccountStatePage status="PENDING" />;
  }

  const granted = new Set(activeMemberships.find((membership) => membership.branch.id === selectedBranchId)?.permissions ?? me.permissions);
  const context: AdminOutletContext = {
    me,
    accessToken,
    activeBranchId: selectedBranchId,
    hasPermission: (permission) => granted.has(permission)
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-14 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold">WebOrder Admin</span>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin">
                Staff
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/branches">
                Branches
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/roles">
                Roles
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/menu">
                Menu
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/products">
                Products
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/options">
                Options
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/units">
                Units
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/ingredients">
                Ingredients
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/recipes">
                Recipes
              </NavLink>
              <NavLink className={({ isActive }) => navClass(isActive)} to="/admin/inventory">
                Inventory
              </NavLink>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Active branch"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              value={selectedBranchId}
              onChange={(event) => setActiveBranchId(event.target.value)}
            >
              {activeMemberships.map((membership) => (
                <option key={membership.branch.id} value={membership.branch.id}>
                  {membership.branch.code} - {membership.branch.name}
                </option>
              ))}
            </select>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <Outlet context={context} />
    </main>
  );
}

function navClass(isActive: boolean): string {
  return `rounded-md px-3 py-2 ${isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
}

import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "../components/theme-toggle";

export function AdminLayout(): ReactElement {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <span className="text-sm font-semibold">{t("admin.header")}</span>
          <ThemeToggle />
        </div>
      </header>
      <Outlet />
    </main>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { fetchSetupStatus } from "./setup-api";

interface SetupStatusGuardProps {
  children: ReactNode;
  allowWhen: "PENDING" | "COMPLETED";
}

export function SetupStatusGuard({ children, allowWhen }: SetupStatusGuardProps): ReactElement {
  const { t } = useTranslation();
  const statusQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: fetchSetupStatus
  });

  if (statusQuery.isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("setup.loading")}</main>;
  }

  if (statusQuery.isError) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("setup.unavailable")}</main>;
  }

  if (!statusQuery.data || statusQuery.data.status !== allowWhen) {
    return <Navigate to={allowWhen === "PENDING" ? "/admin" : "/setup"} replace />;
  }

  return <>{children}</>;
}

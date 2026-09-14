import { useQuery } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AccountStatePage } from "./account-state-page";
import { isAuthorizedAdmin } from "./auth-routing";
import { useAuthSession } from "./use-auth-session";
import { fetchAuthMe, fetchSetupStatus, type AuthMeData } from "../setup/setup-api";

interface AuthRedirectProps {
  pendingSetup: ReactNode;
}

export function SetupEntryRedirect({ pendingSetup }: AuthRedirectProps): ReactElement {
  return <SetupAwareRedirect pendingSetup={pendingSetup} unauthenticatedCompletedPath="/staff" />;
}

export function AuthCallbackRedirect(): ReactElement {
  return <SetupAwareRedirect pendingSetup={<Navigate to="/setup" replace />} unauthenticatedCompletedPath="/staff" />;
}

function SetupAwareRedirect({ pendingSetup, unauthenticatedCompletedPath }: AuthRedirectProps & { unauthenticatedCompletedPath: string }): ReactElement {
  const { accessToken, isLoading } = useAuthSession();

  const setupQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: fetchSetupStatus
  });
  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => fetchAuthMe(accessToken ?? ""),
    enabled: setupQuery.data?.status === "COMPLETED" && Boolean(accessToken)
  });

  if (isLoading || setupQuery.isLoading || meQuery.isLoading) {
    return <Loading />;
  }

  if (setupQuery.isError || !setupQuery.data) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Chưa thể đọc trạng thái setup</main>;
  }

  if (setupQuery.data.status === "PENDING") {
    return <>{pendingSetup}</>;
  }

  if (!accessToken) {
    return <Navigate to={unauthenticatedCompletedPath} replace />;
  }

  if (meQuery.isError || !meQuery.data) {
    return <Navigate to="/pending" replace />;
  }

  return routeForAccount(meQuery.data);
}

function routeForAccount(me: AuthMeData): ReactElement {
  if (me.accountStatus === "PENDING") {
    return <Navigate to="/pending" replace />;
  }
  if (me.accountStatus !== "ACTIVE") {
    return <AccountStatePage status={me.accountStatus} />;
  }
  if (isAuthorizedAdmin(me)) {
    return <Navigate to="/admin" replace />;
  }
  return <Navigate to="/staff" replace />;
}

function Loading(): ReactElement {
  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Đang tải...</main>;
}

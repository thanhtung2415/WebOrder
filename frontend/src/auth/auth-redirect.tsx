import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AccountStatePage } from "./account-state-page";
import { clearAuthIntent, readAuthIntent } from "./auth-intent";
import { isAuthorizedAdmin } from "./auth-routing";
import { useAuthSession } from "./use-auth-session";
import { ApiClientError } from "../services/api-client";
import { fetchAuthMe, fetchSetupStatus, type AuthMeData } from "../setup/setup-api";

interface AuthRedirectProps {
  pendingSetup: ReactNode;
}

export function SetupEntryRedirect({ pendingSetup }: AuthRedirectProps): ReactElement {
  return <SetupAwareRedirect pendingSetup={pendingSetup} unauthenticatedCompletedPath="/login" />;
}

export function AuthCallbackRedirect(): ReactElement {
  return <SetupAwareRedirect pendingSetup={<Navigate to="/setup" replace />} unauthenticatedCompletedPath="/login" />;
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
  const authIntent = readAuthIntent();

  useEffect(() => {
    if (meQuery.data) {
      clearAuthIntent();
    }
  }, [meQuery.data]);

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
    const isUnknownUser = meQuery.error instanceof ApiClientError && meQuery.error.code === "USER_NOT_REGISTERED";
    if (isUnknownUser && authIntent?.mode === "REGISTER" && authIntent.area === "STAFF") {
      return <Navigate to="/pending" replace />;
    }
    return <Navigate to="/login?error=not_registered" replace />;
  }

  return routeForAccount(meQuery.data, authIntent?.area);
}

function routeForAccount(me: AuthMeData, intendedArea?: "ADMIN" | "STAFF"): ReactElement {
  if (me.accountStatus === "PENDING") {
    return <Navigate to="/pending" replace />;
  }
  if (me.accountStatus !== "ACTIVE") {
    return <AccountStatePage status={me.accountStatus} />;
  }
  if (isAuthorizedAdmin(me) && intendedArea !== "STAFF") {
    return <Navigate to="/admin" replace />;
  }
  return <Navigate to="/staff" replace />;
}

function Loading(): ReactElement {
  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Đang tải...</main>;
}

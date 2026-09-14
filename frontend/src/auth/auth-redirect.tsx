import { useQuery } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { AccountStatePage } from "./account-state-page";
import { isAuthorizedAdmin } from "./auth-routing";
import { supabase } from "./supabase-client";
import { useAuthSession } from "./use-auth-session";
import { fetchAuthMe, fetchSetupStatus, type AuthMeData } from "../setup/setup-api";

interface AuthRedirectProps {
  pendingSetup: ReactNode;
}

export function SetupEntryRedirect({ pendingSetup }: AuthRedirectProps): ReactElement {
  return <SetupAwareRedirect pendingSetup={pendingSetup} unauthenticatedCompletedPath="/staff" />;
}

export function AuthCallbackRedirect(): ReactElement {
  return <SetupAwareRedirect pendingSetup={<Navigate to="/setup" replace />} unauthenticatedCompletedPath="/staff" resolveCallbackSession />;
}

function SetupAwareRedirect({
  pendingSetup,
  unauthenticatedCompletedPath,
  resolveCallbackSession = false
}: AuthRedirectProps & { unauthenticatedCompletedPath: string; resolveCallbackSession?: boolean }): ReactElement {
  const { accessToken, isLoading } = useAuthSession();
  const location = useLocation();
  const [callbackSession, setCallbackSession] = useState<Session | null>(null);
  const [isResolvingCallback, setIsResolvingCallback] = useState(resolveCallbackSession);
  const effectiveAccessToken = accessToken ?? callbackSession?.access_token ?? null;

  useEffect(() => {
    if (!resolveCallbackSession) {
      return;
    }

    let cancelled = false;

    async function resolveSession(): Promise<void> {
      setIsResolvingCallback(true);
      const code = new URLSearchParams(location.search).get("code");

      if (code) {
        try {
          const { data } = await supabase.auth.exchangeCodeForSession(code);
          if (!cancelled && data.session) {
            setCallbackSession(data.session);
          }
        } catch {
          // Supabase may already have consumed the PKCE code during URL detection.
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setCallbackSession(data.session);
        setIsResolvingCallback(false);
      }
    }

    void resolveSession().catch(() => {
      if (!cancelled) {
        setIsResolvingCallback(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [location.search, resolveCallbackSession]);

  const setupQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: fetchSetupStatus
  });
  const meQuery = useQuery({
    queryKey: ["auth-me", effectiveAccessToken],
    queryFn: () => fetchAuthMe(effectiveAccessToken ?? ""),
    enabled: setupQuery.data?.status === "COMPLETED" && Boolean(effectiveAccessToken)
  });

  if (isLoading || isResolvingCallback || setupQuery.isLoading || meQuery.isLoading) {
    return <Loading />;
  }

  if (setupQuery.isError || !setupQuery.data) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Chưa thể đọc trạng thái setup</main>;
  }

  if (setupQuery.data.status === "PENDING") {
    return <>{pendingSetup}</>;
  }

  if (!effectiveAccessToken) {
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

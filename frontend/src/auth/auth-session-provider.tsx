import { ReactElement, ReactNode, useEffect, useMemo, useState } from "react";
import { AuthSessionContext, AuthSessionContextValue } from "./auth-session-context";
import { setCurrentAccessToken } from "./auth-token-store";
import { supabase } from "./supabase-client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

interface AuthSessionProviderProps {
  children: ReactNode;
}

let oauthExchange:
  | {
      code: string;
      promise: ReturnType<typeof supabase.auth.exchangeCodeForSession>;
    }
  | undefined;

function exchangeOAuthCodeOnce(code: string): ReturnType<typeof supabase.auth.exchangeCodeForSession> {
  if (!oauthExchange || oauthExchange.code !== code) {
    oauthExchange = {
      code,
      promise: supabase.auth.exchangeCodeForSession(code)
    };
  }
  return oauthExchange.promise;
}

export function AuthSessionProvider({ children }: AuthSessionProviderProps): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let initializing = true;
    let verificationSequence = 0;

    function publishSession(nextSession: Session | null): void {
      if (!mounted) {
        return;
      }
      setCurrentAccessToken(nextSession?.access_token ?? null);
      setSession(nextSession);
      setIsLoading(false);
    }

    async function verifyAndPublish(nextSession: Session | null): Promise<void> {
      if (!mounted) {
        return;
      }
      const sequence = ++verificationSequence;
      if (!nextSession) {
        publishSession(null);
        return;
      }

      const { error } = await supabase.auth.getUser(nextSession.access_token);
      if (!mounted || sequence !== verificationSequence) {
        return;
      }
      publishSession(error ? null : nextSession);
    }

    async function restoreSession(): Promise<void> {
      const code = new URLSearchParams(window.location.search).get("code");
      let restoredSession: Session | null;

      if (code) {
        const { data, error } = await exchangeOAuthCodeOnce(code);
        if (error) {
          throw error;
        }
        restoredSession = data.session;
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      } else {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          throw error;
        }
        restoredSession = data.session;
      }

      await verifyAndPublish(restoredSession);
    }

    function handleAuthChange(event: AuthChangeEvent, nextSession: Session | null): void {
      if (initializing) {
        return;
      }
      if (event === "SIGNED_OUT") {
        publishSession(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        window.setTimeout(() => {
          void verifyAndPublish(nextSession);
        }, 0);
      }
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(handleAuthChange);

    void restoreSession()
      .catch(() => {
        publishSession(null);
      })
      .finally(() => {
        initializing = false;
      });

    return () => {
      mounted = false;
      setCurrentAccessToken(null);
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      session,
      accessToken: session?.access_token ?? null,
      isLoading,
      signInWithGoogle: async (redirectPath = "/auth/callback") => {
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            queryParams: {
              prompt: "select_account"
            }
          }
        });
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
          throw error;
        }
        setCurrentAccessToken(null);
        setSession(null);
      }
    }),
    [isLoading, session]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

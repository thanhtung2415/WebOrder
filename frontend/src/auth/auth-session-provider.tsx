import { ReactElement, ReactNode, useEffect, useMemo, useState } from "react";
import { AuthSessionContext, AuthSessionContextValue } from "./auth-session-context";
import { supabase } from "./supabase-client";
import { Session } from "@supabase/supabase-js";

interface AuthSessionProviderProps {
  children: ReactNode;
}

export function AuthSessionProvider({ children }: AuthSessionProviderProps): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function restoreSession(): Promise<void> {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
        } catch {
          // If Supabase already consumed the OAuth code, fall back to reading the stored session.
        }
      }

      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session);
        setIsLoading(false);
      }
    }

    void restoreSession().catch(() => {
      if (mounted) {
        setIsLoading(false);
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
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
            redirectTo: `${window.location.origin}${redirectPath}`
          }
        });
      },
      signOut: async () => {
        await supabase.auth.signOut();
      }
    }),
    [isLoading, session]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

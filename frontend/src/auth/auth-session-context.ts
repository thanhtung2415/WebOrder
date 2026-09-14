import { Session } from "@supabase/supabase-js";
import { createContext } from "react";

export interface AuthSessionContextValue {
  session: Session | null;
  accessToken: string | null;
  isLoading: boolean;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

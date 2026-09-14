export type AuthArea = "ADMIN" | "STAFF";
export type AuthMode = "LOGIN" | "REGISTER";

export interface AuthIntent {
  area: AuthArea;
  mode: AuthMode;
}

const AUTH_INTENT_KEY = "weborder.authIntent";

export function saveAuthIntent(intent: AuthIntent): void {
  window.sessionStorage.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));
}

export function readAuthIntent(): AuthIntent | null {
  const stored = window.sessionStorage.getItem(AUTH_INTENT_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<AuthIntent>;
    if ((parsed.area === "ADMIN" || parsed.area === "STAFF") && (parsed.mode === "LOGIN" || parsed.mode === "REGISTER")) {
      return { area: parsed.area, mode: parsed.mode };
    }
  } catch {
    clearAuthIntent();
  }

  return null;
}

export function clearAuthIntent(): void {
  window.sessionStorage.removeItem(AUTH_INTENT_KEY);
}

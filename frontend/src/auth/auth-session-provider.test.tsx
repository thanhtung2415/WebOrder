import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "./auth-session-provider";
import { useAuthSession } from "./use-auth-session";

const signInWithOAuthMock = vi.fn();
const exchangeCodeForSessionMock = vi.fn();
const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const unsubscribeMock = vi.fn();
const onAuthStateChangeMock = vi.fn((callback: unknown) => {
  void callback;
  return { data: { subscription: { unsubscribe: unsubscribeMock } } };
});

vi.mock("./supabase-client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      onAuthStateChange: (callback: unknown) => onAuthStateChangeMock(callback),
      exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSessionMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
      signOut: vi.fn()
    }
  }
}));

function Probe(): ReactElement {
  const { accessToken, signInWithGoogle } = useAuthSession();
  return (
    <>
      <span>{accessToken ?? "no-token"}</span>
      <button type="button" onClick={() => void signInWithGoogle()}>
        Login
      </button>
    </>
  );
}

describe("AuthSessionProvider", () => {
  beforeEach(() => {
    signInWithOAuthMock.mockReset();
    exchangeCodeForSessionMock.mockReset();
    getSessionMock.mockReset();
    getUserMock.mockReset();
    onAuthStateChangeMock.mockClear();
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    getUserMock.mockResolvedValue({ data: { user: { id: "auth-user-id" } }, error: null });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "http://localhost:5173", search: "", pathname: "/", hash: "" }
    });
  });

  it("redirects Google OAuth to the auth callback instead of setup", async () => {
    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Login" }));

    await waitFor(() =>
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: "http://localhost:5173/auth/callback" }
      })
    );
  });

  it("restores a Supabase session when an OAuth code returns to any route", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "http://localhost:5173", search: "?code=oauth-code", pathname: "/staff", hash: "" }
    });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    exchangeCodeForSessionMock.mockResolvedValue({ data: { session: { access_token: "callback-access-token" } }, error: null });

    render(
      <StrictMode>
        <AuthSessionProvider>
          <Probe />
        </AuthSessionProvider>
      </StrictMode>
    );

    expect(await screen.findByText("callback-access-token")).toBeInTheDocument();
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("oauth-code");
    expect(exchangeCodeForSessionMock).toHaveBeenCalledTimes(1);
    expect(getUserMock).toHaveBeenCalledWith("callback-access-token");
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(2);
    expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, "/staff");
  });

  it("does not expose a session when Supabase rejects getUser", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "expired-access-token" } }, error: null });
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>
    );

    expect(await screen.findByText("no-token")).toBeInTheDocument();
    expect(getUserMock).toHaveBeenCalledWith("expired-access-token");
  });
});

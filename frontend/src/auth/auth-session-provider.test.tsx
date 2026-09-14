import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "./auth-session-provider";
import { useAuthSession } from "./use-auth-session";

const signInWithOAuthMock = vi.fn();
const exchangeCodeForSessionMock = vi.fn();
const getSessionMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock("./supabase-client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: unsubscribeMock } } })),
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
    getSessionMock.mockResolvedValue({ data: { session: null } });
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
    exchangeCodeForSessionMock.mockResolvedValue({ data: { session: { access_token: "callback-access-token" } } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "callback-access-token" } } });

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>
    );

    expect(await screen.findByText("callback-access-token")).toBeInTheDocument();
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("oauth-code");
    expect(replaceStateSpy).toHaveBeenCalledWith({}, document.title, "/staff");
  });
});

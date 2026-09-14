import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../locales/i18n";
import { SetupPage } from "./setup-page";
import { AuthCallbackRedirect } from "../auth/auth-redirect";

const completeSetupMock = vi.fn();
const fetchSetupStatusMock = vi.fn();
const fetchAuthMeMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const exchangeCodeForSessionMock = vi.fn();
const getSessionMock = vi.fn();
let authState: {
  session: { access_token: string } | null;
  accessToken: string | null;
  isLoading: boolean;
} = {
  session: { access_token: "verified-access-token" },
  accessToken: "verified-access-token" as string | null,
  isLoading: false
};

vi.mock("../auth/use-auth-session", () => ({
  useAuthSession: () => ({
    ...authState,
    signInWithGoogle: signInWithGoogleMock,
    signOut: vi.fn()
  })
}));

vi.mock("../auth/supabase-client", () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSessionMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args)
    }
  }
}));

vi.mock("./setup-api", () => ({
  fetchSetupStatus: () => fetchSetupStatusMock(),
  fetchAuthMe: (...args: unknown[]) => fetchAuthMeMock(...args),
  completeSetup: (...args: unknown[]) => completeSetupMock(...args)
}));

function renderSetup(initialPath = "/setup"): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackRedirect />} />
          <Route path="/admin" element={<div>Admin ready</div>} />
          <Route path="/staff" element={<div>Staff ready</div>} />
          <Route path="/pending" element={<div>Pending ready</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetupPage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authState = {
      session: { access_token: "verified-access-token" },
      accessToken: "verified-access-token",
      isLoading: false
    };
    signInWithGoogleMock.mockReset();
    exchangeCodeForSessionMock.mockReset();
    getSessionMock.mockReset();
    fetchSetupStatusMock.mockResolvedValue({ status: "PENDING" });
    fetchAuthMeMock.mockResolvedValue(authMe());
    exchangeCodeForSessionMock.mockResolvedValue({ data: { session: { access_token: "callback-access-token" } } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "callback-access-token" } } });
    completeSetupMock.mockResolvedValue({
      status: "COMPLETED",
      branch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
      admin: { id: "admin-id", email: "owner@example.com", displayName: "Owner", status: "ACTIVE" }
    });
  });

  it("renders the setup form", async () => {
    renderSetup();

    expect(await screen.findByText("Tạo chi nhánh và admin đầu tiên")).toBeInTheDocument();
  });

  it("shows setup login when setup is pending and user is unauthenticated", async () => {
    authState = { session: null, accessToken: null, isLoading: false };
    renderSetup();

    expect(await screen.findByText("Đăng nhập Google để thiết lập")).toBeInTheDocument();
  });

  it("redirects completed unauthenticated setup visitors to normal staff login", async () => {
    authState = { session: null, accessToken: null, isLoading: false };
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    renderSetup();

    expect(await screen.findByText("Staff ready")).toBeInTheDocument();
    expect(screen.queryByText("Đăng nhập Google để thiết lập")).not.toBeInTheDocument();
  });

  it("redirects completed setup active admins to admin", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["ADMIN"], permissions: ["STAFF_READ"] }));
    renderSetup();

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
  });

  it("redirects completed setup active staff to staff", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["CASHIER"], permissions: ["BILL_READ"] }));
    renderSetup();

    expect(await screen.findByText("Staff ready")).toBeInTheDocument();
  });

  it("routes pending accounts to pending page", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ accountStatus: "PENDING" }));
    renderSetup();

    expect(await screen.findByText("Pending ready")).toBeInTheDocument();
  });

  it("renders locked account state for locked accounts", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ accountStatus: "LOCKED" }));
    renderSetup();

    expect(await screen.findByText("Tài khoản bị khóa")).toBeInTheDocument();
  });

  it("routes Google OAuth callback with existing admin to admin", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["ADMIN"], permissions: ["STAFF_READ"] }));
    renderSetup("/auth/callback");

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
  });

  it("exchanges the Google OAuth callback code before resolving admin access", async () => {
    authState = { session: null, accessToken: null, isLoading: false };
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["ADMIN"], permissions: ["STAFF_READ"] }));

    renderSetup("/auth/callback?code=oauth-code");

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("oauth-code");
    expect(fetchAuthMeMock).toHaveBeenCalledWith("callback-access-token");
    expect(screen.queryByText("Staff ready")).not.toBeInTheDocument();
  });

  it("never shows setup form after setup is completed", async () => {
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    renderSetup();

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
    expect(screen.queryByText("Tạo chi nhánh và admin đầu tiên")).not.toBeInTheDocument();
  });

  it("submits setup and does not persist the setup token", async () => {
    renderSetup();

    fireEvent.change(await screen.findByLabelText("Setup token"), { target: { value: "secret-token" } });
    fireEvent.change(screen.getByLabelText("Tên chi nhánh"), { target: { value: "Main Branch" } });
    fireEvent.change(screen.getByLabelText("Tên hiển thị admin"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tất setup" }));

    await waitFor(() => expect(completeSetupMock).toHaveBeenCalled());
    expect(localStorage.getItem("setupToken")).toBeNull();
    expect(sessionStorage.getItem("setupToken")).toBeNull();
  });
});

function authMe(overrides: Partial<{
  accountStatus: "PENDING" | "ACTIVE" | "LOCKED" | "INACTIVE" | "REJECTED";
  roles: string[];
  permissions: string[];
}> = {}) {
  const roles = overrides.roles ?? ["ADMIN"];
  const permissions = overrides.permissions ?? ["STAFF_READ", "BRANCH_READ", "ROLE_READ"];
  return {
    profile: {
      id: "admin-id",
      email: "owner@example.com",
      displayName: "Owner"
    },
    accountStatus: overrides.accountStatus ?? "ACTIVE",
    activeBranch: {
      id: "branch-id",
      code: "MAIN",
      name: "Main Branch",
      timezone: "Asia/Ho_Chi_Minh"
    },
    memberships: [
      {
        id: "membership-id",
        isPrimary: true,
        isActive: true,
        branch: {
          id: "branch-id",
          code: "MAIN",
          name: "Main Branch",
          timezone: "Asia/Ho_Chi_Minh"
        },
        roles,
        permissions
      }
    ],
    roles,
    permissions,
    shiftAccess: {
      current: null,
      availableActions: []
    }
  };
}

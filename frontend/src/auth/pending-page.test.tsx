import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../services/api-client";
import "../locales/i18n";
import { PendingPage } from "./pending-page";

const fetchAuthMeMock = vi.fn();
const registerStaffMock = vi.fn();

vi.mock("./use-auth-session", () => ({
  useAuthSession: () => ({
    session: { access_token: "verified-access-token" },
    accessToken: "verified-access-token",
    isLoading: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn()
  })
}));

vi.mock("../setup/setup-api", () => ({
  fetchAuthMe: (...args: unknown[]) => fetchAuthMeMock(...args),
  registerStaff: (...args: unknown[]) => registerStaffMock(...args)
}));

function renderPending(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/pending"]}>
        <Routes>
          <Route path="/pending" element={<PendingPage />} />
          <Route path="/admin" element={<div>Admin ready</div>} />
          <Route path="/staff" element={<div>Staff ready</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PendingPage", () => {
  beforeEach(() => {
    fetchAuthMeMock.mockReset();
    registerStaffMock.mockReset();
  });

  it("registers an unknown staff identity only once", async () => {
    fetchAuthMeMock.mockRejectedValue(new ApiClientError("USER_NOT_REGISTERED", "Not registered", "request-id"));
    registerStaffMock.mockRejectedValue(new ApiClientError("INVALID_TOKEN", "Invalid token", "request-id"));

    renderPending();

    await waitFor(() => expect(registerStaffMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(registerStaffMock).toHaveBeenCalledTimes(1);
  });

  it("does not register when auth me rejects the JWT", async () => {
    fetchAuthMeMock.mockRejectedValue(new ApiClientError("INVALID_TOKEN", "Invalid token", "request-id"));

    renderPending();

    expect(await screen.findByText("Tài khoản đang chờ duyệt")).toBeInTheDocument();
    expect(registerStaffMock).not.toHaveBeenCalled();
  });

  it("redirects an active admin away from the pending page", async () => {
    fetchAuthMeMock.mockResolvedValue(authMe());

    renderPending();

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
    expect(registerStaffMock).not.toHaveBeenCalled();
  });
});

function authMe() {
  return {
    profile: { id: "admin-id", email: "owner@example.com", displayName: "Owner" },
    accountStatus: "ACTIVE",
    activeBranch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
    memberships: [
      {
        id: "membership-id",
        isPrimary: true,
        isActive: true,
        branch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
        roles: ["ADMIN"],
        permissions: ["STAFF_READ"]
      }
    ],
    roles: ["ADMIN"],
    permissions: ["STAFF_READ"],
    shiftAccess: { current: null, availableActions: [] }
  };
}

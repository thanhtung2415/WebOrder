import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../locales/i18n";
import { LoginPage } from "./login-page";

const fetchSetupStatusMock = vi.fn();
const fetchAuthMeMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const signOutMock = vi.fn();
let accessToken: string | null = null;

vi.mock("./use-auth-session", () => ({
  useAuthSession: () => ({
    session: accessToken ? { access_token: accessToken } : null,
    accessToken,
    isLoading: false,
    signInWithGoogle: signInWithGoogleMock,
    signOut: signOutMock
  })
}));

vi.mock("../setup/setup-api", () => ({
  fetchSetupStatus: (...args: unknown[]) => fetchSetupStatusMock(...args),
  fetchAuthMe: (...args: unknown[]) => fetchAuthMeMock(...args)
}));

describe("LoginPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    accessToken = null;
    fetchSetupStatusMock.mockReset();
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockReset();
    signInWithGoogleMock.mockReset();
    signInWithGoogleMock.mockResolvedValue(undefined);
    signOutMock.mockReset();
  });

  it("lets an existing admin choose the admin workspace before Google sign-in", async () => {
    renderLogin();

    fireEvent.click(await screen.findByRole("button", { name: /Admin/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tiếp tục với Google/ }));

    await waitFor(() => expect(signInWithGoogleMock).toHaveBeenCalledWith("/auth/callback"));
    expect(JSON.parse(sessionStorage.getItem("weborder.authIntent") ?? "{}")).toEqual({ area: "ADMIN", mode: "LOGIN" });
  });

  it("starts the staff registration flow without granting a frontend role", async () => {
    renderLogin("/login?mode=register&area=staff");

    fireEvent.click(await screen.findByRole("button", { name: /Đăng ký bằng Google/ }));

    await waitFor(() => expect(signInWithGoogleMock).toHaveBeenCalledWith("/auth/callback"));
    expect(JSON.parse(sessionStorage.getItem("weborder.authIntent") ?? "{}")).toEqual({ area: "STAFF", mode: "REGISTER" });
  });

  it("does not allow public admin self-registration", async () => {
    renderLogin("/login?mode=register&area=admin");

    expect(await screen.findByText("Không hỗ trợ tự đăng ký Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Đăng ký bằng Google/ })).not.toBeInTheDocument();
    expect(signInWithGoogleMock).not.toHaveBeenCalled();
  });

  it("routes an authenticated admin to the selected admin workspace", async () => {
    accessToken = "admin-token";
    fetchAuthMeMock.mockResolvedValue(authMe(["ADMIN"], ["STAFF_READ"]));
    renderLogin("/login?area=admin");

    expect(await screen.findByText("Admin ready")).toBeInTheDocument();
  });

  it("cannot route non-admin staff into the admin workspace", async () => {
    accessToken = "staff-token";
    fetchAuthMeMock.mockResolvedValue(authMe(["CASHIER"], ["BILL_READ"]));
    renderLogin("/login?area=admin");

    expect(await screen.findByText("Staff ready")).toBeInTheDocument();
  });
});

function renderLogin(initialEntry = "/login"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>Admin ready</div>} />
          <Route path="/staff" element={<div>Staff ready</div>} />
          <Route path="/pending" element={<div>Pending ready</div>} />
          <Route path="/setup" element={<div>Setup ready</div>} />
          <Route path="/customer" element={<div>Customer ready</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function authMe(roles: string[], permissions: string[]) {
  return {
    profile: { id: "user-id", email: "user@example.com", displayName: "User" },
    accountStatus: "ACTIVE",
    activeBranch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
    memberships: [
      {
        id: "membership-id",
        isPrimary: true,
        isActive: true,
        branch: { id: "branch-id", code: "MAIN", name: "Main Branch", timezone: "Asia/Ho_Chi_Minh" },
        roles,
        permissions
      }
    ],
    roles,
    permissions,
    shiftAccess: { current: null, availableActions: [] }
  };
}

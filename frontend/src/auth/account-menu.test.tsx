import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBranchStore } from "../admin/branch-store";
import { AccountMenu } from "./account-menu";

const signOutMock = vi.fn();

vi.mock("./use-auth-session", () => ({
  useAuthSession: () => ({
    session: { access_token: "verified-access-token" },
    accessToken: "verified-access-token",
    isLoading: false,
    signInWithGoogle: vi.fn(),
    signOut: signOutMock
  })
}));

describe("AccountMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    useBranchStore.getState().setActiveBranchId(null);
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
  });

  it("shows the current user, area switch, and logout action", () => {
    renderMenu(new QueryClient());

    expect(screen.getAllByText("Owner")).toHaveLength(2);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chuyển sang Staff" })).toHaveAttribute("href", "/staff");
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toBeInTheDocument();
  });

  it("signs out, clears cached auth data and active branch, then opens login", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["auth-me", "verified-access-token"], { profile: { id: "old-user" } });
    useBranchStore.getState().setActiveBranchId("old-branch-id");
    renderMenu(queryClient);

    fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(["auth-me", "verified-access-token"])).toBeUndefined();
    expect(useBranchStore.getState().activeBranchId).toBeNull();
    expect(localStorage.getItem("weborder.activeBranchId")).toBeNull();
    expect(await screen.findByText("Login ready")).toBeInTheDocument();
  });
});

function renderMenu(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AccountMenu area="ADMIN" me={authMe()} />} />
          <Route path="/staff" element={<div>Login ready</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function authMe() {
  return {
    profile: { id: "admin-id", email: "owner@example.com", displayName: "Owner" },
    accountStatus: "ACTIVE" as const,
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

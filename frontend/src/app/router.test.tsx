import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "./providers";
import { AdminLayout } from "../admin/AdminLayout";
import { CustomerLayout } from "../customer/CustomerLayout";
import { StaffLayout } from "../staff/StaffLayout";
import { ShellPage } from "./shell-page";
import { SetupStatusGuard } from "../setup/setup-status-guard";
import "../locales/i18n";

const fetchAuthMeMock = vi.fn();
const fetchSetupStatusMock = vi.fn();

vi.mock("../auth/use-auth-session", () => ({
  useAuthSession: () => ({
    session: { access_token: "verified-access-token" },
    accessToken: "verified-access-token",
    isLoading: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn()
  })
}));

vi.mock("../setup/setup-api", () => ({
  fetchSetupStatus: () => fetchSetupStatusMock(),
  fetchAuthMe: () => fetchAuthMeMock()
}));

function renderRoute(path: string): void {
  const router = createMemoryRouter(
    [
      {
        path: "/customer",
        element: <CustomerLayout />,
        children: [{ index: true, element: <ShellPage namespace="customer" /> }]
      },
      {
        path: "/staff",
        element: <StaffLayout />,
        children: [{ index: true, element: <ShellPage namespace="staff" /> }]
      },
      {
        path: "/admin",
        element: (
          <SetupStatusGuard allowWhen="COMPLETED">
            <AdminLayout />
          </SetupStatusGuard>
        ),
        children: [{ index: true, element: <ShellPage namespace="admin" /> }]
      }
    ],
    { initialEntries: [path] }
  );

  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

describe("router shells", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue({
      profile: {
        id: "admin-id",
        email: "owner@example.com",
        displayName: "Owner"
      },
      accountStatus: "ACTIVE",
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
          roles: ["ADMIN"],
          permissions: ["STAFF_READ", "BRANCH_READ", "ROLE_READ"]
        }
      ],
      roles: ["ADMIN"],
      permissions: ["STAFF_READ", "BRANCH_READ", "ROLE_READ"],
      shiftAccess: {
        current: null,
        availableActions: []
      }
    });
  });

  it("renders staff shell", async () => {
    renderRoute("/staff");

    expect(await screen.findByText("Staff layout")).toBeInTheDocument();
  });

  it("renders admin shell", async () => {
    renderRoute("/admin");

    expect(await screen.findByText("WebOrder Admin")).toBeInTheDocument();
  });
});

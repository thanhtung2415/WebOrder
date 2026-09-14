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
const signOutMock = vi.fn();
let authState = {
  session: { access_token: "verified-access-token" } as { access_token: string } | null,
  accessToken: "verified-access-token" as string | null,
  isLoading: false
};

vi.mock("../auth/use-auth-session", () => ({
  useAuthSession: () => ({
    ...authState,
    signInWithGoogle: vi.fn(),
    signOut: signOutMock
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
    authState = {
      session: { access_token: "verified-access-token" },
      accessToken: "verified-access-token",
      isLoading: false
    };
    signOutMock.mockReset();
    signOutMock.mockResolvedValue(undefined);
    fetchSetupStatusMock.mockResolvedValue({ status: "COMPLETED" });
    fetchAuthMeMock.mockResolvedValue(authMe());
  });

  it("renders staff shell", async () => {
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["CASHIER"], permissions: ["BILL_READ"] }));

    renderRoute("/staff");

    expect(await screen.findByText("Staff layout")).toBeInTheDocument();
  });

  it("allows active admins to switch to the staff area", async () => {
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["ADMIN"], permissions: ["STAFF_READ", "BRANCH_READ", "ROLE_READ"] }));

    renderRoute("/staff");

    expect(await screen.findByText("WebOrder Staff")).toBeInTheDocument();
  });

  it("renders admin shell", async () => {
    renderRoute("/admin");

    expect(await screen.findByText("WebOrder Admin")).toBeInTheDocument();
  });

  it("redirects active non-admin staff away from the admin route", async () => {
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["CASHIER"], permissions: ["BILL_READ"] }));

    renderRoute("/admin");

    expect(await screen.findByText("Staff layout")).toBeInTheDocument();
  });

  it("shows the account menu in the authenticated admin area", async () => {
    renderRoute("/admin");
    expect(await screen.findAllByText("Owner")).toHaveLength(2);
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows the account menu in the authenticated staff area", async () => {
    fetchAuthMeMock.mockResolvedValue(authMe({ roles: ["CASHIER"], permissions: ["BILL_READ"] }));

    renderRoute("/staff");

    expect(await screen.findAllByText("Owner")).toHaveLength(2);
    expect(screen.getByText("Staff")).toBeInTheDocument();
  });

  it("redirects unauthenticated admin routes to the staff login", async () => {
    authState = { session: null, accessToken: null, isLoading: false };

    renderRoute("/admin");

    expect(await screen.findByText("Đăng nhập staff")).toBeInTheDocument();
    expect(screen.queryByText("WebOrder Admin")).not.toBeInTheDocument();
  });
});

function authMe(
  overrides: Partial<{
    roles: string[];
    permissions: string[];
  }> = {}
) {
  const roles = overrides.roles ?? ["ADMIN"];
  const permissions = overrides.permissions ?? ["STAFF_READ", "BRANCH_READ", "ROLE_READ"];

  return {
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

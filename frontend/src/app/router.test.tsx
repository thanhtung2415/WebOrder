import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "./providers";
import { AdminLayout } from "../admin/AdminLayout";
import { CustomerLayout } from "../customer/CustomerLayout";
import { StaffLayout } from "../staff/StaffLayout";
import { ShellPage } from "./shell-page";
import "../locales/i18n";

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
        element: <AdminLayout />,
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
  it("renders staff shell", async () => {
    renderRoute("/staff");

    expect(await screen.findByText("Staff layout")).toBeInTheDocument();
  });

  it("renders admin shell", async () => {
    renderRoute("/admin");

    expect(await screen.findByText("Admin layout")).toBeInTheDocument();
  });
});

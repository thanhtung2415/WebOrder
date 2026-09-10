import { Navigate, createBrowserRouter } from "react-router-dom";
import { AdminLayout } from "../admin/AdminLayout";
import { CustomerLayout } from "../customer/CustomerLayout";
import { StaffLayout } from "../staff/StaffLayout";
import { ShellPage } from "./shell-page";

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter([
    {
      path: "/",
      element: <Navigate to="/customer" replace />
    },
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
  ]);
}

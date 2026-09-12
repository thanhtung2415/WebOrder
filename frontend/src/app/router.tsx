import { Navigate, createBrowserRouter } from "react-router-dom";
import { AdminLayout } from "../admin/AdminLayout";
import { BranchManagementPage, RoleManagementPage, StaffManagementPage } from "../admin/AdminPages";
import { InventoryManagementPage } from "../admin/InventoryPages";
import { CategoryManagementPage, OptionManagementPage, ProductManagementPage } from "../admin/MenuPages";
import { IngredientManagementPage, RecipeManagementPage, UnitManagementPage } from "../admin/RecipePages";
import { TableManagementPage } from "../admin/TablePages";
import { PendingPage } from "../auth/pending-page";
import { CustomerLayout } from "../customer/CustomerLayout";
import { CustomerMenuPage } from "../customer/CustomerMenuPage";
import { CustomerQrEntryPage } from "../customer/CustomerQrEntryPage";
import { SetupPage } from "../setup/setup-page";
import { SetupStatusGuard } from "../setup/setup-status-guard";
import { BarQueuePage, KitchenQueuePage } from "../staff/QueuePages";
import { StaffServiceRequestPage } from "../staff/ServiceRequestPage";
import { StaffLayout } from "../staff/StaffLayout";
import { ShellPage } from "./shell-page";

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter([
    {
      path: "/",
      element: <Navigate to="/customer" replace />
    },
    {
      path: "/setup",
      element: <SetupPage />
    },
    {
      path: "/pending",
      element: <PendingPage />
    },
    {
      path: "/customer",
      element: <CustomerLayout />,
      children: [{ index: true, element: <CustomerMenuPage /> }]
    },
    {
      path: "/table/:qrToken",
      element: <CustomerLayout />,
      children: [{ index: true, element: <CustomerQrEntryPage /> }]
    },
    {
      path: "/staff",
      element: <StaffLayout />,
      children: [
        { index: true, element: <ShellPage namespace="staff" /> },
        { path: "requests", element: <StaffServiceRequestPage /> },
        { path: "bar", element: <BarQueuePage /> },
        { path: "kitchen", element: <KitchenQueuePage /> },
        { path: "tables", element: <TableManagementPage /> }
      ]
    },
    {
      path: "/admin",
      element: (
        <SetupStatusGuard allowWhen="COMPLETED">
          <AdminLayout />
        </SetupStatusGuard>
      ),
      children: [
        { index: true, element: <StaffManagementPage /> },
        { path: "branches", element: <BranchManagementPage /> },
        { path: "roles", element: <RoleManagementPage /> },
        { path: "menu", element: <CategoryManagementPage /> },
        { path: "products", element: <ProductManagementPage /> },
        { path: "options", element: <OptionManagementPage /> },
        { path: "units", element: <UnitManagementPage /> },
        { path: "ingredients", element: <IngredientManagementPage /> },
        { path: "recipes", element: <RecipeManagementPage /> },
        { path: "inventory", element: <InventoryManagementPage /> },
        { path: "tables", element: <TableManagementPage /> }
      ]
    }
  ]);
}

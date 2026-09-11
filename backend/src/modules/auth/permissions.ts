export const ADMIN_ROLE_CODE = "ADMIN";

export const PERMISSION_CODES = [
  "SETUP_COMPLETE",
  "BRANCH_READ",
  "BRANCH_MANAGE",
  "STAFF_READ",
  "STAFF_APPROVE",
  "STAFF_REJECT",
  "STAFF_STATUS_MANAGE",
  "STAFF_ROLE_MANAGE",
  "ROLE_READ",
  "ROLE_MANAGE",
  "SHIFT_READ",
  "SHIFT_MANAGE",
  "ATTENDANCE_READ",
  "ATTENDANCE_ADJUST",
  "MENU_READ",
  "MENU_MANAGE",
  "RECIPE_READ",
  "RECIPE_MANAGE",
  "INVENTORY_READ",
  "INVENTORY_IMPORT",
  "INVENTORY_ADJUST",
  "STOCKTAKE_MANAGE",
  "TABLE_READ",
  "TABLE_MANAGE",
  "QR_MANAGE",
  "SESSION_READ",
  "SESSION_MANAGE",
  "SESSION_TRANSFER",
  "SESSION_CLOSE",
  "ORDER_READ",
  "ORDER_CREATE",
  "ORDER_STATUS_UPDATE",
  "ORDER_CANCEL",
  "BAR_QUEUE_READ",
  "KITCHEN_QUEUE_READ",
  "SERVICE_REQUEST_READ",
  "SERVICE_REQUEST_HANDLE",
  "BILL_READ",
  "BILL_MANAGE",
  "BILL_SPLIT",
  "BILL_MERGE",
  "BILL_ISSUE",
  "BILL_VOID",
  "VOUCHER_MANAGE",
  "DISCOUNT_APPLY",
  "DISCOUNT_OVERRIDE",
  "PAYMENT_READ",
  "PAYMENT_CREATE",
  "PAYMENT_CONFIRM",
  "REPORT_READ",
  "REPORT_EXPORT",
  "AUDIT_READ"
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const DEFAULT_SYSTEM_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "BAR",
  "KITCHEN",
  "WAITER"
] as const;

export type SystemRoleCode = (typeof DEFAULT_SYSTEM_ROLES)[number];

const managerPermissions = PERMISSION_CODES.filter((code) => code !== "SETUP_COMPLETE" && code !== "ROLE_MANAGE" && code !== "STAFF_ROLE_MANAGE");

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleCode, readonly PermissionCode[]> = {
  ADMIN: PERMISSION_CODES,
  MANAGER: managerPermissions,
  CASHIER: [
    "SESSION_READ",
    "TABLE_READ",
    "ORDER_READ",
    "SERVICE_REQUEST_READ",
    "SERVICE_REQUEST_HANDLE",
    "BILL_READ",
    "BILL_MANAGE",
    "BILL_SPLIT",
    "BILL_MERGE",
    "BILL_ISSUE",
    "BILL_VOID",
    "PAYMENT_READ",
    "PAYMENT_CREATE",
    "PAYMENT_CONFIRM"
  ],
  BAR: ["ORDER_READ", "ORDER_STATUS_UPDATE", "BAR_QUEUE_READ"],
  KITCHEN: ["ORDER_READ", "ORDER_STATUS_UPDATE", "KITCHEN_QUEUE_READ"],
  WAITER: ["TABLE_READ", "SESSION_READ", "ORDER_READ", "ORDER_CREATE", "ORDER_STATUS_UPDATE", "SERVICE_REQUEST_READ", "SERVICE_REQUEST_HANDLE", "BILL_READ"]
};

export const DEFAULT_ROLE_LABELS: Record<SystemRoleCode, { name: string; description: string }> = {
  ADMIN: {
    name: "Administrator",
    description: "Full system administrator"
  },
  MANAGER: {
    name: "Manager",
    description: "Branch operations manager"
  },
  CASHIER: {
    name: "Cashier",
    description: "Billing and payment staff"
  },
  BAR: {
    name: "Bar",
    description: "Bar preparation queue staff"
  },
  KITCHEN: {
    name: "Kitchen",
    description: "Kitchen preparation queue staff"
  },
  WAITER: {
    name: "Waiter",
    description: "Table service staff"
  }
};

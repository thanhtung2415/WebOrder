import type { AuthMeData } from "../setup/setup-api";

const ADMIN_PERMISSIONS = ["STAFF_READ", "ROLE_READ", "BRANCH_MANAGE", "ROLE_MANAGE"];

export function isAuthorizedAdmin(me: AuthMeData): boolean {
  return me.roles.includes("ADMIN") || me.permissions.some((permission) => ADMIN_PERMISSIONS.includes(permission));
}

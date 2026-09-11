import { SetMetadata } from "@nestjs/common";
import { PermissionCode } from "./permissions";

export const REQUIRED_PERMISSIONS_KEY = "requiredPermissions";
export const REQUIRED_ANY_PERMISSIONS_KEY = "requiredAnyPermissions";

export function RequirePermissions(...permissions: PermissionCode[]): ReturnType<typeof SetMetadata> {
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}

export function RequireAnyPermission(...permissions: PermissionCode[]): ReturnType<typeof SetMetadata> {
  return SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);
}

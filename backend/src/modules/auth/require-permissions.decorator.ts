import { SetMetadata } from "@nestjs/common";
import { PermissionCode } from "./permissions";

export const REQUIRED_PERMISSIONS_KEY = "requiredPermissions";

export function RequirePermissions(...permissions: PermissionCode[]): ReturnType<typeof SetMetadata> {
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}

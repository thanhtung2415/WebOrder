export interface PermissionResponse {
  id: string;
  code: string;
  description: string | null;
}

export interface RoleResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleListResponse {
  items: RoleResponse[];
}

export interface PermissionListResponse {
  items: PermissionResponse[];
}

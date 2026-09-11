import { AuthMeData } from "../setup/setup-api";
import { apiClient } from "../services/api-client";

export type AccountStatus = AuthMeData["accountStatus"];
export type BranchStatus = "ACTIVE" | "INACTIVE";

export interface Branch {
  id: string;
  code: string;
  name: string;
  timezone: string;
  attendanceGraceMinutes: number;
  address: string | null;
  phone: string | null;
  status: BranchStatus;
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
}

export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  avatarPath: string | null;
  status: AccountStatus;
  branches: Array<{
    id: string;
    branch: {
      id: string;
      code: string;
      name: string;
    };
    employeeCode: string | null;
    isPrimary: boolean;
    isActive: boolean;
    roles: Array<{
      id: string;
      code: string;
      name: string;
    }>;
  }>;
}

export interface StaffListParams {
  q?: string;
  status?: string;
  role?: string;
}

interface RequestContext {
  accessToken: string;
  branchId: string;
}

function queryString(params: Partial<Record<string, string | undefined>>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

export async function listBranches(context: RequestContext): Promise<Branch[]> {
  const response = await apiClient.request<{ items: Branch[] }>("/branches", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createBranch(context: RequestContext, payload: Pick<Branch, "code" | "name" | "timezone">): Promise<Branch> {
  const response = await apiClient.request<Branch>("/branches", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateBranch(context: RequestContext, branchId: string, payload: Partial<Pick<Branch, "name" | "timezone" | "status">>): Promise<Branch> {
  const response = await apiClient.request<Branch>(`/branches/${branchId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listStaff(context: RequestContext, params: StaffListParams): Promise<StaffMember[]> {
  const response = await apiClient.request<{ items: StaffMember[] }>(`/staff${queryString({ q: params.q, status: params.status, role: params.role })}`, {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function approveStaff(context: RequestContext, staffId: string, roleIds: string[], employeeCode?: string): Promise<StaffMember> {
  const response = await apiClient.request<StaffMember>(`/staff/${staffId}/approval`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { roleIds, employeeCode }
  });
  return response.data;
}

export async function rejectStaff(context: RequestContext, staffId: string, reason: string): Promise<StaffMember> {
  const response = await apiClient.request<StaffMember>(`/staff/${staffId}/rejection`, {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { reason }
  });
  return response.data;
}

export async function changeStaffStatus(context: RequestContext, staffId: string, status: AccountStatus, reason?: string): Promise<StaffMember> {
  const response = await apiClient.request<StaffMember>(`/staff/${staffId}/status`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { status, reason }
  });
  return response.data;
}

export async function replaceStaffRoles(context: RequestContext, staffId: string, roleIds: string[]): Promise<StaffMember> {
  const response = await apiClient.request<StaffMember>(`/staff/${staffId}/branches/${context.branchId}/roles`, {
    method: "PUT",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { roleIds }
  });
  return response.data;
}

export async function listRoles(context: RequestContext): Promise<Role[]> {
  const response = await apiClient.request<{ items: Role[] }>("/roles", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function createRole(context: RequestContext, payload: Pick<Role, "code" | "name"> & { description?: string }): Promise<Role> {
  const response = await apiClient.request<Role>("/roles", {
    method: "POST",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function updateRole(context: RequestContext, roleId: string, payload: Partial<Pick<Role, "name" | "description">>): Promise<Role> {
  const response = await apiClient.request<Role>(`/roles/${roleId}`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: payload
  });
  return response.data;
}

export async function listPermissions(context: RequestContext): Promise<Permission[]> {
  const response = await apiClient.request<{ items: Permission[] }>("/permissions", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data.items;
}

export async function replaceRolePermissions(context: RequestContext, roleId: string, permissionIds: string[]): Promise<Role> {
  const response = await apiClient.request<Role>(`/roles/${roleId}/permissions`, {
    method: "PUT",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { permissionIds }
  });
  return response.data;
}

import { AccountStatus } from "@prisma/client";

export interface StaffRoleResponse {
  id: string;
  code: string;
  name: string;
}

export interface StaffBranchResponse {
  id: string;
  branch: {
    id: string;
    code: string;
    name: string;
  };
  employeeCode: string | null;
  isPrimary: boolean;
  isActive: boolean;
  roles: StaffRoleResponse[];
}

export interface StaffResponse {
  id: string;
  email: string;
  displayName: string;
  avatarPath: string | null;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  branches: StaffBranchResponse[];
}

export interface StaffListResponse {
  items: StaffResponse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

import { BranchStatus } from "@prisma/client";

export interface BranchResponse {
  id: string;
  code: string;
  name: string;
  timezone: string;
  attendanceGraceMinutes: number;
  address: string | null;
  phone: string | null;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BranchListResponse {
  items: BranchResponse[];
}

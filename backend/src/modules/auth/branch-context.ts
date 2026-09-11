import { AccountStatus, BranchStatus } from "@prisma/client";
import { AuthContext } from "./auth-context";

export interface BranchContext {
  auth: AuthContext;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: AccountStatus;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    status: BranchStatus;
  };
  staffBranch: {
    id: string;
    isPrimary: boolean;
    isActive: boolean;
  };
  roles: string[];
  permissions: string[];
}

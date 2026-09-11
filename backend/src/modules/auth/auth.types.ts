import { AccountStatus } from "@prisma/client";

export interface StaffRegistrationResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    status: AccountStatus;
  };
}

export interface AuthMeResponse {
  profile: {
    id: string;
    authUserId: string;
    email: string;
    displayName: string;
    avatarPath: string | null;
  };
  accountStatus: AccountStatus;
  activeBranch: {
    id: string;
    code: string;
    name: string;
    timezone: string;
  } | null;
  memberships: Array<{
    id: string;
    isPrimary: boolean;
    isActive: boolean;
    branch: {
      id: string;
      code: string;
      name: string;
      timezone: string;
    };
    roles: string[];
    permissions: string[];
  }>;
  roles: string[];
  permissions: string[];
  shiftAccess: {
    current: null;
    availableActions: string[];
  };
}

export interface LogoutResponse {
  handled: true;
  attendance: null;
}

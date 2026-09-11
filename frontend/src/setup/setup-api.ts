import { apiClient } from "../services/api-client";

export interface SetupStatusData {
  status: "PENDING" | "COMPLETED";
}

export interface CompleteSetupRequest {
  setupToken: string;
  branch: {
    code: string;
    name: string;
    timezone: string;
  };
  admin: {
    displayName: string;
  };
}

export interface CompleteSetupData {
  status: "COMPLETED";
  branch: {
    id: string;
    code: string;
    name: string;
    timezone: string;
  };
  admin: {
    id: string;
    email: string;
    displayName: string;
    status: "ACTIVE";
  };
}

export interface AuthMeData {
  profile: {
    id: string;
    email: string;
    displayName: string;
  };
  accountStatus: "PENDING" | "ACTIVE" | "LOCKED" | "INACTIVE" | "REJECTED";
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

export async function fetchSetupStatus(): Promise<SetupStatusData> {
  const response = await apiClient.request<SetupStatusData>("/setup/status");
  return response.data;
}

export async function completeSetup(payload: CompleteSetupRequest, accessToken: string, idempotencyKey: string): Promise<CompleteSetupData> {
  const response = await apiClient.request<CompleteSetupData>("/setup", {
    method: "POST",
    accessToken,
    idempotencyKey,
    body: payload
  });
  return response.data;
}

export async function fetchAuthMe(accessToken: string): Promise<AuthMeData> {
  const response = await apiClient.request<AuthMeData>("/auth/me", { accessToken });
  return response.data;
}

export async function registerStaff(accessToken: string, displayName?: string): Promise<void> {
  await apiClient.request("/auth/registrations", {
    method: "POST",
    accessToken,
    body: displayName ? { displayName } : {}
  });
}

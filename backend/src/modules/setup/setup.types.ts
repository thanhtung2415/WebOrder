export interface SetupStatusResponse {
  status: "PENDING" | "COMPLETED";
}

export interface CompleteSetupResponse {
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

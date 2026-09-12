import { apiClient } from "../services/api-client";

export type ServiceRequestType = "CALL_STAFF" | "REQUEST_PAYMENT";
export type ServiceRequestStatus = "PENDING" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";

export interface ServiceRequest {
  id: string;
  branchId: string;
  tableSessionId: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  handledById: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  table: { id: string; code: string; displayName: string };
  createdAt: string;
  updatedAt: string;
}

export async function createCustomerServiceRequest(qrSessionToken: string, type: ServiceRequestType, tableSessionId?: string): Promise<ServiceRequest> {
  const response = await apiClient.request<ServiceRequest>("/service-requests", {
    method: "POST",
    qrSessionToken,
    body: { type, ...(tableSessionId ? { tableSessionId } : {}) }
  });
  return response.data;
}

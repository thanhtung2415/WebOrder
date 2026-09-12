import { apiClient } from "../services/api-client";
import type { ServiceRequest, ServiceRequestStatus } from "../customer/customer-service-request-api";

export interface StaffServiceRequestContext {
  accessToken: string;
  branchId: string;
}

export interface ServiceRequestListResponse {
  items: ServiceRequest[];
}

export async function fetchServiceRequests(context: StaffServiceRequestContext): Promise<ServiceRequestListResponse> {
  const response = await apiClient.request<ServiceRequestListResponse>("/service-requests", {
    accessToken: context.accessToken,
    branchId: context.branchId
  });
  return response.data;
}

export async function updateServiceRequestStatus(context: StaffServiceRequestContext, requestId: string, status: Extract<ServiceRequestStatus, "ACKNOWLEDGED" | "RESOLVED">): Promise<ServiceRequest> {
  const response = await apiClient.request<ServiceRequest>(`/service-requests/${requestId}/status`, {
    method: "PATCH",
    accessToken: context.accessToken,
    branchId: context.branchId,
    body: { status }
  });
  return response.data;
}

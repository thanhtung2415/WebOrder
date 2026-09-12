import { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";
import { BranchContext } from "../auth/branch-context";
import { QrSessionContext } from "../tables/table.types";

export type ServiceRequestAccessContext = { kind: "qr"; qr: QrSessionContext } | { kind: "staff"; branch: BranchContext };

export interface ServiceRequestResponse {
  id: string;
  branchId: string;
  tableSessionId: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  handledById: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  table: {
    id: string;
    code: string;
    displayName: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ServiceRequestListResponse {
  items: ServiceRequestResponse[];
}

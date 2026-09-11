import { useOutletContext } from "react-router-dom";
import { AuthMeData } from "../setup/setup-api";

export interface AdminOutletContext {
  me: AuthMeData;
  accessToken: string;
  activeBranchId: string;
  hasPermission: (permission: string) => boolean;
}

export function useAdminContext(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>();
}

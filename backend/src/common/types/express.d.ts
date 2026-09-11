declare namespace Express {
  export interface Request {
    requestId?: string;
    authContext?: import("../../modules/auth/auth-context").AuthContext;
    branchContext?: import("../../modules/auth/branch-context").BranchContext;
  }
}

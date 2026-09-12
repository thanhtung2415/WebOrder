declare namespace Express {
  export interface Request {
    requestId?: string;
    authContext?: import("../../modules/auth/auth-context").AuthContext;
    branchContext?: import("../../modules/auth/branch-context").BranchContext;
    qrSessionContext?: import("../../modules/tables/table.types").QrSessionContext;
    cartAccessContext?: import("../../modules/cart/cart.types").CartAccessContext;
    orderAccessContext?: import("../../modules/orders/order.types").OrderAccessContext;
    serviceRequestAccessContext?: import("../../modules/service-requests/service-request.types").ServiceRequestAccessContext;
  }
}

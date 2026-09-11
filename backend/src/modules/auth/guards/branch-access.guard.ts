import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { forbidden, invalidToken } from "../../../common/errors/api-exception";
import { AuthorizationService } from "../services/authorization.service";

@Injectable()
export class BranchAccessGuard implements CanActivate {
  constructor(private readonly authorizationService: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.authContext;
    if (!auth) {
      throw invalidToken();
    }

    const header = request.headers["x-branch-id"];
    const branchId = Array.isArray(header) ? header[0] : header;
    if (!branchId || branchId.trim().length === 0) {
      throw forbidden("BRANCH_ACCESS_DENIED", "X-Branch-Id is required");
    }

    request.branchContext = await this.authorizationService.resolveBranchContext(auth, branchId.trim());
    return true;
  }
}

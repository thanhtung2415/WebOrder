import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { invalidToken } from "../../../common/errors/api-exception";
import { PermissionCode } from "../permissions";
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from "../require-permissions.decorator";
import { AuthorizationService } from "../services/authorization.service";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const requiredAny = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if ((!required || required.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.branchContext) {
      throw invalidToken();
    }
    if (required && required.length > 0) {
      this.authorizationService.assertPermissions(request.branchContext, required);
    }
    if (requiredAny && requiredAny.length > 0) {
      this.authorizationService.assertAnyPermission(request.branchContext, requiredAny);
    }
    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { forbidden, invalidToken } from "../../../common/errors/api-exception";
import { SupabaseJwtVerifierService } from "../../auth/supabase-jwt-verifier.service";
import { AuthorizationService } from "../../auth/services/authorization.service";
import { QrSessionTokenService } from "../qr-session-token.service";

@Injectable()
export class ProductReadAccessGuard implements CanActivate {
  constructor(
    private readonly qrSessionTokenService: QrSessionTokenService,
    private readonly supabaseJwtVerifier: SupabaseJwtVerifierService,
    private readonly authorizationService: AuthorizationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      throw invalidToken();
    }

    const qrContext = await this.tryResolveQrContext(token);
    if (qrContext) {
      request.qrSessionContext = qrContext;
      return true;
    }

    const auth = await this.supabaseJwtVerifier.verify(token);
    request.authContext = auth;
    const branchId = this.extractBranchId(request);
    const branchContext = await this.authorizationService.resolveBranchContext(auth, branchId);
    this.authorizationService.assertPermissions(branchContext, ["MENU_READ"]);
    request.branchContext = branchContext;
    return true;
  }

  private async tryResolveQrContext(token: string): Promise<Express.Request["qrSessionContext"]> {
    try {
      return await this.qrSessionTokenService.verifyActive(token);
    } catch {
      return undefined;
    }
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token?.trim()) {
      return null;
    }
    return token.trim();
  }

  private extractBranchId(request: Request): string {
    const header = request.headers["x-branch-id"];
    const branchId = Array.isArray(header) ? header[0] : header;
    if (!branchId || branchId.trim().length === 0) {
      throw forbidden("BRANCH_ACCESS_DENIED", "X-Branch-Id is required");
    }
    return branchId.trim();
  }
}

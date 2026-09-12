import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { forbidden, invalidToken } from "../../../common/errors/api-exception";
import { AuthorizationService } from "../../auth/services/authorization.service";
import { SupabaseJwtVerifierService } from "../../auth/supabase-jwt-verifier.service";
import { QrSessionTokenService } from "../../tables/qr-session-token.service";

@Injectable()
export class OrderAccessGuard implements CanActivate {
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

    const qr = await this.tryResolveQrContext(token);
    if (qr) {
      request.qrSessionContext = qr;
      request.orderAccessContext = { kind: "qr", qr };
      return true;
    }

    const auth = await this.supabaseJwtVerifier.verify(token);
    request.authContext = auth;
    const branch = await this.authorizationService.resolveBranchContext(auth, this.extractBranchId(request));
    request.branchContext = branch;
    request.orderAccessContext = { kind: "staff", branch };
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
    if (!branchId?.trim()) {
      throw forbidden("BRANCH_ACCESS_DENIED", "X-Branch-Id is required");
    }
    return branchId.trim();
  }
}

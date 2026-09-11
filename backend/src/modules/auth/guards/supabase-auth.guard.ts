import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { invalidToken } from "../../../common/errors/api-exception";
import { SupabaseJwtVerifierService } from "../supabase-jwt-verifier.service";

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly verifier: SupabaseJwtVerifierService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request.headers.authorization);
    request.authContext = await this.verifier.verify(token);
    return true;
  }

  private extractBearerToken(header: string | undefined): string {
    if (!header) {
      throw invalidToken();
    }

    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token || token.trim().length === 0) {
      throw invalidToken();
    }

    return token.trim();
  }
}

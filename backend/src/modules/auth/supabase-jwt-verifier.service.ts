import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtHeader, JwtPayload, SigningKeyCallback, verify } from "jsonwebtoken";
import { JsonWebKey, KeyObject, createPublicKey } from "node:crypto";
import { invalidToken } from "../../common/errors/api-exception";
import { EnvironmentVariables } from "../../config/environment.validation";
import { AuthContext } from "./auth-context";

interface JwksDocument {
  keys: Array<JsonWebKey & { kid?: string }>;
}

@Injectable()
export class SupabaseJwtVerifierService {
  private readonly jwksUri: string;
  private readonly keyCache = new Map<string, KeyObject>();

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {
    const issuer = this.configService.get("SUPABASE_JWT_ISSUER", { infer: true });
    this.jwksUri = `${issuer}/.well-known/jwks.json`;
  }

  async verify(token: string): Promise<AuthContext> {
    try {
      const payload = await this.verifyJwt(token);
      return this.toAuthContext(payload);
    } catch {
      throw invalidToken();
    }
  }

  private verifyJwt(token: string): Promise<JwtPayload> {
    return new Promise((resolve, reject) => {
      verify(
        token,
        (header: JwtHeader, callback: SigningKeyCallback) => {
          if (!header.kid) {
            callback(new Error("Missing key id"));
            return;
          }
          void this.getPublicKey(header.kid)
            .then((key) => callback(null, key))
            .catch((error: unknown) => callback(error instanceof Error ? error : new Error("Signing key not found")));
        },
        {
          issuer: this.configService.get("SUPABASE_JWT_ISSUER", { infer: true }),
          audience: this.configService.get("SUPABASE_JWT_AUDIENCE", { infer: true }),
          algorithms: ["RS256", "ES256"]
        },
        (error, decoded) => {
          if (error || typeof decoded !== "object" || decoded === null) {
            reject(error ?? new Error("Invalid token"));
            return;
          }
          resolve(decoded as JwtPayload);
        }
      );
    });
  }

  private async getPublicKey(kid: string): Promise<KeyObject> {
    const cached = this.keyCache.get(kid);
    if (cached) {
      return cached;
    }

    const response = await fetch(this.jwksUri);
    if (!response.ok) {
      throw new Error("JWKS request failed");
    }
    const document = (await response.json()) as JwksDocument;
    const jwk = document.keys.find((key) => key.kid === kid);
    if (!jwk) {
      throw new Error("Signing key not found");
    }

    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    this.keyCache.set(kid, publicKey);
    return publicKey;
  }

  private toAuthContext(payload: JwtPayload): AuthContext {
    if (!payload.sub || !this.isUuid(payload.sub)) {
      throw invalidToken();
    }

    const email = this.readStringClaim(payload, "email");
    const role = this.readStringClaim(payload, "role");
    const isAnonymous = payload.is_anonymous;
    const appMetadata = this.isRecord(payload.app_metadata) ? payload.app_metadata : undefined;
    const provider = appMetadata ? this.readRecordString(appMetadata, "provider") : undefined;
    const providers = appMetadata?.providers;
    const hasGoogleProvider = provider === "google" || (Array.isArray(providers) && providers.includes("google"));

    if (!email || role !== "authenticated" || isAnonymous !== false || !hasGoogleProvider) {
      throw invalidToken();
    }

    return {
      authUserId: payload.sub,
      email,
      displayName: this.resolveDisplayName(payload, email),
      avatarUrl: this.readStringClaim(payload, "avatar_url")
    };
  }

  private resolveDisplayName(payload: JwtPayload, email: string): string {
    const directName = this.readStringClaim(payload, "name") ?? this.readStringClaim(payload, "full_name");
    if (directName) {
      return directName;
    }

    const metadata = payload.user_metadata;
    if (this.isRecord(metadata)) {
      const metadataName = this.readRecordString(metadata, "full_name") ?? this.readRecordString(metadata, "name");
      if (metadataName) {
        return metadataName;
      }
    }

    return email.split("@")[0] || "Staff";
  }

  private readStringClaim(payload: JwtPayload, key: string): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private readRecordString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}

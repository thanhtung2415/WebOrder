import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync, JsonWebKey } from "node:crypto";
import { SignOptions, sign } from "jsonwebtoken";
import { EnvironmentVariables } from "../src/config/environment.validation";
import { SupabaseJwtVerifierService } from "../src/modules/auth/supabase-jwt-verifier.service";

const issuer = "https://example.supabase.co/auth/v1";
const audience = "authenticated";

describe("SupabaseJwtVerifierService", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = {
    ...(publicKey.export({ format: "jwk" }) as JsonWebKey),
    kid: "test-key",
    alg: "RS256",
    use: "sig"
  };

  let service: SupabaseJwtVerifierService;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [publicJwk] })
    }) as unknown as typeof fetch;

    const configService = {
      get: (key: keyof EnvironmentVariables) => {
        const values: Pick<EnvironmentVariables, "SUPABASE_JWT_ISSUER" | "SUPABASE_JWT_AUDIENCE"> = {
          SUPABASE_JWT_ISSUER: issuer,
          SUPABASE_JWT_AUDIENCE: audience
        };
        return values[key as keyof typeof values];
      }
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new SupabaseJwtVerifierService(configService);
  });

  it("verifies signature, issuer, audience and identity claims", async () => {
    const token = createToken();

    await expect(service.verify(token)).resolves.toMatchObject({
      authUserId: "1d653f5e-62e0-47d4-9465-f57d8e3f8026",
      email: "owner@example.com",
      displayName: "Owner"
    });
  });

  it("rejects an invalid audience", async () => {
    const token = createToken({ audience: "wrong-audience" });

    await expect(service.verify(token)).rejects.toMatchObject({
      response: { code: "INVALID_TOKEN" }
    });
  });

  it("rejects an expired token", async () => {
    const token = createToken({ expiresIn: "-10s" });

    await expect(service.verify(token)).rejects.toMatchObject({
      response: { code: "INVALID_TOKEN" }
    });
  });

  it("accepts the standard Supabase claims without a non-standard email_verified claim", async () => {
    const token = createToken();

    await expect(service.verify(token)).resolves.toMatchObject({
      email: "owner@example.com"
    });
  });

  it("rejects anonymous identities", async () => {
    const token = createToken({ isAnonymous: true });

    await expect(service.verify(token)).rejects.toMatchObject({
      response: { code: "INVALID_TOKEN" }
    });
  });

  it("rejects identities that did not authenticate through Google", async () => {
    const token = createToken({ provider: "email" });

    await expect(service.verify(token)).rejects.toMatchObject({
      response: { code: "INVALID_TOKEN" }
    });
  });

  function createToken(
    options: { audience?: string; expiresIn?: SignOptions["expiresIn"]; isAnonymous?: boolean; provider?: string } = {}
  ): string {
    return sign(
      {
        sub: "1d653f5e-62e0-47d4-9465-f57d8e3f8026",
        email: "owner@example.com",
        role: "authenticated",
        is_anonymous: options.isAnonymous ?? false,
        app_metadata: {
          provider: options.provider ?? "google",
          providers: [options.provider ?? "google"]
        },
        name: "Owner"
      },
      privateKey,
      {
        algorithm: "RS256",
        issuer,
        audience: options.audience ?? audience,
        expiresIn: options.expiresIn ?? "5m",
        keyid: "test-key"
      }
    );
  }
});

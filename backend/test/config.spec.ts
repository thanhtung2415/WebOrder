import { validateEnvironment } from "../src/config/environment.validation";

const validEnvironment = {
  NODE_ENV: "test",
  APP_PORT: "3000",
  BACKEND_URL: "http://localhost:3000",
  FRONTEND_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://user:password@localhost:5432/weborder_test",
  DIRECT_URL: "postgresql://user:password@localhost:5432/weborder_test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1",
  SUPABASE_JWT_AUDIENCE: "authenticated",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  SETUP_TOKEN: "setup-token",
  CORS_ORIGINS: "http://localhost:5173,https://app.example.com",
  QR_SESSION_SECRET: "qr-session-secret",
  REQUEST_ID_HEADER: "X-Request-Id",
  RESERVATION_TTL_MINUTES: "10",
  DEFAULT_ATTENDANCE_GRACE_MINUTES: "30",
  REALTIME_ENABLED: "true",
  LOG_LEVEL: "info"
};

describe("validateEnvironment", () => {
  it("returns parsed environment values", () => {
    const result = validateEnvironment(validEnvironment);

    expect(result.APP_PORT).toBe(3000);
    expect(result.CORS_ORIGINS).toEqual(["http://localhost:5173", "https://app.example.com"]);
    expect(result.REALTIME_ENABLED).toBe(true);
    expect(result.RESERVATION_TTL_MINUTES).toBe(10);
  });

  it("fails fast when a required variable is missing", () => {
    const environment = { ...validEnvironment, DATABASE_URL: "" };

    expect(() => validateEnvironment(environment)).toThrow("Missing required environment variable: DATABASE_URL");
  });
});

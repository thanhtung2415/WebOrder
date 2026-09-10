export type NodeEnvironment = "development" | "test" | "staging" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  APP_PORT: number;
  BACKEND_URL: string;
  FRONTEND_URL: string;
  DATABASE_URL: string;
  DIRECT_URL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_ISSUER: string;
  SUPABASE_JWT_AUDIENCE: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SETUP_TOKEN: string;
  CORS_ORIGINS: string[];
  QR_SESSION_SECRET: string;
  REQUEST_ID_HEADER: string;
  RESERVATION_TTL_MINUTES: number;
  DEFAULT_ATTENDANCE_GRACE_MINUTES: number;
  REALTIME_ENABLED: boolean;
  LOG_LEVEL: LogLevel;
}

type RawEnvironment = Record<string, unknown>;

const nodeEnvironments: readonly NodeEnvironment[] = ["development", "test", "staging", "production"];
const logLevels: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function getRequiredString(config: RawEnvironment, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function getOptionalString(config: RawEnvironment, key: string): string | undefined {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], key: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid ${key}: ${value}`);
  }
  return value as T;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("APP_PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function parsePositiveInteger(config: RawEnvironment, key: string): number {
  const value = Number(getRequiredString(config, key));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function parseBoolean(config: RawEnvironment, key: string): boolean {
  const value = getRequiredString(config, key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${key} must be true or false`);
}

function assertUrl(value: string, key: string): string {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("URL must use http or https");
    }
    return value;
  } catch {
    throw new Error(`${key} must be a valid http(s) URL`);
  }
}

function assertPostgresUrl(value: string, key: string): string {
  if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
    throw new Error(`${key} must be a PostgreSQL connection URL`);
  }
  return value;
}

function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ORIGINS must include at least one origin");
  }

  return origins.map((origin) => assertUrl(origin, "CORS_ORIGINS"));
}

export function validateEnvironment(config: RawEnvironment): EnvironmentVariables {
  const nodeEnv = parseEnum(getRequiredString(config, "NODE_ENV"), nodeEnvironments, "NODE_ENV");
  const logLevel = parseEnum(getRequiredString(config, "LOG_LEVEL"), logLevels, "LOG_LEVEL");
  const directUrl = getOptionalString(config, "DIRECT_URL");

  return {
    NODE_ENV: nodeEnv,
    APP_PORT: parsePort(getRequiredString(config, "APP_PORT")),
    BACKEND_URL: assertUrl(getRequiredString(config, "BACKEND_URL"), "BACKEND_URL"),
    FRONTEND_URL: assertUrl(getRequiredString(config, "FRONTEND_URL"), "FRONTEND_URL"),
    DATABASE_URL: assertPostgresUrl(getRequiredString(config, "DATABASE_URL"), "DATABASE_URL"),
    DIRECT_URL: directUrl ? assertPostgresUrl(directUrl, "DIRECT_URL") : undefined,
    SUPABASE_URL: assertUrl(getRequiredString(config, "SUPABASE_URL"), "SUPABASE_URL"),
    SUPABASE_ANON_KEY: getRequiredString(config, "SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: getRequiredString(config, "SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_JWT_ISSUER: assertUrl(getRequiredString(config, "SUPABASE_JWT_ISSUER"), "SUPABASE_JWT_ISSUER"),
    SUPABASE_JWT_AUDIENCE: getRequiredString(config, "SUPABASE_JWT_AUDIENCE"),
    GOOGLE_CLIENT_ID: getRequiredString(config, "GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: getRequiredString(config, "GOOGLE_CLIENT_SECRET"),
    SETUP_TOKEN: getRequiredString(config, "SETUP_TOKEN"),
    CORS_ORIGINS: parseCorsOrigins(getRequiredString(config, "CORS_ORIGINS")),
    QR_SESSION_SECRET: getRequiredString(config, "QR_SESSION_SECRET"),
    REQUEST_ID_HEADER: getRequiredString(config, "REQUEST_ID_HEADER"),
    RESERVATION_TTL_MINUTES: parsePositiveInteger(config, "RESERVATION_TTL_MINUTES"),
    DEFAULT_ATTENDANCE_GRACE_MINUTES: parsePositiveInteger(config, "DEFAULT_ATTENDANCE_GRACE_MINUTES"),
    REALTIME_ENABLED: parseBoolean(config, "REALTIME_ENABLED"),
    LOG_LEVEL: logLevel
  };
}

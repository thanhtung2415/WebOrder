# ENVIRONMENT - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.0  
**Last updated:** 2026-09-10  
**Document priority:** SRS -> BUSINESS_RULES -> DATABASE -> API -> ARCHITECTURE -> DEVELOPMENT_PLAN -> CODING_RULES -> Code

## 1. Purpose

This document defines environment variables for the Web Order project before Phase 0 implementation. It does not implement any business feature and does not change the approved architecture.

No real secret may be committed. `.env.example` is a safe template only.

## 2. Environment Profiles

### Development

Development uses local application ports and a development PostgreSQL/Supabase project or local PostgreSQL compatible with the Prisma schema. Development credentials MUST NOT be reused in staging or production.

### Test

Test uses isolated database/auth/storage values. Critical database and concurrency tests MUST run against PostgreSQL, not only mocked Prisma. Test credentials MUST NOT point to production.

### Staging

Staging uses a separate Supabase project or isolated PostgreSQL database, separate Auth redirect URLs, separate Storage buckets and staging-only secrets. Migrations should be verified here before production.

### Production

Production uses production-only credentials, HTTPS URLs, strict CORS allowlist, connection pooling for runtime traffic, direct database access only for controlled migrations, monitored health/readiness checks and securely generated setup token.

## 3. Client / Server Classification

SERVER ONLY variables MUST never be exposed to frontend bundles, browser JavaScript, logs, audit payloads or screenshots.

Frontend-public variables MUST use the Vite `VITE_` prefix and must contain only values safe for a browser:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_BASE_URL
```

Forbidden frontend variables:

```text
VITE_SUPABASE_SERVICE_ROLE_KEY
VITE_DATABASE_URL
VITE_DIRECT_URL
VITE_SETUP_TOKEN
VITE_GOOGLE_CLIENT_SECRET
VITE_QR_SESSION_SECRET
```

## 4. Variable Reference

| Variable | Purpose | Required? | Server/Client | Example format | Security note |
|---|---|---:|---|---|---|
| `NODE_ENV` | Runtime environment selector. | Yes | Server | `development`, `test`, `staging`, `production` | Not secret. Use to select validation/profile behavior. |
| `APP_PORT` | Backend HTTP port. | Yes for backend | Server | `3000` | Not secret. |
| `BACKEND_URL` | Public backend base URL used for CORS, callbacks and server-generated links. | Yes | Server | `http://localhost:3000` or `https://api.example.com` | Not secret. Must match deployed backend. |
| `FRONTEND_URL` | Public frontend URL used for CORS and auth redirects. | Yes | Server | `http://localhost:5173` or `https://app.example.com` | Not secret. Must be environment-specific. |
| `DATABASE_URL` | Runtime database connection URL, usually pooled. Used by Prisma at runtime. | Yes | Server only | `postgresql://USER:PASSWORD@HOST:PORT/DB?pgbouncer=true` | Secret. Never expose to frontend or logs. |
| `DIRECT_URL` | Direct database connection for migrations or tooling that must bypass pooling. | Required for migrations when provider needs direct connection | Server only | `postgresql://USER:PASSWORD@HOST:PORT/DB` | Secret. Use only for controlled migration/admin tasks. |
| `SUPABASE_URL` | Supabase project API URL for backend integrations. | Yes | Server | `https://<project-ref>.supabase.co` | Not a secret by itself, but keep environment-specific. |
| `SUPABASE_ANON_KEY` | Supabase anonymous key for public client-compatible operations. | Yes when Supabase client is used | Server and client-safe only through `VITE_SUPABASE_ANON_KEY` | JWT-like public anon key from Supabase project settings | Public key, but still environment-specific. Do not confuse with service role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only privileged Supabase key for server operations. | Yes if backend needs privileged Supabase operations | Server only | Supabase service role key string | Highly sensitive. Never expose to frontend, logs or audit. |
| `SUPABASE_JWT_ISSUER` | Expected JWT issuer for Supabase Auth token verification. | Yes for auth | Server only | `https://<project-ref>.supabase.co/auth/v1` | Not secret, but must match the environment. |
| `SUPABASE_JWT_AUDIENCE` | Expected JWT audience for Supabase Auth verification. | Yes for auth | Server only | `authenticated` | Not secret. Validate strictly. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID used by Supabase/Auth configuration references. | Yes for Google login | Server and provider configuration | OAuth client ID string | Public-ish identifier, but keep environment-specific. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. | Yes for Google login provider setup where backend/provider needs it | Server only | OAuth client secret string | Secret. Never expose to frontend or commit. |
| `SETUP_TOKEN` | One-time bootstrap token for first admin/branch setup. | Yes before setup, disabled after setup | Server only | Leave blank in templates; generate a strong random value per environment | Secret. Do not log, commit or expose. Backend must hash/verify and consume it. |
| `CORS_ORIGINS` | Comma-separated allowed browser origins. | Yes | Server only | `http://localhost:5173,https://app.example.com` | Not secret. Must be strict in staging/production. |
| `QR_SESSION_SECRET` | Secret for signing/verifying QR session tokens if implementation uses signed tokens. | Yes for QR session token security | Server only | Strong random secret string | Secret. Never expose to frontend or logs. |
| `REQUEST_ID_HEADER` | Header name for request/correlation ID. | Yes | Server and client header contract | `X-Request-Id` | Not secret. Must align with API client and logging. |
| `RESERVATION_TTL_MINUTES` | Default cart item inventory reservation TTL. | Yes | Server | `10` | Not secret. Must match BR-RESERVATION-REFRESH-001. |
| `DEFAULT_ATTENDANCE_GRACE_MINUTES` | Default attendance auto-checkout grace period. | Yes | Server | `30` | Not secret. Must match branch default unless overridden by data model. |
| `REALTIME_ENABLED` | Enables realtime outbox worker/broadcast behavior by environment. | Yes | Server | `true` or `false` | Not secret. Realtime still follows transactional outbox. |
| `LOG_LEVEL` | Structured logging verbosity. | Yes | Server | `debug`, `info`, `warn`, `error` | Not secret. Debug logging must still redact secrets. |
| `VITE_SUPABASE_URL` | Browser-safe Supabase URL for frontend Supabase Auth client. | Yes for frontend auth | Frontend public | `https://<project-ref>.supabase.co` | Public. Must not imply service role access. |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe Supabase anon key for frontend auth. | Yes for frontend auth | Frontend public | Supabase anon key string | Public anon key only. Never use service role key. |
| `VITE_API_BASE_URL` | Browser API base URL for NestJS backend. | Yes for frontend API client | Frontend public | `http://localhost:3000/api/v1` or `https://api.example.com/api/v1` | Public. Must point to backend API, not database. |

## 5. Database URL Rules

`DATABASE_URL` is the runtime database connection used by the backend and Prisma client. In hosted Supabase/PostgreSQL environments this should normally be the pooled/runtime connection so application traffic does not exhaust direct database connections.

`DIRECT_URL` is for migrations or administrative tooling that needs a direct PostgreSQL connection. It MUST NOT be exposed to frontend code and SHOULD NOT be used for normal runtime traffic unless the deployment explicitly requires it.

Do not hard-code Supabase project URLs or database URLs in source code. Use environment variables per environment.

## 6. First-Time Setup Token Rules

`SETUP_TOKEN` is only for initial bootstrap:

- MUST be a strong random secret generated per environment.
- MUST NOT be logged.
- MUST NOT be committed.
- MUST NOT appear in frontend bundles.
- MUST be verified by backend according to BR-SETUP-SECURITY-001.
- MUST be hashed if persisted.
- MUST be consumed/disabled after setup completes.

`.env.example` intentionally leaves `SETUP_TOKEN=` blank.

## 7. Frontend Exposure Rules

Frontend code may read only `VITE_*` variables. For this project the allowed frontend variables are:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Frontend MUST NOT contain database URLs, setup token, Google client secret, QR session secret or Supabase service role key.

## 8. Phase 0 / Phase 1 Coverage

The environment template covers Phase 0 and Phase 1 needs from DEVELOPMENT_PLAN.md:

- App URLs and port for backend/frontend foundation.
- Database URLs for Prisma runtime and migration workflows.
- Supabase URL, anon key and service role key separation.
- Supabase JWT issuer/audience for backend JWT verification.
- Google OAuth client values for setup/auth flows.
- First-time setup token for bootstrap.
- CORS origins, request ID header and QR session secret for security foundation.
- Reservation TTL and attendance grace defaults from business rules.
- Realtime flag for transactional outbox worker behavior.
- Logging level for structured logs.

No Redis configuration is included because Redis is not part of MVP critical locks or idempotency.

## 9. Validation Checklist

- No real secrets are present in `.env.example`.
- SERVER ONLY variables are explicitly documented.
- Frontend public variables are limited to safe `VITE_*` names.
- `.gitignore` ignores real `.env` files.
- `.gitignore` does not ignore `.env.example`.
- `DATABASE_URL` and `DIRECT_URL` purposes are separated.
- `SETUP_TOKEN` is blank in `.env.example` and documented as one-time server-only bootstrap secret.
- Environment rules align with ARCHITECTURE.md and CODING_RULES.md.

## 10. Blockers

None.

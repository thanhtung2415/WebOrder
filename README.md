# Web Order Quan Nuoc/Ca Phe

Phase 0 project foundation for a QR-based cafe/restaurant ordering system.

## Prerequisites

- Node.js 24 or compatible active LTS
- npm
- PostgreSQL/Supabase PostgreSQL for database-backed validation

## Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Environment Setup

Copy `.env.example` to a local `.env` file for your machine. Do not commit `.env`.

The frontend may only use:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_BASE_URL
```

Server-only secrets such as `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `SETUP_TOKEN` and `QR_SESSION_SECRET` must never be exposed to the browser.

See `docs/ENVIRONMENT.md` for the full variable reference.

## Run Backend

```bash
cd backend
npm run dev
```

Backend routes:

- Health: `GET /api/v1/health`
- Readiness: `GET /api/v1/health/ready`
- Swagger: `/api/docs`

## Run Frontend

```bash
cd frontend
npm run dev
```

The frontend starts with customer, staff and admin layout shells only. Business features begin in later phases.

## Prisma

```bash
cd backend
npm run prisma:format
npm run prisma:validate
```

Do not use `prisma db push` as the production migration strategy.

## Tests

```bash
cd backend
npm run lint
npm run build
npm run test
npm run test:e2e

cd ../frontend
npm run lint
npm run build
npm run test
```

Database connectivity tests are opt-in:

```bash
cd backend
RUN_DB_TESTS=true npm run test -- prisma.connectivity.spec.ts
```

## Project Structure

```text
docs/
backend/
  prisma/
  src/
    common/
    config/
    database/
    health/
frontend/
  src/
    app/
    customer/
    staff/
    admin/
    components/
    services/
    hooks/
    stores/
    locales/
    types/
    utils/
```

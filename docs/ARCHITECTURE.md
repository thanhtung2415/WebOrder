# ARCHITECTURE - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.1  
**Last updated:** 2026-09-10

This is the official architecture path. The original Vietnamese architecture source is preserved at `docs/Kien_truc_Web_Order_Quan_Nuoc.md`.

## 1. Stack

```text
Frontend: React, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, shadcn/ui, react-i18next
Backend:  Node.js, NestJS, TypeScript, REST API, Prisma ORM, class-validator, Swagger/OpenAPI
Database: PostgreSQL hosted on Supabase
Auth:     Supabase Auth with Google OAuth
Realtime: Supabase Realtime Broadcast through transactional outbox
Storage:  Supabase Storage
Cron:     Supabase Cron or NestJS Scheduler
```

Do not change this stack without updating SRS, Business Rules, Database and API first.

## 2. System Flow

```text
React Customer/Admin/Staff Web
        -> NestJS REST API
        -> Prisma
        -> Supabase PostgreSQL
        -> Transactional Outbox
        -> Supabase Realtime Broadcast
```

Frontend never directly performs critical business decisions such as inventory reserve/consume, VAT, discount, payment confirmation, role assignment or session closure.

## 3. Application Areas

| Area | Responsibility |
|---|---|
| Customer QR Web | QR session, menu, cart, order confirm, order status, service requests |
| Staff Web | Tables, order queue, bar/kitchen status, service handling, bill/payment |
| Admin Web | Branch, menu, recipe, inventory, staff/RBAC, shift, reports, audit |
| Backend API | Auth mapping, RBAC, validation, transactions, state transitions, outbox |
| PostgreSQL | Source of truth for setup, inventory, reservation, order, bill, payment, attendance, audit and idempotency |

## 4. Backend Modules

```text
auth, setup, users, roles, permissions, branches,
tables, qr, sessions,
categories, products, product-options, recipes,
units, ingredients, inventory, inventory-reservations, inventory-transactions,
orders, order-items, kitchen,
bills, bill-items, bill-adjustments, payments, vouchers,
shifts, attendance, reports, audit-logs, realtime-outbox, prisma
```

## 5. Concurrency Model

- QR session: partial unique index for one open session per table.
- Last-cup reservation: conditional inventory row update inside PostgreSQL transaction.
- Confirm order: lock cart/session/reservations; unique `orders.cart_id`.
- Split/Merge/Void bill: lock session, bills and order items by stable UUID order.
- Payment: one PENDING/SUCCEEDED payment per bill with idempotency key.
- Setup: singleton `system_setup` row plus transaction lock.
- Scheduler jobs use `FOR UPDATE SKIP LOCKED` for reservation expiry and auto checkout batches.

## 6. Realtime Model

Business transaction writes to `realtime_outbox`. A worker broadcasts only after commit. Clients treat realtime as notification and refetch REST snapshots after reconnect.

## 7. Deployment Shape

```text
Frontend -> Vercel/Cloudflare Pages
Backend  -> Node.js hosting
Database -> Supabase PostgreSQL
Auth     -> Supabase Auth
Storage  -> Supabase Storage
Cron     -> Supabase Cron or NestJS Scheduler
```

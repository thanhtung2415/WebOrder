# CODING RULES - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.0  
**Last updated:** 2026-09-10  
**Applies to:** AI coding agents and human developers  
**Document priority:** SRS -> BUSINESS_RULES -> DATABASE -> API -> ARCHITECTURE -> DEVELOPMENT_PLAN -> CODING_RULES -> Code

## 1. Purpose

This document defines mandatory implementation rules for the Web Order project. It is not a feature specification and MUST NOT change business requirements.

Every implementation task MUST follow the official documents in priority order:

```text
SRS -> BUSINESS_RULES -> DATABASE -> API -> ARCHITECTURE -> DEVELOPMENT_PLAN -> CODING_RULES -> Code
```

If code conflicts with an official document, code MUST be changed. If official documents conflict with each other, follow the priority order above and stop the affected work if the conflict cannot be resolved safely.

## 2. General Coding Principles

- CR-GEN-001 MUST follow SOLID principles where they improve clarity, testability and change safety.
- CR-GEN-002 MUST keep separation of concerns between presentation, API boundary, application service, domain/business logic, repository and database.
- CR-GEN-003 MUST keep functions small, focused and named by intent.
- CR-GEN-004 MUST prefer explicit code over hidden magic.
- CR-GEN-005 MUST prefer readable code over clever code.
- CR-GEN-006 MUST avoid duplicated business logic. Shared critical rules belong in one service/domain utility with tests.
- CR-GEN-007 SHOULD use DRY, but MUST NOT create abstractions only because they may be useful later.
- CR-GEN-008 MUST NOT add architecture, libraries, frameworks, microservices or Redis unless the official documents are updated first.
- CR-GEN-009 MUST NOT introduce hidden side effects in validators, mappers or read/query functions.
- CR-GEN-010 MUST NOT silently swallow errors. Convert expected errors to standard API errors and log unexpected errors safely.
- CR-GEN-011 MUST keep changes scoped to the assigned task and current phase.
- CR-GEN-012 MUST NOT hard delete operational history unless the database contract explicitly allows it.

## 3. TypeScript Rules

- CR-TS-001 MUST use TypeScript strict mode for backend and frontend.
- CR-TS-002 MUST NOT use `any` unless a short reason is documented near the type boundary.
- CR-TS-003 MUST NOT use `@ts-ignore` to hide type errors. Prefer correct types, narrow types, or `@ts-expect-error` only in intentional type tests.
- CR-TS-004 MUST NOT use non-null assertion `!` casually. Prove the value through validation or explicit guard code.
- CR-TS-005 MUST give public functions, service methods and exported helpers explicit return types.
- CR-TS-006 MUST use defined enums/types instead of magic strings for statuses, permissions, payment methods, event names and business state.
- CR-TS-007 MUST keep DTO and API types explicit.
- CR-TS-008 SHOULD share API contracts between frontend and backend when the project has a safe shared contract path.
- CR-TS-009 MUST NOT duplicate critical type definitions across frontend/backend if a shared contract exists.

## 4. Backend Architecture Rules

Backend flow MUST follow:

```text
Controller -> Application/Service -> Domain/business logic -> Prisma/Repository -> PostgreSQL
```

- CR-BE-001 MUST use NestJS, TypeScript, REST API, Prisma, class-validator and Swagger/OpenAPI as defined in ARCHITECTURE.md.
- CR-BE-002 Controller MUST only receive requests, validate DTOs, read authenticated context, call application service and return response.
- CR-BE-003 Controller MUST NOT calculate inventory, VAT, discount, payment decisions, bill allocation, reservation logic or complex Prisma business transactions.
- CR-BE-004 Business logic MUST live in the appropriate service/domain layer.
- CR-BE-005 Repository/Prisma access MUST not bypass domain invariants for critical mutations.
- CR-BE-006 Backend MUST be authoritative for authentication mapping, authorization, price, inventory, discount, VAT, payment and state transitions.
- CR-BE-007 Backend MUST return the standard API envelope from API.md.
- CR-BE-008 Backend MUST use API.md error codes when a code exists. Do not invent random business error strings.
- CR-BE-009 Backend MUST write Swagger/OpenAPI contracts that match API.md.
- CR-BE-010 Backend MUST keep branch scope explicit in every staff/admin operation.

## 5. Database Rules

- CR-DB-001 PostgreSQL is the source of truth for setup, auth mapping, RBAC, QR/session, cart reservation, inventory, orders, bills, payments, attendance, idempotency, audit and realtime outbox.
- CR-DB-002 Prisma MUST NOT bypass PostgreSQL invariants from schema.prisma and migration.sql.
- CR-DB-003 Critical business mutation MUST run in a database transaction.
- CR-DB-004 MUST NOT use a read -> client/business calculation -> update pattern when a race condition can exist.
- CR-DB-005 MUST use conditional UPDATE, row locks, unique constraints, triggers or transactions according to DATABASE.md.
- CR-DB-006 When locking multiple rows, MUST lock in deterministic order, normally stable UUID order.
- CR-DB-007 MUST preserve append-only tables: inventory transactions, audit logs and order item status history.
- CR-DB-008 MUST NOT update/delete audit or inventory ledger history to undo a business action. Create a compensating transaction instead.
- CR-DB-009 MUST respect no-hard-delete operational history for orders, order items, bills, payments, inventory ledger, audit logs and attendance history.
- CR-DB-010 Schema changes MUST follow: business/document requirement -> Prisma schema -> migration -> validation/test.
- CR-DB-011 MUST NOT use `prisma db push` as production migration strategy.
- CR-DB-012 Applied production migrations MUST NOT be rewritten. Create a new migration instead. During current pre-production initial migration work, follow repository state carefully.

## 6. Transaction Rules

- CR-TX-001 Transaction MUST be short, deterministic and scoped to one business mutation.
- CR-TX-002 Transaction MUST validate current database state before mutation.
- CR-TX-003 Transaction MUST lock required rows before applying critical changes.
- CR-TX-004 Transaction MUST write ledger, audit and realtime_outbox inside the same business transaction when applicable.
- CR-TX-005 Transaction MUST commit before external/realtime processing.
- CR-TX-006 MUST NOT call Supabase Realtime directly inside a business transaction.
- CR-TX-007 MUST NOT upload files inside a database transaction.
- CR-TX-008 MUST NOT call external payment providers inside a long database transaction.
- CR-TX-009 SHOULD avoid network calls inside transactions whenever possible.
- CR-TX-010 Scheduler batch jobs MUST use safe locking patterns such as `FOR UPDATE SKIP LOCKED` where DATABASE.md requires it.

Recommended pattern:

```text
BEGIN
-> validate current DB state
-> lock required rows
-> perform mutation
-> write ledger/audit/outbox
-> COMMIT
-> process external/realtime after commit
```

## 7. Inventory and Reservation Rules

- CR-INV-001 Frontend MUST NOT decide stock availability for critical logic.
- CR-INV-002 Available inventory MUST be treated as `physical_quantity - reserved_quantity`.
- CR-INV-003 Ingredient base units are authoritative for recipes, inventory balances and reservations.
- CR-INV-004 Inventory import MUST snapshot input quantity, input unit, conversion factor and converted base quantity.
- CR-INV-005 Reservation authority is PostgreSQL, not Redis or frontend state.
- CR-INV-006 Reservation TTL is per Cart Item and defaults to 10 minutes.
- CR-INV-007 Expired reservations MUST NOT be revived. Backend must check stock again.
- CR-INV-008 Updating quantity, size, topping or any recipe-changing option MUST re-check stock and reset TTL only for that cart item's active reservations.
- CR-INV-009 Note-only cart item updates MUST NOT reset reservation TTL.
- CR-INV-010 Cancel `NEW` order item MUST create one RETURN ledger effect.
- CR-INV-011 Cancel `PREPARING` or `READY` order item MUST create one WASTE ledger effect.
- CR-INV-012 Cancel side effects MUST be idempotent and MUST NOT produce duplicate RETURN/WASTE ledgers for the same order item cancellation.

## 8. Money, Billing and Payment Rules

- CR-MONEY-001 MUST NOT use JavaScript floating point for critical money calculations.
- CR-MONEY-002 Money calculations MUST use Decimal/NUMERIC-compatible values.
- CR-MONEY-003 Frontend MUST NOT send subtotal, discountAmount, vatAmount or total for backend to trust directly.
- CR-MONEY-004 Backend MUST calculate subtotal, discount, VAT and total from authoritative source data.
- CR-MONEY-005 VND VAT MUST use `vatAmount = ROUND(preVat * vatRate / 100, 0)`.
- CR-MONEY-006 MVP MUST NOT implement mixed payment.
- CR-MONEY-007 MVP MUST NOT implement partial payment.
- CR-BILL-001 Split, merge and void bill MUST run inside a transaction.
- CR-BILL-002 MUST NOT over-allocate BillItem quantity beyond ordered quantity.
- CR-BILL-003 Paid bills MUST NOT be split, merged, voided, adjusted or have totals changed.
- CR-BILL-004 Merge MUST NOT calculate `total = bill1.total + bill2.total`.
- CR-BILL-005 Merge MUST move allocations, reverse source adjustments if needed, mark source bills MERGED, recalculate subtotal, discount, VAT and total, and write audit.
- CR-BILL-006 Void MUST NOT cancel orders. It releases allocations because VOID bills do not count as effective allocations.
- CR-BILL-007 Direct discount plus voucher requires DISCOUNT_OVERRIDE permission, reason, actor, before snapshot, after snapshot and audit.
- CR-PAY-001 Payment amount MUST equal bill total.
- CR-PAY-002 One bill MAY have only one PENDING or SUCCEEDED payment in MVP.
- CR-PAY-003 Payment confirmation MUST be idempotent and terminal transitions MUST NOT be repeated.

## 9. Authentication Rules

- CR-AUTH-001 Supabase Auth is responsible for authentication.
- CR-AUTH-002 Backend MUST verify Supabase JWT for staff/admin requests.
- CR-AUTH-003 Backend identity MUST come from verified `JWT.sub`.
- CR-AUTH-004 Backend MUST NOT trust `authUserId`, `actorId`, `role` or `permission` from client request.
- CR-AUTH-005 `users.auth_user_id` maps Supabase identity and MUST NOT require a database FK to `auth.users`.
- CR-AUTH-006 Supabase service-role key MUST be server-only.
- CR-AUTH-007 First-time setup MUST require verified Supabase Google JWT plus one-time setup token.
- CR-AUTH-008 MUST NOT implement "first login becomes admin".
- CR-AUTH-009 Setup token plaintext MUST NOT be logged or persisted.

## 10. Authorization Rules

- CR-AZ-001 Every protected endpoint MUST use backend guard authorization.
- CR-AZ-002 Hiding buttons in frontend MUST NOT be treated as security.
- CR-AZ-003 Authorization MUST check account status.
- CR-AZ-004 Authorization MUST check StaffBranch membership and branch scope.
- CR-AZ-005 Authorization MUST check roles and permissions.
- CR-AZ-006 Authorization MUST check shift access when API.md marks it applicable.
- CR-AZ-007 Backend MUST NOT trust `X-Branch-Id` until branch membership is verified.
- CR-AZ-008 Last admin protection MUST be enforced when changing roles/status.
- CR-AZ-009 Customer QR session access MUST be scoped to that branch, table and session only.

## 11. Customer QR Security Rules

- CR-QR-001 MUST NOT use raw table/database ID as a customer capability.
- CR-QR-002 QR token MUST be random, rotatable and disable-able.
- CR-QR-003 Each table MAY have only one active QR token.
- CR-QR-004 QR scan MUST create or join the current open table session.
- CR-QR-005 Each table MAY have only one non-closed session.
- CR-QR-006 QR Session token MUST scope access by branch, table and session.
- CR-QR-007 Public QR, cart, order and service request endpoints MUST be rate-limited.
- CR-QR-008 Customer MUST NOT access resources outside its QR session.

## 12. Idempotency Rules

- CR-IDEMP-001 Critical mutations in API.md MUST require `Idempotency-Key`.
- CR-IDEMP-002 Setup, confirm order, inventory mutation, bill split/merge/void, discount mutation and payment mutation MUST use persistent PostgreSQL idempotency.
- CR-IDEMP-003 Same `Idempotency-Key` plus same payload MUST replay stored response.
- CR-IDEMP-004 Same `Idempotency-Key` plus different payload MUST return `IDEMPOTENCY_KEY_REUSED`.
- CR-IDEMP-005 Redis MUST NOT be the only source for critical idempotency.
- CR-IDEMP-006 Idempotency record MUST store scope, key, request hash, response status/body, status and expiry.

## 13. Realtime Rules

- CR-RT-001 Business transaction MUST insert `realtime_outbox` event rows for applicable realtime notifications.
- CR-RT-002 Worker MUST broadcast Supabase Realtime only after commit.
- CR-RT-003 Consumers MUST tolerate duplicate events.
- CR-RT-004 After reconnect, REST refetch is the official snapshot source.
- CR-RT-005 Realtime event payloads MUST NOT expose secrets or customer-forbidden internals.

## 14. Audit Rules

- CR-AUD-001 Critical actions MUST write AuditLog in the same transaction as the business action.
- CR-AUD-002 Audit should include actor, action, entity, reason, before, after, requestId and timestamp when applicable.
- CR-AUD-003 AuditLog MUST be append-only.
- CR-AUD-004 MUST NOT UPDATE or DELETE audit history.
- CR-AUD-005 MUST NOT write secrets, tokens, JWT, setup token or service-role key into audit fields.
- CR-AUD-006 Audit query endpoints MUST redact sensitive data according to viewer permission.

Critical audited actions include setup, QR rotate/disable, transfer table, cancel item, split/merge/void bill, discount override, payment confirm, inventory mutation, recipe update, user/role/shift/attendance changes and session close.

## 15. Error Handling Rules

- CR-ERR-001 API errors MUST follow API.md standard error envelope.
- CR-ERR-002 MUST NOT return stack traces, SQL, JWT, secrets, raw internal exceptions or sensitive payment payloads.
- CR-ERR-003 Customer-facing errors MUST NOT expose sensitive inventory details.
- CR-ERR-004 Expected business failures MUST use API.md error codes.
- CR-ERR-005 Unexpected errors MUST be logged with requestId and safely returned as `INTERNAL_ERROR`.
- CR-ERR-006 Validation failures MUST return `VALIDATION_ERROR` with safe messages.

## 16. Validation Rules

- CR-VAL-001 Every request DTO MUST be validated server-side.
- CR-VAL-002 Frontend validation is UX only and MUST NOT be trusted.
- CR-VAL-003 MUST validate UUIDs, enums, quantities, money inputs, string length, option relationships, branch scope and state transitions.
- CR-VAL-004 MUST validate option min/max/default rules before cart/order operations.
- CR-VAL-005 MUST validate all state transitions for session, order item, service request, bill, payment, stocktake and attendance.
- CR-VAL-006 MUST reject client-provided derived totals, inventory balances and actor identity when backend can derive them.

## 17. Frontend Architecture Rules

- CR-FE-001 Frontend MUST use React, TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS, shadcn/ui and react-i18next.
- CR-FE-002 Frontend MUST separate customer, staff and admin application areas.
- CR-FE-003 TanStack Query MUST be used for server state.
- CR-FE-004 Zustand SHOULD be used only for local/client UI state.
- CR-FE-005 MUST NOT copy server business state into Zustand unnecessarily.
- CR-FE-006 Frontend MUST NOT calculate final business results. It may show previews, but backend response is authoritative.
- CR-FE-007 Components MUST NOT call Supabase/PostgreSQL directly for critical business mutations.
- CR-FE-008 Critical write flow MUST be: Frontend -> NestJS -> PostgreSQL.
- CR-FE-009 Customer UI MUST be mobile-first.
- CR-FE-010 Staff/Admin UI MUST be responsive for tablet/desktop.
- CR-FE-011 Dark mode MUST work.
- CR-FE-012 User-facing text MUST go through i18n.

## 18. React Rules

- CR-REACT-001 MUST use functional components.
- CR-REACT-002 MUST follow React hooks rules.
- CR-REACT-003 MUST keep components reasonably small and focused.
- CR-REACT-004 SHOULD separate business/API hooks from presentation components when complexity grows.
- CR-REACT-005 MUST NOT scatter direct fetch calls through components.
- CR-REACT-006 API access MUST go through centralized service/query layer.
- CR-REACT-007 Loading, error and empty states are required for user-facing server-state views.
- CR-REACT-008 Customer order flow MUST remain usable on mobile.
- CR-REACT-009 Bar/kitchen/staff queue screens MUST be readable on tablet/desktop and support elapsed-time indicators from API data.

## 19. API Client Rules

- CR-API-CLIENT-001 Frontend MUST use a centralized API client.
- CR-API-CLIENT-002 API client MUST support Authorization bearer token.
- CR-API-CLIENT-003 API client MUST support QR Session token.
- CR-API-CLIENT-004 API client MUST support `X-Branch-Id`.
- CR-API-CLIENT-005 API client MUST support `X-Request-Id`.
- CR-API-CLIENT-006 API client MUST support `Idempotency-Key`.
- CR-API-CLIENT-007 API client MUST parse the standard API error envelope.
- CR-API-CLIENT-008 API client MUST NOT auto-retry critical POST mutations unless a valid idempotency key is attached and retry policy is explicit.

## 20. Logging Rules

- CR-LOG-001 Backend logs MUST be structured.
- CR-LOG-002 Request logs MUST include requestId, method, route, status and duration.
- CR-LOG-003 Logs SHOULD include internal actorId and branchId when applicable.
- CR-LOG-004 MUST NOT log JWT, setup token, full QR token, QR session token, password, secret, Supabase service-role key or sensitive payment payload.
- CR-LOG-005 Errors MUST be logged with enough context to debug without leaking secrets.
- CR-LOG-006 Audit logs are not application logs; do not use logs as replacement for required AuditLog rows.

## 21. Naming Rules

- CR-NAME-001 TypeScript files SHOULD use kebab-case, for example `payment.service.ts`.
- CR-NAME-002 NestJS classes MUST use PascalCase with role suffix, for example `PaymentService`, `PaymentController`, `PaymentModule`.
- CR-NAME-003 DTO classes MUST use PascalCase and end with `Dto`, for example `CreatePaymentDto`.
- CR-NAME-004 Service files MUST end with `.service.ts`.
- CR-NAME-005 Controller files MUST end with `.controller.ts`.
- CR-NAME-006 Module files MUST end with `.module.ts`.
- CR-NAME-007 Guard files MUST end with `.guard.ts`; policy files SHOULD end with `.policy.ts`.
- CR-NAME-008 Prisma model names MUST stay PascalCase and map to documented snake_case table names.
- CR-NAME-009 Database columns MUST remain snake_case through Prisma `@map` where needed.
- CR-NAME-010 API JSON fields MUST use camelCase.
- CR-NAME-011 API resources SHOULD use plural nouns and match API.md.
- CR-NAME-012 Test files SHOULD use `.spec.ts` for unit tests and `.e2e-spec.ts` for e2e tests unless the scaffold standard differs.
- CR-NAME-013 Environment variables MUST use SCREAMING_SNAKE_CASE.
- CR-NAME-014 Permission codes, audit actions, statuses and event names MUST match API.md/DATABASE.md vocabulary.

## 22. Folder Structure Rules

Backend SHOULD use a simple NestJS structure:

```text
src/
  common/
  config/
  database/
  modules/
    auth/
    setup/
    staff/
    branch/
    menu/
    inventory/
    table/
    order/
    billing/
    payment/
    attendance/
    reports/
```

Each backend module MAY contain:

```text
controller
service
dto
guards
policies
tests
```

Frontend SHOULD use:

```text
src/
  app/
  customer/
  staff/
  admin/
  components/
  services/
  hooks/
  stores/
  types/
  locales/
  utils/
```

- CR-FOLDER-001 Folder structure MUST fit ARCHITECTURE.md.
- CR-FOLDER-002 MUST NOT create unnecessarily complex folder architecture.
- CR-FOLDER-003 Shared common code MUST not become a dumping ground for feature-specific logic.
- CR-FOLDER-004 Module boundaries SHOULD follow business domains from DEVELOPMENT_PLAN.md.

## 23. Testing Rules

- CR-TEST-001 Compile success alone MUST NOT be considered done.
- CR-TEST-002 Every feature MUST include tests required by DEVELOPMENT_PLAN.md for its phase.
- CR-TEST-003 Critical database features MUST be tested with real PostgreSQL, not only mocked Prisma.
- CR-TEST-004 Setup concurrency MUST be tested.
- CR-TEST-005 QR/session concurrency MUST be tested.
- CR-TEST-006 Inventory and reservation concurrency MUST be tested.
- CR-TEST-007 Order confirmation and cancellation inventory effects MUST be tested.
- CR-TEST-008 Bill allocation, split, merge and void MUST be tested.
- CR-TEST-009 Payment duplicate/idempotency behavior MUST be tested.
- CR-TEST-010 Attendance overnight, logout, auto checkout and manual adjustment MUST be tested.
- CR-TEST-011 Every critical bug fix MUST include a regression test.
- CR-TEST-012 Security tests MUST cover auth, RBAC, branch isolation, public QR abuse and forbidden actions.
- CR-TEST-013 Load tests in hardening MUST include 200 concurrent menu readers, QR scans, add-to-cart requests and order confirmations as defined in DEVELOPMENT_PLAN.md.

## 24. Environment and Secret Rules

- CR-ENV-001 MUST NOT commit `.env`.
- CR-ENV-002 MUST provide `.env.example`.
- CR-ENV-003 MUST separate development, test, staging and production environment values.
- CR-ENV-004 MUST NOT use production credentials in local or test.
- CR-ENV-005 Environment variables MUST be validated at startup.
- CR-ENV-006 Supabase anon key may be used by frontend where appropriate; Supabase service-role key MUST stay server-only.
- CR-ENV-007 Setup token MUST be generated and stored safely outside source code.
- CR-ENV-008 CORS allowlist, app URLs, JWT config, database URL and storage config MUST be environment-driven.

## 25. Git Rules

- CR-GIT-001 A phase/task SHOULD be committed in small, clear commits.
- CR-GIT-002 MUST NOT commit `.env`, `node_modules`, `dist`, `coverage`, secrets or generated temporary files.
- CR-GIT-003 Commit message SHOULD follow examples such as:

```text
feat(auth): implement Supabase JWT guard
feat(inventory): add stock import transaction
test(order): add duplicate confirmation test
fix(billing): prevent over-allocation
```

- CR-GIT-004 MUST NOT mix unrelated phases in one commit.
- CR-GIT-005 MUST NOT remove constraints, failing tests or documented rules just to make a task pass.

## 26. AI Coding Agent Rules

Every AI coding agent implementation task MUST do the following before editing code:

- CR-AI-001 Read CODING_RULES.md.
- CR-AI-002 Read the current phase section in DEVELOPMENT_PLAN.md.
- CR-AI-003 Read related API endpoint contract in API.md.
- CR-AI-004 Read related Business Rule IDs in BUSINESS_RULES.md.
- CR-AI-005 Read related Database models, constraints, indexes and triggers in DATABASE.md, schema.prisma and migration.sql.
- CR-AI-006 Inspect current code before assuming files, modules, tables or models exist.
- CR-AI-007 Implement only the assigned task and required supporting code.

AI coding agents MUST NOT:

- CR-AI-008 Change business rules on their own.
- CR-AI-009 Change schema only to make coding easier.
- CR-AI-010 Add Redis for critical MVP state, locks or idempotency.
- CR-AI-011 Add microservices.
- CR-AI-012 Change framework or approved stack.
- CR-AI-013 Implement a later dependent phase without instruction.
- CR-AI-014 Rewrite unrelated modules.
- CR-AI-015 Delete constraints to make tests pass.
- CR-AI-016 Remove failing tests instead of fixing behavior.
- CR-AI-017 Hard-code production data, credentials or branch-specific secrets.

If requirements conflict:

```text
STOP
Report BLOCKED with the conflicting files/sections and no business behavior change.
```

## 27. Definition of Done for One Coding Task

A coding task is DONE only when:

- CR-DOD-TASK-001 Code compiles.
- CR-DOD-TASK-002 Lint passes.
- CR-DOD-TASK-003 Related tests pass.
- CR-DOD-TASK-004 Existing tests are not broken.
- CR-DOD-TASK-005 API matches API.md contract.
- CR-DOD-TASK-006 Business Rules are followed.
- CR-DOD-TASK-007 Permissions are enforced.
- CR-DOD-TASK-008 Transaction rules are followed where required.
- CR-DOD-TASK-009 Audit/outbox are written where required.
- CR-DOD-TASK-010 No critical TODO remains.
- CR-DOD-TASK-011 No secrets are committed or logged.
- CR-DOD-TASK-012 File changes stay within assigned scope.

## 28. Definition of Done for One Phase

- CR-DOD-PHASE-001 A phase is complete only when every Definition of Done item in DEVELOPMENT_PLAN.md for that phase is satisfied.
- CR-DOD-PHASE-002 MUST NOT move to a dependent phase while the current phase is failing.
- CR-DOD-PHASE-003 MUST document test evidence and known residual risk before marking a phase complete.

## 29. Current Repository Notes

At the time this document is created, repository inspection shows:

- `docs/` contains official SRS, Business Rules, Database, API, Architecture and Development Plan documents.
- `backend/prisma/` contains Prisma schema and initial database migration.
- Backend NestJS app and Frontend React app are not scaffolded yet.

These notes are descriptive only. Future implementation MUST inspect the repository again before making code changes.

## 30. Validation

This document is aligned with:

- SRS.md: customer QR flow, staff/admin roles, setup security, MVP boundaries and document priority.
- BUSINESS_RULES.md: first-time setup, QR session, unit conversion, cancellation, billing, payment, discount, attendance, VAT, auth and idempotency rules.
- DATABASE.md: PostgreSQL source of truth, invariants, transaction strategy, append-only history and concurrency strategy.
- API.md: endpoint contracts, standard response/error format, headers, idempotency, security matrix and error codes.
- ARCHITECTURE.md: React/NestJS/Prisma/Supabase stack, backend flow, transactional outbox and deployment shape.
- DEVELOPMENT_PLAN.md: phase order, test strategy, security strategy, load test strategy and Definition of Done.

## 31. Blockers

None found in the current aligned documentation.

# API CONTRACT - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.1  
**Base path:** `/api/v1`  
**Protocol:** HTTPS + JSON  
**Backend:** NestJS REST API  
**Last updated:** 2026-09-10

## 1. Conventions

- JSON fields use `camelCase`.
- Timestamps are ISO-8601 UTC; branch timezone is used for business date/shift calculations.
- Staff requests send Supabase JWT in `Authorization: Bearer <token>` and `X-Branch-Id`.
- Customer requests use QR Session bearer token after QR scan.
- Backend never trusts client-provided `authUserId`, `actorId`, `branchId`, price, subtotal, VAT, total or inventory balance when those can be derived server-side.

Success:

```json
{ "success": true, "data": {}, "meta": {}, "requestId": "req_..." }
```

Error:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." }, "requestId": "req_..." }
```

## 2. Authentication and Authorization

Supabase handles Google OAuth. Backend verifies Supabase JWT and maps `JWT.sub` to `users.auth_user_id`.

Permission codes used by API:

```text
SETUP_COMPLETE
BRANCH_READ BRANCH_MANAGE
STAFF_READ STAFF_APPROVE STAFF_REJECT STAFF_STATUS_MANAGE STAFF_ROLE_MANAGE
ROLE_READ ROLE_MANAGE
SHIFT_READ SHIFT_MANAGE ATTENDANCE_READ ATTENDANCE_ADJUST
MENU_READ MENU_MANAGE RECIPE_READ RECIPE_MANAGE
INVENTORY_READ INVENTORY_IMPORT INVENTORY_ADJUST STOCKTAKE_MANAGE
TABLE_READ TABLE_MANAGE QR_MANAGE SESSION_READ SESSION_MANAGE SESSION_TRANSFER SESSION_CLOSE
ORDER_READ ORDER_CREATE ORDER_STATUS_UPDATE ORDER_CANCEL
BAR_QUEUE_READ KITCHEN_QUEUE_READ
SERVICE_REQUEST_READ SERVICE_REQUEST_HANDLE
BILL_READ BILL_MANAGE BILL_SPLIT BILL_MERGE BILL_ISSUE BILL_VOID
VOUCHER_MANAGE DISCOUNT_APPLY DISCOUNT_OVERRIDE
PAYMENT_READ PAYMENT_CREATE PAYMENT_CONFIRM
REPORT_READ REPORT_EXPORT AUDIT_READ
```

## 3. Idempotency

`Idempotency-Key` is required for setup, confirm order, inventory mutations, bill split/merge/void, discount mutation and payment mutation.

Backend stores idempotency in PostgreSQL table `idempotency_keys`:

```text
scope, key, request_hash, response_status, response_body, status, expires_at
```

Same key + same payload returns stored response. Same key + different payload returns `409 IDEMPOTENCY_KEY_REUSED`.

## 4. Setup APIs

### GET /setup/status

- Auth: Public, rate-limited.
- Response: `{ "status": "PENDING" | "COMPLETED" }`.

### POST /setup

- Auth: Supabase JWT from Google OAuth.
- Body:

```json
{
  "setupToken": "one-time-secret",
  "branch": { "code": "MAIN", "name": "Main Branch", "timezone": "Asia/Ho_Chi_Minh" },
  "admin": { "displayName": "Owner" }
}
```

- Rules: Verify JWT email, verify setup token hash, lock singleton setup state, create Branch/User/StaffBranch/ADMIN role/AuditLog, consume token and set setup `COMPLETED` in one transaction.
- Errors: `INVALID_TOKEN`, `INVALID_SETUP_TOKEN`, `SETUP_ALREADY_COMPLETED`, `SETUP_IN_PROGRESS`, `SETUP_TOKEN_EXPIRED`.

## 5. Auth APIs

| Endpoint | Contract |
|---|---|
| `POST /auth/registrations` | Staff first login registration after setup; profile starts `PENDING`; identity from JWT only. |
| `GET /auth/me` | Returns user, branch memberships, roles, permissions and current shift access. |
| `POST /auth/logout` | Normal logout; server sets `check_out_at = now`, `check_out_source = NORMAL_LOGOUT`; no client time accepted. |

## 6. Branch, Staff and RBAC APIs

| Endpoint group | Permission | Notes |
|---|---|---|
| `GET/POST/PATCH /branches` | `BRANCH_READ`, `BRANCH_MANAGE` | Branch timezone and `attendanceGraceMinutes` are managed here. |
| `GET /staff`, `GET /staff/:id` | `STAFF_READ` | Branch-scoped. |
| `POST /staff/:id/approval` | `STAFF_APPROVE` | Creates membership/roles and activates user. |
| `POST /staff/:id/rejection` | `STAFF_REJECT` | Reason required. |
| `PATCH /staff/:id/status` | `STAFF_STATUS_MANAGE` | Reason required for lock/inactivate. |
| `PUT /staff/:id/branches/:branchId/roles` | `STAFF_ROLE_MANAGE` | Must not remove the last admin. |
| `GET/POST/PATCH /roles`, `GET /permissions` | `ROLE_READ`, `ROLE_MANAGE` | RBAC managed by permissions, not role-name checks. |

## 7. Menu, Unit, Ingredient and Recipe APIs

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /products`, `GET /products/:id` | QR session or `MENU_READ` | Customer sees active products and availability, not recipe quantities. |
| `POST/PATCH /products` | `MENU_MANAGE` | Price/options/status changes do not affect old order snapshots. |
| `GET/POST/PATCH /option-groups`, `/option-values` | `MENU_MANAGE` | Supports SIZE, TOPPING, SUGAR, ICE, CUSTOM. |
| `GET /units` | `INVENTORY_READ` or `RECIPE_READ` | Unit catalog: MASS, VOLUME, COUNT, PACKAGE. |
| `POST/PATCH /units` | `INVENTORY_ADJUST` | Unit dimension is immutable after use. |
| `GET/POST/PATCH /ingredients` | `INVENTORY_READ`, `INVENTORY_ADJUST` | Ingredient requires `baseUnitId`; base unit is immutable after ledger use. |
| `GET/PUT /ingredients/:id/units/:unitId` | `INVENTORY_ADJUST` | Manages active conversion to base unit. |
| `GET/POST /products/:id/recipes` | `RECIPE_READ`, `RECIPE_MANAGE` | Recipe quantities are always base-unit quantities. |
| `POST /recipes/:id/activation` | `RECIPE_MANAGE` | Activates exactly one recipe for base/option target. |

## 8. Inventory APIs

### POST /inventory-transactions

- Permission: `INVENTORY_IMPORT` for `IMPORT`, `INVENTORY_ADJUST` for other manual mutations.
- IMPORT body:

```json
{
  "ingredientId": "uuid",
  "type": "IMPORT",
  "inputQuantity": 2,
  "inputUnitId": "uuid",
  "unitCost": 120000,
  "reason": "Nhap sua tuoi"
}
```

- Rules: Backend resolves active conversion to ingredient base unit and persists snapshot: input quantity, input unit, conversion factor and converted base quantity.
- Errors: `INVALID_UNIT_CONVERSION`, `INVENTORY_WOULD_BE_NEGATIVE`, `IDEMPOTENCY_KEY_REUSED`.

Other inventory endpoints:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /inventory` | `INVENTORY_READ` | Returns physical, reserved and computed available. |
| `GET /inventory/:id` | `INVENTORY_READ` | Includes recent immutable ledger. |
| `GET /inventory-transactions` | `INVENTORY_READ` | Cursor paginated ledger. |
| `GET/POST/PATCH /stocktakes` | `STOCKTAKE_MANAGE` | Completion posts stocktake ledger rows. |

## 9. QR, Table and Session APIs

### POST /qr-sessions

- Auth: Public QR token.
- Body: `{ "qrToken": "uuid" }`.
- Rules: If table has no non-closed session, create one. If it has one, join it. Database partial unique resolves race.
- Response: QR Session token and session/table summary.
- Errors: `INVALID_QR`, `QR_DISABLED`, `TABLE_INACTIVE`.

Other endpoints:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET/POST/PATCH /tables` | `TABLE_READ`, `TABLE_MANAGE` | Branch-scoped table management. |
| `POST /tables/:id/qr-rotation` | `QR_MANAGE` | Disable old token, create active token. |
| `POST /table-sessions/:id/transfer` | `SESSION_TRANSFER` | Move open session and audit before/after. |
| `POST /table-sessions/:id/closure` | `SESSION_CLOSE` | Requires all effective bills paid/void and no active reservations. |

## 10. Cart and Reservation APIs

### POST /cart/items

- Auth: QR Session or staff with `ORDER_CREATE`.
- Body: `{ "productId": "uuid", "quantity": 1, "optionValueIds": [], "note": "" }`.
- Rules: Resolve recipe, reserve inventory for 10 minutes and set active reservation `expiresAt`.

### PATCH /cart/items/:id

- Auth: QR Session or staff.
- Body may include `quantity`, `optionValueIds`, `note`, `isTakeaway`.
- Rules:
  - Quantity/size/topping/recipe-changing option: recalculate inventory, release/reserve difference and reset only this cart item's active reservation expiry.
  - Note-only update: TTL unchanged.
  - GET cart never refreshes TTL.
  - Expired reservation cannot be revived without new stock check.
- Errors: `RESERVATION_EXPIRED`, `INSUFFICIENT_INVENTORY`.

### DELETE /cart/items/:id

Releases active reservations and removes unconfirmed cart item.

## 11. Order APIs

### POST /orders

- Auth: QR Session or staff with `ORDER_CREATE`.
- Headers: `Idempotency-Key`.
- Rules: Lock cart/session/reservations; create order/order item snapshots; consume reservations; decrement physical stock; write ledger and outbox.

### POST /order-items/:id/cancellation

- Auth: Staff + `ORDER_CANCEL`.
- Body: `{ "reason": "Khach doi mon" }`.
- Rules:
  - `NEW` -> `CANCELLED` + one RETURN ledger.
  - `PREPARING`/`READY` -> `CANCELLED` + one WASTE ledger.
  - `SERVED` cannot be cancelled in MVP unless future policy changes.
  - Reason, actor, audit and status history are required.

No endpoint exists for cancelling an entire order in MVP.

Other endpoints:

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /orders/:id` | QR same session or `ORDER_READ` | Customer view hides internal actors/cost. |
| `GET /table-sessions/:id/orders` | QR same session or `ORDER_READ` | Session order history. |
| `PATCH /order-items/:id/status` | `ORDER_STATUS_UPDATE` | NEW -> PREPARING -> READY -> SERVED. |
| `GET /bar/queue`, `GET /kitchen/queue` | `BAR_QUEUE_READ`, `KITCHEN_QUEUE_READ` | Queue includes elapsed seconds; UI maps 1-3 green, 3-7 orange, 7-10 red, >10 late warning. |

## 12. Service Request APIs

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /service-requests` | QR Session | Types: `CALL_STAFF`, `REQUEST_PAYMENT`. |
| `GET /service-requests` | `SERVICE_REQUEST_READ` | Staff queue. |
| `PATCH /service-requests/:id/status` | `SERVICE_REQUEST_HANDLE` | PENDING -> ACKNOWLEDGED -> RESOLVED. |

## 13. Bill APIs

### POST /bills

- Permission: `BILL_MANAGE`.
- Creates draft bill from unbilled order item quantities in a table session.
- Trigger rejects over-allocation.

### POST /bills/:id/splits

- Permission: `BILL_SPLIT`.
- Splits an unpaid bill into one or more bills.
- Paid bills cannot be split.

### POST /bills/merges

- Permission: `BILL_MERGE`.
- Headers: `Idempotency-Key`.
- Body:

```json
{
  "sourceBillIds": ["uuid", "uuid"],
  "targetBillId": "uuid",
  "reason": "Gop bill theo yeu cau khach"
}
```

- Rules: all bills same table session, no bill is PAID, no active payment, reverse source discounts, move allocations, mark source bills `MERGED`, recalc destination totals, audit `MERGE_BILL`.
- Realtime: `BILL_MERGED`, `BILL_UPDATED`.
- Errors: `BILL_ALREADY_PAID`, `BILL_HAS_ACTIVE_PAYMENT`, `BILL_MERGE_SESSION_MISMATCH`, `INVALID_BILL_MERGE`.

### POST /bills/:id/voidance

- Permission: `BILL_VOID`.
- Body: `{ "reason": "Tao nham bill" }`.
- Rules: unpaid only; active payment must be cancelled/expired first; order remains; allocations are released because VOID bills no longer count.
- Realtime: `BILL_VOIDED`, `BILL_UPDATED`.

### POST /bills/:id/issuance

- Permission: `BILL_ISSUE`.
- Locks current totals and sets `ISSUED`.

## 14. Discount APIs

### POST /bills/:id/voucher-applications

- Permission: `DISCOUNT_APPLY`; combining with active direct discount requires `DISCOUNT_OVERRIDE`.
- Body: `{ "voucherCode": "SUMMER10", "overrideReason": "..." }`.
- Rules: voucher -> direct discount -> VAT -> total.

### POST /bills/:id/direct-discounts

- Permission: `DISCOUNT_APPLY`; combining with active voucher requires `DISCOUNT_OVERRIDE`.
- Body: `{ "discountType": "PERCENT" | "FIXED_AMOUNT", "discountValue": 10, "reason": "...", "overrideReason": "..." }`.
- Override stores actor, reason, before and after snapshots.

### POST /bill-adjustments/:id/reversal

- Permission: `DISCOUNT_APPLY`.
- Reverses active adjustment without deleting history.

## 15. Payment APIs

### POST /payments

- Permission: `PAYMENT_CREATE`.
- Headers: `Idempotency-Key`.
- Body: `{ "billId": "uuid", "method": "CASH" | "QR_MOCK" }`.
- Rules: bill must be `ISSUED`; payment amount is `bill.total`; no partial/mixed payment; one active/succeeded payment per bill.
- Errors: `PAYMENT_ALREADY_EXISTS`, `BILL_NOT_ISSUED`, `PAYMENT_METHOD_NOT_SUPPORTED`.

### POST /payments/:id/confirmation

- Permission: `PAYMENT_CONFIRM`.
- Headers: `Idempotency-Key`.
- Body: `{ "result": "SUCCEEDED" | "FAILED", "providerRef": "optional", "failureReason": "optional" }`.
- Rules: PENDING -> terminal only once; SUCCEEDED sets bill `PAID` when amount equals total.

### GET /payments/:id

Reads payment status, branch-scoped.

## 16. Shift and Attendance APIs

Shift interval:

```text
start = workDate + startTime
end = workDate + endTime if endTime > startTime
end = workDate + 1 day + endTime if endTime <= startTime
```

| Endpoint | Permission | Notes |
|---|---|---|
| `GET/POST/PATCH /shifts` | `SHIFT_READ`, `SHIFT_MANAGE` | `graceMinutes` is nullable; null means branch default. |
| `GET/POST/PATCH /shift-assignments` | `SHIFT_READ`, `SHIFT_MANAGE` | Branch-scoped schedule. |
| `POST /attendances/check-ins` | Staff self | Server time, source `NORMAL_LOGIN`. |
| `POST /attendances/:id/check-out` | Staff self | Server time, source `NORMAL_LOGOUT`. |
| `POST /attendances/auto-checkout-runs` | Internal scheduler | Closes due attendance after grace; `checkOutAt = scheduled shift end`, source `SYSTEM_AUTO`. |
| `PATCH /attendances/:id` | `ATTENDANCE_ADJUST` | Manual adjustment with reason, before/after and audit. |

## 17. Reports and Audit APIs

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /reports/overview` | `REPORT_READ` | Revenue from PAID bills only. |
| `GET /reports/products` | `REPORT_READ` | Uses order/bill snapshots. |
| `GET /reports/inventory` | `REPORT_READ` | Ledger is source of truth. |
| `GET /reports/attendance` | `REPORT_READ` | Uses overnight and attendance source rules. |
| `POST /report-exports` | `REPORT_EXPORT` | CSV/XLSX MVP. |
| `GET /audit-logs` | `AUDIT_READ` | Append-only, cursor paginated. |

## 18. Realtime Events

Outbox events are written in the same transaction and broadcast after commit.

| Event | Source |
|---|---|
| `ORDER_CREATED` | Confirm order |
| `ORDER_ITEM_STATUS_CHANGED` | Status update/cancellation |
| `INVENTORY_CHANGED` | reserve/release/consume/import/adjust/return/waste |
| `PRODUCT_AVAILABILITY_CHANGED` | inventory/recipe/product changes |
| `SERVICE_REQUEST_CREATED`, `SERVICE_REQUEST_UPDATED` | service requests |
| `BILL_UPDATED` | create/split/merge/void/discount/payment init |
| `BILL_MERGED` | `POST /bills/merges` |
| `BILL_VOIDED` | bill voidance |
| `BILL_PAID` | payment confirmation |
| `SESSION_UPDATED`, `SESSION_CLOSED` | session changes |
| `ATTENDANCE_UPDATED` | check-in/out/auto/manual adjustment |

## 19. Security Matrix

| Group | Public | QR | Waiter | Bar | Kitchen | Cashier | Manager | Admin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Setup status | yes | no | no | no | no | no | no | no |
| Complete setup | Google JWT + setup token | no | no | no | no | no | no | no |
| QR session/menu/cart/order create | limited | own session | support | no | no | no | yes | yes |
| Order queue/status | no | own status | served | bar area | kitchen area | read | yes | yes |
| Bill split/merge/void/payment | no | no | no | no | no | yes | yes | yes |
| Discount override | no | no | no | no | no | no | permission | permission |
| Inventory/recipe/menu mutation | no | no | no | no | no | no | permission | yes |
| Staff/RBAC/shift/report/audit | no | no | no | no | no | no | permission | yes |

## 20. Error Codes

| HTTP | Code |
|---:|---|
| 400 | `VALIDATION_ERROR`, `INVALID_OPTION`, `INVALID_UNIT_CONVERSION`, `INVALID_DISCOUNT`, `INVALID_SPLIT`, `INVALID_BILL_MERGE` |
| 401 | `INVALID_TOKEN`, `INVALID_QR_SESSION` |
| 403 | `FORBIDDEN`, `ACCOUNT_PENDING`, `ACCOUNT_LOCKED`, `SHIFT_NOT_ACTIVE`, `BRANCH_ACCESS_DENIED`, `DISCOUNT_OVERRIDE_REQUIRED`, `INVALID_SETUP_TOKEN` |
| 404 | `USER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `INVENTORY_NOT_FOUND`, `SESSION_NOT_FOUND`, `CART_NOT_FOUND`, `ORDER_NOT_FOUND`, `BILL_NOT_FOUND`, `PAYMENT_NOT_FOUND` |
| 409 | `SETUP_ALREADY_COMPLETED`, `SETUP_IN_PROGRESS`, `IDEMPOTENCY_KEY_REUSED`, `QR_DISABLED`, `TABLE_HAS_OPEN_SESSION`, `SESSION_CLOSED`, `RESERVATION_EXPIRED`, `ORDER_ALREADY_CONFIRMED`, `INVALID_STATUS_TRANSITION`, `BILL_ALLOCATION_EXCEEDED`, `BILL_ALREADY_PAID`, `BILL_HAS_ACTIVE_PAYMENT`, `PAYMENT_ALREADY_EXISTS`, `PAYMENT_ALREADY_CONFIRMED` |
| 422 | `PRODUCT_UNAVAILABLE`, `RECIPE_NOT_CONFIGURED`, `INSUFFICIENT_INVENTORY`, `INVENTORY_WOULD_BE_NEGATIVE`, `VOUCHER_INVALID`, `VOUCHER_EXPIRED`, `VOUCHER_USAGE_LIMIT_REACHED`, `PAYMENT_AMOUNT_MISMATCH`, `CANCELLATION_REASON_REQUIRED`, `SETUP_TOKEN_EXPIRED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

## 21. Open Questions

None. The five former API questions are resolved in `docs/BUSINESS_RULES.md`.

# BUSINESS RULES - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.1  
**Last updated:** 2026-09-10  
**Document priority:** SRS -> BUSINESS_RULES -> DATABASE -> API -> ARCHITECTURE -> Code

Tai lieu nay chot 15 quyet dinh nghiep vu dang dieu khien database va API. Khong duoc tu y thay doi requirement trong khi implement backend/frontend.

## 1. Impact Analysis

| Decision | Affected files | Affected tables | Affected enums | Affected API | Required changes | Risk |
|---|---|---|---|---|---|---|
| Q1 First-Time Setup | BUSINESS_RULES, DATABASE, API, Prisma, migration | `system_setup`, `branches`, `users`, `staff_branches`, `staff_roles`, `audit_logs`, `idempotency_keys` | `setup_status`, `audit_action` | `/setup/status`, `POST /setup` | Setup token hash, singleton setup state, transaction one-time setup | High: privilege takeover if weak |
| Q2 QR auto session | DATABASE, API, Prisma, migration | `table_qr_codes`, `table_sessions` | `session_status`, `qr_status` | `POST /qr-sessions` | QR scan creates or joins current open session; partial unique one open session/table | High: duplicate session race |
| Q3 Full unit conversion | DATABASE, API, Prisma, migration | `units`, `ingredient_units`, `unit_conversions`, `ingredients`, `inventory_transactions` | `unit_dimension` | unit, ingredient, inventory APIs | Base unit per ingredient; import snapshot input unit/factor/base quantity | High: inventory drift |
| Q4 Cancel item RETURN/WASTE | BUSINESS_RULES, DATABASE, API, migration | `order_items`, `inventory_transactions`, `audit_logs`, `realtime_outbox` | `inventory_transaction_type`, `audit_action` | `POST /order-items/:id/cancellation` | NEW returns stock; PREPARING/READY records waste; no double side effect | High: wrong stock |
| Q5 No mixed/partial payment | BUSINESS_RULES, DATABASE, API, Prisma, migration | `bills`, `payments`, `idempotency_keys` | `bill_status`, `payment_status` | payment APIs | Remove the old partial-paid bill state; one PENDING/SUCCEEDED payment per bill | High: payment inconsistency |
| Q6 Voucher/direct discount override | BUSINESS_RULES, DATABASE, API, Prisma, migration | `bill_adjustments`, `audit_logs` | `audit_action` | voucher/discount APIs | Default voucher OR direct discount; override needs permission, actor, reason, before/after | Medium |
| Q7 Overnight shift | BUSINESS_RULES, DATABASE, API | `shifts`, `shift_assignments`, `attendances` | `attendance_event_source` | shift/attendance APIs | `end_time <= start_time` means next day | Medium |
| Q8 VND VAT rounding | DATABASE, API, migration | `bills` | none | bill APIs, reports | VAT = round(pre_vat * rate / 100, 0) | Medium |
| Q9 Supabase auth mapping | SRS, BUSINESS_RULES, DATABASE, API, Prisma | `users` | none | auth/setup APIs | `users.auth_user_id` UUID unique not FK; identity from verified JWT.sub | High |
| Q10 Docs standardization | all docs | none | none | none | Official docs live under `docs/`; priority order fixed | Low |
| API-DECISION-001 Setup token | BUSINESS_RULES, DATABASE, API, Prisma, migration | `system_setup`, `idempotency_keys` | `setup_status` | `POST /setup` | Use `setupToken`; hash only | High |
| API-DECISION-002 Split/Merge/Void bill | BUSINESS_RULES, DATABASE, API, Prisma, migration | `bills`, `bill_items`, `bill_adjustments`, `audit_logs` | `bill_status`, `audit_action` | bill split/merge/void APIs | Add `MERGED`, `merged_into_bill_id`, merge API; VOID releases allocations | High |
| API-DECISION-003 No cancel entire order MVP | SRS, BUSINESS_RULES, API | `orders`, `order_items` | `audit_action` | order APIs | No `cancel-order` endpoint; staff cancels order item only | Medium |
| API-DECISION-004 Reservation refresh | BUSINESS_RULES, DATABASE, API | `cart_items`, `inventory_reservations` | `reservation_status` | cart APIs | Recipe-changing edit resets only that cart item's reservations | High |
| API-DECISION-005 Logout + auto checkout | BUSINESS_RULES, DATABASE, API, Prisma, migration | `branches`, `shifts`, `attendances`, `audit_logs` | `attendance_event_source`, `audit_action` | logout/attendance APIs | Normal logout, scheduler fallback, manual adjustment with audit | Medium |

## 2. Conflict Detection

| ID | Conflict | Resolution |
|---|---|---|
| CONFLICT-001 | `docs/SRS.md`, `docs/ARCHITECTURE.md`, `docs/BUSINESS_RULES.md` were missing at the required official paths. | Created official docs under `docs/`; original architecture file is kept as source material. |
| CONFLICT-002 | API used an old setup-proof placeholder and listed setup protection as open. | Replaced with `setupToken`; token is one-time, hashed if persisted, consumed in setup transaction. |
| CONFLICT-003 | Database/API allowed an old partial-paid bill state while MVP forbids partial payment. | Removed that state; payment must equal bill total. |
| CONFLICT-004 | Database allowed multiple payments per bill for future partial/mixed payment. | Added partial unique invariant for one PENDING/SUCCEEDED payment per bill. |
| CONFLICT-005 | VAT migration rounded to 2 decimals. | Changed bill invariant to `round(..., 0)` for VND. |
| CONFLICT-006 | Unit conversion was only a free-text `unit_code`. | Added unit catalog, ingredient allowed units, conversion table and inventory import snapshots. |
| CONFLICT-007 | Bill void/merge rules were open. | Added `MERGED`, merge relation, explicit split/merge/void rules and API. |
| CONFLICT-008 | Cancel entire order existed as possible audit action but MVP excludes the workflow. | `CANCEL_ORDER` may remain as future audit enum only; API has no cancel-order endpoint in MVP. |
| CONFLICT-009 | Reservation refresh behavior was open. | Chosen per-cart-item refresh only for recipe-changing edits; note/read do not refresh. |
| CONFLICT-010 | Logout fallback was open. | Chosen normal logout + auto checkout + manual adjustment. |

## 3. Rules

### BR-SETUP-SECURITY-001

First-time setup is available only at `/setup` before setup is completed. It requires a verified Supabase Google JWT and a one-time setup token. The backend must verify `JWT.sub`, verify the token against a stored hash or deployment secret, create Branch, User, StaffBranch, ADMIN role and AuditLog in one transaction, then mark `system_setup.status = COMPLETED`.

Rules:

- Never use "first login becomes admin".
- Never trust `authUserId`, role or actor from request body.
- Never log the plaintext setup token.
- Only one concurrent setup transaction can succeed.
- After success, `/setup` is locked and the token is consumed.

### BR-QR-SESSION-001

When a customer scans an active QR, the backend opens or joins the current session for that table. A table can have at most one non-closed session. Race protection is database-backed by a partial unique index on `table_sessions(table_id) WHERE closed_at IS NULL`.

### BR-UNIT-CONVERSION-001

Each ingredient has exactly one base unit. Recipes, inventory balances and reservation quantities are stored in base units. Inventory import may use another allowed unit, but the transaction must snapshot input quantity, input unit, conversion factor and converted base quantity.

### BR-ORDER-CANCEL-001

MVP does not support cancelling an entire order. Customer can edit/delete cart items before confirm only. After confirm, staff with `ORDER_CANCEL` can cancel individual order items:

| Current item status | Result | Inventory effect |
|---|---|---|
| `NEW` | `CANCELLED` | Create one `RETURN` ledger and restore physical inventory |
| `PREPARING` | `CANCELLED` | Create one `WASTE` ledger; do not restore stock |
| `READY` | `CANCELLED` | Create one `WASTE` ledger; do not restore stock |

Cancellation requires reason, actor, status history and audit log. The same order item must not produce more than one RETURN/WASTE cancellation side effect.

### BR-BILL-SPLIT-001

Split Bill converts one unpaid bill allocation into multiple unpaid bills in the same table session. It must lock session, source bill, target bills and order items in deterministic order. It must not allocate more quantity than ordered.

### BR-BILL-MERGE-001

Merge Bill combines multiple unpaid bills from the same table session into one destination bill. Source bills are never hard deleted; they become `MERGED` and store `merged_into_bill_id`, `merged_at`, `merged_by_id` and `merge_reason`.

Merge rules:

- All bills must belong to the same `table_session`.
- No source or destination bill may be `PAID`.
- No bill may have active payment `PENDING`.
- Existing voucher/direct discount adjustments on source bills are reversed.
- Destination subtotal, discounts, VAT and total are recalculated; totals are not summed from source bills.
- Audit action `MERGE_BILL` is required.

### BR-BILL-VOID-001

Void Bill is only for bills created by mistake or no longer needed. It is not a substitute for Merge. Only unpaid bills can be voided. If a bill has payment `PENDING`, the payment must be cancelled/expired first. VOID does not cancel orders; it releases bill item allocations back to the unbilled pool.

### BR-DISCOUNT-001

By default, a bill can use either one active voucher adjustment or one active direct discount adjustment. A staff member with `DISCOUNT_OVERRIDE` may combine voucher and direct discount only with override reason, actor, before snapshot, after snapshot and audit.

Calculation order:

```text
subtotal -> voucher -> direct discount -> discounted amount -> VAT -> total
```

### BR-PAYMENT-001

MVP supports one payment method per bill and no partial payment. Payment amount is always `bill.total`. A bill can have only one `PENDING` or `SUCCEEDED` payment. If the customer wants multiple methods, staff must split bill first.

### BR-RESERVATION-REFRESH-001

Reservation TTL defaults to 10 minutes per cart item. Add Cart Item sets `expires_at = now + 10 minutes`. Updating quantity, size, topping or any recipe-changing field recalculates inventory, releases/reserves only the difference and resets expiry only for that cart item's active reservations. Updating note does not reset expiry. GET cart never resets expiry. Expired reservations are not revived; backend must check stock again.

### BR-ATTENDANCE-001

Shift interval is calculated in branch timezone:

```text
end_time > start_time  => same day
end_time <= start_time => next day
```

Normal logout stores server time and `check_out_source = NORMAL_LOGOUT`. Auto checkout runs after `shift end + grace period`, but stores `check_out_at = scheduled shift end`, `check_out_source = SYSTEM_AUTO`. Grace period defaults to branch setting 30 minutes and may be overridden on Shift. Manual adjustment requires `ATTENDANCE_ADJUST`, reason, actor, before/after and audit.

### BR-VAT-001

Bill currency is VND. Database may keep money as `NUMERIC(14,2)`, but VAT amount for bill totals is rounded mathematically to zero decimal places:

```text
vat_amount = ROUND(discounted_amount * vat_rate / 100, 0)
total = discounted_amount + vat_amount
```

### BR-AUTH-001

Supabase Auth is authentication identity. `public.users` is business identity. `users.auth_user_id` is UUID UNIQUE NOT NULL and has no FK to `auth.users`. Backend maps identity from verified JWT `sub`; request body values are ignored.

### BR-IDEMPOTENCY-001

Critical mutations use persistent PostgreSQL idempotency, not Redis-only state. Store scope, key, request hash, response status/body, status and expiry. Same key and payload returns stored response; same key with a different payload returns `IDEMPOTENCY_KEY_REUSED`.

## 4. Test Plan

| Case | Expected result |
|---|---|
| 1. Two users complete setup at the same time | Only one transaction succeeds; loser gets `SETUP_ALREADY_COMPLETED` or `SETUP_IN_PROGRESS`. |
| 2. Two customers scan empty table QR | Only one session is created; both receive same active session. |
| 3. Two customers reserve last cup | Only one reservation succeeds; other gets `INSUFFICIENT_INVENTORY`. |
| 4. Update cart item quantity/size/topping | Only that item's reservation expiry resets. |
| 5. Update note | TTL is unchanged. |
| 6. Update expired reservation | Backend checks stock again; creates new reservation only if enough stock. |
| 7. Cancel NEW | One RETURN ledger; inventory restored once. |
| 8. Cancel PREPARING | One WASTE ledger; stock not restored. |
| 9. Cancel READY | One WASTE ledger; stock not restored. |
| 10. Split bill | No over-allocation. |
| 11. Merge bill | Items move to destination, source bills keep history, totals recalc. |
| 12. Merge bill with discount | Old adjustments reversed; totals are not summed. |
| 13. Void bill | Order remains; allocations release. |
| 14. Paid bill split/merge/void | Operation rejected. |
| 15. Two create-payment requests | Only one valid PENDING/SUCCEEDED payment. |
| 16. Repeat payment confirm | No double payment. |
| 17. VAT decimal case | VAT rounds to 1 VND. |
| 18. Staff forgets logout | Scheduler auto checks out after grace. |
| 19. Auto checkout | `check_out_at` equals scheduled shift end, not scheduler run time. |
| 20. Manager adjusts attendance | Reason and audit are required. |

## 5. New Open Questions

None. The five former API open questions are resolved by this document.

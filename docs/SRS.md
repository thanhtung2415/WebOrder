# SRS - WEB ORDER QUAN NUOC/CA PHE

**Status:** COMPLETED  
**Version:** 1.1  
**Last updated:** 2026-09-10

## 1. Scope

He thong Web Order phuc vu quan ca phe/quan an, bat dau voi mot chi nhanh va thiet ke san cho nhieu chi nhanh. Khach ngoi tai ban quet QR, xem menu, chon mon, xac nhan order, goi nhan vien va yeu cau thanh toan ma khong can dang nhap.

MVP khong bao gom frontend/backend feature implementation trong tai lieu nay; day la dac ta nghiep vu va rang buoc he thong.

## 2. User Classes

| User class | Authentication | Main capabilities |
|---|---|---|
| Customer | QR session token only | Scan QR, view menu, edit cart before confirm, confirm order, call staff, request payment |
| Waiter | Supabase Google login | View tables/orders, support customer order, serve item, transfer table if permitted |
| Bar/Kitchen | Supabase Google login | View queue, update item status, print order ticket |
| Cashier | Supabase Google login | Issue/split/merge/void bills, apply allowed discount, create/confirm payment |
| Manager | Supabase Google login | Operational management, discount override, attendance adjustment |
| Admin | Supabase Google login + setup/bootstrap for first admin | Full system management |

One staff can have multiple roles per branch.

## 3. Functional Requirements

### FR-SETUP

- System exposes `/setup` only before first-time setup is completed.
- Setup requires Google OAuth through Supabase and a one-time setup token.
- Setup creates first Branch, User, StaffBranch, ADMIN role assignment and AuditLog in one transaction.
- "First login becomes admin" is forbidden.

### FR-QR-TABLE

- Each table has one active QR token.
- QR opens or joins the table's current session.
- Admin can rotate or disable QR.
- Staff can transfer table; session, orders and bills move with audit.

### FR-MENU

- Product has name, image, price, description, category, processing area and status.
- Product supports size, ice, sugar, topping and item note.
- Size/topping can affect price and recipe.
- Promotion can be added later; current MVP uses voucher/direct discount at bill level.

### FR-CART-ORDER

- Customer flow: scan QR -> menu -> product/options -> cart -> confirm order.
- Customer can edit/delete cart item only before confirm.
- After confirm, customer cannot cancel or edit order item.
- Staff with permission can cancel individual order item only.
- MVP has no cancel-entire-order endpoint.

### FR-INVENTORY

- Inventory is tracked by ingredient, not by product count.
- Ingredient has base unit; recipe and inventory are stored in base unit.
- Import supports input unit conversion and snapshots conversion data.
- Add-to-cart reserves ingredients for 10 minutes per cart item.
- Reservation/concurrency must be protected by PostgreSQL transaction and row locks.

### FR-BILL-PAYMENT

- Staff can create/split/merge/void unpaid bills.
- Bill source history must not be hard deleted.
- One bill has one payment method and no partial payment in MVP.
- If customer wants multiple methods, staff splits bill first.
- VAT is 8% by default and rounded to one VND.

### FR-ATTENDANCE

- Shift supports overnight rule: `end_time <= start_time` means next day.
- Normal logout creates check-out at server time.
- Auto checkout closes forgotten attendance after configurable grace period and stores scheduled shift end as check-out time.
- Manager/Admin can manually adjust attendance with reason and audit.

### FR-AUDIT-REPORT

- Critical actions require AuditLog: setup, QR rotate/disable, transfer table, cancel item, split/merge/void bill, discount override, payment confirm, inventory mutation, recipe update, user/role/shift/attendance changes and session close.
- Reports derive from order, bill, payment, inventory ledger and attendance source data.

## 4. Non-Functional Requirements

- Backend is source of truth for authentication mapping, authorization, price, inventory, discount, VAT, payment and state transitions.
- PostgreSQL is source of truth for critical business state.
- Redis is not required for MVP critical idempotency or locks.
- Supabase Realtime Broadcast is fed from transactional outbox after commit.
- No hard delete for operational history.
- Customer UI is mobile-first; Admin/Staff UI is responsive.
- Dark mode is required.

## 5. Document Priority

When documents conflict, follow:

```text
SRS -> BUSINESS_RULES -> DATABASE -> API -> ARCHITECTURE -> Code
```

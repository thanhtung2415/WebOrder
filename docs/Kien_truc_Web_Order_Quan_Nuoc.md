# KIẾN TRÚC HỆ THỐNG WEB ORDER QUÁN NƯỚC

## 1. Tổng quan kiến trúc

Hệ thống được phát triển theo mô hình:

```text
Frontend (React)
        ↓
REST API
        ↓
Backend (NestJS)
        ↓
Prisma ORM
        ↓
Supabase PostgreSQL
```

Ngoài PostgreSQL, hệ thống sử dụng thêm các dịch vụ của Supabase:

- Supabase Auth: đăng nhập Google cho Admin/Staff.
- Supabase Realtime: cập nhật order, trạng thái món, tồn kho và thông báo theo thời gian thực.
- Supabase Storage: lưu ảnh món, logo, banner và avatar.
- Supabase Cron hoặc NestJS Scheduler: xử lý các tác vụ định kỳ như hết hạn giữ nguyên liệu.

Nguyên tắc chính:

> Frontend không trực tiếp xử lý các nghiệp vụ quan trọng như trừ tồn kho, tính hóa đơn, VAT, voucher, xác nhận thanh toán hoặc phân quyền. Các thao tác này phải đi qua Backend.

---

# 2. Technology Stack

## 2.1. Frontend

```text
React
TypeScript
Vite
React Router
TanStack Query
Zustand
Tailwind CSS
shadcn/ui
react-i18next
Supabase JS Client
```

### Vai trò

- **React**: xây dựng giao diện.
- **TypeScript**: kiểm soát kiểu dữ liệu và giảm lỗi.
- **Vite**: build và development server.
- **React Router**: quản lý route.
- **TanStack Query**: gọi API, cache và đồng bộ dữ liệu server.
- **Zustand**: quản lý state phía client như giỏ hàng và UI.
- **Tailwind CSS**: styling.
- **shadcn/ui**: bộ component UI.
- **react-i18next**: hỗ trợ Tiếng Việt/Tiếng Anh.
- **Supabase JS Client**: phục vụ Auth và Realtime khi cần.

---

## 2.2. Backend

```text
Node.js
NestJS
TypeScript
REST API
Prisma ORM
Swagger / OpenAPI
class-validator
```

Backend chịu trách nhiệm:

- Authentication và Authorization.
- Phân quyền Admin/Staff.
- Quản lý phiên bàn.
- Quản lý order.
- Xử lý giữ nguyên liệu.
- Trừ tồn kho.
- Quản lý công thức món.
- Xử lý hóa đơn.
- Tách hóa đơn.
- Voucher và giảm giá.
- VAT.
- Thanh toán.
- Quản lý ca làm việc.
- Audit log.
- Báo cáo.
- Phát realtime event.

---

# 3. Database

## Database sử dụng

```text
PostgreSQL
```

Database được host trên:

```text
Supabase
```

Supabase không phải là loại database riêng. Database chính của Supabase là PostgreSQL.

Kiến trúc:

```text
NestJS
   ↓
Prisma
   ↓
Supabase PostgreSQL
```

---

# 4. Kiến trúc tổng thể

```text
                         INTERNET
                            │
            ┌───────────────┴────────────────┐
            │                                │
            ▼                                ▼
┌───────────────────────┐        ┌───────────────────────┐
│ CUSTOMER WEB          │        │ ADMIN / STAFF WEB     │
│ React + TypeScript    │        │ React + TypeScript    │
│ Mobile-first          │        │ Responsive            │
└───────────┬───────────┘        └───────────┬───────────┘
            │                                │
            └───────────────┬────────────────┘
                            │
                         REST API
                            │
                            ▼
                 ┌─────────────────────┐
                 │   NESTJS BACKEND    │
                 │                     │
                 │ Business Logic      │
                 │ RBAC                │
                 │ Validation          │
                 │ Transactions        │
                 └──────────┬──────────┘
                            │
                         Prisma
                            │
                            ▼
                 ┌─────────────────────┐
                 │      SUPABASE       │
                 │                     │
                 │ PostgreSQL          │
                 │ Auth                │
                 │ Realtime            │
                 │ Storage             │
                 │ Cron                │
                 └─────────────────────┘
```

---

# 5. Cấu trúc Frontend

Có thể sử dụng một React project nhưng chia giao diện thành ba khu vực:

```text
src/
│
├── customer/
│   ├── menu/
│   ├── product/
│   ├── cart/
│   ├── order/
│   └── requests/
│
├── staff/
│   ├── tables/
│   ├── orders/
│   ├── bar/
│   ├── billing/
│   └── inventory/
│
├── admin/
│   ├── dashboard/
│   ├── products/
│   ├── categories/
│   ├── ingredients/
│   ├── recipes/
│   ├── inventory/
│   ├── staff/
│   ├── shifts/
│   ├── tables/
│   ├── vouchers/
│   ├── reports/
│   └── audit-logs/
│
├── components/
├── layouts/
├── hooks/
├── services/
├── stores/
├── types/
├── utils/
└── locales/
```

---

# 6. Customer Web

Khách không cần đăng nhập.

Ví dụ route:

```text
/table/:qrToken
/menu
/cart
/order-status
```

Luồng:

```text
Quét QR
   ↓
Xác định bàn
   ↓
Menu
   ↓
Chi tiết món
   ↓
Size / Topping / Đá / Đường
   ↓
Thêm vào giỏ
   ↓
Giữ nguyên liệu
   ↓
Xác nhận Order
   ↓
Theo dõi trạng thái
```

Customer Web được thiết kế theo hướng **mobile-first**.

---

# 7. Staff Web

Ví dụ route:

```text
/staff
/staff/tables
/staff/orders
/staff/bar
/staff/billing
/staff/inventory
```

Giao diện hiển thị dựa theo role.

## Pha chế / Bar

Có quyền:

- Xem hàng đợi món.
- Xem số bàn.
- Xem size/topping/đá/đường.
- Xem ghi chú.
- Cập nhật trạng thái món.
- In phiếu order.

Thời gian chờ:

```text
0 - 3 phút   → Xanh
3 - 7 phút   → Cam
7 - 10 phút  → Đỏ
> 10 phút    → Cảnh báo trễ
```

## Thu ngân

Có quyền:

- Xem hóa đơn.
- Tách hóa đơn.
- Voucher.
- Giảm giá.
- VAT.
- Thanh toán.
- In bill.

## Phục vụ

Có quyền:

- Xem bàn.
- Xem trạng thái order.
- Xác nhận món đã phục vụ.
- Nhận yêu cầu gọi nhân viên.
- Nhận yêu cầu thanh toán.
- Hỗ trợ order.
- Chuyển bàn nếu được cấp quyền.

---

# 8. Admin Web

Ví dụ route:

```text
/admin/dashboard

/admin/products
/admin/categories
/admin/toppings
/admin/ingredients
/admin/recipes

/admin/inventory
/admin/inventory/import
/admin/inventory/export
/admin/inventory/count

/admin/tables
/admin/staff
/admin/shifts

/admin/vouchers
/admin/reports
/admin/audit-logs
```

Admin có quyền quản trị toàn bộ hệ thống.

---

# 9. Cấu trúc Backend NestJS

Đề xuất:

```text
src/
│
├── auth/
├── users/
├── roles/
├── permissions/
├── branches/
│
├── tables/
├── qr/
├── sessions/
│
├── categories/
├── products/
├── product-options/
├── toppings/
├── recipes/
│
├── ingredients/
├── inventory/
├── inventory-reservations/
├── inventory-transactions/
│
├── orders/
├── order-items/
├── kitchen/
│
├── bills/
├── bill-items/
├── payments/
├── vouchers/
│
├── shifts/
├── notifications/
├── reports/
├── audit-logs/
│
├── prisma/
└── app.module.ts
```

---

# 10. Authentication

Sử dụng:

```text
Supabase Auth
+
Google OAuth
```

Luồng đăng nhập Staff:

```text
Staff
   ↓
Login Google
   ↓
Supabase Auth
   ↓
Backend xác thực token
   ↓
Kiểm tra tài khoản Staff
```

Đăng nhập lần đầu:

```text
Google Login
   ↓
Tạo Profile
   ↓
status = PENDING
   ↓
Chờ Admin duyệt
```

Admin duyệt:

```text
PENDING
   ↓
Gán Role
   ↓
Gán Shift
   ↓
ACTIVE
```

Mỗi lần đăng nhập Backend kiểm tra:

- Tài khoản đã được duyệt chưa.
- Có bị khóa không.
- Có đang active không.
- Có nằm trong khung giờ được phép đăng nhập không.
- Role hiện tại.
- Permission hiện tại.

---

# 11. Authorization

Áp dụng:

```text
RBAC
Role-Based Access Control
```

Role ví dụ:

```text
ADMIN
MANAGER
CASHIER
BAR
KITCHEN
WAITER
```

Một Staff có thể có nhiều role.

Ví dụ:

```text
Staff A
├── WAITER
└── CASHIER
```

Backend phải kiểm tra permission ở server.

Không được chỉ ẩn nút trên frontend.

---

# 12. Realtime

Sử dụng:

```text
Supabase Realtime
```

Ưu tiên cơ chế:

```text
Broadcast
```

Realtime event có thể gồm:

```text
ORDER_CREATED

ORDER_ITEM_STATUS_CHANGED

TABLE_REQUEST_CREATED

PAYMENT_REQUEST_CREATED

INVENTORY_CHANGED

PRODUCT_AVAILABILITY_CHANGED

INGREDIENT_RESERVED

INGREDIENT_RELEASED
```

Ví dụ:

```text
Customer
   ↓
POST /orders
   ↓
NestJS
   ↓
Create Order
   ↓
Realtime: ORDER_CREATED
   ↓
Bar nhận ngay order
```

---

# 13. Trạng thái món

Trạng thái xử lý món:

```text
NEW
  ↓
PREPARING
  ↓
READY
  ↓
SERVED
```

Có thêm:

```text
CANCELLED
```

Trạng thái thanh toán không nằm trong trạng thái món.

---

# 14. Quản lý tồn kho nguyên liệu

Tồn kho được quản lý theo **nguyên liệu**, không quản lý số lượng món một cách độc lập.

Ví dụ công thức:

```text
Cà phê sữa M

Cà phê     20 g
Sữa đặc    30 ml
Đá        150 g
Ly M        1 cái
Ống hút     1 cái
```

Quan hệ:

```text
Product
   ↓
Recipe
   ↓
Recipe Item
   ↓
Ingredient
```

Một món có nhiều nguyên liệu.

Một nguyên liệu cũng có thể được sử dụng cho nhiều món.

---

# 15. Công thức món

Ví dụ bảng:

```text
product_recipes

product_id | ingredient_id | quantity
--------------------------------------
CF_SUA_M   | COFFEE         | 20
CF_SUA_M   | CONDENSED_MILK | 30
CF_SUA_M   | ICE            | 150
CF_SUA_M   | CUP_M          | 1
```

Size và topping cũng có thể bổ sung thêm định lượng.

Ví dụ:

```text
Topping trân châu
→ +50g trân châu
```

---

# 16. Giữ nguyên liệu trong giỏ hàng

Thời gian giữ:

```text
10 phút
```

Khi khách thêm món:

```text
Customer
   ↓
Add To Cart
   ↓
Backend
   ↓
Check Recipe
   ↓
Check Available Inventory
   ↓
Reserve Ingredients
```

Không được chỉ kiểm tra:

```text
stock > 0
```

ở frontend.

---

# 17. Xử lý ly cuối cùng

Ví dụ nguyên liệu chỉ còn đủ cho một ly.

```text
Khách A ─────┐
             ├── Add To Cart gần như cùng lúc
Khách B ─────┘
```

Backend xử lý transaction.

```text
Khách A
   ↓
Transaction
   ↓
Reserve thành công
   ↓
Available = 0
```

Sau đó:

```text
Realtime
   ↓
PRODUCT_AVAILABILITY_CHANGED
   ↓
Khách B thấy HẾT HÀNG
```

Khách B không thể thêm món.

Người được giữ món là request được server xử lý thành công trước.

---

# 18. Inventory Reservation

Đề xuất bảng:

```text
inventory_reservations
```

Các trường:

```text
id
cart_id
session_id
ingredient_id
quantity
expires_at
status
created_at
```

Status:

```text
ACTIVE
CONSUMED
RELEASED
EXPIRED
```

Ví dụ:

```text
09:00 Add Cart

expires_at = 09:10
```

Nếu khách order lúc 09:05:

```text
ACTIVE
  ↓
CONSUMED
```

Nếu đến 09:10 chưa order:

```text
ACTIVE
  ↓
EXPIRED
```

Nguyên liệu được trả lại tồn khả dụng.

---

# 19. Inventory Transaction

Mọi biến động kho nên được ghi lại.

Bảng:

```text
inventory_transactions
```

Các loại:

```text
IMPORT
ORDER_CONSUMPTION
WASTE
DAMAGED
STAFF_USE
ADJUSTMENT
STOCKTAKE
RETURN
```

Thông tin cần lưu:

```text
ingredient_id
quantity
type
reference_id
reason
created_by
created_at
```

Nhờ đó có thể kiểm tra thất thoát nguyên liệu.

---

# 20. Scheduler / Cron

Cần job định kỳ xử lý reservation hết hạn.

Có thể sử dụng:

```text
Supabase Cron
```

hoặc:

```text
NestJS Scheduler
```

Ví dụ chạy mỗi phút:

```text
Tìm reservation:

status = ACTIVE
AND
expires_at <= NOW()
```

Sau đó:

```text
ACTIVE
  ↓
EXPIRED
```

và giải phóng nguyên liệu.

MVP chưa cần Redis chỉ để xử lý việc này.

---

# 21. Order Flow

```text
TABLE
  ↓
TABLE SESSION
  ↓
ORDER
  ↓
ORDER ITEM
```

Một bàn có nhiều phiên theo thời gian.

Tại một thời điểm:

```text
1 Table
   ↓
1 Active Session
```

Một Session:

```text
Session
├── Order #1
├── Order #2
└── Order #3
```

Các order phát sinh khi khách gọi thêm món.

---

# 22. Luồng Order hoàn chỉnh

```text
Khách quét QR
       ↓
Xác định bàn
       ↓
Tạo / lấy phiên hiện tại
       ↓
Xem Menu
       ↓
Chọn món
       ↓
Chọn Size / Topping / Đá / Đường
       ↓
Add To Cart
       ↓
Backend kiểm tra công thức
       ↓
Kiểm tra tồn kho
       ↓
Reserve nguyên liệu 10 phút
       ↓
Khách Confirm
       ↓
PostgreSQL Transaction
       ↓
Create Order
       ↓
Create Order Items
       ↓
Reservation → CONSUMED
       ↓
Inventory Consumption
       ↓
Realtime ORDER_CREATED
       ↓
BAR / KITCHEN
```

---

# 23. Billing

Quan hệ:

```text
Table Session
     ↓
Orders
     ↓
Order Items
     ↓
Bills
```

Staff có thể chia các món trong cùng Session thành:

```text
Bill #1
Bill #2
Bill #3
```

Mỗi Bill:

```text
Bill
├── Bill Items
├── Subtotal
├── Voucher
├── Direct Discount
├── VAT
├── Total
└── Payment Status
```

---

# 24. Split Bill

Ví dụ phiên bàn có:

```text
3 Trà đào
2 Cà phê
1 Trà sữa
```

Có thể chia:

```text
Bill #1
├── 1 Trà đào
└── 1 Cà phê

Bill #2
└── 2 Trà đào

Bill #3
├── 1 Cà phê
└── 1 Trà sữa
```

Một đơn vị món chỉ được thuộc một bill tại một thời điểm.

Không được tính tiền trùng.

---

# 25. Voucher, Discount và VAT

Hỗ trợ:

```text
Voucher %
Voucher số tiền cố định

Direct Discount %
Direct Discount số tiền cố định
```

Không tính phí phục vụ.

VAT:

```text
8%
```

Công thức:

```text
Pre VAT Amount
= Subtotal - Discount

VAT
= Pre VAT Amount × 8%

Total
= Pre VAT Amount + VAT
```

Mỗi hóa đơn tách riêng có:

- Discount riêng.
- VAT riêng.
- Total riêng.
- Payment Status riêng.

---

# 26. Payment

Phiên bản hiện tại:

```text
Cash
QR Payment Mock
```

Phiên bản sau:

```text
QR chuyển khoản cá nhân của quán
```

Có thể mở rộng:

```text
VNPay
MoMo
ZaloPay
Bank API
```

---

# 27. Quản lý ca

Admin thiết lập:

```text
Staff
   ↓
Shift
   ↓
Allowed Login Time
```

Ví dụ:

```text
Ca sáng
06:00 → 14:00
```

Check-in:

```text
Lần login đầu tiên trong ca
```

Check-out:

```text
Lần logout cuối cùng trong ca
```

Backend kiểm tra thời gian đăng nhập trước khi cho Staff truy cập.

---

# 28. Audit Log

Các thao tác quan trọng phải được ghi nhận:

```text
CANCEL_ORDER
CANCEL_ORDER_ITEM

SPLIT_BILL
TRANSFER_TABLE

APPLY_VOUCHER
APPLY_DISCOUNT

CONFIRM_PAYMENT

IMPORT_INVENTORY
EXPORT_INVENTORY
ADJUST_INVENTORY

UPDATE_RECIPE

UPDATE_ROLE
LOCK_USER

UPDATE_SHIFT
```

Audit log nên lưu:

```text
actor_id
action
entity_type
entity_id
before_data
after_data
created_at
```

---

# 29. Supabase Storage

Không lưu file ảnh trực tiếp vào PostgreSQL.

Sử dụng:

```text
Supabase Storage
```

Cấu trúc ví dụ:

```text
products/
├── ca-phe-sua.webp
├── bac-xiu.webp
└── tra-dao.webp

avatars/
└── staff/

branding/
├── logo.webp
└── banner.webp
```

Database chỉ lưu URL/path của file.

---

# 30. Đa ngôn ngữ

Frontend hỗ trợ:

```text
VI
EN
```

Sử dụng:

```text
react-i18next
```

Ví dụ:

```text
src/locales/
├── vi.json
└── en.json
```

---

# 31. Dark Mode

Dark Mode là yêu cầu bắt buộc.

Sử dụng:

```text
Tailwind CSS
+
shadcn/ui
```

Có thể hỗ trợ:

```text
Light
Dark
System
```

---

# 32. API Design

Dùng REST API.

Ví dụ:

## Menu

```text
GET    /api/categories
GET    /api/products
GET    /api/products/:id
```

## Cart

```text
POST   /api/cart/reservations
DELETE /api/cart/reservations/:id
```

## Order

```text
POST   /api/orders
GET    /api/orders/:id
GET    /api/sessions/:id/orders

PATCH  /api/order-items/:id/status
POST   /api/order-items/:id/cancel
```

## Table

```text
GET    /api/tables
GET    /api/tables/:id

POST   /api/tables/:id/sessions
POST   /api/sessions/:id/transfer
POST   /api/sessions/:id/close
```

## Bill

```text
POST   /api/bills
GET    /api/bills/:id

POST   /api/bills/:id/split
POST   /api/bills/:id/voucher
POST   /api/bills/:id/discount
```

## Payment

```text
POST   /api/payments
POST   /api/payments/:id/confirm
```

## Inventory

```text
GET    /api/inventory

POST   /api/inventory/import
POST   /api/inventory/export
POST   /api/inventory/stocktake
POST   /api/inventory/adjustment
```

## Staff

```text
GET    /api/staff
POST   /api/staff/:id/approve
POST   /api/staff/:id/reject

PATCH  /api/staff/:id/roles
PATCH  /api/staff/:id/status
```

## Shift

```text
GET    /api/shifts
POST   /api/shifts
PATCH  /api/shifts/:id
```

---

# 33. Swagger

Backend nên tích hợp:

```text
Swagger / OpenAPI
```

Ví dụ:

```text
/api/docs
```

Dùng để:

- Test API.
- Xem request/response.
- Hỗ trợ frontend.
- Document API.
- Debug.

---

# 34. Validation

Frontend có thể sử dụng:

```text
Zod
```

Backend sử dụng:

```text
class-validator
```

Backend luôn phải validate lại dữ liệu.

Không được tin dữ liệu gửi từ frontend.

---

# 35. Transaction

Các nghiệp vụ quan trọng phải chạy trong database transaction.

Ví dụ:

```text
Reserve Inventory

Confirm Order

Consume Inventory

Split Bill

Apply Voucher

Confirm Payment

Stock Adjustment
```

Ví dụ Confirm Order:

```text
BEGIN

1. Lock reservation
2. Kiểm tra chưa hết hạn
3. Kiểm tra session còn active
4. Create order
5. Create order items
6. Mark reservation CONSUMED
7. Ghi inventory transaction

COMMIT
```

Nếu một bước lỗi:

```text
ROLLBACK
```

---

# 36. Security

Frontend không được phép trực tiếp thực hiện:

```text
❌ Trừ tồn kho
❌ Điều chỉnh tồn kho
❌ Tính bill cuối cùng
❌ Áp voucher thực tế
❌ Tính VAT cuối cùng
❌ Xác nhận thanh toán
❌ Gán role
❌ Sửa ca
❌ Đóng phiên bàn
```

Các nghiệp vụ trên phải đi theo:

```text
React
   ↓
NestJS
   ↓
Authentication
   ↓
Authorization
   ↓
Validation
   ↓
Business Logic
   ↓
Database Transaction
   ↓
PostgreSQL
```

---

# 37. QR bàn

QR không nên chứa trực tiếp database ID đơn giản như:

```text
/table/1
```

Nên sử dụng token riêng.

Ví dụ:

```text
/table/q/7dd5f867...
```

Backend dùng token để xác định bàn.

Admin có thể:

- Tạo QR.
- Rotate token.
- Vô hiệu hóa token.

---

# 38. Deployment

Kiến trúc triển khai:

```text
                         INTERNET
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
       React Frontend                NestJS Backend
             │                             │
             └─────────────┬───────────────┘
                           │
                           ▼
                    SUPABASE CLOUD
                 ┌────────────────────┐
                 │ PostgreSQL         │
                 │ Auth               │
                 │ Realtime           │
                 │ Storage            │
                 │ Cron               │
                 └────────────────────┘
```

Đề xuất:

```text
Frontend
→ Vercel / Cloudflare Pages

Backend
→ Railway / Render / Fly.io / VPS

Database
→ Supabase

Source Code
→ GitHub
```

---

# 39. Cấu trúc Repository

Có thể sử dụng monorepo đơn giản:

```text
web-order/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── src/
│   ├── prisma/
│   ├── test/
│   └── package.json
│
├── docs/
│   ├── SRS.md
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DATABASE.md
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

# 40. Stack cuối cùng

```text
FRONTEND
──────────────────────────────
React
TypeScript
Vite
React Router
TanStack Query
Zustand
Tailwind CSS
shadcn/ui
react-i18next


BACKEND
──────────────────────────────
Node.js
NestJS
TypeScript
REST API
Swagger
class-validator


ORM
──────────────────────────────
Prisma


DATABASE
──────────────────────────────
PostgreSQL
host trên Supabase


AUTH
──────────────────────────────
Supabase Auth
Google OAuth


REALTIME
──────────────────────────────
Supabase Realtime
Broadcast


FILE STORAGE
──────────────────────────────
Supabase Storage


SCHEDULER
──────────────────────────────
Supabase Cron
hoặc
NestJS Scheduler


DEPLOYMENT
──────────────────────────────
Frontend → Vercel / Cloudflare
Backend  → Node.js Hosting
Database → Supabase


VERSION CONTROL
──────────────────────────────
Git
GitHub
```

---

# 41. Luồng nghiệp vụ tổng quát

```text
Khách quét QR
        ↓
Xác định bàn
        ↓
Phiên phục vụ
        ↓
Menu
        ↓
Chọn món
        ↓
Size / Topping / Đá / Đường
        ↓
Thêm vào giỏ
        ↓
Backend kiểm tra nguyên liệu
        ↓
Giữ nguyên liệu tối đa 10 phút
        ↓
Xác nhận Order
        ↓
Database Transaction
        ↓
Trừ / ghi nhận tiêu hao nguyên liệu
        ↓
Realtime
        ↓
Bar / Bếp
        ↓
Mới tạo
        ↓
Đang pha chế
        ↓
Sẵn sàng
        ↓
Staff phục vụ
        ↓
Đã phục vụ
        ↓
Khách có thể gọi thêm
        ↓
Yêu cầu thanh toán
        ↓
Tách hóa đơn nếu cần
        ↓
Voucher / Discount
        ↓
VAT 8%
        ↓
Thanh toán
        ↓
Tất cả hóa đơn hoàn tất
        ↓
Đóng phiên bàn
        ↓
Lưu lịch sử
        ↓
Báo cáo
```

---

# 42. Nguyên tắc phát triển

1. Không đưa business logic quan trọng vào Frontend.
2. Mọi thao tác nhạy cảm phải được Backend kiểm tra quyền.
3. Nghiệp vụ tồn kho phải sử dụng transaction.
4. Không cho tồn kho bị âm.
5. Không để hai khách cùng giữ lượng nguyên liệu cuối cùng.
6. Trạng thái món và tồn kho phải cập nhật realtime.
7. Lưu Audit Log cho thao tác quan trọng.
8. Thiết kế database có khả năng mở rộng nhiều chi nhánh.
9. Customer Web phải ưu tiên mobile.
10. Admin/Staff Web phải responsive trên tablet và desktop.
11. Không lưu ảnh trực tiếp trong PostgreSQL.
12. Tính tiền cuối cùng phải do Backend thực hiện.
13. Frontend chỉ hiển thị kết quả do Backend xác nhận.
14. API phải có validation và authorization.
15. Các chức năng MVP cần được chia theo module để dễ phát triển và kiểm thử.

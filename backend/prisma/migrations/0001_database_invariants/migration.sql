-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('PENDING', 'ACTIVE', 'LOCKED', 'INACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "setup_status" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "unit_dimension" AS ENUM ('MASS', 'VOLUME', 'COUNT', 'PACKAGE');

-- CreateEnum
CREATE TYPE "table_status" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "qr_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('ACTIVE', 'PAYMENT_REQUESTED', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('ACTIVE', 'ORDERED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "processing_area" AS ENUM ('BAR', 'KITCHEN');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "option_group_type" AS ENUM ('SIZE', 'TOPPING', 'SUGAR', 'ICE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "recipe_type" AS ENUM ('BASE', 'SIZE', 'ADD_ON');

-- CreateEnum
CREATE TYPE "ingredient_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "inventory_transaction_type" AS ENUM ('IMPORT', 'ORDER_CONSUMPTION', 'WASTE', 'DAMAGED', 'STAFF_USE', 'ADJUSTMENT', 'STOCKTAKE', 'RETURN');

-- CreateEnum
CREATE TYPE "stocktake_status" AS ENUM ('DRAFT', 'COUNTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "order_item_status" AS ENUM ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "service_request_type" AS ENUM ('CALL_STAFF', 'REQUEST_PAYMENT');

-- CreateEnum
CREATE TYPE "service_request_status" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "voucher_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "bill_status" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'MERGED', 'VOID');

-- CreateEnum
CREATE TYPE "bill_adjustment_source" AS ENUM ('VOUCHER', 'DIRECT_DISCOUNT');

-- CreateEnum
CREATE TYPE "bill_adjustment_status" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'QR_MOCK', 'BANK_QR', 'VNPAY', 'MOMO', 'ZALOPAY', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'CHECKED_OUT', 'ABSENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_event_source" AS ENUM ('NORMAL_LOGIN', 'NORMAL_LOGOUT', 'SYSTEM_AUTO', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('FIRST_TIME_SETUP_COMPLETED', 'CANCEL_ORDER', 'CANCEL_ORDER_ITEM', 'TRANSFER_TABLE', 'SPLIT_BILL', 'MERGE_BILL', 'VOID_BILL', 'APPLY_VOUCHER', 'APPLY_DISCOUNT', 'DISCOUNT_OVERRIDE', 'CONFIRM_PAYMENT', 'IMPORT_INVENTORY', 'EXPORT_INVENTORY', 'ADJUST_INVENTORY', 'STOCKTAKE', 'UPDATE_RECIPE', 'APPROVE_USER', 'REJECT_USER', 'UPDATE_ROLE', 'LOCK_USER', 'UNLOCK_USER', 'UPDATE_SHIFT', 'UPDATE_ATTENDANCE', 'AUTO_CHECK_OUT', 'ROTATE_QR', 'DISABLE_QR', 'CLOSE_SESSION');

-- CreateTable
CREATE TABLE "system_setup" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "status" "setup_status" NOT NULL DEFAULT 'PENDING',
    "setup_token_hash" VARCHAR(255),
    "token_expires_at" TIMESTAMPTZ(3),
    "token_consumed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "symbol" VARCHAR(24) NOT NULL,
    "dimension" "unit_dimension" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_units" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "label" VARCHAR(80),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingredient_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "from_unit_id" UUID NOT NULL,
    "to_unit_id" UUID NOT NULL,
    "conversion_factor" DECIMAL(18,6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "scope" VARCHAR(96) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(128) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "status" "idempotency_status" NOT NULL DEFAULT 'PROCESSING',
    "locked_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "attendance_grace_minutes" INTEGER NOT NULL DEFAULT 30,
    "address" TEXT,
    "phone" VARCHAR(32),
    "logo_path" TEXT,
    "banner_path" TEXT,
    "status" "branch_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "avatar_path" TEXT,
    "status" "account_status" NOT NULL DEFAULT 'PENDING',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_branches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_code" VARCHAR(32),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(96) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_roles" (
    "id" UUID NOT NULL,
    "staff_branch_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "grace_minutes" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "staff_branch_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL DEFAULT 'SCHEDULED',
    "check_in_at" TIMESTAMPTZ(3),
    "check_out_at" TIMESTAMPTZ(3),
    "check_in_source" "attendance_event_source",
    "check_out_source" "attendance_event_source",
    "adjusted_by_id" UUID,
    "adjustment_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "image_path" TEXT,
    "base_price" DECIMAL(14,2) NOT NULL,
    "processing_area" "processing_area" NOT NULL,
    "status" "product_status" NOT NULL DEFAULT 'ACTIVE',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_groups" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "option_group_type" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_values" (
    "id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_groups" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "min_selections" INTEGER NOT NULL DEFAULT 0,
    "max_selections" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL,
    "product_option_group_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,
    "price_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "base_unit_id" UUID NOT NULL,
    "status" "ingredient_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_option_value_id" UUID,
    "type" "recipe_type" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "physical_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "minimum_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "last_unit_cost" DECIMAL(14,2),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "token" UUID NOT NULL,
    "status" "cart_status" NOT NULL DEFAULT 'ACTIVE',
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "is_takeaway" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item_options" (
    "cart_item_id" UUID NOT NULL,
    "product_option_value_id" UUID NOT NULL,

    CONSTRAINT "cart_item_options_pkey" PRIMARY KEY ("cart_item_id","product_option_value_id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "cart_item_id" UUID NOT NULL,
    "order_item_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "terminal_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "type" "inventory_transaction_type" NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "physical_quantity_after" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "input_quantity" DECIMAL(18,3),
    "input_unit_id" UUID,
    "conversion_factor_snapshot" DECIMAL(18,6),
    "converted_base_quantity" DECIMAL(18,3),
    "order_item_id" UUID,
    "stocktake_item_id" UUID,
    "reason" TEXT,
    "created_by_id" UUID,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "status" "stocktake_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "started_by_id" UUID NOT NULL,
    "completed_by_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_items" (
    "id" UUID NOT NULL,
    "stocktake_id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "expected_quantity" DECIMAL(18,3) NOT NULL,
    "counted_quantity" DECIMAL(18,3) NOT NULL,
    "difference" DECIMAL(18,3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "capacity" INTEGER,
    "status" "table_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_qr_codes" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "token" UUID NOT NULL,
    "status" "qr_status" NOT NULL DEFAULT 'ACTIVE',
    "generated_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_sessions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "session_number" VARCHAR(48) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'ACTIVE',
    "opened_by_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_requested_at" TIMESTAMPTZ(3),
    "locked_by_id" UUID,
    "locked_at" TIMESTAMPTZ(3),
    "lock_reason" TEXT,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "cart_id" UUID,
    "order_number" VARCHAR(48) NOT NULL,
    "source" "order_source" NOT NULL DEFAULT 'CUSTOMER',
    "created_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_code_snapshot" VARCHAR(32) NOT NULL,
    "product_name_snapshot" VARCHAR(160) NOT NULL,
    "processing_area" "processing_area" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "base_unit_price" DECIMAL(14,2) NOT NULL,
    "option_unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "final_unit_price" DECIMAL(14,2) NOT NULL,
    "line_subtotal" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "is_takeaway" BOOLEAN NOT NULL DEFAULT false,
    "status" "order_item_status" NOT NULL DEFAULT 'NEW',
    "preparing_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "served_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_options" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "product_option_value_id" UUID,
    "group_type" "option_group_type" NOT NULL,
    "group_name_snapshot" VARCHAR(120) NOT NULL,
    "option_name_snapshot" VARCHAR(120) NOT NULL,
    "price_delta_snapshot" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_status_history" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "from_status" "order_item_status",
    "to_status" "order_item_status" NOT NULL,
    "changed_by_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "type" "service_request_type" NOT NULL,
    "status" "service_request_status" NOT NULL DEFAULT 'PENDING',
    "handled_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" DECIMAL(14,2) NOT NULL,
    "maximum_discount" DECIMAL(14,2),
    "minimum_subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usage_limit" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "status" "voucher_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "merged_into_bill_id" UUID,
    "bill_number" VARCHAR(48) NOT NULL,
    "status" "bill_status" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "voucher_discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "direct_discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discounted_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "merged_by_id" UUID,
    "merged_at" TIMESTAMPTZ(3),
    "merge_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_snapshot" DECIMAL(14,2) NOT NULL,
    "line_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_adjustments" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "source" "bill_adjustment_source" NOT NULL,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL,
    "voucher_id" UUID,
    "code_snapshot" VARCHAR(48),
    "status" "bill_adjustment_status" NOT NULL DEFAULT 'ACTIVE',
    "applied_by_id" UUID NOT NULL,
    "reversed_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reverse_reason" TEXT,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "override_by_id" UUID,
    "override_reason" TEXT,
    "override_before" JSONB,
    "override_after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "provider" VARCHAR(48),
    "provider_ref" VARCHAR(160),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "initiated_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "request_id" VARCHAR(128),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realtime_outbox" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "event_type" VARCHAR(96) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE INDEX "units_dimension_is_active_idx" ON "units"("dimension", "is_active");

-- CreateIndex
CREATE INDEX "ingredient_units_unit_id_is_active_idx" ON "ingredient_units"("unit_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_units_ingredient_id_unit_id_key" ON "ingredient_units"("ingredient_id", "unit_id");

-- CreateIndex
CREATE INDEX "unit_conversions_from_unit_id_to_unit_id_is_active_idx" ON "unit_conversions"("from_unit_id", "to_unit_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_ingredient_id_from_unit_id_to_unit_id_key" ON "unit_conversions"("ingredient_id", "from_unit_id", "to_unit_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_branch_id_scope_created_at_idx" ON "idempotency_keys"("branch_id", "scope", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_status_expires_at_idx" ON "idempotency_keys"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "staff_branches_branch_id_is_active_idx" ON "staff_branches"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_branches_user_id_branch_id_key" ON "staff_branches"("user_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_branches_branch_id_employee_code_key" ON "staff_branches"("branch_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "staff_roles_role_id_idx" ON "staff_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_roles_staff_branch_id_role_id_key" ON "staff_roles"("staff_branch_id", "role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "shifts_branch_id_is_active_idx" ON "shifts"("branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_branch_id_code_key" ON "shifts"("branch_id", "code");

-- CreateIndex
CREATE INDEX "shift_assignments_work_date_shift_id_idx" ON "shift_assignments"("work_date", "shift_id");

-- CreateIndex
CREATE INDEX "shift_assignments_staff_branch_id_work_date_idx" ON "shift_assignments"("staff_branch_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_staff_branch_id_shift_id_work_date_key" ON "shift_assignments"("staff_branch_id", "shift_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_shift_assignment_id_key" ON "attendances"("shift_assignment_id");

-- CreateIndex
CREATE INDEX "attendances_status_idx" ON "attendances"("status");

-- CreateIndex
CREATE INDEX "categories_branch_id_is_active_sort_order_idx" ON "categories"("branch_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "categories_branch_id_code_key" ON "categories"("branch_id", "code");

-- CreateIndex
CREATE INDEX "products_branch_id_category_id_status_idx" ON "products"("branch_id", "category_id", "status");

-- CreateIndex
CREATE INDEX "products_branch_id_is_featured_status_idx" ON "products"("branch_id", "is_featured", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_branch_id_code_key" ON "products"("branch_id", "code");

-- CreateIndex
CREATE INDEX "option_groups_branch_id_type_is_active_idx" ON "option_groups"("branch_id", "type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "option_groups_branch_id_code_key" ON "option_groups"("branch_id", "code");

-- CreateIndex
CREATE INDEX "option_values_option_group_id_is_active_sort_order_idx" ON "option_values"("option_group_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "option_values_option_group_id_code_key" ON "option_values"("option_group_id", "code");

-- CreateIndex
CREATE INDEX "product_option_groups_product_id_sort_order_idx" ON "product_option_groups"("product_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_groups_product_id_option_group_id_key" ON "product_option_groups"("product_id", "option_group_id");

-- CreateIndex
CREATE INDEX "product_option_values_product_option_group_id_is_active_sor_idx" ON "product_option_values"("product_option_group_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_product_option_group_id_option_value__key" ON "product_option_values"("product_option_group_id", "option_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_code_key" ON "ingredients"("code");

-- CreateIndex
CREATE INDEX "ingredients_status_idx" ON "ingredients"("status");

-- CreateIndex
CREATE INDEX "ingredients_base_unit_id_idx" ON "ingredients"("base_unit_id");

-- CreateIndex
CREATE INDEX "recipes_product_id_type_is_active_idx" ON "recipes"("product_id", "type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_product_id_type_product_option_value_id_version_key" ON "recipes"("product_id", "type", "product_option_value_id", "version");

-- CreateIndex
CREATE INDEX "recipe_items_ingredient_id_idx" ON "recipe_items"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_ingredient_id_key" ON "recipe_items"("recipe_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "inventories_branch_id_physical_quantity_reserved_quantity_idx" ON "inventories"("branch_id", "physical_quantity", "reserved_quantity");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_branch_id_ingredient_id_key" ON "inventories"("branch_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_key" ON "carts"("token");

-- CreateIndex
CREATE INDEX "carts_table_session_id_status_idx" ON "carts"("table_session_id", "status");

-- CreateIndex
CREATE INDEX "carts_status_last_activity_at_idx" ON "carts"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "cart_item_options_product_option_value_id_idx" ON "cart_item_options"("product_option_value_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "inventory_reservations_inventory_id_status_idx" ON "inventory_reservations"("inventory_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_order_item_id_idx" ON "inventory_reservations"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_cart_item_id_inventory_id_key" ON "inventory_reservations"("cart_item_id", "inventory_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_branch_id_occurred_at_idx" ON "inventory_transactions"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_inventory_id_occurred_at_idx" ON "inventory_transactions"("inventory_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_occurred_at_idx" ON "inventory_transactions"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_input_unit_id_idx" ON "inventory_transactions"("input_unit_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_order_item_id_idx" ON "inventory_transactions"("order_item_id");

-- CreateIndex
CREATE INDEX "stocktakes_branch_id_status_started_at_idx" ON "stocktakes"("branch_id", "status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_branch_id_code_key" ON "stocktakes"("branch_id", "code");

-- CreateIndex
CREATE INDEX "stocktake_items_inventory_id_idx" ON "stocktake_items"("inventory_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_items_stocktake_id_inventory_id_key" ON "stocktake_items"("stocktake_id", "inventory_id");

-- CreateIndex
CREATE INDEX "tables_branch_id_status_idx" ON "tables"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tables_branch_id_code_key" ON "tables"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "table_qr_codes_token_key" ON "table_qr_codes"("token");

-- CreateIndex
CREATE INDEX "table_qr_codes_table_id_status_idx" ON "table_qr_codes"("table_id", "status");

-- CreateIndex
CREATE INDEX "table_sessions_table_id_status_idx" ON "table_sessions"("table_id", "status");

-- CreateIndex
CREATE INDEX "table_sessions_branch_id_status_opened_at_idx" ON "table_sessions"("branch_id", "status", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "table_sessions_branch_id_session_number_key" ON "table_sessions"("branch_id", "session_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_cart_id_key" ON "orders"("cart_id");

-- CreateIndex
CREATE INDEX "orders_table_session_id_created_at_idx" ON "orders"("table_session_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_branch_id_created_at_idx" ON "orders"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_branch_id_order_number_key" ON "orders"("branch_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_processing_area_status_created_at_idx" ON "order_items"("processing_area", "status", "created_at");

-- CreateIndex
CREATE INDEX "order_items_status_created_at_idx" ON "order_items"("status", "created_at");

-- CreateIndex
CREATE INDEX "order_item_options_order_item_id_idx" ON "order_item_options"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_status_history_order_item_id_created_at_idx" ON "order_item_status_history"("order_item_id", "created_at");

-- CreateIndex
CREATE INDEX "service_requests_branch_id_status_created_at_idx" ON "service_requests"("branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "service_requests_table_session_id_status_idx" ON "service_requests"("table_session_id", "status");

-- CreateIndex
CREATE INDEX "vouchers_branch_id_status_starts_at_ends_at_idx" ON "vouchers"("branch_id", "status", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_branch_id_code_key" ON "vouchers"("branch_id", "code");

-- CreateIndex
CREATE INDEX "bills_table_session_id_status_idx" ON "bills"("table_session_id", "status");

-- CreateIndex
CREATE INDEX "bills_merged_into_bill_id_idx" ON "bills"("merged_into_bill_id");

-- CreateIndex
CREATE INDEX "bills_branch_id_status_created_at_idx" ON "bills"("branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bills_branch_id_bill_number_key" ON "bills"("branch_id", "bill_number");

-- CreateIndex
CREATE INDEX "bill_items_order_item_id_idx" ON "bill_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_items_bill_id_order_item_id_key" ON "bill_items"("bill_id", "order_item_id");

-- CreateIndex
CREATE INDEX "bill_adjustments_bill_id_status_idx" ON "bill_adjustments"("bill_id", "status");

-- CreateIndex
CREATE INDEX "bill_adjustments_voucher_id_status_idx" ON "bill_adjustments"("voucher_id", "status");

-- CreateIndex
CREATE INDEX "bill_adjustments_override_by_id_idx" ON "bill_adjustments"("override_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_bill_id_status_idx" ON "payments"("bill_id", "status");

-- CreateIndex
CREATE INDEX "payments_branch_id_status_created_at_idx" ON "payments"("branch_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_created_at_idx" ON "audit_logs"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "realtime_outbox_processed_at_available_at_idx" ON "realtime_outbox"("processed_at", "available_at");

-- CreateIndex
CREATE INDEX "realtime_outbox_branch_id_event_type_created_at_idx" ON "realtime_outbox"("branch_id", "event_type", "created_at");

-- AddForeignKey
ALTER TABLE "system_setup" ADD CONSTRAINT "system_setup_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_staff_branch_id_fkey" FOREIGN KEY ("staff_branch_id") REFERENCES "staff_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_staff_branch_id_fkey" FOREIGN KEY ("staff_branch_id") REFERENCES "staff_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shift_assignment_id_fkey" FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_adjusted_by_id_fkey" FOREIGN KEY ("adjusted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_product_option_group_id_fkey" FOREIGN KEY ("product_option_group_id") REFERENCES "product_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_option_value_id_fkey" FOREIGN KEY ("product_option_value_id") REFERENCES "product_option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_options" ADD CONSTRAINT "cart_item_options_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_options" ADD CONSTRAINT "cart_item_options_product_option_value_id_fkey" FOREIGN KEY ("product_option_value_id") REFERENCES "product_option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_input_unit_id_fkey" FOREIGN KEY ("input_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_stocktake_item_id_fkey" FOREIGN KEY ("stocktake_item_id") REFERENCES "stocktake_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_qr_codes" ADD CONSTRAINT "table_qr_codes_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_qr_codes" ADD CONSTRAINT "table_qr_codes_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_locked_by_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_product_option_value_id_fkey" FOREIGN KEY ("product_option_value_id") REFERENCES "product_option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_status_history" ADD CONSTRAINT "order_item_status_history_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_status_history" ADD CONSTRAINT "order_item_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_merged_into_bill_id_fkey" FOREIGN KEY ("merged_into_bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_merged_by_id_fkey" FOREIGN KEY ("merged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_adjustments" ADD CONSTRAINT "bill_adjustments_override_by_id_fkey" FOREIGN KEY ("override_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_outbox" ADD CONSTRAINT "realtime_outbox_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL invariants that Prisma schema syntax cannot express.

-- Setup is a singleton protected by row/advisory locks in the application transaction.
ALTER TABLE "system_setup"
  ADD CONSTRAINT "system_setup_singleton_check" CHECK ("id" = 1),
  ADD CONSTRAINT "system_setup_completion_check" CHECK (
    ("status" = 'PENDING' AND "completed_at" IS NULL AND "completed_by_id" IS NULL AND "token_consumed_at" IS NULL)
    OR
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "completed_by_id" IS NOT NULL AND "token_consumed_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "system_setup_token_hash_check" CHECK (
    "setup_token_hash" IS NULL OR length("setup_token_hash") >= 32
  );

-- Only one non-closed session may occupy a table, including payment-requested or locked sessions.
CREATE UNIQUE INDEX "table_sessions_one_open_per_table"
ON "table_sessions" ("table_id")
WHERE "closed_at" IS NULL;

-- A table has one printable active QR token; rotated tokens remain as history.
CREATE UNIQUE INDEX "table_qr_codes_one_active_per_table"
ON "table_qr_codes" ("table_id")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "recipes_one_active_base_per_product"
ON "recipes" ("product_id")
WHERE "type" = 'BASE' AND "is_active" = true;

CREATE UNIQUE INDEX "recipes_one_active_option_recipe"
ON "recipes" ("product_option_value_id")
WHERE "product_option_value_id" IS NOT NULL AND "is_active" = true;

CREATE UNIQUE INDEX "recipes_base_version_per_product"
ON "recipes" ("product_id", "version")
WHERE "type" = 'BASE';

CREATE UNIQUE INDEX "product_option_values_one_default_per_group"
ON "product_option_values" ("product_option_group_id")
WHERE "is_default" = true AND "is_active" = true;

CREATE UNIQUE INDEX "ingredient_units_one_default_per_ingredient"
ON "ingredient_units" ("ingredient_id")
WHERE "is_default" = true AND "is_active" = true;

CREATE UNIQUE INDEX "unit_conversions_one_active_path"
ON "unit_conversions" ("ingredient_id", "from_unit_id", "to_unit_id")
WHERE "is_active" = true;

CREATE UNIQUE INDEX "bill_adjustments_one_active_source_per_bill"
ON "bill_adjustments" ("bill_id", "source")
WHERE "status" = 'ACTIVE';

-- MVP payment rule: a bill can have only one active or successful payment.
CREATE UNIQUE INDEX "payments_one_active_or_success_per_bill"
ON "payments" ("bill_id")
WHERE "status" IN ('PENDING', 'SUCCEEDED');

-- Cancellation side effects must not be recorded twice for one order item.
CREATE UNIQUE INDEX "inventory_transactions_one_cancel_effect_per_item"
ON "inventory_transactions" ("order_item_id", "type")
WHERE "order_item_id" IS NOT NULL AND "type" IN ('RETURN', 'WASTE');

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_attendance_grace_check" CHECK ("attendance_grace_minutes" >= 0);

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_grace_minutes_check" CHECK ("grace_minutes" IS NULL OR "grace_minutes" >= 0);

ALTER TABLE "product_option_groups"
  ADD CONSTRAINT "product_option_groups_selection_check" CHECK (
    "min_selections" >= 0 AND "max_selections" >= "min_selections"
  );

ALTER TABLE "products"
  ADD CONSTRAINT "products_base_price_check" CHECK ("base_price" >= 0);

ALTER TABLE "product_option_values"
  ADD CONSTRAINT "product_option_values_price_delta_check" CHECK ("price_delta" >= 0);

ALTER TABLE "units"
  ADD CONSTRAINT "units_code_check" CHECK (length(trim("code")) > 0),
  ADD CONSTRAINT "units_symbol_check" CHECK (length(trim("symbol")) > 0);

ALTER TABLE "unit_conversions"
  ADD CONSTRAINT "unit_conversions_factor_check" CHECK ("conversion_factor" > 0),
  ADD CONSTRAINT "unit_conversions_no_self_check" CHECK ("from_unit_id" <> "to_unit_id");

ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_quantity_check" CHECK (
    "physical_quantity" >= 0
    AND "reserved_quantity" >= 0
    AND "minimum_quantity" >= 0
    AND "reserved_quantity" <= "physical_quantity"
  );

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "inventory_reservations_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "inventory_reservations_terminal_check" CHECK (
    ("status" = 'ACTIVE' AND "terminal_at" IS NULL)
    OR
    ("status" IN ('CONSUMED', 'RELEASED', 'EXPIRED') AND "terminal_at" IS NOT NULL)
  );

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_quantity_check" CHECK ("quantity_delta" <> 0),
  ADD CONSTRAINT "inventory_transactions_import_snapshot_check" CHECK (
    "type" <> 'IMPORT'
    OR (
      "quantity_delta" > 0
      AND "input_quantity" IS NOT NULL
      AND "input_quantity" > 0
      AND "input_unit_id" IS NOT NULL
      AND "conversion_factor_snapshot" IS NOT NULL
      AND "conversion_factor_snapshot" > 0
      AND "converted_base_quantity" IS NOT NULL
      AND "converted_base_quantity" = "quantity_delta"
    )
  );

ALTER TABLE "stocktake_items"
  ADD CONSTRAINT "stocktake_items_difference_check" CHECK ("difference" = "counted_quantity" - "expected_quantity");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_amount_check" CHECK (
    "base_unit_price" >= 0
    AND "option_unit_price" >= 0
    AND "final_unit_price" = "base_unit_price" + "option_unit_price"
    AND "line_subtotal" = "final_unit_price" * "quantity"
  ),
  ADD CONSTRAINT "order_items_cancel_check" CHECK (
    ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL)
    OR
    ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL AND length(trim("cancel_reason")) > 0)
  );

ALTER TABLE "bills"
  ADD CONSTRAINT "bills_amounts_check" CHECK (
    "subtotal" >= 0
    AND "voucher_discount_amount" >= 0
    AND "direct_discount_amount" >= 0
    AND "discounted_amount" = "subtotal" - "voucher_discount_amount" - "direct_discount_amount"
    AND "discounted_amount" >= 0
    AND "vat_rate" >= 0
    AND "vat_amount" = round("discounted_amount" * "vat_rate" / 100, 0)
    AND "total" = "discounted_amount" + "vat_amount"
  ),
  ADD CONSTRAINT "bills_void_check" CHECK (
    ("status" <> 'VOID' AND "voided_at" IS NULL AND "voided_by_id" IS NULL AND "void_reason" IS NULL)
    OR
    ("status" = 'VOID' AND "voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND length(trim("void_reason")) > 0)
  ),
  ADD CONSTRAINT "bills_merge_check" CHECK (
    ("status" <> 'MERGED' AND "merged_into_bill_id" IS NULL AND "merged_at" IS NULL AND "merged_by_id" IS NULL AND "merge_reason" IS NULL)
    OR
    ("status" = 'MERGED' AND "merged_into_bill_id" IS NOT NULL AND "merged_at" IS NOT NULL AND "merged_by_id" IS NOT NULL AND length(trim("merge_reason")) > 0)
  );

ALTER TABLE "bill_items"
  ADD CONSTRAINT "bill_items_amount_check" CHECK (
    "quantity" > 0 AND "unit_price_snapshot" >= 0 AND "line_amount" = "unit_price_snapshot" * "quantity"
  );

ALTER TABLE "bill_adjustments"
  ADD CONSTRAINT "bill_adjustments_value_check" CHECK (
    "discount_value" > 0
    AND "discount_amount" >= 0
    AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 100)
    AND ("voucher_id" IS NOT NULL OR "source" = 'DIRECT_DISCOUNT')
  ),
  ADD CONSTRAINT "bill_adjustments_override_check" CHECK (
    ("is_override" = false AND "override_by_id" IS NULL AND "override_reason" IS NULL AND "override_before" IS NULL AND "override_after" IS NULL)
    OR
    ("is_override" = true AND "override_by_id" IS NOT NULL AND length(trim("override_reason")) > 0 AND "override_before" IS NOT NULL AND "override_after" IS NOT NULL)
  );

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_confirmation_check" CHECK (
    ("status" = 'SUCCEEDED' AND "confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL)
    OR
    ("status" <> 'SUCCEEDED')
  );

ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_time_check" CHECK (
    "check_out_at" IS NULL OR "check_in_at" IS NULL OR "check_out_at" >= "check_in_at"
  ),
  ADD CONSTRAINT "attendances_source_check" CHECK (
    ("check_in_at" IS NULL OR "check_in_source" IS NOT NULL)
    AND
    ("check_out_at" IS NULL OR "check_out_source" IS NOT NULL)
  ),
  ADD CONSTRAINT "attendances_manual_adjustment_check" CHECK (
    ("check_in_source" <> 'MANUAL_ADJUSTMENT' AND "check_out_source" <> 'MANUAL_ADJUSTMENT')
    OR
    ("adjusted_by_id" IS NOT NULL AND length(trim("adjustment_reason")) > 0)
  );

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "idempotency_keys_response_check" CHECK (
    ("status" = 'PROCESSING' AND "response_status" IS NULL AND "response_body" IS NULL)
    OR
    ("status" IN ('SUCCEEDED', 'FAILED') AND "response_status" IS NOT NULL)
    OR
    ("status" = 'EXPIRED')
  );

CREATE OR REPLACE FUNCTION "assert_unit_conversion_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_unit uuid;
  from_dimension "unit_dimension";
  to_dimension "unit_dimension";
BEGIN
  SELECT "base_unit_id" INTO base_unit
  FROM "ingredients"
  WHERE "id" = NEW."ingredient_id";

  IF base_unit IS NULL THEN
    RAISE EXCEPTION 'Unit conversion requires an existing ingredient';
  END IF;

  IF NEW."to_unit_id" <> base_unit THEN
    RAISE EXCEPTION 'Ingredient conversion must target the ingredient base unit';
  END IF;

  SELECT "dimension" INTO from_dimension FROM "units" WHERE "id" = NEW."from_unit_id";
  SELECT "dimension" INTO to_dimension FROM "units" WHERE "id" = NEW."to_unit_id";

  IF from_dimension IS NULL OR to_dimension IS NULL THEN
    RAISE EXCEPTION 'Unit conversion requires existing units';
  END IF;

  IF from_dimension <> to_dimension AND from_dimension <> 'PACKAGE' AND to_dimension <> 'PACKAGE' THEN
    RAISE EXCEPTION 'Unit conversion dimensions are incompatible';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "unit_conversions_scope_guard"
BEFORE INSERT OR UPDATE ON "unit_conversions"
FOR EACH ROW EXECUTE FUNCTION "assert_unit_conversion_scope"();

CREATE OR REPLACE FUNCTION "assert_ingredient_unit_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ingredients" i
    JOIN "units" u ON u."id" = NEW."unit_id"
    WHERE i."id" = NEW."ingredient_id"
      AND (
        i."base_unit_id" = NEW."unit_id"
        OR EXISTS (
          SELECT 1
          FROM "unit_conversions" c
          WHERE c."ingredient_id" = NEW."ingredient_id"
            AND c."from_unit_id" = NEW."unit_id"
            AND c."to_unit_id" = i."base_unit_id"
            AND c."is_active" = true
        )
      )
  ) THEN
    RAISE EXCEPTION 'Ingredient unit must be the base unit or have an active conversion to base unit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ingredient_units_scope_guard"
BEFORE INSERT OR UPDATE ON "ingredient_units"
FOR EACH ROW EXECUTE FUNCTION "assert_ingredient_unit_scope"();

CREATE OR REPLACE FUNCTION "assert_business_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'products' AND NOT EXISTS (
    SELECT 1 FROM "categories" c WHERE c."id" = NEW."category_id" AND c."branch_id" = NEW."branch_id"
  ) THEN
    RAISE EXCEPTION 'Product and category must belong to the same branch';
  ELSIF TG_TABLE_NAME = 'product_option_groups' AND NOT EXISTS (
    SELECT 1
    FROM "products" p
    JOIN "option_groups" og ON og."id" = NEW."option_group_id"
    WHERE p."id" = NEW."product_id" AND p."branch_id" = og."branch_id"
  ) THEN
    RAISE EXCEPTION 'Product option group must belong to the product branch';
  ELSIF TG_TABLE_NAME = 'product_option_values' AND NOT EXISTS (
    SELECT 1
    FROM "product_option_groups" pog
    JOIN "option_values" ov ON ov."id" = NEW."option_value_id"
    JOIN "option_groups" og ON og."id" = ov."option_group_id"
    JOIN "products" p ON p."id" = pog."product_id"
    WHERE pog."id" = NEW."product_option_group_id" AND og."branch_id" = p."branch_id"
  ) THEN
    RAISE EXCEPTION 'Product option value must belong to the product branch';
  ELSIF TG_TABLE_NAME = 'shift_assignments' AND NOT EXISTS (
    SELECT 1
    FROM "staff_branches" sb
    JOIN "shifts" s ON s."id" = NEW."shift_id"
    WHERE sb."id" = NEW."staff_branch_id" AND sb."branch_id" = s."branch_id"
  ) THEN
    RAISE EXCEPTION 'Shift assignment staff and shift must belong to the same branch';
  ELSIF TG_TABLE_NAME = 'recipes' THEN
    IF NEW."type" = 'BASE' AND NEW."product_option_value_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Base recipe cannot target an option';
    ELSIF NEW."type" IN ('SIZE', 'ADD_ON') AND NEW."product_option_value_id" IS NULL THEN
      RAISE EXCEPTION 'Option recipe requires an option';
    ELSIF NEW."product_option_value_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "product_option_values" pov
      JOIN "product_option_groups" pog ON pog."id" = pov."product_option_group_id"
      WHERE pov."id" = NEW."product_option_value_id" AND pog."product_id" = NEW."product_id"
    ) THEN
      RAISE EXCEPTION 'Recipe option must belong to its product';
    END IF;
  ELSIF TG_TABLE_NAME = 'table_sessions' AND NOT EXISTS (
    SELECT 1 FROM "tables" t WHERE t."id" = NEW."table_id" AND t."branch_id" = NEW."branch_id"
  ) THEN
    RAISE EXCEPTION 'Session and table must belong to the same branch';
  ELSIF TG_TABLE_NAME = 'carts' AND NOT EXISTS (
    SELECT 1 FROM "table_sessions" s
    WHERE s."id" = NEW."table_session_id"
      AND s."branch_id" = NEW."branch_id"
      AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cart requires an open session in the same branch';
  ELSIF TG_TABLE_NAME = 'cart_items' AND NOT EXISTS (
    SELECT 1
    FROM "carts" c
    JOIN "products" p ON p."id" = NEW."product_id"
    WHERE c."id" = NEW."cart_id" AND c."branch_id" = p."branch_id"
  ) THEN
    RAISE EXCEPTION 'Cart item product must belong to the cart branch';
  ELSIF TG_TABLE_NAME = 'cart_item_options' AND NOT EXISTS (
    SELECT 1
    FROM "cart_items" ci
    JOIN "product_option_values" pov ON pov."id" = NEW."product_option_value_id"
    JOIN "product_option_groups" pog ON pog."id" = pov."product_option_group_id"
    WHERE ci."id" = NEW."cart_item_id" AND ci."product_id" = pog."product_id"
  ) THEN
    RAISE EXCEPTION 'Cart option must be configured for the cart item product';
  ELSIF TG_TABLE_NAME = 'inventory_reservations' AND NOT EXISTS (
    SELECT 1
    FROM "cart_items" ci
    JOIN "carts" c ON c."id" = ci."cart_id"
    JOIN "inventories" i ON i."id" = NEW."inventory_id"
    WHERE ci."id" = NEW."cart_item_id" AND c."branch_id" = i."branch_id"
  ) THEN
    RAISE EXCEPTION 'Reservation inventory must belong to the cart branch';
  ELSIF TG_TABLE_NAME = 'orders' AND NOT EXISTS (
    SELECT 1 FROM "table_sessions" s
    WHERE s."id" = NEW."table_session_id"
      AND s."branch_id" = NEW."branch_id"
      AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
      AND (
        NEW."cart_id" IS NULL
        OR EXISTS (
          SELECT 1 FROM "carts" c
          WHERE c."id" = NEW."cart_id" AND c."branch_id" = NEW."branch_id" AND c."table_session_id" = NEW."table_session_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Order requires an open session in the same branch';
  ELSIF TG_TABLE_NAME = 'order_items' AND NOT EXISTS (
    SELECT 1
    FROM "orders" o
    JOIN "products" p ON p."id" = NEW."product_id"
    WHERE o."id" = NEW."order_id" AND o."branch_id" = p."branch_id"
  ) THEN
    RAISE EXCEPTION 'Order item product must belong to the order branch';
  ELSIF TG_TABLE_NAME = 'order_item_options' AND NEW."product_option_value_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "order_items" oi
    JOIN "product_option_values" pov ON pov."id" = NEW."product_option_value_id"
    JOIN "product_option_groups" pog ON pog."id" = pov."product_option_group_id"
    WHERE oi."id" = NEW."order_item_id" AND oi."product_id" = pog."product_id"
  ) THEN
    RAISE EXCEPTION 'Order item option must be configured for the product';
  ELSIF TG_TABLE_NAME = 'inventory_transactions' AND NOT EXISTS (
    SELECT 1 FROM "inventories" i WHERE i."id" = NEW."inventory_id" AND i."branch_id" = NEW."branch_id"
  ) THEN
    RAISE EXCEPTION 'Inventory transaction must belong to the inventory branch';
  ELSIF TG_TABLE_NAME = 'stocktake_items' AND NOT EXISTS (
    SELECT 1
    FROM "stocktakes" st
    JOIN "inventories" i ON i."id" = NEW."inventory_id"
    WHERE st."id" = NEW."stocktake_id" AND st."branch_id" = i."branch_id"
  ) THEN
    RAISE EXCEPTION 'Stocktake item must belong to the stocktake branch';
  ELSIF TG_TABLE_NAME = 'service_requests' AND NOT EXISTS (
    SELECT 1 FROM "table_sessions" s
    WHERE s."id" = NEW."table_session_id"
      AND s."branch_id" = NEW."branch_id"
      AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Service request requires an open session in the same branch';
  ELSIF TG_TABLE_NAME = 'bills' AND NOT EXISTS (
    SELECT 1 FROM "table_sessions" s
    WHERE s."id" = NEW."table_session_id"
      AND s."branch_id" = NEW."branch_id"
      AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Bill and session must belong to the same branch';
  ELSIF TG_TABLE_NAME = 'bills' AND NEW."merged_into_bill_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "bills" target
    WHERE target."id" = NEW."merged_into_bill_id"
      AND target."branch_id" = NEW."branch_id"
      AND target."table_session_id" = NEW."table_session_id"
      AND target."status" IN ('DRAFT', 'ISSUED')
  ) THEN
    RAISE EXCEPTION 'Merged bill target must be an unpaid bill in the same table session';
  ELSIF TG_TABLE_NAME = 'bill_adjustments' AND NEW."voucher_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "bills" b
    JOIN "vouchers" v ON v."id" = NEW."voucher_id"
    WHERE b."id" = NEW."bill_id" AND b."branch_id" = v."branch_id"
  ) THEN
    RAISE EXCEPTION 'Voucher and bill must belong to the same branch';
  ELSIF TG_TABLE_NAME = 'payments' AND NOT EXISTS (
    SELECT 1 FROM "bills" b WHERE b."id" = NEW."bill_id" AND b."branch_id" = NEW."branch_id"
  ) THEN
    RAISE EXCEPTION 'Payment and bill must belong to the same branch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_scope_guard" BEFORE INSERT OR UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "product_option_groups_scope_guard" BEFORE INSERT OR UPDATE ON "product_option_groups" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "product_option_values_scope_guard" BEFORE INSERT OR UPDATE ON "product_option_values" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "shift_assignments_scope_guard" BEFORE INSERT OR UPDATE ON "shift_assignments" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "recipes_scope_guard" BEFORE INSERT OR UPDATE ON "recipes" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "table_sessions_scope_guard" BEFORE INSERT OR UPDATE ON "table_sessions" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "carts_scope_guard" BEFORE INSERT OR UPDATE ON "carts" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "cart_items_scope_guard" BEFORE INSERT OR UPDATE ON "cart_items" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "cart_item_options_scope_guard" BEFORE INSERT OR UPDATE ON "cart_item_options" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "inventory_reservations_scope_guard" BEFORE INSERT OR UPDATE ON "inventory_reservations" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "orders_scope_guard" BEFORE INSERT OR UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "order_items_scope_guard" BEFORE INSERT OR UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "order_item_options_scope_guard" BEFORE INSERT OR UPDATE ON "order_item_options" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "inventory_transactions_scope_guard" BEFORE INSERT OR UPDATE ON "inventory_transactions" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "stocktake_items_scope_guard" BEFORE INSERT OR UPDATE ON "stocktake_items" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "service_requests_scope_guard" BEFORE INSERT OR UPDATE ON "service_requests" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "bills_scope_guard" BEFORE INSERT OR UPDATE ON "bills" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "bill_adjustments_scope_guard" BEFORE INSERT OR UPDATE ON "bill_adjustments" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();
CREATE TRIGGER "payments_scope_guard" BEFORE INSERT OR UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION "assert_business_scope"();

-- Reservation rows own the reserved_quantity counter. The conditional UPDATE is the row lock
-- that makes two simultaneous last-cup attempts deterministic.
CREATE OR REPLACE FUNCTION "maintain_inventory_reservation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_rows integer;
  delta numeric(18,3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inventory reservations are historical records and cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' OR NEW."terminal_at" IS NOT NULL OR NEW."order_item_id" IS NOT NULL THEN
      RAISE EXCEPTION 'A reservation must be created as ACTIVE';
    END IF;

    UPDATE "inventories"
    SET "reserved_quantity" = "reserved_quantity" + NEW."quantity",
        "version" = "version" + 1,
        "updated_at" = now()
    WHERE "id" = NEW."inventory_id"
      AND "physical_quantity" - "reserved_quantity" >= NEW."quantity";
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      RAISE EXCEPTION 'Insufficient available inventory for reservation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."inventory_id" <> OLD."inventory_id" OR NEW."cart_item_id" <> OLD."cart_item_id" THEN
    RAISE EXCEPTION 'Reservation ownership cannot be changed';
  END IF;

  IF OLD."status" <> 'ACTIVE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Terminal reservation cannot be modified or consumed twice';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'ACTIVE' THEN
    delta := NEW."quantity" - OLD."quantity";
    IF delta > 0 THEN
      UPDATE "inventories"
      SET "reserved_quantity" = "reserved_quantity" + delta,
          "version" = "version" + 1,
          "updated_at" = now()
      WHERE "id" = NEW."inventory_id"
        AND "physical_quantity" - "reserved_quantity" >= delta;
      GET DIAGNOSTICS changed_rows = ROW_COUNT;
      IF changed_rows <> 1 THEN
        RAISE EXCEPTION 'Insufficient available inventory to increase reservation';
      END IF;
    ELSIF delta < 0 THEN
      UPDATE "inventories"
      SET "reserved_quantity" = "reserved_quantity" + delta,
          "version" = "version" + 1,
          "updated_at" = now()
      WHERE "id" = NEW."inventory_id";
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" NOT IN ('CONSUMED', 'RELEASED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Invalid reservation status transition';
  END IF;
  IF NEW."status" = 'CONSUMED' AND NEW."order_item_id" IS NULL THEN
    RAISE EXCEPTION 'Consumed reservation requires an order item';
  END IF;

  NEW."terminal_at" := COALESCE(NEW."terminal_at", now());
  UPDATE "inventories"
  SET "reserved_quantity" = "reserved_quantity" - OLD."quantity",
      "version" = "version" + 1,
      "updated_at" = now()
  WHERE "id" = OLD."inventory_id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_reservations_counter_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "inventory_reservations"
FOR EACH ROW EXECUTE FUNCTION "maintain_inventory_reservation"();

-- Prevent one order-item unit from being allocated to more than one active bill.
CREATE OR REPLACE FUNCTION "guard_bill_item_allocation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "bill_status";
  order_quantity integer;
  allocated_quantity bigint;
  bill_session uuid;
  order_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "status" INTO parent_status FROM "bills" WHERE "id" = OLD."bill_id" FOR UPDATE;
    IF parent_status NOT IN ('DRAFT', 'ISSUED') THEN
      RAISE EXCEPTION 'Items can only be changed on a draft or issued unpaid bill';
    END IF;
    PERFORM 1 FROM "order_items" WHERE "id" = OLD."order_item_id" FOR UPDATE;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW."bill_id" <> OLD."bill_id" OR NEW."order_item_id" <> OLD."order_item_id") THEN
    RAISE EXCEPTION 'Move allocations by deleting and inserting inside the split or merge bill transaction';
  END IF;

  SELECT "status", "table_session_id" INTO parent_status, bill_session
  FROM "bills" WHERE "id" = NEW."bill_id" FOR UPDATE;
  IF parent_status NOT IN ('DRAFT', 'ISSUED') THEN
    RAISE EXCEPTION 'Items can only be changed on a draft or issued unpaid bill';
  END IF;

  SELECT oi."quantity", o."table_session_id"
  INTO order_quantity, order_session
  FROM "order_items" oi
  JOIN "orders" o ON o."id" = oi."order_id"
  WHERE oi."id" = NEW."order_item_id" AND oi."status" <> 'CANCELLED'
  FOR UPDATE OF oi;

  IF order_quantity IS NULL THEN
    RAISE EXCEPTION 'Cancelled or missing order item cannot be billed';
  END IF;
  IF order_session <> bill_session THEN
    RAISE EXCEPTION 'Bill item and bill must belong to the same table session';
  END IF;

  SELECT COALESCE(sum(bi."quantity"), 0)
  INTO allocated_quantity
  FROM "bill_items" bi
  JOIN "bills" b ON b."id" = bi."bill_id"
  WHERE bi."order_item_id" = NEW."order_item_id"
    AND b."status" NOT IN ('VOID', 'MERGED')
    AND bi."id" <> NEW."id";

  IF allocated_quantity + NEW."quantity" > order_quantity THEN
    RAISE EXCEPTION 'Billed quantity exceeds order item quantity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bill_items_allocation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "bill_items"
FOR EACH ROW EXECUTE FUNCTION "guard_bill_item_allocation"();

CREATE OR REPLACE FUNCTION "guard_bill_adjustment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "bill_status";
  target_bill_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bill adjustments are historical records; reverse them instead of deleting';
  ELSE
    target_bill_id := NEW."bill_id";
  END IF;

  SELECT "status" INTO parent_status
  FROM "bills" WHERE "id" = target_bill_id FOR UPDATE;
  IF parent_status NOT IN ('DRAFT', 'ISSUED') THEN
    RAISE EXCEPTION 'Adjustments can only be changed on a draft or issued unpaid bill';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bill_adjustments_final_bill_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "bill_adjustments"
FOR EACH ROW EXECUTE FUNCTION "guard_bill_adjustment"();

CREATE OR REPLACE FUNCTION "protect_final_bill"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  successful_amount numeric(14,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IN ('PAID', 'MERGED', 'VOID') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Paid, merged or void bill is immutable';
    END IF;
    IF OLD."status" = 'PAID' AND NEW."status" <> 'PAID' THEN
      RAISE EXCEPTION 'Paid bill cannot be split, merged or voided';
    END IF;
  END IF;

  SELECT COALESCE(sum("amount"), 0)
  INTO successful_amount
  FROM "payments"
  WHERE "bill_id" = NEW."id" AND "status" = 'SUCCEEDED';

  IF successful_amount > NEW."total" THEN
    RAISE EXCEPTION 'Bill total cannot be lower than successful payments';
  ELSIF NEW."status" = 'PAID' AND successful_amount <> NEW."total" THEN
    RAISE EXCEPTION 'Paid bill requires one successful payment equal to total';
  ELSIF NEW."status" IN ('DRAFT', 'ISSUED', 'MERGED', 'VOID') AND successful_amount <> 0 THEN
    RAISE EXCEPTION 'Unpaid, merged or void bill cannot have successful payment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bills_final_state_guard"
BEFORE INSERT OR UPDATE ON "bills"
FOR EACH ROW EXECUTE FUNCTION "protect_final_bill"();

CREATE OR REPLACE FUNCTION "guard_payment_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bill_total numeric(14,2);
  bill_state "bill_status";
BEGIN
  SELECT "total", "status" INTO bill_total, bill_state
  FROM "bills" WHERE "id" = NEW."bill_id" FOR UPDATE;

  IF bill_state NOT IN ('ISSUED') THEN
    RAISE EXCEPTION 'Payment can only be created or confirmed for an issued bill';
  END IF;

  IF NEW."amount" <> bill_total THEN
    RAISE EXCEPTION 'MVP payment amount must equal the bill total';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."status" <> OLD."status" THEN
      IF OLD."status" = 'PENDING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED') THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Invalid or repeated payment status transition';
      END IF;
    ELSIF OLD."status" <> 'PENDING' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Terminal payment cannot be modified';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_transition_guard"
BEFORE INSERT OR UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION "guard_payment_transition"();

-- Closing a session is allowed only after every non-cancelled unit is billed and all bills are final.
CREATE OR REPLACE FUNCTION "guard_session_close"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'CLOSED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Closed session is immutable';
  END IF;

  IF NEW."status" = 'CLOSED' AND OLD."status" <> 'CLOSED' THEN
    IF NEW."closed_at" IS NULL THEN
      RAISE EXCEPTION 'Closed session requires closed_at';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "bills" b
      WHERE b."table_session_id" = NEW."id" AND b."status" NOT IN ('PAID', 'VOID', 'MERGED')
    ) THEN
      RAISE EXCEPTION 'All effective bills must be paid or void before closing the session';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."order_id"
      LEFT JOIN (
        SELECT bi."order_item_id", sum(bi."quantity") AS billed_quantity
        FROM "bill_items" bi
        JOIN "bills" b ON b."id" = bi."bill_id" AND b."status" NOT IN ('VOID', 'MERGED')
        GROUP BY bi."order_item_id"
      ) x ON x."order_item_id" = oi."id"
      WHERE o."table_session_id" = NEW."id"
        AND oi."status" <> 'CANCELLED'
        AND COALESCE(x.billed_quantity, 0) <> oi."quantity"
    ) THEN
      RAISE EXCEPTION 'Every non-cancelled order item unit must be billed before closing the session';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "inventory_reservations" ir
      JOIN "cart_items" ci ON ci."id" = ir."cart_item_id"
      JOIN "carts" c ON c."id" = ci."cart_id"
      WHERE c."table_session_id" = NEW."id" AND ir."status" = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Active inventory reservations must be released before closing the session';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "table_sessions_close_guard"
BEFORE UPDATE ON "table_sessions"
FOR EACH ROW EXECUTE FUNCTION "guard_session_close"();

-- Ledger and audit records are append-only.
CREATE OR REPLACE FUNCTION "prevent_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "inventory_transactions_append_only"
BEFORE UPDATE OR DELETE ON "inventory_transactions"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "orders_no_delete"
BEFORE DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "order_items_no_delete"
BEFORE DELETE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "order_item_status_history_append_only"
BEFORE UPDATE OR DELETE ON "order_item_status_history"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "bills_no_delete"
BEFORE DELETE ON "bills"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();

CREATE TRIGGER "payments_no_delete"
BEFORE DELETE ON "payments"
FOR EACH ROW EXECUTE FUNCTION "prevent_history_mutation"();


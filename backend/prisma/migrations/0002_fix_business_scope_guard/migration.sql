CREATE OR REPLACE FUNCTION "assert_business_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "categories" c WHERE c."id" = NEW."category_id" AND c."branch_id" = NEW."branch_id"
    ) THEN
      RAISE EXCEPTION 'Product and category must belong to the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'product_option_groups' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "products" p
      JOIN "option_groups" og ON og."id" = NEW."option_group_id"
      WHERE p."id" = NEW."product_id" AND p."branch_id" = og."branch_id"
    ) THEN
      RAISE EXCEPTION 'Product option group must belong to the product branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'product_option_values' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "product_option_groups" pog
      JOIN "option_values" ov ON ov."id" = NEW."option_value_id"
      JOIN "option_groups" og ON og."id" = ov."option_group_id"
      JOIN "products" p ON p."id" = pog."product_id"
      WHERE pog."id" = NEW."product_option_group_id" AND og."branch_id" = p."branch_id"
    ) THEN
      RAISE EXCEPTION 'Product option value must belong to the product branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'shift_assignments' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "staff_branches" sb
      JOIN "shifts" s ON s."id" = NEW."shift_id"
      WHERE sb."id" = NEW."staff_branch_id" AND sb."branch_id" = s."branch_id"
    ) THEN
      RAISE EXCEPTION 'Shift assignment staff and shift must belong to the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'recipes' THEN
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
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'table_sessions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "tables" t WHERE t."id" = NEW."table_id" AND t."branch_id" = NEW."branch_id"
    ) THEN
      RAISE EXCEPTION 'Session and table must belong to the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'carts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "table_sessions" s
      WHERE s."id" = NEW."table_session_id"
        AND s."branch_id" = NEW."branch_id"
        AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Cart requires an open session in the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'cart_items' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "carts" c
      JOIN "products" p ON p."id" = NEW."product_id"
      WHERE c."id" = NEW."cart_id" AND c."branch_id" = p."branch_id"
    ) THEN
      RAISE EXCEPTION 'Cart item product must belong to the cart branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'cart_item_options' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "cart_items" ci
      JOIN "product_option_values" pov ON pov."id" = NEW."product_option_value_id"
      JOIN "product_option_groups" pog ON pog."id" = pov."product_option_group_id"
      WHERE ci."id" = NEW."cart_item_id" AND ci."product_id" = pog."product_id"
    ) THEN
      RAISE EXCEPTION 'Cart option must be configured for the cart item product';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'inventory_reservations' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "cart_items" ci
      JOIN "carts" c ON c."id" = ci."cart_id"
      JOIN "inventories" i ON i."id" = NEW."inventory_id"
      WHERE ci."id" = NEW."cart_item_id" AND c."branch_id" = i."branch_id"
    ) THEN
      RAISE EXCEPTION 'Reservation inventory must belong to the cart branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF NOT EXISTS (
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
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'order_items' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "orders" o
      JOIN "products" p ON p."id" = NEW."product_id"
      WHERE o."id" = NEW."order_id" AND o."branch_id" = p."branch_id"
    ) THEN
      RAISE EXCEPTION 'Order item product must belong to the order branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'order_item_options' THEN
    IF NEW."product_option_value_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "order_items" oi
      JOIN "product_option_values" pov ON pov."id" = NEW."product_option_value_id"
      JOIN "product_option_groups" pog ON pog."id" = pov."product_option_group_id"
      WHERE oi."id" = NEW."order_item_id" AND oi."product_id" = pog."product_id"
    ) THEN
      RAISE EXCEPTION 'Order item option must be configured for the product';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'inventory_transactions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "inventories" i WHERE i."id" = NEW."inventory_id" AND i."branch_id" = NEW."branch_id"
    ) THEN
      RAISE EXCEPTION 'Inventory transaction must belong to the inventory branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'stocktake_items' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "stocktakes" st
      JOIN "inventories" i ON i."id" = NEW."inventory_id"
      WHERE st."id" = NEW."stocktake_id" AND st."branch_id" = i."branch_id"
    ) THEN
      RAISE EXCEPTION 'Stocktake item must belong to the stocktake branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'service_requests' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "table_sessions" s
      WHERE s."id" = NEW."table_session_id"
        AND s."branch_id" = NEW."branch_id"
        AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Service request requires an open session in the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bills' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "table_sessions" s
      WHERE s."id" = NEW."table_session_id"
        AND s."branch_id" = NEW."branch_id"
        AND (TG_OP <> 'INSERT' OR s."closed_at" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Bill and session must belong to the same branch';
    END IF;
    IF NEW."merged_into_bill_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "bills" target
      WHERE target."id" = NEW."merged_into_bill_id"
        AND target."branch_id" = NEW."branch_id"
        AND target."table_session_id" = NEW."table_session_id"
        AND target."status" IN ('DRAFT', 'ISSUED')
    ) THEN
      RAISE EXCEPTION 'Merged bill target must be an unpaid bill in the same table session';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bill_adjustments' THEN
    IF NEW."voucher_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "bills" b
      JOIN "vouchers" v ON v."id" = NEW."voucher_id"
      WHERE b."id" = NEW."bill_id" AND b."branch_id" = v."branch_id"
    ) THEN
      RAISE EXCEPTION 'Voucher and bill must belong to the same branch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "bills" b WHERE b."id" = NEW."bill_id" AND b."branch_id" = NEW."branch_id"
    ) THEN
      RAISE EXCEPTION 'Payment and bill must belong to the same branch';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

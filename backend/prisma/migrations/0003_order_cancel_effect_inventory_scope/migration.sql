DROP INDEX IF EXISTS "inventory_transactions_one_cancel_effect_per_item";

CREATE UNIQUE INDEX "inventory_transactions_one_cancel_effect_per_item_inventory"
ON "inventory_transactions" ("order_item_id", "type", "inventory_id")
WHERE "order_item_id" IS NOT NULL AND "type" IN ('RETURN', 'WASTE');

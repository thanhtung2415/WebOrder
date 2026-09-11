ALTER TABLE "recipe_items"
  ADD CONSTRAINT "recipe_items_quantity_check" CHECK ("quantity" > 0);


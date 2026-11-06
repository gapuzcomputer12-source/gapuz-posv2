-- Migration: add a "low stock" crossing signal (exactly 3 left) to
-- deduct_stock, alongside the existing "zeroed out" signal.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: admins asked for a heads-up email when a product's stock crosses
-- down to exactly 3, so they can reorder before it runs out — but NOT one
-- email per unit sold while stock drains through 2 and 1, which would just
-- spam the inbox. So this only fires once, on the exact prev>3 -> next=3
-- crossing, the same way out_zeroed already only fires once on prev>0 ->
-- next=0. Values 1 and 2 are intentionally silent.
--
-- This changes deduct_stock's return shape (adds out_low), so the function
-- must be dropped first — Postgres won't let CREATE OR REPLACE change a
-- function's output columns.

DROP FUNCTION IF EXISTS deduct_stock(jsonb);

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock INTO v_prev FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > 3 AND v_next = 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

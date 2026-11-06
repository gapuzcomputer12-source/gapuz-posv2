-- Migration: widen the "low stock" email trigger from an exact crossing
-- through 3 to any resulting stock of 1, 2, or 3.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: the previous version (add_low_stock_threshold.sql) only fired
-- out_low when stock crossed exactly from above 3 down to 3 (prev>3 AND
-- next=3). That meant a checkout that deducted several units at once and
-- landed on 1 or 2 directly (skipping over 3) never sent a low-stock email
-- at all. This version fires whenever a genuine decrease lands the new
-- stock in [1,3], covering that gap. 0 still only ever sends "Out of
-- Stock" (out_zeroed), never "Low Stock".
--
-- Same return shape as before (out_id, out_stock, out_zeroed, out_low), so
-- CREATE OR REPLACE is enough — no DROP FUNCTION needed this time.

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
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

-- Migration: products.last_sold_at has existed since add_serial_tracking.sql
-- but nothing ever wrote to it — every UPDATE products in schema.sql
-- (deduct_stock, add_serials, delete_serial, approve_return) leaves it
-- alone, so it has sat NULL forever regardless of real sales. The new
-- Dashboard's Slow-Moving Products card depends on it being accurate.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- 1. deduct_stock (checkout) now also stamps last_sold_at = now() for
--    every product actually sold — same function, same SECURITY DEFINER,
--    just one more column touched in the same atomic per-row update.
-- 2. One-time backfill from existing transaction_items/transactions
--    history, so products sold before this migration don't all show as
--    "Never sold" until their next sale.

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock INTO v_prev FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

-- One-time backfill — safe to re-run, it only ever moves last_sold_at
-- forward to each product's true most-recent sale.
UPDATE products p
SET last_sold_at = sub.max_sold_at
FROM (
  SELECT ti.product_id, MAX(t.created_at) AS max_sold_at
  FROM transaction_items ti
  JOIN transactions t USING (transaction_id)
  GROUP BY ti.product_id
) sub
WHERE p.product_id = sub.product_id
  AND (p.last_sold_at IS NULL OR p.last_sold_at < sub.max_sold_at);

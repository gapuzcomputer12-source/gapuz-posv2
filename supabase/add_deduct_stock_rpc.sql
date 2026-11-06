-- Migration: atomic stock deduction at checkout.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: the old flow (src/store/index.js deductStock) read each product's
-- current stock on the client, computed stock - qty in JavaScript, then
-- wrote that number back. If two cashiers on different terminals checked
-- out overlapping items at the same moment, both reads could see the same
-- starting stock and the second write would silently clobber the first —
-- overselling inventory that doesn't actually exist.
--
-- This function instead does the read-modify-write as one atomic step per
-- product, inside a single Postgres statement per item:
--   1. SELECT ... FOR UPDATE locks the row so no other transaction can
--      read/write it until this one finishes.
--   2. The new stock is computed and written from that locked value.
-- Two concurrent checkouts on the same product now simply queue instead
-- of racing — whichever commits second sees the first one's result.
--
-- No SECURITY DEFINER here on purpose — it runs with the calling user's
-- own privileges, so the existing "Allow authenticated update" RLS policy
-- on products still applies normally (see fix_role_based_rls.sql for
-- which products operations are admin-only; UPDATE stays open to all
-- signed-in users since checkout needs it).

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean)
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
      CONTINUE; -- product no longer exists, skip it
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

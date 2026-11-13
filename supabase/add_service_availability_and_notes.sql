-- Migration: services work without stock.
-- Builds on add_is_service_flag.sql — corrects deduct_stock's handling of
-- service rows (it previously skipped sold/last_sold_at too; checkout
-- should still count a service as "sold" even though it has no stock to
-- deduct) and adds two new columns:
--   products.is_available   — lets a service be temporarily hidden from
--                              the POS grid/search (e.g. "not booking
--                              repairs right now") without deleting it.
--   transaction_items.notes — a short per-line job note for service items
--                              ("Acer laptop – reformat + Windows 11"),
--                              printed on the receipt.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- deduct_stock (checkout): a service row never has its stock touched (and
-- never trips out_zeroed/out_low, since stock is meaningless for it), but
-- it still counts as sold — sold/last_sold_at update exactly like a
-- physical product. Non-service rows are unchanged from
-- add_last_sold_at_tracking.sql / add_is_service_flag.sql.
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
  v_is_service boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock, is_service INTO v_prev, v_is_service FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    IF v_is_service THEN
      UPDATE products SET sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;
      out_id     := v_id;
      out_stock  := v_prev;
      out_zeroed := false;
      out_low    := false;
      RETURN NEXT;
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

-- Migration: a real `is_service` boolean column instead of detecting a
-- service product by string-comparing category === 'Services' everywhere
-- (Dashboard.jsx, Reports.jsx, and every future place that needs it). This
-- decouples "has no stock to track" from "whatever category it's filed
-- under" — a product's category can be renamed or a custom category added
-- without silently breaking service detection.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;

-- One-time backfill from the existing convention (category = 'Services').
-- Safe to re-run.
UPDATE products SET is_service = true WHERE category = 'Services' AND is_service = false;

-- deduct_stock (checkout) now skips service rows entirely — no stock
-- change, no `sold` incrementing, no last_sold_at stamp. Everything else
-- (row locking, low-stock flags) is unchanged from
-- add_last_sold_at_tracking.sql.
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
    IF v_prev IS NULL OR v_is_service THEN
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

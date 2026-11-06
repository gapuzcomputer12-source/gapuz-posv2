-- Migration: stamp refunds/returns with their APPROVAL time, separate from
-- created_at (the submission time). Run this once in Supabase Dashboard ->
-- SQL Editor -> New query -> Run.
--
-- Why: Gross vs Net sales reporting deducts an approved refund/return from
-- revenue in the period it was APPROVED, not the period of the original
-- sale or the period the request was filed. Without this column there's no
-- way to tell when approval happened, so the app falls back to created_at
-- for any row where processed_at is still NULL (rows approved before this
-- migration ran).

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE returns  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;

-- Refunds are approved via a plain client-side UPDATE (see updateRefund in
-- src/store/index.js), which now sets processed_at = now() itself — no RPC
-- change needed for that table.
--
-- Returns are approved via the approve_return RPC (see add_approve_return_rpc.sql),
-- which does the status flip server-side as part of its atomic restock
-- transaction. Redefining it here so that same UPDATE also stamps
-- processed_at, and returning it so the client can show the right value
-- immediately without a refetch.
--
-- Adding the out_processed_at OUT parameter changes the function's return
-- row type, which CREATE OR REPLACE refuses to do in place (Postgres error
-- 42P13) — the existing version has to be dropped first.
DROP FUNCTION IF EXISTS approve_return(int);

CREATE OR REPLACE FUNCTION approve_return(p_return_id int)
RETURNS TABLE (out_status text, out_already boolean, out_product_id int, out_stock int, out_processed_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_items  jsonb;
  item     jsonb;
  v_id     int;
  v_qty    int;
  v_next   int;
  v_any    boolean := false;
  v_processed_at timestamptz;
BEGIN
  SELECT status, items INTO v_status, v_items
  FROM returns WHERE return_id = p_return_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    SELECT processed_at INTO v_processed_at FROM returns WHERE return_id = p_return_id;
    out_status := v_status; out_already := true; out_product_id := NULL; out_stock := NULL; out_processed_at := v_processed_at;
    RETURN NEXT;
    RETURN;
  END IF;

  v_processed_at := NOW();
  UPDATE returns SET status = 'Approved', processed_at = v_processed_at WHERE return_id = p_return_id;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb))
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := COALESCE((item->>'returnQty')::int, (item->>'qty')::int, 1);

    UPDATE products SET stock = stock + v_qty
    WHERE product_id = v_id
    RETURNING stock INTO v_next;

    IF FOUND THEN
      out_status := 'Approved'; out_already := false; out_product_id := v_id; out_stock := v_next; out_processed_at := v_processed_at;
      RETURN NEXT;
      v_any := true;
    END IF;
  END LOOP;

  IF NOT v_any THEN
    out_status := 'Approved'; out_already := false; out_product_id := NULL; out_stock := NULL; out_processed_at := v_processed_at;
    RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(int) TO authenticated;

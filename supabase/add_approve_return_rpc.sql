-- Migration: atomic return approval + restock.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: the old flow (Returns.jsx handleApprove) did two separate network
-- round-trips from the browser — one UPDATE to flip the return's status to
-- 'Approved', then a forEach of unawaited restockProduct() calls (one
-- UPDATE per returned item, each itself a client-side read-then-write of
-- stock). Two problems fell out of that:
--   1. Not atomic — if the connection drops after the status UPDATE but
--      before the restocks finish, the return is stuck showing "Approved"
--      with some or all items never added back to stock.
--   2. Not idempotent — a double-click on Approve (or a retried request)
--      re-runs the whole forEach, restocking every item a second time.
--
-- This function does the whole operation as one statement per call, which
-- Postgres runs as a single transaction: either the status flip and every
-- item's restock all land, or (on error/disconnect) none of them do.
--
-- Idempotency: `SELECT ... FOR UPDATE` locks the return row for the
-- duration of the call. A concurrent second call (e.g. a double-click)
-- blocks until the first finishes, then sees status already 'Approved'
-- (not 'Pending') and reports out_already = true without touching stock
-- again.
--
-- No SECURITY DEFINER here on purpose, matching deduct_stock — it runs
-- with the calling user's own privileges, so the existing admin-only
-- "Admins can update returns" RLS policy still gates who can call this
-- productively (a cashier's call will fail the UPDATE on `returns` under
-- RLS, same as before).

CREATE OR REPLACE FUNCTION approve_return(p_return_id int)
RETURNS TABLE (out_status text, out_already boolean, out_product_id int, out_stock int)
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
BEGIN
  SELECT status, items INTO v_status, v_items
  FROM returns WHERE return_id = p_return_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    out_status := v_status; out_already := true; out_product_id := NULL; out_stock := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE returns SET status = 'Approved' WHERE return_id = p_return_id;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb))
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := COALESCE((item->>'returnQty')::int, (item->>'qty')::int, 1);

    UPDATE products SET stock = stock + v_qty
    WHERE product_id = v_id
    RETURNING stock INTO v_next;

    IF FOUND THEN
      out_status := 'Approved'; out_already := false; out_product_id := v_id; out_stock := v_next;
      RETURN NEXT;
      v_any := true;
    END IF;
  END LOOP;

  IF NOT v_any THEN
    out_status := 'Approved'; out_already := false; out_product_id := NULL; out_stock := NULL;
    RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(int) TO authenticated;

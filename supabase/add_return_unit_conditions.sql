-- Migration: require an explicit Resellable/Defective condition for every
-- returned unit before a return can be approved — the admin UI now starts
-- every unit unselected (see ReturnDetailsModal.jsx) and this is the
-- server-side half of that lock, since the frontend disabling "Approve"
-- is not a guarantee on its own (a direct RPC call could still skip it).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- What changed vs the previous approve_return (add_return_money_overlap_
-- and_replacement.sql):
--   1. `conditions JSONB` added to `returns` — the exact per-unit decision
--      made at approval time, persisted for the details modal's read-only
--      view afterward and for the activity log.
--   2. "Unit keys": a serialized line is keyed one-per-serial, same as
--      before. A non-serialized line now gets ONE KEY PER UNIT —
--      "item:<item_id>:<unit_index>" (0-based) — instead of one key for
--      the whole line, since each physical unit of that line can now get
--      its own condition (see ReturnDetailsModal.jsx's per-unit rows).
--   3. p_conditions must contain EXACTLY the expected unit-key set — every
--      expected key present with a value of {"status":"Resellable"} or
--      {"status":"Defective",...}, and no extra/unrecognized keys — or the
--      whole call is rejected with 'All returned units must have a
--      condition before approving'. The old COALESCE(..., 'Resellable')
--      fallback is gone entirely; an unset unit is no longer treated as
--      Resellable by default.
--   4. Restocking a non-serialized line is now per-unit too: it resells
--      however many of that line's units were marked Resellable, not the
--      whole line's qty or nothing.
-- Everything else (Replacement's per-serial swap, the money-back loyalty
-- points/total_spent reversal, admin-only + Pending-only gating) is
-- unchanged.

ALTER TABLE returns ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION approve_return(p_return_id INT, p_conditions JSONB DEFAULT '{}'::jsonb, p_replacements JSONB DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ret    returns%ROWTYPE;
  it       JSONB;
  s        TEXT;
  v_key    TEXT;
  v_unit   INT;
  v_name   TEXT;
  v_resell INT;
  v_status TEXT;
  v_repl_serial TEXT;
  v_repl_row    product_serials%ROWTYPE;
  v_orig_row    product_serials%ROWTYPE;
  v_customer_id INT;
  v_tx_total    NUMERIC;
  v_settled_before NUMERIC;
  v_full_before BOOLEAN;
  v_full_after  BOOLEAN;
  v_points_deducted INT;
  v_expected_count INT := 0;
  v_provided_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND active) THEN
    RAISE EXCEPTION 'Only admins can approve returns';
  END IF;

  SELECT * INTO v_ret FROM returns WHERE return_id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_ret.status <> 'Pending' THEN
    RAISE EXCEPTION 'Return is already %', v_ret.status;
  END IF;

  -- Every returned unit must have an explicit, valid condition — no
  -- default. Walk the same unit-key scheme the frontend uses (one key per
  -- serial; "item:<item_id>:<n>" per unit on a non-serialized line) and
  -- require a matching, valid entry in p_conditions for each one.
  FOR it IN SELECT * FROM jsonb_array_elements(v_ret.items) LOOP
    IF jsonb_array_length(COALESCE(it->'serials','[]'::jsonb)) > 0 THEN
      FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
        v_expected_count := v_expected_count + 1;
        v_status := p_conditions->s->>'status';
        IF v_status IS NULL OR v_status NOT IN ('Resellable','Defective') THEN
          RAISE EXCEPTION 'All returned units must have a condition before approving';
        END IF;
      END LOOP;
    ELSE
      FOR v_unit IN 0..((it->>'qty')::INT - 1) LOOP
        v_expected_count := v_expected_count + 1;
        v_key := 'item:' || (it->>'item_id') || ':' || v_unit;
        v_status := p_conditions->v_key->>'status';
        IF v_status IS NULL OR v_status NOT IN ('Resellable','Defective') THEN
          RAISE EXCEPTION 'All returned units must have a condition before approving';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Catches extra/unrecognized keys the per-expected-key checks above
  -- can't see on their own (those only ever look up keys they expect).
  SELECT count(*) INTO v_provided_count FROM jsonb_object_keys(p_conditions);
  IF v_provided_count <> v_expected_count THEN
    RAISE EXCEPTION 'All returned units must have a condition before approving';
  END IF;

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  FOR it IN SELECT * FROM jsonb_array_elements(v_ret.items) LOOP
    IF jsonb_array_length(COALESCE(it->'serials','[]'::jsonb)) > 0 THEN
      v_resell := 0;
      FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
        SELECT * INTO v_orig_row FROM product_serials WHERE serial_number = s FOR UPDATE;

        IF (p_conditions->s->>'status') = 'Defective' THEN
          UPDATE product_serials SET status = 'Defective' WHERE serial_number = s;
        ELSE
          UPDATE product_serials
            SET status = 'In Stock', transaction_id = NULL, transaction_item_id = NULL, sold_at = NULL
            WHERE serial_number = s;
          v_resell := v_resell + 1;
        END IF;

        IF v_ret.method = 'Replacement' THEN
          v_repl_serial := trim(COALESCE(p_replacements->>s, ''));
          IF v_repl_serial = '' THEN
            RAISE EXCEPTION 'A replacement serial is required for returned serial %', s;
          END IF;
          SELECT * INTO v_repl_row FROM product_serials WHERE serial_number = v_repl_serial FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Replacement serial % not found', v_repl_serial;
          END IF;
          IF v_repl_row.product_id <> v_orig_row.product_id THEN
            RAISE EXCEPTION 'Replacement serial % is not the same product as the returned unit', v_repl_serial;
          END IF;
          IF v_repl_row.status <> 'In Stock' THEN
            RAISE EXCEPTION 'Replacement serial % is not in stock (status: %)', v_repl_serial, v_repl_row.status;
          END IF;
          UPDATE product_serials
            SET status = 'Sold', transaction_id = v_ret.transaction_id,
                transaction_item_id = v_orig_row.transaction_item_id, sold_at = now()
            WHERE serial_number = v_repl_serial;
          UPDATE products SET stock = GREATEST(stock - 1, 0) WHERE product_id = v_repl_row.product_id;
        END IF;
      END LOOP;
    ELSE
      -- Per-unit now, not all-or-nothing: resell only however many of
      -- this line's units were actually marked Resellable.
      v_resell := 0;
      FOR v_unit IN 0..((it->>'qty')::INT - 1) LOOP
        v_key := 'item:' || (it->>'item_id') || ':' || v_unit;
        IF (p_conditions->v_key->>'status') = 'Resellable' THEN
          v_resell := v_resell + 1;
        END IF;
      END LOOP;
      IF v_ret.method = 'Replacement' THEN
        UPDATE products SET stock = GREATEST(stock - (it->>'qty')::INT, 0) WHERE product_id = (it->>'product_id')::INT;
      END IF;
    END IF;
    IF v_resell > 0 THEN
      UPDATE products SET stock = stock + v_resell WHERE product_id = (it->>'product_id')::INT;
    END IF;
  END LOOP;

  -- Loyalty points/total_spent reversal — unchanged.
  IF v_ret.method IN ('Cash refund', 'GCash refund') THEN
    SELECT customer_id, total INTO v_customer_id, v_tx_total FROM transactions WHERE transaction_id = v_ret.transaction_id;
    IF v_customer_id IS NOT NULL THEN
      SELECT COALESCE(SUM(total), 0) INTO v_settled_before
        FROM refunds WHERE transaction_id = v_ret.transaction_id AND status = 'Approved';
      SELECT v_settled_before + COALESCE(SUM(total), 0) INTO v_settled_before
        FROM returns WHERE transaction_id = v_ret.transaction_id AND status = 'Approved'
          AND method IN ('Cash refund', 'GCash refund') AND return_id <> p_return_id;

      v_full_before := v_settled_before >= v_tx_total;
      v_full_after  := (v_settled_before + v_ret.total) >= v_tx_total;
      v_points_deducted := (CASE WHEN NOT v_full_before AND v_full_after THEN 10 ELSE 0 END) + floor(v_ret.total / 100)::int;

      UPDATE customers SET
        points = GREATEST(0, points - v_points_deducted),
        purchases = CASE WHEN NOT v_full_before AND v_full_after THEN GREATEST(0, purchases - 1) ELSE purchases END,
        total_spent = GREATEST(0, total_spent - v_ret.total)
      WHERE customer_id = v_customer_id;
    END IF;
  END IF;

  UPDATE returns SET status = 'Approved', processed_at = now(), processed_by = v_name, conditions = p_conditions
    WHERE return_id = p_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(INT, JSONB, JSONB) TO authenticated;

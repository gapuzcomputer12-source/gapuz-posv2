-- Migration: bring back the Returns feature, integrated with serial-number
-- tracking (product_serials, add_serials, mark_serials_sold — see
-- add_serial_tracking.sql) and a 7-day return policy.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- History: a `returns` table + `approve_return(int)` RPC existed before
-- (add_returns_table.sql / add_approve_return_rpc.sql), but the Returns
-- feature was removed in full from the code — the page, store, and sales
-- math (see git commit "Remove the Returns feature"). That removal only
-- deleted the migration *files* from the repo; it did NOT drop anything
-- from an already-provisioned database. So this migration is written
-- defensively:
--   * `CREATE TABLE IF NOT EXISTS returns` — reuses the table if it's
--     still there from before (its old shape is a strict subset of the
--     new one, just missing `processed_at`), creates it fresh otherwise.
--   * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS processed_at` — backfills
--     that one column on a surviving old-shape table.
--   * `DROP POLICY IF EXISTS "Allow authenticated insert"` — the old
--     table let any signed-in user INSERT directly; the new design only
--     writes through create_return (SECURITY DEFINER), so that policy is
--     closed the same way product_serials is admin/RPC-gated.
--   * `DROP FUNCTION IF EXISTS approve_return(int)` — the old function's
--     signature (return_id only, no conditions) would otherwise coexist
--     with the new approve_return(int, jsonb) as an ambiguous overload.
--
-- Returns vs Refunds: a Refund is money back with no restock (unchanged,
-- see refunds table). A Return means the item physically comes back —
-- approval decides, per unit, whether it's Resellable (back to stock /
-- back to "In Stock" for a serial) or Defective (not restocked / serial
-- flipped to "Defective").

CREATE TABLE IF NOT EXISTS returns (
  return_id      SERIAL PRIMARY KEY,
  transaction_id INTEGER REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  customer_name  VARCHAR(100) DEFAULT 'Walk-in',
  reason         VARCHAR(150),
  method         VARCHAR(30),
  notes          TEXT,
  subtotal       NUMERIC(10,2) DEFAULT 0,
  vat            NUMERIC(10,2) DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         VARCHAR(20)  NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  processed_by   VARCHAR(100),
  items          JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

ALTER TABLE returns ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_returns_transaction ON returns(transaction_id);
CREATE INDEX IF NOT EXISTS idx_returns_status      ON returns(status);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read" ON returns;
CREATE POLICY "Allow authenticated read" ON returns FOR SELECT TO authenticated USING (true);

-- No direct INSERT policy on purpose — rows are only created through
-- create_return (SECURITY DEFINER below), which enforces the 7-day window
-- and the serial/qty validation no raw client insert could be trusted to do.
DROP POLICY IF EXISTS "Allow authenticated insert" ON returns;

-- Only an admin can approve/reject (same pattern as refunds).
DROP POLICY IF EXISTS "Admins can update returns" ON returns;
CREATE POLICY "Admins can update returns" ON returns FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Old signature (no conditions arg) would otherwise ambiguously overload
-- with the new approve_return(int, jsonb) below.
DROP FUNCTION IF EXISTS approve_return(int);

-- Cashier submits a return; enforces the 7-day policy on the server (the
-- UI also shows/blocks on this, but the server check is the one that
-- actually matters). Also blocks:
--   * returning a serial that wasn't Sold on this exact transaction, or
--     already has a Pending return against it;
--   * returning more of a non-serialized line than is still outstanding
--     (sold qty minus whatever's already Pending/Approved in another
--     return for that same line);
--   * returning anything that already has a Pending/Approved REFUND
--     against the same product on this transaction — Refunds don't track
--     serials or per-unit detail, so the only safe way to guarantee a
--     sale's money is never double-deducted (once via Refunds, once via
--     Returns) is to refuse the Return outright in that case.
CREATE OR REPLACE FUNCTION create_return(
  p_transaction_id INT, p_items JSONB, p_reason TEXT, p_method TEXT, p_notes TEXT,
  p_subtotal NUMERIC, p_vat NUMERIC, p_total NUMERIC)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx      transactions%ROWTYPE;
  v_id      INT;
  it        JSONB;
  s         TEXT;
  v_item_id INT;
  v_prod_id INT;
  v_sold_qty INT;
  v_req_qty  INT;
  v_already_returned INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF now() > v_tx.created_at + interval '7 days' THEN
    RAISE EXCEPTION 'Return period expired: items can only be returned within 7 days of purchase';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (it->>'item_id')::INT;
    v_prod_id := (it->>'product_id')::INT;

    SELECT qty INTO v_sold_qty FROM transaction_items
      WHERE item_id = v_item_id AND transaction_id = p_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % was not part of this transaction', v_item_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM refunds r, jsonb_array_elements(r.items) ri
      WHERE r.transaction_id = p_transaction_id
        AND r.status IN ('Pending','Approved')
        AND (ri->>'id')::INT = v_prod_id
    ) THEN
      RAISE EXCEPTION 'This item already has a refund request on this sale — it cannot also be returned';
    END IF;

    IF jsonb_array_length(COALESCE(it->'serials','[]'::jsonb)) > 0 THEN
      IF (SELECT COUNT(DISTINCT x) FROM jsonb_array_elements_text(it->'serials') x) <> jsonb_array_length(it->'serials') THEN
        RAISE EXCEPTION 'Duplicate serial in return request for item %', v_item_id;
      END IF;
      FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
        IF NOT EXISTS (
          SELECT 1 FROM product_serials
          WHERE serial_number = s AND transaction_id = p_transaction_id AND status = 'Sold'
        ) THEN
          RAISE EXCEPTION 'Serial % was not sold in this transaction or was already returned', s;
        END IF;
        IF EXISTS (
          SELECT 1 FROM returns r,
            jsonb_array_elements(r.items) ri,
            jsonb_array_elements_text(COALESCE(ri->'serials','[]'::jsonb)) rs
          WHERE r.status = 'Pending' AND rs = s
        ) THEN
          RAISE EXCEPTION 'Serial % already has a pending return', s;
        END IF;
      END LOOP;
    ELSE
      -- Non-serialized line: requested qty can't exceed what's left to
      -- return once whatever is already Pending/Approved for this same
      -- item is accounted for (Approved doesn't flip any status flag for
      -- a non-serialized item the way a serial does, so it must still
      -- count against the pool here).
      v_req_qty := COALESCE((it->>'qty')::INT, 0);
      SELECT COALESCE(SUM((ri->>'qty')::INT), 0) INTO v_already_returned
        FROM returns r, jsonb_array_elements(r.items) ri
        WHERE r.status IN ('Pending','Approved')
          AND (ri->>'item_id')::INT = v_item_id
          AND jsonb_array_length(COALESCE(ri->'serials','[]'::jsonb)) = 0;
      IF v_req_qty <= 0 OR v_req_qty > (v_sold_qty - v_already_returned) THEN
        RAISE EXCEPTION 'Return quantity for item % exceeds what is left to return', v_item_id;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO returns(transaction_id, customer_name, reason, method, notes,
                      subtotal, vat, total, items, status)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
          p_subtotal, p_vat, p_total, p_items, 'Pending')
  RETURNING return_id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_return(INT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

-- Admin approves; per unit: Resellable (back to stock) or Defective (not
-- restocked). Atomic — one call either fully applies or fully fails.
-- p_conditions: {"<serial_number>":"Defective", "item:<item_id>":"Defective"}
-- — anything not listed defaults to Resellable.
CREATE OR REPLACE FUNCTION approve_return(p_return_id INT, p_conditions JSONB DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ret    returns%ROWTYPE;
  it       JSONB;
  s        TEXT;
  v_name   TEXT;
  v_resell INT;
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

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  FOR it IN SELECT * FROM jsonb_array_elements(v_ret.items) LOOP
    IF jsonb_array_length(COALESCE(it->'serials','[]'::jsonb)) > 0 THEN
      v_resell := 0;
      FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
        IF COALESCE(p_conditions->>s, 'Resellable') = 'Defective' THEN
          UPDATE product_serials SET status = 'Defective' WHERE serial_number = s;
        ELSE
          UPDATE product_serials
            SET status = 'In Stock', transaction_id = NULL, transaction_item_id = NULL, sold_at = NULL
            WHERE serial_number = s;
          v_resell := v_resell + 1;
        END IF;
      END LOOP;
    ELSE
      v_resell := CASE WHEN COALESCE(p_conditions->>('item:' || (it->>'item_id')), 'Resellable') = 'Defective'
                       THEN 0 ELSE (it->>'qty')::INT END;
    END IF;
    IF v_resell > 0 THEN
      UPDATE products SET stock = stock + v_resell WHERE product_id = (it->>'product_id')::INT;
    END IF;
  END LOOP;

  UPDATE returns SET status = 'Approved', processed_at = now(), processed_by = v_name
    WHERE return_id = p_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(INT, JSONB) TO authenticated;

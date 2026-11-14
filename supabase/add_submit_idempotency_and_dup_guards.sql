-- Migration: prevent duplicate Return/Refund rows when a cashier
-- spam-clicks Submit on slow internet (each click fires its own network
-- request; the UI disabling the button after the first click doesn't help
-- if two clicks both land before the first re-render).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- What this does:
--   1. Adds `client_request_id UUID` (UNIQUE, nullable) to both `refunds`
--      and `returns`. The frontend generates one UUID with
--      crypto.randomUUID() when the Refund/Return form opens and sends it
--      with every submit attempt for that same form — a retry (double
--      click, or a retry after a dropped response) reuses the same id.
--   2. create_refund / create_return both become idempotent on that id:
--      if a row with the given client_request_id already exists, the RPC
--      returns that row's id (and created=false) instead of inserting a
--      duplicate — no error, nothing new written. A genuine race (two
--      requests with the same id reaching Postgres concurrently) is still
--      caught by the UNIQUE constraint and handled the same way via an
--      EXCEPTION WHEN unique_violation block, since the SELECT-then-INSERT
--      above isn't atomic on its own.
--   3. Both RPCs now RETURN TABLE(id, created) instead of a bare id, so
--      the caller can tell a genuinely new row (created=true) from a
--      deduped retry (created=false) — the frontend uses this to write
--      the activity_log 'submitted'/'created' entry only once per request,
--      not once per click that happened to reach the server.
--   4. Extra safety net in create_refund only (create_return already had
--      its own strong per-serial/per-qty guards, which stay unchanged):
--      rejects a second Pending refund for the same transaction and the
--      same amount created within the last 60 seconds. This only matters
--      for a duplicate that somehow arrives WITHOUT a matching
--      client_request_id (e.g. a stale form from before this migration);
--      the id-based check above is the primary guard and always wins
--      first when it applies.
--
-- Signature note: adding a parameter changes each function's arity, so
-- (same reason earlier migrations in this project did this — see
-- add_return_evidence_photos.sql) the old signature is dropped explicitly
-- before the new one is created, so it can't keep coexisting as an
-- un-protected overload a direct RPC call could still hit.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS client_request_id UUID;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS client_request_id UUID;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_client_request_id_key;
ALTER TABLE refunds ADD CONSTRAINT refunds_client_request_id_key UNIQUE (client_request_id);

ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_client_request_id_key;
ALTER TABLE returns ADD CONSTRAINT returns_client_request_id_key UNIQUE (client_request_id);

-- ── create_refund ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_refund(int, numeric, text, text, text);

CREATE OR REPLACE FUNCTION create_refund(
  p_transaction_id INT, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_notes TEXT,
  p_client_request_id UUID DEFAULT NULL)
RETURNS TABLE(id INT, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx       transactions%ROWTYPE;
  v_claimed  NUMERIC;
  v_name     TEXT;
  v_id       INT;
  v_existing INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotency: a retried submit (same client_request_id) returns the
  -- row that was already created instead of inserting a duplicate.
  IF p_client_request_id IS NOT NULL THEN
    SELECT refund_id INTO v_existing FROM refunds WHERE client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing, false;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF now() > v_tx.created_at + interval '7 days' THEN
    RAISE EXCEPTION 'Refund period expired: refunds can only be requested within 7 days of purchase';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  -- Spam-click safety net for a duplicate that arrives without a matching
  -- client_request_id (see migration header).
  IF EXISTS (
    SELECT 1 FROM refunds
    WHERE transaction_id = p_transaction_id AND status = 'Pending'
      AND total = p_amount AND created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'A matching refund request was just submitted for this transaction — please wait a moment before retrying';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO v_claimed
    FROM refunds WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved');
  SELECT v_claimed + COALESCE(SUM(total), 0) INTO v_claimed
    FROM returns WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved')
      AND method IN ('Cash refund', 'GCash refund');

  IF p_amount > (v_tx.total - v_claimed) THEN
    RAISE EXCEPTION 'Refund amount exceeds what is left to refund on this transaction';
  END IF;

  SELECT name INTO v_name FROM profiles WHERE profiles.id = auth.uid();

  BEGIN
    INSERT INTO refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by, submitted_by, client_request_id)
    VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name, v_name, p_client_request_id)
    RETURNING refund_id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race against another request with the same client_request_id
    -- that committed first — return its row instead of erroring out.
    SELECT refund_id INTO v_id FROM refunds WHERE client_request_id = p_client_request_id;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END;

  RETURN QUERY SELECT v_id, true;
END;
$$;

GRANT EXECUTE ON FUNCTION create_refund(INT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ── create_return ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_return(int, jsonb, text, text, text, numeric, numeric, numeric, jsonb);

CREATE OR REPLACE FUNCTION create_return(
  p_transaction_id INT, p_items JSONB, p_reason TEXT, p_method TEXT, p_notes TEXT,
  p_subtotal NUMERIC, p_vat NUMERIC, p_total NUMERIC, p_evidence_photos JSONB DEFAULT '[]'::jsonb,
  p_client_request_id UUID DEFAULT NULL)
RETURNS TABLE(id INT, created BOOLEAN)
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
  v_claimed  NUMERIC;
  v_name     TEXT;
  v_existing INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotency: a retried submit (same client_request_id) returns the
  -- row that was already created instead of inserting a duplicate.
  IF p_client_request_id IS NOT NULL THEN
    SELECT return_id INTO v_existing FROM returns WHERE client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing, false;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF now() > v_tx.created_at + interval '7 days' THEN
    RAISE EXCEPTION 'Return period expired: items can only be returned within 7 days of purchase';
  END IF;

  IF p_method IN ('Cash refund', 'GCash refund') THEN
    SELECT COALESCE(SUM(total), 0) INTO v_claimed
      FROM refunds WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved');
    IF v_claimed + p_total > v_tx.total THEN
      RAISE EXCEPTION 'This return would exceed what remains to be paid back on this transaction';
    END IF;
  END IF;

  -- Unchanged: the same per-item serial/qty validation this RPC has
  -- always done, including "serial already has a pending return".
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (it->>'item_id')::INT;
    v_prod_id := (it->>'product_id')::INT;

    SELECT qty INTO v_sold_qty FROM transaction_items
      WHERE item_id = v_item_id AND transaction_id = p_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % was not part of this transaction', v_item_id;
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

  SELECT name INTO v_name FROM profiles WHERE profiles.id = auth.uid();

  BEGIN
    INSERT INTO returns(transaction_id, customer_name, reason, method, notes,
                        subtotal, vat, total, items, status, evidence_photos, submitted_by, client_request_id)
    VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
            p_subtotal, p_vat, p_total, p_items, 'Pending', COALESCE(p_evidence_photos, '[]'::jsonb), v_name, p_client_request_id)
    RETURNING return_id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT return_id INTO v_id FROM returns WHERE client_request_id = p_client_request_id;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END;

  RETURN QUERY SELECT v_id, true;
END;
$$;

GRANT EXECUTE ON FUNCTION create_return(INT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB, UUID) TO authenticated;

-- Fix: "column reference "id" is ambiguous" when submitting a refund or
-- return, introduced by add_submit_idempotency_and_dup_guards.sql.
--
-- Cause: that migration changed create_refund/create_return to
-- RETURNS TABLE(id INT, created BOOLEAN). In PL/pgSQL, the columns of a
-- RETURNS TABLE clause become ordinary variables in scope for the whole
-- function body — so the function-level "id" variable now collides with
-- the bare `id` column reference in `SELECT name FROM profiles WHERE id =
-- auth.uid()` (profiles.id is its UUID primary key). Postgres can't tell
-- which "id" you mean and refuses to run the query.
-- Fix: qualify that one reference as `profiles.id` in both functions.
-- Nothing else changes — same signatures, same logic, just the fix.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

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

  -- Fixed: profiles.id (was bare `id`, ambiguous against the function's
  -- own `id` output column from RETURNS TABLE).
  SELECT name INTO v_name FROM profiles WHERE profiles.id = auth.uid();

  BEGIN
    INSERT INTO refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by, submitted_by, client_request_id)
    VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name, v_name, p_client_request_id)
    RETURNING refund_id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT refund_id INTO v_id FROM refunds WHERE client_request_id = p_client_request_id;
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END;

  RETURN QUERY SELECT v_id, true;
END;
$$;

GRANT EXECUTE ON FUNCTION create_refund(INT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated;

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

  -- Fixed: profiles.id (was bare `id`, ambiguous against the function's
  -- own `id` output column from RETURNS TABLE).
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

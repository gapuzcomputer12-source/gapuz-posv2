-- Migration: track who actually SUBMITTED a refund/return, independent of
-- `processed_by` — needed for the Cashier Dashboard's "My Requests" list.
--
-- Why this is needed: `processed_by` is overloaded. create_refund sets it
-- to the submitting cashier's name at INSERT time, and approval never
-- touches it again — but reject_refund/reject_return both OVERWRITE it
-- with the REJECTING ADMIN's name (see RefundDetailsModal.jsx's own
-- comment: "Requested By has to come from the submission log, not
-- record.processedBy"). So a cashier filtering refunds/returns by
-- `processedBy === myName` would correctly find their own Pending/Approved
-- requests but silently lose every one of their own Rejected requests.
-- create_return is worse: it never sets processed_by at all until a
-- decision is made, so a Pending return has no submitter identity
-- anywhere on the row. The frontend previously worked around this (in
-- RefundDetailsModal.jsx) by cross-referencing the activity_log's
-- 'submitted'/'created' entry — but activity_log is admin-only via RLS, so
-- a cashier can't read it to find their own submissions. Run this once in
-- Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Backfill note: existing Pending/Approved rows can be backfilled from
-- processed_by (refunds only — it's accurate for those two statuses).
-- Already-Rejected refunds and ALL existing returns (Pending or Approved)
-- have no recoverable submitter and are left NULL — there is no way to
-- reconstruct that after the fact. Only requests submitted after this
-- migration will have a reliable submitted_by going forward.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS submitted_by TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS submitted_by TEXT;

UPDATE refunds SET submitted_by = processed_by
  WHERE submitted_by IS NULL AND status <> 'Rejected' AND processed_by IS NOT NULL;

-- create_refund: identical to add_create_refund_rpc.sql's version, plus
-- writing the same submitter name into the new column.
CREATE OR REPLACE FUNCTION create_refund(
  p_transaction_id INT, p_amount NUMERIC, p_reason TEXT, p_method TEXT, p_notes TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx     transactions%ROWTYPE;
  v_claimed NUMERIC;
  v_name   TEXT;
  v_id     INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  SELECT COALESCE(SUM(total), 0) INTO v_claimed
    FROM refunds WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved');
  SELECT v_claimed + COALESCE(SUM(total), 0) INTO v_claimed
    FROM returns WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved')
      AND method IN ('Cash refund', 'GCash refund');

  IF p_amount > (v_tx.total - v_claimed) THEN
    RAISE EXCEPTION 'Refund amount exceeds what is left to refund on this transaction';
  END IF;

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  INSERT INTO refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by, submitted_by)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name, v_name)
  RETURNING refund_id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_refund(INT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- create_return: identical to add_return_evidence_photos.sql's 9-arg
-- version (money-level guard + serial/qty validation unchanged), plus
-- looking up and storing the caller's own name as submitted_by — it
-- never looked up the caller's profile at all before this.
CREATE OR REPLACE FUNCTION create_return(
  p_transaction_id INT, p_items JSONB, p_reason TEXT, p_method TEXT, p_notes TEXT,
  p_subtotal NUMERIC, p_vat NUMERIC, p_total NUMERIC, p_evidence_photos JSONB DEFAULT '[]'::jsonb)
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
  v_claimed  NUMERIC;
  v_name     TEXT;
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

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  INSERT INTO returns(transaction_id, customer_name, reason, method, notes,
                      subtotal, vat, total, items, status, evidence_photos, submitted_by)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
          p_subtotal, p_vat, p_total, p_items, 'Pending', COALESCE(p_evidence_photos, '[]'::jsonb), v_name)
  RETURNING return_id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_return(INT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB) TO authenticated;

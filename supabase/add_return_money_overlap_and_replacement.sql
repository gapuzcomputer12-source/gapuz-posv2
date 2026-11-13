-- Migration: Returns is the only way an item physically comes back now
-- that Refunds is money-only (see add_create_refund_rpc.sql). This file:
--   1. create_return — drops the old "this product already has a
--      Pending/Approved refund" guard (refunds no longer reference
--      products/items at all, so that check can never match anything
--      going forward) and replaces it with a transaction-TOTAL guard: a
--      money-back return can't push (refunds + money-back returns)
--      past the transaction's total.
--   2. approve_return — on approval of a money-back return (Cash refund /
--      GCash refund), reverses the customer's loyalty points/total_spent
--      for the returned amount, server-side, the same formula
--      revertPurchase (src/store/index.js) uses for refunds.
--   3. approve_return — implements 'Replacement' for real: for each
--      returned serial, the admin supplies the replacement unit's serial
--      (same product, currently In Stock); it's marked Sold under the
--      original transaction and stock is deducted by 1. For a
--      non-serialized line, stock is deducted by the returned qty
--      instead (no serial to pick). The returned unit is still handled as
--      Resellable/Defective exactly as before — Replacement only adds the
--      extra "and a new unit goes out" step on top of that.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

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
  v_claimed  NUMERIC;
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

  -- Money-level guard (replaces the old per-product refund/return overlap
  -- check — a Refund is a flat transaction-level amount now, not tied to
  -- any product, so there is no longer a product_id to compare against).
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
      -- Non-serialized line: requested qty can't exceed what's left to
      -- return once whatever is already Pending/Approved for this same
      -- item is accounted for.
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

-- Adding p_replacements changes the signature (not just a default on an
-- existing one) — the old 2-arg overload has to be dropped explicitly or
-- it keeps coexisting un-replaced (same reason add_returns_table.sql
-- dropped the 1-arg approve_return before adding the jsonb conditions arg).
DROP FUNCTION IF EXISTS approve_return(int, jsonb);

-- p_replacements: {"<returned_serial>":"<replacement_serial>"} — required
-- for every serialized item on a 'Replacement' return; ignored otherwise.
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
  v_name   TEXT;
  v_resell INT;
  v_repl_serial TEXT;
  v_repl_row    product_serials%ROWTYPE;
  v_orig_row    product_serials%ROWTYPE;
  v_customer_id INT;
  v_tx_total    NUMERIC;
  v_settled_before NUMERIC;
  v_full_before BOOLEAN;
  v_full_after  BOOLEAN;
  v_points_deducted INT;
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
        SELECT * INTO v_orig_row FROM product_serials WHERE serial_number = s FOR UPDATE;

        IF COALESCE(p_conditions->>s, 'Resellable') = 'Defective' THEN
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
      v_resell := CASE WHEN COALESCE(p_conditions->>('item:' || (it->>'item_id')), 'Resellable') = 'Defective'
                       THEN 0 ELSE (it->>'qty')::INT END;
      IF v_ret.method = 'Replacement' THEN
        UPDATE products SET stock = GREATEST(stock - (it->>'qty')::INT, 0) WHERE product_id = (it->>'product_id')::INT;
      END IF;
    END IF;
    IF v_resell > 0 THEN
      UPDATE products SET stock = stock + v_resell WHERE product_id = (it->>'product_id')::INT;
    END IF;
  END LOOP;

  -- Loyalty points/total_spent reversal — money-back methods only
  -- (Replacement never took money back, so the customer's spend/points
  -- stand as they are). Mirrors revertPurchase's formula in
  -- src/store/index.js: a flat +10/purchase-count bonus is only reversed
  -- at the exact moment the transaction crosses into fully settled
  -- (refunds + money-back returns >= transaction total), detected here by
  -- comparing the settled total with and without this return.
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

  UPDATE returns SET status = 'Approved', processed_at = now(), processed_by = v_name
    WHERE return_id = p_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(INT, JSONB, JSONB) TO authenticated;

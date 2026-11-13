-- Migration: Refunds become money-only. A Refund is now a flat peso amount
-- entered by the cashier (billing correction / service not rendered /
-- cancelled service), with no item/qty attached at all — an item physically
-- coming back is always a Return (see add_return_money_overlap_and_replacement.sql).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why a server-side RPC: the old insert path was a plain
-- `supabase.from('refunds').insert(...)` under an `INSERT ... WITH CHECK
-- (true)` policy — nothing in the database enforced the 7-day window or
-- capped the amount against what the transaction actually has left to
-- refund (see Q6/Q8 in the refund audit). create_refund (SECURITY DEFINER,
-- same style as create_return) is now the only way a refund row can be
-- created, so those two rules are real guarantees instead of client-side
-- suggestions.
--
-- "What's left to refund" = transaction total minus every Pending/Approved
-- refund already filed AND every Pending/Approved money-back return
-- (Cash refund / GCash refund — a Replacement return pays nothing back, so
-- it doesn't count here).

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

  INSERT INTO refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name)
  RETURNING refund_id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_refund(INT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- Direct inserts are no longer possible — every refund must go through
-- create_refund above, which is the only place the 7-day window and the
-- remaining-amount cap are actually enforced.
DROP POLICY IF EXISTS "Allow authenticated insert" ON refunds;

-- Migration: require a rejection reason on both Refunds and Returns, so a
-- cashier (possibly looking at this from a different till, or the admin
-- rejecting remotely, away from the store) always sees exactly why a
-- request was turned down.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- What this does:
--   1. Adds `rejection_reason TEXT` to both `refunds` and `returns`.
--   2. Backfills any EXISTING 'Rejected' rows with 'No reason recorded'
--      before the CHECK constraint goes on, so this migration never fails
--      against historical data.
--   3. Adds a CHECK constraint on both tables: whenever status =
--      'Rejected', rejection_reason must be present and at least 5
--      characters (trimmed).
--   4. Creates reject_refund(...) / reject_return(...) — SECURITY DEFINER,
--      admin-only, Pending-only, same style as create_refund/create_return
--      — the only way a request can move to 'Rejected' going forward. They
--      touch only the refunds/returns row itself: no stock, serials,
--      points, or totals are touched (that's correct — a rejection is a
--      no-op on inventory/money, unlike an approval).
--
-- Note: the CHECK constraint is a real safety net on its own — even a raw
-- `update refunds set status='Rejected'` that skips the RPC entirely will
-- now be rejected by Postgres unless it also sets a valid
-- rejection_reason, regardless of how the request got routed.

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE refunds SET rejection_reason = 'No reason recorded'
  WHERE status = 'Rejected' AND (rejection_reason IS NULL OR length(trim(rejection_reason)) < 5);
UPDATE returns SET rejection_reason = 'No reason recorded'
  WHERE status = 'Rejected' AND (rejection_reason IS NULL OR length(trim(rejection_reason)) < 5);

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_rejection_requires_reason;
ALTER TABLE refunds ADD CONSTRAINT refunds_rejection_requires_reason
  CHECK (status <> 'Rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) >= 5));

ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_rejection_requires_reason;
ALTER TABLE returns ADD CONSTRAINT returns_rejection_requires_reason
  CHECK (status <> 'Rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) >= 5));

CREATE OR REPLACE FUNCTION reject_refund(p_refund_id INT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_name   TEXT;
  v_reason TEXT := trim(p_reason);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND active) THEN
    RAISE EXCEPTION 'Only admins can reject refunds';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
  END IF;

  SELECT status INTO v_status FROM refunds WHERE refund_id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund not found';
  END IF;
  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Refund is already %', v_status;
  END IF;

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  UPDATE refunds SET
    status = 'Rejected',
    rejection_reason = v_reason,
    processed_by = v_name,
    processed_at = now()
  WHERE refund_id = p_refund_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_refund(INT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION reject_return(p_return_id INT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_name   TEXT;
  v_reason TEXT := trim(p_reason);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND active) THEN
    RAISE EXCEPTION 'Only admins can reject returns';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
  END IF;

  SELECT status INTO v_status FROM returns WHERE return_id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'Return is already %', v_status;
  END IF;

  SELECT name INTO v_name FROM profiles WHERE id = auth.uid();

  UPDATE returns SET
    status = 'Rejected',
    rejection_reason = v_reason,
    processed_by = v_name,
    processed_at = now()
  WHERE return_id = p_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION reject_return(INT, TEXT) TO authenticated;

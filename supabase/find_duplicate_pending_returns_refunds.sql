-- Read-only audit: lists existing duplicate Pending returns/refunds
-- created by the spam-click bug (same transaction, same amount, created
-- within 1 minute of each other) — before add_submit_idempotency_and_dup_
-- guards.sql existed, nothing stopped two clicks on Submit from both
-- creating a row. Nothing here is deleted or modified; review the pairs
-- below and reject the extras manually (RejectReasonModal in the app, or
-- reject_refund/reject_return directly) once you've confirmed which one
-- is the real request.
--
-- "Duplicate" here means: same transaction_id, same total (refunds) or
-- same total+items (returns), both still Pending, created_at within 60
-- seconds of each other. Run this in Supabase Dashboard -> SQL Editor.

-- ── Duplicate Pending refunds ──────────────────────────────────────
SELECT
  a.refund_id   AS refund_id_1,
  b.refund_id   AS refund_id_2,
  a.transaction_id,
  a.total,
  a.submitted_by,
  a.created_at  AS created_at_1,
  b.created_at  AS created_at_2,
  EXTRACT(EPOCH FROM (b.created_at - a.created_at)) AS seconds_apart
FROM refunds a
JOIN refunds b
  ON a.transaction_id = b.transaction_id
 AND a.refund_id < b.refund_id
WHERE a.status = 'Pending' AND b.status = 'Pending'
  AND a.total = b.total
  AND abs(EXTRACT(EPOCH FROM (b.created_at - a.created_at))) <= 60
ORDER BY a.transaction_id, a.created_at;

-- ── Duplicate Pending returns ──────────────────────────────────────
-- items::text equality is a simple exact-match check on the submitted
-- JSON (same items, same qty/serials, same order) — good enough to flag
-- a true double-submit, where the second request is a byte-for-byte
-- resend of the first.
SELECT
  a.return_id   AS return_id_1,
  b.return_id   AS return_id_2,
  a.transaction_id,
  a.total,
  a.method,
  a.submitted_by,
  a.created_at  AS created_at_1,
  b.created_at  AS created_at_2,
  EXTRACT(EPOCH FROM (b.created_at - a.created_at)) AS seconds_apart
FROM returns a
JOIN returns b
  ON a.transaction_id = b.transaction_id
 AND a.return_id < b.return_id
WHERE a.status = 'Pending' AND b.status = 'Pending'
  AND a.total = b.total
  AND a.items::text = b.items::text
  AND abs(EXTRACT(EPOCH FROM (b.created_at - a.created_at))) <= 60
ORDER BY a.transaction_id, a.created_at;

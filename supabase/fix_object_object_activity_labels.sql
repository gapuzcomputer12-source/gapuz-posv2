-- Fix: activity_log rows showing entity_label = "#[object Object]" for
-- submitted refunds / created returns.
--
-- Cause: an earlier version of addRefund/submitReturn (src/store/index.js)
-- built the label from the create_refund/create_return RPC result without
-- extracting its numeric id first, so `#${row}`-style string interpolation
-- stringified the whole result object instead. Fixed going forward in
-- src/store/index.js (getReturnedId helper) — this migration only repairs
-- rows already written with the bad label.
--
-- Approach: for each bad row, find the refunds/returns row submitted by the
-- same actor (submitted_by) within a tight 10-second window of the
-- activity_log row's created_at, and backfill the correct "#0001"-style
-- label. Only applies when exactly one candidate match exists — a row with
-- zero or multiple candidates in that window is left untouched rather than
-- risk assigning the wrong id, and is listed by the final SELECT below for
-- manual review.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- Refunds ---------------------------------------------------------------
WITH candidates AS (
  SELECT al.log_id, r.refund_id,
         count(*) OVER (PARTITION BY al.log_id) AS n
  FROM activity_log al
  JOIN refunds r
    ON r.submitted_by = al.actor_name
   AND r.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
  WHERE al.entity_type = 'refund'
    AND al.action = 'submitted'
    AND al.entity_label LIKE '%object Object%'
)
UPDATE activity_log al
SET entity_label = '#' || lpad(c.refund_id::text, 4, '0')
FROM candidates c
WHERE al.log_id = c.log_id AND c.n = 1;

-- Returns -----------------------------------------------------------------
WITH candidates AS (
  SELECT al.log_id, r.return_id,
         count(*) OVER (PARTITION BY al.log_id) AS n
  FROM activity_log al
  JOIN returns r
    ON r.submitted_by = al.actor_name
   AND r.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds'
  WHERE al.entity_type = 'return'
    AND al.action = 'created'
    AND al.entity_label LIKE '%object Object%'
)
UPDATE activity_log al
SET entity_label = '#' || lpad(c.return_id::text, 4, '0')
FROM candidates c
WHERE al.log_id = c.log_id AND c.n = 1;

-- Report: anything still bad (no match, or an ambiguous multi-match), with
-- the candidate counts that explain why it wasn't touched.
SELECT al.log_id, al.actor_name, al.action, al.entity_type, al.entity_label, al.created_at,
  (SELECT count(*) FROM refunds r WHERE r.submitted_by = al.actor_name
     AND r.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds') AS refund_candidates,
  (SELECT count(*) FROM returns r WHERE r.submitted_by = al.actor_name
     AND r.created_at BETWEEN al.created_at - interval '10 seconds' AND al.created_at + interval '10 seconds') AS return_candidates
FROM activity_log al
WHERE al.entity_label LIKE '%object Object%'
ORDER BY al.created_at;

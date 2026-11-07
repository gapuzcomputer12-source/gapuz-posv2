-- Migration: snapshot cost_price onto each transaction_items row at sale
-- time, so the Dashboard/Reports Profit figure stays accurate even if a
-- product's cost_price is edited later. Mirrors how `price` (the selling
-- price) is already snapshotted per line item instead of looked up live.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Backfill existing rows using each product's CURRENT cost price, since the
-- historical cost at the time of those sales was never recorded. This is a
-- best-effort estimate for past data only — rows inserted after the app
-- update ships will carry the real cost at time of sale automatically.
UPDATE transaction_items ti
SET cost_price = p.cost_price
FROM products p
WHERE ti.product_id = p.product_id
  AND ti.cost_price = 0;

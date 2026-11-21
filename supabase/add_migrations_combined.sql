-- Combined 'add_*' migration scripts, concatenated in chronological order.
-- Each section below was originally its own file in supabase/.
-- Already-applied migrations kept here for historical reference.

-- ============================================================
-- Originally: add_email_to_profiles.sql
-- ============================================================
-- Adds an email column to profiles so the admin's Staff Accounts page can list
-- everyone (name + email + role) without an extra admin-API round trip per view.
-- Run once in the Supabase Dashboard -> SQL Editor on an already-deployed
-- database. schema.sql already includes this column for fresh installs.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email VARCHAR(100);

-- Backfill existing accounts (e.g. the original admin) from auth.users.
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;


-- ============================================================
-- Originally: add_active_to_profiles.sql
-- ============================================================
-- Adds an `active` column to profiles so cashier accounts can be
-- suspended/reactivated without deleting them. schema.sql already includes
-- this column for fresh installs.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;


-- ============================================================
-- Originally: add_activity_log.sql
-- ============================================================
-- Migration: activity log for admin/cashier actions (who processed a refund,
-- deleted a product, suspended a staff account, etc.) — run this once in
-- Supabase Dashboard -> SQL Editor -> New query -> Run.

CREATE TABLE activity_log (
  log_id       SERIAL PRIMARY KEY,
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name   VARCHAR(100) NOT NULL,
  action       VARCHAR(20)  NOT NULL,
  entity_type  VARCHAR(20)  NOT NULL,
  entity_label VARCHAR(150),
  details      JSONB,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read the log.
CREATE POLICY "Admins can read activity log" ON activity_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Any signed-in user (cashier or admin) can write an entry — e.g. a cashier
-- submitting a refund request. There are deliberately no UPDATE/DELETE
-- policies, so entries can't be edited or removed through the app once
-- written — that's what makes it useful if a dispute ever comes up.
CREATE POLICY "Allow authenticated insert" ON activity_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_activity_log_created_at ON activity_log(created_at);


-- ============================================================
-- Originally: add_category_icon.sql
-- ============================================================
-- Migration: lets an admin manually pin an icon to a category, for ones the
-- keyword-based auto-icon matching doesn't handle well — run this once in
-- Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE categories ADD COLUMN icon VARCHAR(30);


-- ============================================================
-- Originally: add_deduct_stock_rpc.sql
-- ============================================================
-- Migration: atomic stock deduction at checkout.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: the old flow (src/store/index.js deductStock) read each product's
-- current stock on the client, computed stock - qty in JavaScript, then
-- wrote that number back. If two cashiers on different terminals checked
-- out overlapping items at the same moment, both reads could see the same
-- starting stock and the second write would silently clobber the first —
-- overselling inventory that doesn't actually exist.
--
-- This function instead does the read-modify-write as one atomic step per
-- product, inside a single Postgres statement per item:
--   1. SELECT ... FOR UPDATE locks the row so no other transaction can
--      read/write it until this one finishes.
--   2. The new stock is computed and written from that locked value.
-- Two concurrent checkouts on the same product now simply queue instead
-- of racing — whichever commits second sees the first one's result.
--
-- No SECURITY DEFINER here on purpose — it runs with the calling user's
-- own privileges, so the existing "Allow authenticated update" RLS policy
-- on products still applies normally (see fix_role_based_rls.sql for
-- which products operations are admin-only; UPDATE stays open to all
-- signed-in users since checkout needs it).

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock INTO v_prev FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE; -- product no longer exists, skip it
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;


-- ============================================================
-- Originally: add_processed_at.sql
-- ============================================================
-- Migration: stamp refunds/returns with their APPROVAL time, separate from
-- created_at (the submission time). Run this once in Supabase Dashboard ->
-- SQL Editor -> New query -> Run.
--
-- Why: Gross vs Net sales reporting deducts an approved refund/return from
-- revenue in the period it was APPROVED, not the period of the original
-- sale or the period the request was filed. Without this column there's no
-- way to tell when approval happened, so the app falls back to created_at
-- for any row where processed_at is still NULL (rows approved before this
-- migration ran).

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE returns  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;

-- Refunds are approved via a plain client-side UPDATE (see updateRefund in
-- src/store/index.js), which now sets processed_at = now() itself — no RPC
-- change needed for that table.
--
-- Returns are approved via the approve_return RPC (see add_approve_return_rpc.sql),
-- which does the status flip server-side as part of its atomic restock
-- transaction. Redefining it here so that same UPDATE also stamps
-- processed_at, and returning it so the client can show the right value
-- immediately without a refetch.
--
-- Adding the out_processed_at OUT parameter changes the function's return
-- row type, which CREATE OR REPLACE refuses to do in place (Postgres error
-- 42P13) — the existing version has to be dropped first.
DROP FUNCTION IF EXISTS approve_return(int);

CREATE OR REPLACE FUNCTION approve_return(p_return_id int)
RETURNS TABLE (out_status text, out_already boolean, out_product_id int, out_stock int, out_processed_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_items  jsonb;
  item     jsonb;
  v_id     int;
  v_qty    int;
  v_next   int;
  v_any    boolean := false;
  v_processed_at timestamptz;
BEGIN
  SELECT status, items INTO v_status, v_items
  FROM returns WHERE return_id = p_return_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return % not found', p_return_id;
  END IF;

  IF v_status <> 'Pending' THEN
    SELECT processed_at INTO v_processed_at FROM returns WHERE return_id = p_return_id;
    out_status := v_status; out_already := true; out_product_id := NULL; out_stock := NULL; out_processed_at := v_processed_at;
    RETURN NEXT;
    RETURN;
  END IF;

  v_processed_at := NOW();
  UPDATE returns SET status = 'Approved', processed_at = v_processed_at WHERE return_id = p_return_id;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb))
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := COALESCE((item->>'returnQty')::int, (item->>'qty')::int, 1);

    UPDATE products SET stock = stock + v_qty
    WHERE product_id = v_id
    RETURNING stock INTO v_next;

    IF FOUND THEN
      out_status := 'Approved'; out_already := false; out_product_id := v_id; out_stock := v_next; out_processed_at := v_processed_at;
      RETURN NEXT;
      v_any := true;
    END IF;
  END LOOP;

  IF NOT v_any THEN
    out_status := 'Approved'; out_already := false; out_product_id := NULL; out_stock := NULL; out_processed_at := v_processed_at;
    RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_return(int) TO authenticated;


-- ============================================================
-- Originally: add_low_stock_threshold.sql
-- ============================================================
-- Migration: add a "low stock" crossing signal (exactly 3 left) to
-- deduct_stock, alongside the existing "zeroed out" signal.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: admins asked for a heads-up email when a product's stock crosses
-- down to exactly 3, so they can reorder before it runs out — but NOT one
-- email per unit sold while stock drains through 2 and 1, which would just
-- spam the inbox. So this only fires once, on the exact prev>3 -> next=3
-- crossing, the same way out_zeroed already only fires once on prev>0 ->
-- next=0. Values 1 and 2 are intentionally silent.
--
-- This changes deduct_stock's return shape (adds out_low), so the function
-- must be dropped first — Postgres won't let CREATE OR REPLACE change a
-- function's output columns.

DROP FUNCTION IF EXISTS deduct_stock(jsonb);

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock INTO v_prev FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > 3 AND v_next = 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;


-- ============================================================
-- Originally: add_cost_price_to_transaction_items.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_serial_tracking.sql
-- ============================================================
-- Migration: serial-number tracking for serialized products (GPUs,
-- laptops, motherboards, SSDs, etc.) — one row per physical unit, from
-- receiving stock to sale.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Design notes:
-- * products.stock stays the single source of truth for quantity (deduct_stock,
--   low-stock alerts, reports all keep reading/writing it exactly as before).
--   product_serials is a side-channel that accounts for *which* units make up
--   that number for has_serial products — add_serials/delete_serial keep the
--   two in sync atomically so they never drift.
-- * Admin-only writes on product_serials follow the same
--   `profiles.role = 'admin'` check already used everywhere else in this
--   schema (see fix_role_based_rls.sql) — no `active` check, because a
--   suspended admin is banned at the Auth layer (toggle-staff-status) and
--   can't hold a session to begin with.
-- * mark_serials_sold resolves each transaction_items.item_id itself (by
--   transaction_id + product_id) instead of requiring the frontend to pass
--   it — src/store/index.js's addTransaction() doesn't currently select the
--   inserted item rows back, and a cart only ever has one line per product,
--   so this avoids an unrelated change to that insert just for this feature.

ALTER TABLE products ADD COLUMN IF NOT EXISTS has_serial BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS product_serials (
  serial_id           SERIAL PRIMARY KEY,
  product_id          INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  serial_number       VARCHAR(100) NOT NULL UNIQUE,
  status              VARCHAR(20) NOT NULL DEFAULT 'In Stock' CHECK (status IN ('In Stock','Sold','Defective')),
  transaction_id      INTEGER REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  transaction_item_id INTEGER REFERENCES transaction_items(item_id) ON DELETE SET NULL,
  sold_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_serials_product ON product_serials(product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_status  ON product_serials(status);
CREATE INDEX IF NOT EXISTS idx_product_serials_txn     ON product_serials(transaction_id);

ALTER TABLE product_serials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read" ON product_serials;
CREATE POLICY "Allow authenticated read" ON product_serials FOR SELECT TO authenticated USING (true);

-- Cashiers never touch product_serials rows directly — only through
-- add_serials / delete_serial / mark_serials_sold below (all SECURITY
-- DEFINER). These policies exist as defense-in-depth against a raw
-- supabase.from('product_serials') call bypassing the RPCs.
DROP POLICY IF EXISTS "Admins can insert serials" ON product_serials;
CREATE POLICY "Admins can insert serials" ON product_serials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can update serials" ON product_serials;
CREATE POLICY "Admins can update serials" ON product_serials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete serials" ON product_serials;
CREATE POLICY "Admins can delete serials" ON product_serials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Admin registers serials when stock arrives; stock increases by the number
-- added, atomically with the insert (SECURITY DEFINER so it can both bypass
-- the admin-only INSERT policy above *and* write products.stock in one go).
CREATE OR REPLACE FUNCTION add_serials(p_product_id INT, p_serials TEXT[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can add serial numbers';
  END IF;

  INSERT INTO product_serials (product_id, serial_number)
  SELECT p_product_id, trim(s) FROM unnest(p_serials) s WHERE trim(s) <> '';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE products SET stock = stock + v_count WHERE product_id = p_product_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION add_serials(INT, TEXT[]) TO authenticated;

-- Deletes a serial only while it's still In Stock, decreasing stock by 1 in
-- the same atomic step (row-locked so it can't race a concurrent sale of
-- the same serial via mark_serials_sold).
CREATE OR REPLACE FUNCTION delete_serial(p_serial_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row product_serials%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete serial numbers';
  END IF;

  SELECT * INTO v_row FROM product_serials WHERE serial_id = p_serial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serial not found';
  END IF;
  IF v_row.status <> 'In Stock' THEN
    RAISE EXCEPTION 'Only an in-stock serial can be deleted (status: %)', v_row.status;
  END IF;

  DELETE FROM product_serials WHERE serial_id = p_serial_id;
  UPDATE products SET stock = GREATEST(stock - 1, 0) WHERE product_id = v_row.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_serial(INT) TO authenticated;

-- Marks scanned serials as Sold for a transaction (row-locked, validated).
-- p_items: [{"product_id":5,"serials":["SN1","SN2"]}]
-- Any exception here rolls back everything this call touched (plpgsql
-- function bodies run inside the calling statement's transaction), so a
-- failure partway through never leaves some serials marked Sold and others
-- not for the same checkout.
CREATE OR REPLACE FUNCTION mark_serials_sold(p_transaction_id INT, p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it        JSONB;
  s         TEXT;
  v_row     product_serials%ROWTYPE;
  v_item_id INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT item_id INTO v_item_id FROM transaction_items
      WHERE transaction_id = p_transaction_id AND product_id = (it->>'product_id')::INT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No transaction item for product % on transaction %', (it->>'product_id')::INT, p_transaction_id;
    END IF;

    FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
      SELECT * INTO v_row FROM product_serials WHERE serial_number = s FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Serial % not found', s;
      END IF;
      IF v_row.product_id <> (it->>'product_id')::INT THEN
        RAISE EXCEPTION 'Serial % belongs to a different product', s;
      END IF;
      IF v_row.status <> 'In Stock' THEN
        RAISE EXCEPTION 'Serial % is not in stock (status: %)', s, v_row.status;
      END IF;

      UPDATE product_serials
        SET status = 'Sold', transaction_id = p_transaction_id,
            transaction_item_id = v_item_id, sold_at = now()
        WHERE serial_id = v_row.serial_id;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_serials_sold(INT, JSONB) TO authenticated;

-- Narrow, audited rollback for the one failure case checkout needs to
-- undo: a transaction was just inserted but mark_serials_sold then failed,
-- so the sale never actually completed. Deliberately NOT a blanket DELETE
-- policy on transactions (that would let any cashier erase real sales
-- history) — this only ever removes a transaction that is seconds old AND
-- has no serial successfully marked Sold against it yet.
CREATE OR REPLACE FUNCTION void_failed_sale(p_transaction_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM transactions
   WHERE transaction_id = p_transaction_id
     AND created_at > now() - interval '2 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM product_serials
        WHERE transaction_id = p_transaction_id AND status = 'Sold'
     );
END;
$$;

GRANT EXECUTE ON FUNCTION void_failed_sale(INT) TO authenticated;


-- ============================================================
-- Originally: add_returns_table.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_create_refund_rpc.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_return_money_overlap_and_replacement.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_rejection_reason_and_reject_rpcs.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_return_evidence_photos.sql
-- ============================================================
-- Migration: evidence photos for Returns. A cashier can attach up to 5
-- photos (compressed client-side — see src/utils/compressImage.js) when
-- submitting a return; an admin reviews them in ReturnDetailsModal via
-- short-lived signed URLs. Scoped to Returns only, not Refunds — a Refund
-- is money-only with no physical item to photograph.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. STORAGE BUCKET — private. The app never requests a public URL; every
--    read goes through storage.createSignedUrls (see getEvidencePhotoUrls
--    in src/store/index.js), fetched only when a return's detail modal is
--    actually opened, not for the whole Return History list.
insert into storage.buckets (id, name, public)
values ('return-evidence', 'return-evidence', false)
on conflict (id) do nothing;

-- RLS is already enabled on storage.objects by default on every Supabase
-- project — no ALTER TABLE needed here (and the SQL Editor's role doesn't
-- own that table anyway, so it couldn't run that statement even if it were
-- needed).

drop policy if exists "Authenticated can upload return evidence" on storage.objects;
create policy "Authenticated can upload return evidence" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'return-evidence');

drop policy if exists "Authenticated can read return evidence" on storage.objects;
create policy "Authenticated can read return evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'return-evidence');

-- Needed so a cashier can remove/retake a photo they just took, before
-- the return is even submitted (photos upload to a per-session draft
-- folder as soon as they're taken, ahead of the return_id existing).
drop policy if exists "Authenticated can delete return evidence" on storage.objects;
create policy "Authenticated can delete return evidence" on storage.objects
  for delete to authenticated
  using (bucket_id = 'return-evidence');

-- 2. COLUMN — array of storage object paths, e.g.
--    ["<draft-uuid>/<timestamp>-<n>.jpg"]. Written once, at submission
--    time, by create_return below; never touched afterward.
alter table returns add column if not exists evidence_photos jsonb not null default '[]'::jsonb;

-- 3. create_return — adding a new parameter changes the function's
--    signature (arity), so the old 8-arg overload must be dropped first,
--    same reason earlier migrations in this project dropped
--    approve_return/create_return before widening their argument list.
-- Everything else below (the 7-day window, the per-product money guard,
-- the per-serial/per-qty validation) is copied verbatim, unchanged, from
-- the current create_return — only p_evidence_photos and the one new
-- INSERT column are new.
drop function if exists create_return(int, jsonb, text, text, text, numeric, numeric, numeric);

create or replace function create_return(
  p_transaction_id int, p_items jsonb, p_reason text, p_method text, p_notes text,
  p_subtotal numeric, p_vat numeric, p_total numeric, p_evidence_photos jsonb default '[]'::jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
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

  INSERT INTO returns(transaction_id, customer_name, reason, method, notes,
                      subtotal, vat, total, items, status, evidence_photos)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
          p_subtotal, p_vat, p_total, p_items, 'Pending', COALESCE(p_evidence_photos, '[]'::jsonb))
  RETURNING return_id INTO v_id;

  RETURN v_id;
END;
$$;

grant execute on function create_return(int, jsonb, text, text, text, numeric, numeric, numeric, jsonb) to authenticated;


-- ============================================================
-- Originally: add_last_sold_at_tracking.sql
-- ============================================================
-- Migration: products.last_sold_at has existed since add_serial_tracking.sql
-- but nothing ever wrote to it — every UPDATE products in schema.sql
-- (deduct_stock, add_serials, delete_serial, approve_return) leaves it
-- alone, so it has sat NULL forever regardless of real sales. The new
-- Dashboard's Slow-Moving Products card depends on it being accurate.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- 1. deduct_stock (checkout) now also stamps last_sold_at = now() for
--    every product actually sold — same function, same SECURITY DEFINER,
--    just one more column touched in the same atomic per-row update.
-- 2. One-time backfill from existing transaction_items/transactions
--    history, so products sold before this migration don't all show as
--    "Never sold" until their next sale.

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock INTO v_prev FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

-- One-time backfill — safe to re-run, it only ever moves last_sold_at
-- forward to each product's true most-recent sale.
UPDATE products p
SET last_sold_at = sub.max_sold_at
FROM (
  SELECT ti.product_id, MAX(t.created_at) AS max_sold_at
  FROM transaction_items ti
  JOIN transactions t USING (transaction_id)
  GROUP BY ti.product_id
) sub
WHERE p.product_id = sub.product_id
  AND (p.last_sold_at IS NULL OR p.last_sold_at < sub.max_sold_at);


-- ============================================================
-- Originally: add_return_refund_submitted_by.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_is_service_flag.sql
-- ============================================================
-- Migration: a real `is_service` boolean column instead of detecting a
-- service product by string-comparing category === 'Services' everywhere
-- (Dashboard.jsx, Reports.jsx, and every future place that needs it). This
-- decouples "has no stock to track" from "whatever category it's filed
-- under" — a product's category can be renamed or a custom category added
-- without silently breaking service detection.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;

-- One-time backfill from the existing convention (category = 'Services').
-- Safe to re-run.
UPDATE products SET is_service = true WHERE category = 'Services' AND is_service = false;

-- deduct_stock (checkout) now skips service rows entirely — no stock
-- change, no `sold` incrementing, no last_sold_at stamp. Everything else
-- (row locking, low-stock flags) is unchanged from
-- add_last_sold_at_tracking.sql.
CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
  v_is_service boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock, is_service INTO v_prev, v_is_service FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL OR v_is_service THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;


-- ============================================================
-- Originally: add_service_availability_and_notes.sql
-- ============================================================
-- Migration: services work without stock.
-- Builds on add_is_service_flag.sql — corrects deduct_stock's handling of
-- service rows (it previously skipped sold/last_sold_at too; checkout
-- should still count a service as "sold" even though it has no stock to
-- deduct) and adds two new columns:
--   products.is_available   — lets a service be temporarily hidden from
--                              the POS grid/search (e.g. "not booking
--                              repairs right now") without deleting it.
--   transaction_items.notes — a short per-line job note for service items
--                              ("Acer laptop – reformat + Windows 11"),
--                              printed on the receipt.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- deduct_stock (checkout): a service row never has its stock touched (and
-- never trips out_zeroed/out_low, since stock is meaningless for it), but
-- it still counts as sold — sold/last_sold_at update exactly like a
-- physical product. Non-service rows are unchanged from
-- add_last_sold_at_tracking.sql / add_is_service_flag.sql.
CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
  v_is_service boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock, is_service INTO v_prev, v_is_service FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    IF v_is_service THEN
      UPDATE products SET sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;
      out_id     := v_id;
      out_stock  := v_prev;
      out_zeroed := false;
      out_low    := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);

    UPDATE products SET stock = v_next, sold = sold + v_qty, last_sold_at = now() WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;


-- ============================================================
-- Originally: add_submit_idempotency_and_dup_guards.sql
-- ============================================================
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


-- ============================================================
-- Originally: add_return_unit_conditions.sql
-- ============================================================
Add a "Defective Items" feature to track returned units marked Defective until they're resolved (supplier claim, repair, or write-off).

1. DATABASE (migration)
- Create table `defective_items`:
  - defective_id SERIAL PK
  - return_id INTEGER REFERENCES returns(return_id) ON DELETE SET NULL
  - product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL
  - product_name VARCHAR(150) NOT NULL (snapshot)
  - serial_id INTEGER REFERENCES product_serials ON DELETE SET NULL (null for non-serial products)
  - serial_number VARCHAR(100) (snapshot)
  - qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0)  -- serial items always 1
  - cost_price NUMERIC(10,2) NOT NULL DEFAULT 0 (snapshot of products.cost_price at the time of return)
  - defect_note TEXT (from the admin's condition note)
  - status VARCHAR(30) NOT NULL DEFAULT 'Defective' CHECK (status IN ('Defective','Sent to supplier','Replaced by supplier','Repaired','Written off'))
  - supplier_name VARCHAR(100), rma_number VARCHAR(50)  -- optional, for supplier claims
  - resolution_note TEXT
  - created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, resolved_by VARCHAR(100)
- Create `defective_item_history` (id, defective_id FK ON DELETE CASCADE, from_status, to_status, note, changed_by, changed_at DEFAULT NOW()) so every status change is kept.
- RLS: admin only for SELECT/INSERT/UPDATE on both tables; no DELETE policy (records are permanent). Cashiers have no access.
- Update `approve_return`: for each unit marked Defective, insert a defective_items row (with cost_price snapshot and the defect note) and set its serial status to 'defective'. Resellable units keep the existing restock logic.

2. RPC `update_defective_status(p_id int, p_status text, p_note text, p_supplier text, p_rma text)`
- SECURITY DEFINER, admin-only check.
- Allowed transitions only:
  - Defective → Sent to supplier, Repaired, Written off
  - Sent to supplier → Replaced by supplier, Repaired, Written off, Defective (claim rejected)
  - Replaced by supplier / Repaired / Written off are FINAL (no more changes).
- Require p_note for 'Written off' (why it can't be claimed or fixed).
- Require p_supplier for 'Sent to supplier' (RMA number optional).
- Effects:
  - 'Repaired' or 'Replaced by supplier' → stock +qty on the product (SELECT ... FOR UPDATE). For serial items: on Repaired, set the same serial back to 'in_stock'; on Replaced, mark the old serial 'replaced' and remind the admin to add the new unit's serial via the existing add serials flow (return a flag so the UI can open it).
  - 'Written off' → no stock change; serial status 'written_off'.
  - Set resolved_at / resolved_by on final statuses.
- Insert a defective_item_history row and an activity_log entry (action 'update', entity_type 'defective', details {from, to, note}).

3. POS BLOCK
- When scanning or typing a serial at checkout, block serials with status 'defective', 'written_off' or 'replaced' with the message: "This unit is marked Defective and can't be sold."

4. ADMIN PAGE: "Defective Items" (sidebar under MANAGEMENT, below Products, admin only)
- KPI cards: Waiting (Defective), At Supplier, Resolved this month, Loss this month (₱ sum of cost_price × qty for Written off).
- Filter pills: All / Defective / Sent to supplier / Resolved (Repaired + Replaced) / Written off, with counts.
- Search by product name, serial or return #.
- Table: Product, Serial, Return #, Defect, Status badge, Days since return, Action.
  - Status colors: Defective = red, Sent to supplier = blue, Repaired / Replaced = green, Written off = gray.
  - Rows still 'Defective' for more than 7 days: show an amber "7d+" warning chip.
- Action: "Update" button opens a modal with only the allowed next statuses, plus fields: supplier name and RMA # (for Sent to supplier), note (required for Written off). Confirm button disabled while saving.
- Clicking a row opens details: product, serial, defect note, evidence photos from the original return, linked return #, and a status timeline from defective_item_history.
- Pagination 8 rows per page, Back/Next, same as the other tables.

5. REPORTS
- Add a "Defective Loss" KPI card to Reports (sum of cost_price × qty of Written off in the selected date range), labeled as a loss.
- Don't change existing sales/return calculations.

6. DASHBOARD
- Add a small alert row: "3 defective items waiting for action" linking to the Defective Items page (only when count > 0).

Reuse existing modal (portal), table, badge, pagination and toast components and styling. Show me the migration SQL, RPCs, and every file changed.

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

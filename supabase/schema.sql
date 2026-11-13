-- Gapuz POS System - Full Database SQL
-- Gapuz Computer Services and Accessories
-- Stack: Supabase PostgreSQL
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- NOTE: there is no "users" table here on purpose. Logins go through
-- Supabase's built-in Auth (auth.users), which handles password hashing
-- and sessions for you. The "profiles" table below just attaches a
-- name + role (admin/cashier) to each auth user.

-- 1. PROFILES (role + display name, one row per auth user)
CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(100),
  role       VARCHAR(20)  NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin','cashier')),
  active     BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. PRODUCTS
CREATE TABLE products (
  product_id   SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  category     VARCHAR(50)  NOT NULL,
  price        NUMERIC(10,2) NOT NULL,
  cost_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0,
  barcode      VARCHAR(50),
  icon         VARCHAR(10),
  image        TEXT,
  sold         INTEGER NOT NULL DEFAULT 0,
  has_serial   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sold_at TIMESTAMP WITH TIME ZONE
);

INSERT INTO products (name, category, price, cost_price, stock, barcode, icon, sold) VALUES
('AMD Ryzen 5 5600X',         'Processors',  9500,  7200,  12, 'CPU-001', '💻', 24),
('Intel Core i5-12400',       'Processors',  10500, 8000,  8,  'CPU-002', '💻', 18),
('AMD Ryzen 7 5800X',         'Processors',  15000, 11500, 5,  'CPU-003', '💻', 12),
('Kingston 8GB DDR4 3200MHz', 'RAM',         1800,  1300,  20, 'RAM-001', '🧩', 35),
('Corsair 16GB DDR4 3200MHz', 'RAM',         3200,  2400,  15, 'RAM-002', '🧩', 28),
('NVIDIA RTX 3060 12GB',      'GPU',         22000, 17000, 4,  'GPU-001', '🎮', 8),
('AMD RX 6600 8GB',           'GPU',         16500, 12500, 6,  'GPU-002', '🎮', 11),
('Samsung 500GB SSD',         'Storage',     2800,  2100,  18, 'SSD-001', '💾', 42),
('WD 1TB HDD',                'Storage',     1900,  1400,  22, 'HDD-001', '💾', 31),
('Laptop Acer Aspire 5',      'Laptops',     35000, 28000, 3,  'LAP-001', '💻', 5),
('Laptop ASUS VivoBook',      'Laptops',     28000, 22000, 4,  'LAP-002', '💻', 7),
('Gaming Mouse Logitech',     'Peripherals', 1200,  850,   25, 'PER-001', '🖱️', 38),
('Mechanical Keyboard',       'Peripherals', 2500,  1800,  15, 'PER-002', '⌨️', 22),
('USB-C Hub 7-in-1',          'Accessories', 1500,  1100,  30, 'ACC-001', '🔌', 55),
('HDMI Cable 2m',             'Accessories', 350,   200,   50, 'ACC-002', '🔌', 88),
('PC Cleaning Service',       'Services',    500,   0,     0,  'SVC-001', '🔧', 15),
('OS Installation',           'Services',    800,   0,     0,  'SVC-002', '💿', 20);

-- 3. CUSTOMERS
CREATE TABLE customers (
  customer_id  SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(100),
  phone        VARCHAR(20),
  address      TEXT,
  points       INTEGER NOT NULL DEFAULT 0,
  purchases    INTEGER NOT NULL DEFAULT 0,
  total_spent  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO customers (name, email, phone, address, points, purchases, total_spent) VALUES
('Juan dela Cruz',  'juan@email.com',  '0917-111-1111', 'CDO City', 1520, 12, 45000),
('Maria Santos',    'maria@email.com', '0918-222-2222', 'CDO City', 320,  4,  12000),
('Pedro Reyes',     'pedro@email.com', '0919-333-3333', 'CDO City', 3200, 28, 98000),
('Ana Garcia',      'ana@email.com',   '0920-444-4444', 'CDO City', 450,  8,  22000),
('Carlo Bautista',  'carlo@email.com', '0921-555-5555', 'CDO City', 2480, 31, 179000),
('Liza Villanueva', 'liza@email.com',  '0922-666-6666', 'CDO City', 520,  5,  23000);

-- 4. TRANSACTIONS
-- payment is free text (e.g. "Cash", "GCash", "Card", or "Cash+GCash" for split payments)
CREATE TABLE transactions (
  transaction_id SERIAL PRIMARY KEY,
  customer_id    INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
  customer_name  VARCHAR(100) DEFAULT 'Walk-in',
  payment        VARCHAR(30)  NOT NULL,
  subtotal       NUMERIC(10,2) NOT NULL DEFAULT 0,
  disc_amt       NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat            NUMERIC(10,2) NOT NULL DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  cash_given     NUMERIC(10,2),
  status         VARCHAR(20)  NOT NULL DEFAULT 'Completed',
  cashier_name   VARCHAR(100),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TRANSACTION_ITEMS (line items per sale)
CREATE TABLE transaction_items (
  item_id        SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  product_id     INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
  name           VARCHAR(150) NOT NULL,
  qty            INTEGER NOT NULL DEFAULT 1,
  price          NUMERIC(10,2) NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. REFUNDS
CREATE TABLE refunds (
  refund_id      SERIAL PRIMARY KEY,
  transaction_id INTEGER REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  customer_name  VARCHAR(100) DEFAULT 'Walk-in',
  reason         VARCHAR(150),
  refund_method  VARCHAR(30),
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         VARCHAR(20)  NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  processed_by   VARCHAR(100),
  items          JSONB,
  subtotal       NUMERIC(10,2) DEFAULT 0,
  vat            NUMERIC(10,2) DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at   TIMESTAMP WITH TIME ZONE
);

-- 7. HOLDS (parked carts)
CREATE TABLE holds (
  hold_id      SERIAL PRIMARY KEY,
  label        VARCHAR(100) NOT NULL,
  items        JSONB NOT NULL,
  customer_id  INTEGER REFERENCES customers(customer_id) ON DELETE SET NULL,
  saved_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CATEGORIES (product category list — lets admins add/remove categories from the UI
--    instead of hardcoding them in the frontend)
CREATE TABLE categories (
  category_id SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  badge_color VARCHAR(20) NOT NULL DEFAULT 'badge-accent',
  icon        VARCHAR(30),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO categories (name, badge_color, sort_order) VALUES
('Processors',  'badge-blue',   1),
('RAM',         'badge-purple', 2),
('GPU',         'badge-accent', 3),
('Storage',     'badge-yellow', 4),
('Laptops',     'badge-green',  5),
('Peripherals', 'badge-cyan',   6),
('Accessories', 'badge-orange', 7),
('Services',    'badge-green',  8);

-- 9. ACTIVITY LOG (who did what — refunds processed, products deleted, staff
--    suspended, etc. No UPDATE/DELETE policies on purpose, so entries can't
--    be altered or removed through the app once written.)
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

-- 10. PRODUCT_SERIALS (one row per physical unit, for serialized products —
--     GPUs, laptops, motherboards, SSDs, etc. products.stock stays the
--     single source of truth for quantity; this is a side-channel for
--     which units make up that number, kept in sync via add_serials /
--     delete_serial / mark_serials_sold below.)
CREATE TABLE product_serials (
  serial_id           SERIAL PRIMARY KEY,
  product_id          INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  serial_number       VARCHAR(100) NOT NULL UNIQUE,
  status              VARCHAR(20) NOT NULL DEFAULT 'In Stock' CHECK (status IN ('In Stock','Sold','Defective')),
  transaction_id      INTEGER REFERENCES transactions(transaction_id) ON DELETE SET NULL,
  transaction_item_id INTEGER REFERENCES transaction_items(item_id) ON DELETE SET NULL,
  sold_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. RETURNS (merchandise returns — the item physically comes back; see
--     refunds above for the money-only flow). Rows are only created
--     through create_return (SECURITY DEFINER, below), which enforces the
--     7-day window and serial/qty validation a raw insert couldn't.
CREATE TABLE returns (
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

-- ROW LEVEL SECURITY
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE holds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_serials   ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON transaction_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON refunds FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON holds FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON product_serials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read activity log" ON activity_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Allow authenticated insert" ON transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON transaction_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON refunds FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON holds FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (true);

-- Products and categories: only admins add/remove products or manage
-- categories (both are admin-only pages in the app). Product UPDATE is
-- deliberately left open below — cashiers need it to deduct stock at
-- checkout.
CREATE POLICY "Admins can insert products" ON products FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can insert categories" ON categories FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Allow authenticated update" ON products FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated update" ON customers FOR UPDATE TO authenticated USING (true);

-- Refunds/transactions: any signed-in user can submit a refund request, but
-- only an admin can approve/reject one or mark a sale as refunded.
CREATE POLICY "Admins can update refunds" ON refunds FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can update transactions" ON transactions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can update categories" ON categories FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Admins can delete products" ON products FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Allow authenticated delete" ON holds FOR DELETE TO authenticated USING (true);
CREATE POLICY "Allow authenticated delete" ON customers FOR DELETE TO authenticated USING (true);
CREATE POLICY "Admins can delete categories" ON categories FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Product serials: cashiers never touch rows directly — only through
-- add_serials / delete_serial / mark_serials_sold (all SECURITY DEFINER,
-- below). These policies are defense-in-depth against a raw
-- supabase.from('product_serials') call bypassing the RPCs.
CREATE POLICY "Admins can insert serials" ON product_serials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can update serials" ON product_serials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can delete serials" ON product_serials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- Returns: no INSERT policy on purpose — rows are only created through
-- create_return (SECURITY DEFINER, below). Only an admin can approve/reject.
CREATE POLICY "Admins can update returns" ON returns FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- INDEXES
CREATE INDEX idx_transactions_customer   ON transactions(customer_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transaction_items_txn   ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_prod  ON transaction_items(product_id);
CREATE INDEX idx_refunds_transaction     ON refunds(transaction_id);
CREATE INDEX idx_refunds_status          ON refunds(status);
CREATE INDEX idx_products_category       ON products(category);
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX idx_product_serials_product ON product_serials(product_id);
CREATE INDEX idx_product_serials_status  ON product_serials(status);
CREATE INDEX idx_product_serials_txn     ON product_serials(transaction_id);
CREATE INDEX idx_returns_transaction     ON returns(transaction_id);
CREATE INDEX idx_returns_status          ON returns(status);

-- VIEWS
-- security_invoker = true makes each view run with the querying user's own
-- permissions (and RLS) instead of the view owner's — otherwise Postgres
-- defaults views to definer-style access, which bypasses RLS on the
-- underlying tables and trips Supabase's linter (see fix_security_definer_views.sql
-- for applying this to an already-deployed database).
CREATE VIEW sales_summary
WITH (security_invoker = true) AS
SELECT DATE(t.created_at)      AS sale_date,
       COUNT(t.transaction_id) AS total_transactions,
       SUM(t.subtotal)         AS total_subtotal,
       SUM(t.disc_amt)         AS total_discount,
       SUM(t.vat)              AS total_vat,
       SUM(t.total)            AS total_revenue,
       t.payment               AS payment_method
FROM transactions t
GROUP BY DATE(t.created_at), t.payment
ORDER BY sale_date DESC;

CREATE VIEW product_sales
WITH (security_invoker = true) AS
SELECT p.product_id, p.name, p.category, p.price, p.cost_price, p.stock, p.sold,
       ROUND(((p.price - p.cost_price) / NULLIF(p.price, 0)) * 100, 2) AS margin_percent,
       CASE
         WHEN p.price < p.cost_price THEN 'At Loss'
         WHEN ((p.price - p.cost_price) / NULLIF(p.price, 0)) * 100 <= 15 THEN 'Low Margin'
         ELSE 'Healthy'
       END AS margin_status
FROM products p
ORDER BY p.sold DESC;

CREATE VIEW customer_loyalty
WITH (security_invoker = true) AS
SELECT c.customer_id, c.name, c.points, c.purchases, c.total_spent,
       CASE
         WHEN c.points >= 3000 THEN 'Platinum'
         WHEN c.points >= 1500 THEN 'Gold'
         WHEN c.points >= 500  THEN 'Silver'
         ELSE 'Bronze'
       END AS loyalty_tier
FROM customers c
ORDER BY c.points DESC;

-- FUNCTIONS
-- Atomic stock deduction at checkout — locks each product row
-- (SELECT ... FOR UPDATE) before computing its new stock, so two
-- concurrent checkouts on the same product queue instead of racing and
-- overselling. Runs with the calling user's own privileges (no SECURITY
-- DEFINER), so the normal products RLS policies still apply.
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
    -- Fires whenever a real decrease lands stock at 1, 2, or 3 — not just
    -- an exact crossing through 3 — so a batch sale that jumps straight
    -- from, say, 6 to 1 still gets a low-stock email instead of staying
    -- silent just because it skipped over 3.
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

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

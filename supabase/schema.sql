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

-- 6b. RETURNS (merchandise returns — mirrors refunds; admin approval
--     restocks items, same as a refund, but isn't necessarily a cash refund)
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

-- ROW LEVEL SECURITY
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE holds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON transaction_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON refunds FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON holds FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can read activity log" ON activity_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Allow authenticated insert" ON transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON transaction_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON refunds FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated insert" ON returns FOR INSERT TO authenticated WITH CHECK (true);
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

-- Refunds/returns/transactions: any signed-in user can submit a refund or
-- return request, but only an admin can approve/reject one or mark a sale
-- as refunded.
CREATE POLICY "Admins can update refunds" ON refunds FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can update returns" ON returns FOR UPDATE TO authenticated
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

-- INDEXES
CREATE INDEX idx_transactions_customer   ON transactions(customer_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transaction_items_txn   ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_prod  ON transaction_items(product_id);
CREATE INDEX idx_refunds_transaction     ON refunds(transaction_id);
CREATE INDEX idx_refunds_status          ON refunds(status);
CREATE INDEX idx_returns_transaction     ON returns(transaction_id);
CREATE INDEX idx_returns_status          ON returns(status);
CREATE INDEX idx_products_category       ON products(category);
CREATE INDEX idx_activity_log_created_at ON activity_log(created_at);

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

-- Atomic return approval + restock — flips a return's status to 'Approved'
-- and restocks every item it covers as one transaction, so a dropped
-- connection can't leave the status "Approved" with only some items
-- restocked. Locks the return row first, so a double-click (two
-- overlapping calls) only restocks once: the second call sees the status
-- is no longer 'Pending' and reports out_already = true without touching
-- stock. No SECURITY DEFINER, same as deduct_stock, so the normal
-- admin-only "Admins can update returns" RLS policy still applies.
-- Also stamps processed_at on approval (see add_processed_at.sql) — Gross vs
-- Net sales reporting deducts an approved return from revenue in the period
-- it was approved, not the period of the original sale, so it needs this
-- timestamp distinct from created_at.
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

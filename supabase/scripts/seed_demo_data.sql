-- Demo-data seed for the capstone defense. Builds ~190-200 realistic
-- transactions, 25 customers, holds, returns, refunds, and matching
-- activity_log entries on top of the EXISTING product/category/staff
-- catalog (nothing added/removed/renamed on those).
--
-- Everything below runs in one transaction: BEGIN...COMMIT at the very
-- bottom. If anything raises, the whole thing rolls back and nothing
-- changes. No tables/columns/RPCs/RLS policies/triggers/views are
-- touched structurally — data only (plus created_at/stock on specific
-- existing products, per the agreed plan).
--
-- Before running: upload 2-3 small images to the 'return-evidence'
-- Storage bucket named exactly seed-1.jpg, seed-2.jpg, seed-3.jpg
-- (Dashboard -> Storage -> return-evidence -> Upload) so the Returns'
-- evidence_photos actually open to a real file.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Takes a few seconds (~200 transactions generated procedurally).

BEGIN;

-- ============================================================
-- 0. Staff ids (from your actual profiles table)
-- ============================================================
-- Gapuz Admin   b0007e8c-333f-434d-93d7-02d0a8f73615
-- Cashier       98539959-e2ca-4d1a-a4b0-26886bdd3770
-- Cashier 2     9d62f694-2cf8-42cc-a28a-13fa5d0e4a77

-- ============================================================
-- 1. Product adjustments (per the agreed plan)
-- ============================================================

-- Data-integrity fix: product 40 shows stock=4 but only 2 real serials
-- remain "In Stock" (the other 2 were Sold/Defective rows deleted by the
-- earlier cleanup without touching stock). Reconcile to the true count.
UPDATE products SET stock = 2 WHERE product_id = 40;

-- Top-up: these are incidentally sitting at 1-3 units already (not your
-- chosen low-stock showcase) — bump them to a healthy level so they
-- don't pollute the Low Stock report once the showcase products below
-- are deliberately left low.
UPDATE products SET stock = CASE product_id
  WHEN 17 THEN 22 WHEN 22 THEN 28 WHEN 30 THEN 20 WHEN 32 THEN 26
  WHEN 34 THEN 24 WHEN 41 THEN 18 WHEN 55 THEN 20 END
WHERE product_id IN (17,22,30,32,34,41,55);

-- Slow-movers showcase: backdate created_at well past the 30-day
-- SLOW_MOVING_DAYS cutoff; these never get a single sale below, so
-- last_sold_at stays NULL — both Dashboard's and Reports' Slow-Moving
-- widgets will pick them up.
UPDATE products SET created_at = now() - interval '100 days' WHERE product_id = 18;
UPDATE products SET created_at = now() - interval '115 days' WHERE product_id = 19;
UPDATE products SET created_at = now() - interval '130 days' WHERE product_id = 20;
UPDATE products SET created_at = now() - interval '145 days' WHERE product_id = 21;
UPDATE products SET created_at = now() - interval '160 days' WHERE product_id = 50;

-- General catalog: backdate everything else (except the slow-movers
-- above and the 3 genuinely-new products 58/59/61) to a deterministic
-- 11-85 day spread. Needed because Reports' Least-Selling chart ignores
-- anything younger than 10 days, and the whole catalog is currently
-- only 6 days old — without this, Least Selling would render empty.
UPDATE products
SET created_at = now() - ((11 + (product_id * 7) % 75))::int * interval '1 day'
WHERE product_id NOT IN (18,19,20,21,50,58,59,61);

-- ============================================================
-- 2. Customers — 25, Filipino names, CDO-style addresses/phones
-- ============================================================
CREATE TEMP TABLE seed_customer_ids AS
WITH ins AS (
  INSERT INTO customers (name, email, phone, address, points, purchases, total_spent)
  VALUES
    ('Maria Luz Abellana',    'marialuz.abellana12@gmail.com', '0917-234-5612', 'Brgy. Carmen, Cagayan de Oro City', 0,0,0),
    ('Juan Carlo Pacana',     'juancarlo.pacana45@gmail.com',  '0918-345-2291', 'Brgy. Lapasan, Cagayan de Oro City', 0,0,0),
    ('Rosemarie Tan',         'rosemarie.tan33@gmail.com',     '0919-456-7823', 'Brgy. Kauswagan, Cagayan de Oro City', 0,0,0),
    ('Ronnie Dagohoy',        'ronnie.dagohoy88@gmail.com',    '0920-567-1134', 'Brgy. Bulua, Cagayan de Oro City', 0,0,0),
    ('Angelica Nacional',     'angelica.nacional21@gmail.com', '0921-678-4456', 'Brgy. Gusa, Cagayan de Oro City', 0,0,0),
    ('Mark Anthony Yap',      'markanthony.yap77@gmail.com',   '0927-789-9987', 'Brgy. Nazareth, Cagayan de Oro City', 0,0,0),
    ('Cristina Borja',        'cristina.borja09@gmail.com',    '0928-890-2218', 'Brgy. Macabalan, Cagayan de Oro City', 0,0,0),
    ('Jun Villareal',         'jun.villareal64@gmail.com',     '0929-901-5549', 'Brgy. Puerto, Cagayan de Oro City', 0,0,0),
    ('Precious Gonzaga',      'precious.gonzaga18@gmail.com',  '0930-012-8870', 'Brgy. Balulang, Cagayan de Oro City', 0,0,0),
    ('Dindo Macabenta',       'dindo.macabenta52@gmail.com',   '0905-123-4401', 'Brgy. Cugman, Cagayan de Oro City', 0,0,0),
    ('Shiela Marie Cagoco',   'shielamarie.cagoco39@gmail.com','0906-234-7732', 'Brgy. Iponan, Cagayan de Oro City', 0,0,0),
    ('Noel Pelaez',           'noel.pelaez71@gmail.com',       '0908-345-0063', 'Brgy. Camaman-an, Cagayan de Oro City', 0,0,0),
    ('Jennilyn Corrales',     'jennilyn.corrales26@gmail.com', '0910-456-3394', 'Brgy. Tablon, Cagayan de Oro City', 0,0,0),
    ('Rico Salcedo',          'rico.salcedo84@gmail.com',      '0912-567-6625', 'Brgy. Agusan, Cagayan de Oro City', 0,0,0),
    ('Gemma Antolin',         'gemma.antolin15@gmail.com',     '0915-678-9956', 'Brgy. Bayabas, Cagayan de Oro City', 0,0,0),
    ('Ferdinand Oclarit',     'ferdinand.oclarit60@gmail.com', '0917-789-2287', 'Brgy. Pagatpat, Cagayan de Oro City', 0,0,0),
    ('Lovely Jabagat',        'lovely.jabagat47@gmail.com',    '0918-890-5518', 'Brgy. Patag, Cagayan de Oro City', 0,0,0),
    ('Benjie Suarez',         'benjie.suarez93@gmail.com',     '0919-901-8849', 'Brgy. Macasandig, Cagayan de Oro City', 0,0,0),
    ('Rhea Montalban',        'rhea.montalban28@gmail.com',    '0920-012-1180', 'Brgy. Lumbia, Cagayan de Oro City', 0,0,0),
    ('Alvin Jumalon',         'alvin.jumalon66@gmail.com',     '0921-123-4411', 'Brgy. Gusa, Cagayan de Oro City', 0,0,0),
    ('Marites Cuizon',        'marites.cuizon34@gmail.com',    '0927-234-7742', 'Brgy. Carmen, Cagayan de Oro City', 0,0,0),
    ('Eduardo Lumapas',       'eduardo.lumapas19@gmail.com',   '0928-345-0073', 'Brgy. Kauswagan, Cagayan de Oro City', 0,0,0),
    ('Joan Kristel Rosales',  'joankristel.rosales58@gmail.com','0929-456-3304', 'Brgy. Bulua, Cagayan de Oro City', 0,0,0),
    ('Reymark Abarquez',      'reymark.abarquez41@gmail.com',  '0930-567-6635', 'Brgy. Nazareth, Cagayan de Oro City', 0,0,0),
    ('Cherry Ann Buot',       'cherryann.buot07@gmail.com',    '0905-678-9966', 'Brgy. Macabalan, Cagayan de Oro City', 0,0,0)
  RETURNING customer_id
)
SELECT customer_id FROM ins;

-- ============================================================
-- 3. Weighted pool of sellable products for the main sales loop
-- ============================================================
-- Excludes: slow-movers (18,19,20,21,50), zero-stock (27,44,46),
-- low-stock showcase (23,24,25,26,33,42 — left untouched, already in
-- the 1-3 band), and the 3 new arrivals (58,59,61 — handled in their
-- own guaranteed step below so they're not left to chance).
CREATE TEMP TABLE product_weight AS
SELECT product_id, 1.0::numeric AS weight FROM products
WHERE product_id NOT IN (18,19,20,21,50, 27,44,46, 23,24,25,26,33,42, 58,59,61);

-- Clear top sellers: a handful of products absorb most of the weight so
-- Top Selling reads as genuinely concentrated, leaving a long tail of
-- lightly-sold products for Least Selling / "No demand" variety.
UPDATE product_weight SET weight = 10 WHERE product_id IN (43,45,51,28,37);

-- Day-of-week weighted date pool: each of the last 90 days appears
-- multiple times, weekends (Fri/Sat/Sun) more often, so random draws
-- naturally cluster sales toward weekends.
CREATE TEMP TABLE day_pool AS
SELECT d.day_offset
FROM generate_series(0,89) AS d(day_offset)
CROSS JOIN LATERAL generate_series(
  1,
  CASE WHEN extract(dow FROM (current_date - d.day_offset)) IN (0,5,6) THEN 16 ELSE 9 END
) AS rep(n);

-- Scratch table used per-iteration to hold the current cart before the
-- transaction row (which needs the computed subtotal/vat/total) exists.
CREATE TEMP TABLE cart_items (
  product_id int, name text, price numeric, cost_price numeric,
  qty int, is_service boolean, has_serial boolean
);

-- ============================================================
-- 4. Main sales-generation loop (~192 transactions)
-- ============================================================
DO $$
DECLARE
  v_i int;
  v_day_offset int;
  v_ts timestamptz;
  v_staff_roll numeric;
  v_actor_name text;
  v_customer_id int;
  v_customer_name text;
  v_n_items int;
  v_pid int;
  v_name text;
  v_price numeric;
  v_cost numeric;
  v_is_service boolean;
  v_has_serial boolean;
  v_avail int;
  v_qty int;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_payment text;
  v_pay_roll numeric;
  v_cash_given numeric;
  v_txn_id int;
  v_item_id int;
  v_serial text;
  rec RECORD;
  j int;
BEGIN
  FOR v_i IN 1..192 LOOP
    TRUNCATE cart_items;

    SELECT day_offset INTO v_day_offset FROM day_pool ORDER BY random() LIMIT 1;
    v_ts := (current_date - v_day_offset)::timestamptz
            + (9 + random()*10) * interval '1 hour'
            + (random()*59) * interval '1 minute';

    v_staff_roll := random();
    v_actor_name := CASE
      WHEN v_staff_roll < 0.15 THEN 'Gapuz Admin'
      WHEN v_staff_roll < 0.70 THEN 'Cashier'
      ELSE 'Cashier 2' END;

    IF random() < 0.40 THEN
      SELECT c.customer_id, c.name INTO v_customer_id, v_customer_name
      FROM customers c JOIN seed_customer_ids s ON s.customer_id = c.customer_id
      ORDER BY random() LIMIT 1;
    ELSE
      v_customer_id := NULL;
      v_customer_name := 'Walk-in';
    END IF;

    v_n_items := 1 + floor(random()*4)::int;

    FOR j IN 1..v_n_items LOOP
      v_avail := NULL;
      SELECT p.product_id, p.name, p.price, p.cost_price, p.is_service, p.has_serial,
             CASE WHEN p.has_serial
                  THEN (SELECT count(*)::int FROM product_serials ps WHERE ps.product_id = p.product_id AND ps.status = 'In Stock')
                  ELSE p.stock END
        INTO v_pid, v_name, v_price, v_cost, v_is_service, v_has_serial, v_avail
      FROM products p
      JOIN product_weight pw ON pw.product_id = p.product_id
      WHERE p.created_at <= v_ts
        AND p.is_available
        AND p.product_id NOT IN (SELECT ci.product_id FROM cart_items ci)
        AND (p.is_service
             OR (NOT p.has_serial AND p.stock > 0)
             OR (p.has_serial AND EXISTS (SELECT 1 FROM product_serials ps2 WHERE ps2.product_id = p.product_id AND ps2.status = 'In Stock')))
      ORDER BY random() * pw.weight DESC
      LIMIT 1;

      IF v_pid IS NULL THEN
        CONTINUE;
      END IF;

      IF v_is_service THEN
        v_qty := 1;
      ELSIF v_has_serial THEN
        v_qty := 1;
      ELSE
        v_qty := LEAST(1 + floor(random()*2)::int, v_avail);
      END IF;

      INSERT INTO cart_items VALUES (v_pid, v_name, v_price, v_cost, v_qty, v_is_service, v_has_serial);
    END LOOP;

    SELECT COALESCE(SUM(price*qty),0) INTO v_subtotal FROM cart_items;
    IF v_subtotal = 0 THEN
      CONTINUE;
    END IF;
    v_vat := round(v_subtotal * 0.12, 2);
    v_total := v_subtotal + v_vat;

    v_pay_roll := random();
    v_payment := CASE
      WHEN v_pay_roll < 0.55 THEN 'Cash'
      WHEN v_pay_roll < 0.90 THEN 'GCash'
      ELSE 'Cash+GCash' END;
    v_cash_given := CASE WHEN v_payment IN ('Cash','Cash+GCash') THEN ceil(v_total/50)*50 ELSE NULL END;

    INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
    VALUES (v_customer_id, v_customer_name, v_payment, v_subtotal, 0, v_vat, v_total, v_cash_given, 'Completed', v_actor_name, v_ts)
    RETURNING transaction_id INTO v_txn_id;

    FOR rec IN SELECT * FROM cart_items LOOP
      INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
      VALUES (v_txn_id, rec.product_id, rec.name, rec.qty, rec.price, rec.cost_price, v_ts)
      RETURNING item_id INTO v_item_id;

      IF rec.is_service THEN
        UPDATE products SET sold = sold + rec.qty,
          last_sold_at = CASE WHEN last_sold_at IS NULL OR last_sold_at < v_ts THEN v_ts ELSE last_sold_at END
        WHERE product_id = rec.product_id;
      ELSE
        UPDATE products SET stock = stock - rec.qty, sold = sold + rec.qty,
          last_sold_at = CASE WHEN last_sold_at IS NULL OR last_sold_at < v_ts THEN v_ts ELSE last_sold_at END
        WHERE product_id = rec.product_id;
      END IF;

      IF rec.has_serial THEN
        SELECT serial_number INTO v_serial FROM product_serials
          WHERE product_id = rec.product_id AND status = 'In Stock' LIMIT 1;
        UPDATE product_serials SET status = 'Sold', transaction_id = v_txn_id, transaction_item_id = v_item_id, sold_at = v_ts
          WHERE serial_number = v_serial;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 5. Guaranteed coverage: new arrivals (58, 59, 61) + product 40's
--    2 serials, in case random draws above missed any of them.
-- ============================================================
DO $$
DECLARE
  v_ts timestamptz;
  v_pid int;
  v_name text;
  v_price numeric;
  v_cost numeric;
  v_is_service boolean;
  v_has_serial boolean;
  v_txn_id int;
  v_item_id int;
  v_serial text;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_actor text[] := ARRAY['Gapuz Admin','Cashier','Cashier 2'];
BEGIN
  FOR v_pid IN SELECT unnest(ARRAY[58,59,61,40]) LOOP
    SELECT p.name, p.price, p.cost_price, p.is_service, p.has_serial
      INTO v_name, v_price, v_cost, v_is_service, v_has_serial
    FROM products p WHERE p.product_id = v_pid;

    -- Skip products whose serials/stock are already fully sold out from
    -- the main loop (nothing left to force-sell).
    IF v_has_serial AND NOT EXISTS (SELECT 1 FROM product_serials WHERE product_id = v_pid AND status = 'In Stock') THEN
      CONTINUE;
    END IF;

    -- New arrivals get a very recent date (can't be sold before they
    -- existed); product 40 (already backdated above) gets any recent date.
    v_ts := CASE WHEN v_pid IN (58,59,61)
      THEN now() - (random()*20) * interval '1 hour'
      ELSE now() - (random()*5) * interval '1 day' END;

    v_subtotal := v_price;
    v_vat := round(v_subtotal * 0.12, 2);
    v_total := v_subtotal + v_vat;

    INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
    VALUES (NULL, 'Walk-in', 'Cash', v_subtotal, 0, v_vat, v_total, ceil(v_total/50)*50, 'Completed', v_actor[1 + floor(random()*3)::int], v_ts)
    RETURNING transaction_id INTO v_txn_id;

    INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
    VALUES (v_txn_id, v_pid, v_name, 1, v_price, v_cost, v_ts)
    RETURNING item_id INTO v_item_id;

    IF v_is_service THEN
      UPDATE products SET sold = sold + 1,
        last_sold_at = CASE WHEN last_sold_at IS NULL OR last_sold_at < v_ts THEN v_ts ELSE last_sold_at END
      WHERE product_id = v_pid;
    ELSE
      UPDATE products SET stock = stock - 1, sold = sold + 1,
        last_sold_at = CASE WHEN last_sold_at IS NULL OR last_sold_at < v_ts THEN v_ts ELSE last_sold_at END
      WHERE product_id = v_pid;
    END IF;

    IF v_has_serial THEN
      SELECT serial_number INTO v_serial FROM product_serials
        WHERE product_id = v_pid AND status = 'In Stock' LIMIT 1;
      UPDATE product_serials SET status = 'Sold', transaction_id = v_txn_id, transaction_item_id = v_item_id, sold_at = v_ts
        WHERE serial_number = v_serial;
    END IF;

    -- Product 61 has 2 serials and we only want 1 forced sale here (the
    -- other one is very likely already sold by the main loop, or can
    -- stay available) — but run this block twice for 61 to be sure both
    -- serials move at least once if the main loop missed it entirely.
    IF v_pid = 61 AND EXISTS (SELECT 1 FROM product_serials WHERE product_id = 61 AND status = 'In Stock') THEN
      v_ts := now() - (random()*10) * interval '1 hour';
      v_subtotal := v_price; v_vat := round(v_subtotal*0.12,2); v_total := v_subtotal+v_vat;
      INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
      VALUES (NULL, 'Walk-in', 'GCash', v_subtotal, 0, v_vat, v_total, NULL, 'Completed', v_actor[1 + floor(random()*3)::int], v_ts)
      RETURNING transaction_id INTO v_txn_id;
      INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
      VALUES (v_txn_id, v_pid, v_name, 1, v_price, v_cost, v_ts)
      RETURNING item_id INTO v_item_id;
      UPDATE products SET stock = stock - 1, sold = sold + 1, last_sold_at = v_ts WHERE product_id = v_pid;
      SELECT serial_number INTO v_serial FROM product_serials WHERE product_id = 61 AND status = 'In Stock' LIMIT 1;
      UPDATE product_serials SET status = 'Sold', transaction_id = v_txn_id, transaction_item_id = v_item_id, sold_at = v_ts
        WHERE serial_number = v_serial;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 6. Customer loyalty — first pass: credit points/purchases/spend for
--    every completed sale linked to a customer (mirrors addPoints
--    called once per transaction: +10 + floor(total/100) each time).
-- ============================================================
UPDATE customers c SET
  points = sub.pts,
  purchases = sub.cnt,
  total_spent = sub.total
FROM (
  SELECT customer_id, count(*) AS cnt, sum(total) AS total, sum(10 + floor(total/100))::int AS pts
  FROM transactions WHERE customer_id IS NOT NULL GROUP BY customer_id
) sub
WHERE c.customer_id = sub.customer_id;

-- ============================================================
-- 7. Holds — 2-3 active parked carts
-- ============================================================
INSERT INTO holds (label, items, customer_id, saved_at)
SELECT 'Hold - ' || name, jsonb_build_array(jsonb_build_object('id', product_id, 'name', name, 'price', price, 'qty', 1, 'category', category)),
       NULL, now() - interval '2 hours'
FROM products WHERE product_id = 28;

INSERT INTO holds (label, items, customer_id, saved_at)
SELECT 'Hold - ' || name, jsonb_build_array(jsonb_build_object('id', product_id, 'name', name, 'price', price, 'qty', 2, 'category', category)),
       (SELECT customer_id FROM seed_customer_ids ORDER BY random() LIMIT 1), now() - interval '5 hours'
FROM products WHERE product_id = 37;

INSERT INTO holds (label, items, customer_id, saved_at)
SELECT 'Hold - ' || name, jsonb_build_array(jsonb_build_object('id', product_id, 'name', name, 'price', price, 'qty', 1, 'category', category)),
       NULL, now() - interval '1 day'
FROM products WHERE product_id = 51;

-- ============================================================
-- 8. Pick distinct transactions for Returns (8) and Refunds (6) —
--    no overlap, so the loyalty-reversal math stays simple (at most
--    one money-back event per transaction).
-- ============================================================
CREATE TEMP TABLE picked_for_return AS
SELECT transaction_id, created_at, total, customer_id, row_number() OVER () AS rn
FROM (
  SELECT transaction_id, created_at, total, customer_id FROM transactions t
  WHERE total > 300
    -- a Return must have at least one physical (non-service) line to
    -- return — service-only sales belong to Refunds instead.
    AND EXISTS (
      SELECT 1 FROM transaction_items ti JOIN products p ON p.product_id = ti.product_id
      WHERE ti.transaction_id = t.transaction_id AND p.is_service = false
    )
  ORDER BY random() LIMIT 8
) x;

CREATE TEMP TABLE picked_for_refund AS
SELECT transaction_id, created_at, total, customer_id, row_number() OVER () AS rn
FROM (
  SELECT transaction_id, created_at, total, customer_id FROM transactions
  WHERE total > 200 AND transaction_id NOT IN (SELECT transaction_id FROM picked_for_return)
  ORDER BY random() LIMIT 6
) x;

-- ============================================================
-- 9. Returns — 8 total: 2 Pending, 4 Approved, 2 Rejected
-- ============================================================
DO $$
DECLARE
  rec RECORD;
  v_item RECORD;
  v_method text;
  v_status text;
  v_reason text;
  -- Paired index-by-index with v_statuses: one Replacement lands Approved
  -- (so the replacement-unit stock-out path actually runs) and one lands
  -- Rejected, rather than both landing on the same status by accident.
  v_methods text[] := ARRAY['Cash refund','GCash refund','Cash refund','GCash refund','Replacement','Cash refund','GCash refund','Replacement'];
  v_statuses text[] := ARRAY['Pending','Pending','Approved','Approved','Approved','Approved','Rejected','Rejected'];
  v_reasons text[] := ARRAY['Defective product','Wrong item delivered','Customer changed mind','Item not as described','Duplicate purchase','Defective product','Wrong item delivered','Customer changed mind'];
  v_rejection_reasons text[] := ARRAY['Unit tested fine in-store, no defect found on inspection.','Past the 7-day window by the time it was physically brought in.'];
  v_submitter text[] := ARRAY['Gapuz Admin','Cashier','Cashier 2'];
  v_created timestamptz;
  v_processed timestamptz;
  v_return_id int;
  v_items jsonb;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_evidence jsonb;
  v_conditions jsonb := '{}'::jsonb;
  v_unit_key text;
  v_unit_status text;
  v_resell int;
  v_customer_id int;
  v_tx_total numeric;
  v_settled_before numeric;
  v_full_before boolean;
  v_full_after boolean;
  v_points_deducted int;
  v_submitted_by text;
  v_processed_by text;
  n int;
BEGIN
  FOR rec IN SELECT * FROM picked_for_return ORDER BY rn LOOP
    n := rec.rn;
    v_method := v_methods[n];
    v_status := v_statuses[n];
    v_reason := v_reasons[n];
    v_submitted_by := v_submitter[1 + floor(random()*3)::int];
    v_created := rec.created_at + (0.5 + random()*6) * interval '1 day';
    IF v_created > now() THEN v_created := now() - interval '1 hour'; END IF;

    -- One line item from the original sale (avoid lines on has_serial
    -- products whose serial no longer exists sold-against this txn, and
    -- avoid re-picking a line already used by an earlier return in this
    -- loop, which can't happen since transactions aren't reused across
    -- picks anyway).
    SELECT ti.item_id, ti.product_id, ti.name, ti.qty, ti.price, p.has_serial
      INTO v_item
    FROM transaction_items ti JOIN products p ON p.product_id = ti.product_id
    WHERE ti.transaction_id = rec.transaction_id AND p.is_service = false
    ORDER BY random() LIMIT 1;

    v_subtotal := v_item.price * v_item.qty;
    v_vat := round(v_subtotal * 0.12, 2);
    v_total := v_subtotal + v_vat;

    IF v_item.has_serial THEN
      SELECT jsonb_build_array(jsonb_build_object(
        'item_id', v_item.item_id, 'product_id', v_item.product_id, 'qty', v_item.qty,
        'serials', (SELECT jsonb_agg(serial_number) FROM product_serials WHERE transaction_item_id = v_item.item_id)
      )) INTO v_items;
    ELSE
      v_items := jsonb_build_array(jsonb_build_object(
        'item_id', v_item.item_id, 'product_id', v_item.product_id, 'qty', v_item.qty, 'serials', '[]'::jsonb
      ));
    END IF;

    v_evidence := (CASE (1 + floor(random()*3)::int)
      WHEN 1 THEN jsonb_build_array('seed-1.jpg')
      WHEN 2 THEN jsonb_build_array('seed-1.jpg','seed-2.jpg')
      ELSE jsonb_build_array('seed-1.jpg','seed-2.jpg','seed-3.jpg') END);

    v_processed := NULL;
    v_processed_by := NULL;
    v_conditions := '{}'::jsonb;

    IF v_status IN ('Approved','Rejected') THEN
      v_processed := v_created + (0.2 + random()*1.5) * interval '1 day';
      IF v_processed > now() THEN v_processed := now(); END IF;
      v_processed_by := 'Gapuz Admin';
    END IF;

    INSERT INTO returns (transaction_id, customer_name, reason, method, notes, subtotal, vat, total, status,
                          processed_by, items, evidence_photos, rejection_reason, submitted_by, conditions, created_at, processed_at)
    VALUES (rec.transaction_id,
            (SELECT customer_name FROM transactions WHERE transaction_id = rec.transaction_id),
            v_reason, v_method, NULL, v_subtotal, v_vat, v_total, v_status,
            v_processed_by, v_items, v_evidence,
            CASE WHEN v_status = 'Rejected' THEN v_rejection_reasons[1 + floor(random()*2)::int] ELSE NULL END,
            v_submitted_by, '{}'::jsonb, v_created, v_processed)
    RETURNING return_id INTO v_return_id;

    -- Activity log: created, then approved/rejected if resolved.
    INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
    SELECT p.id, v_submitted_by, 'created', 'return', '#' || lpad(v_return_id::text,4,'0'),
           jsonb_build_object('return_id', v_return_id, 'total', v_total), v_created
    FROM profiles p WHERE p.name = v_submitted_by;

    IF v_status = 'Rejected' THEN
      INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
      SELECT p.id, v_processed_by, 'rejected', 'return', '#' || lpad(v_return_id::text,4,'0'),
             jsonb_build_object('reason', (SELECT rejection_reason FROM returns WHERE return_id = v_return_id),
                                 'customerName', (SELECT customer_name FROM transactions WHERE transaction_id = rec.transaction_id), 'total', v_total),
             v_processed
      FROM profiles p WHERE p.name = v_processed_by;
    END IF;

    IF v_status = 'Approved' THEN
      -- Build the per-unit conditions map (same key scheme approve_return
      -- requires) and apply resell/defective effects, including
      -- Replacement's extra stock-out for the replacement unit.
      v_resell := 0;
      IF v_item.has_serial THEN
        FOR v_unit_key IN SELECT jsonb_array_elements_text((v_items->0)->'serials') LOOP
          v_unit_status := CASE WHEN random() < 0.7 THEN 'Resellable' ELSE 'Defective' END;
          v_conditions := v_conditions || jsonb_build_object(v_unit_key, jsonb_build_object('status', v_unit_status));
          IF v_unit_status = 'Defective' THEN
            UPDATE product_serials SET status = 'Defective' WHERE serial_number = v_unit_key;
          ELSE
            UPDATE product_serials SET status = 'In Stock', transaction_id = NULL, transaction_item_id = NULL, sold_at = NULL WHERE serial_number = v_unit_key;
            v_resell := v_resell + 1;
          END IF;
        END LOOP;
      ELSE
        FOR j IN 0..(v_item.qty - 1) LOOP
          v_unit_key := 'item:' || v_item.item_id || ':' || j;
          v_unit_status := CASE WHEN random() < 0.7 THEN 'Resellable' ELSE 'Defective' END;
          v_conditions := v_conditions || jsonb_build_object(v_unit_key, jsonb_build_object('status', v_unit_status));
          IF v_unit_status = 'Resellable' THEN v_resell := v_resell + 1; END IF;
        END LOOP;
        IF v_resell > 0 THEN
          UPDATE products SET stock = stock + v_resell WHERE product_id = v_item.product_id;
        END IF;
      END IF;

      IF v_method = 'Replacement' AND NOT v_item.has_serial THEN
        UPDATE products SET stock = GREATEST(stock - v_item.qty, 0) WHERE product_id = v_item.product_id;
      END IF;

      UPDATE returns SET conditions = v_conditions WHERE return_id = v_return_id;

      INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
      SELECT p.id, v_processed_by, 'approved', 'return', '#' || lpad(v_return_id::text,4,'0'),
             jsonb_build_object('total', v_total, 'conditions', v_conditions), v_processed
      FROM profiles p WHERE p.name = v_processed_by;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 10. Refunds — 6 total: 1 Pending, 4 Approved, 1 Rejected
-- ============================================================
DO $$
DECLARE
  rec RECORD;
  v_statuses text[] := ARRAY['Pending','Approved','Approved','Approved','Approved','Rejected'];
  v_reasons text[] := ARRAY['Wrong quantity charged','Service not done','Service cancelled','Wrong quantity charged','Other','Wrong quantity charged'];
  v_submitter text[] := ARRAY['Gapuz Admin','Cashier','Cashier 2'];
  v_rejection_reason text := 'Amount claimed does not match the receipt on file.';
  v_created timestamptz;
  v_processed timestamptz;
  v_refund_id int;
  v_amount numeric;
  v_status text;
  v_submitted_by text;
  v_processed_by text;
  n int;
BEGIN
  FOR rec IN SELECT * FROM picked_for_refund ORDER BY rn LOOP
    n := rec.rn;
    v_status := v_statuses[n];
    v_submitted_by := v_submitter[1 + floor(random()*3)::int];
    v_created := rec.created_at + (0.5 + random()*6) * interval '1 day';
    IF v_created > now() THEN v_created := now() - interval '1 hour'; END IF;
    v_amount := round((0.3 + random()*0.5)::numeric * rec.total, 2);

    v_processed := NULL;
    v_processed_by := NULL;
    IF v_status IN ('Approved','Rejected') THEN
      v_processed := v_created + (0.2 + random()*1.5) * interval '1 day';
      IF v_processed > now() THEN v_processed := now(); END IF;
      v_processed_by := 'Gapuz Admin';
    END IF;

    INSERT INTO refunds (transaction_id, customer_name, reason, refund_method, total, status, processed_by,
                          subtotal, vat, notes, rejection_reason, submitted_by, created_at, processed_at)
    VALUES (rec.transaction_id,
            (SELECT customer_name FROM transactions WHERE transaction_id = rec.transaction_id),
            v_reasons[n], (CASE WHEN random() < 0.6 THEN 'Cash' ELSE 'GCash' END),
            v_amount, v_status,
            -- Real app behavior: refund approval never touches processed_by
            -- (only reject_refund overwrites it, with the rejecting admin's
            -- name) — so Pending/Approved keep the original submitter here.
            CASE WHEN v_status = 'Rejected' THEN v_processed_by ELSE v_submitted_by END,
            round(v_amount/1.12,2), round(v_amount - v_amount/1.12,2), NULL,
            CASE WHEN v_status = 'Rejected' THEN v_rejection_reason ELSE NULL END,
            v_submitted_by, v_created, v_processed)
    RETURNING refund_id INTO v_refund_id;

    INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
    SELECT p.id, v_submitted_by, 'submitted', 'refund', '#' || lpad(v_refund_id::text,4,'0'),
           jsonb_build_object('refund_id', v_refund_id, 'total', v_amount), v_created
    FROM profiles p WHERE p.name = v_submitted_by;

    IF v_status = 'Approved' THEN
      INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
      SELECT p.id, v_processed_by, 'approved', 'refund', '#' || lpad(v_refund_id::text,4,'0'),
             jsonb_build_object('total', v_amount), v_processed
      FROM profiles p WHERE p.name = v_processed_by;
    ELSIF v_status = 'Rejected' THEN
      INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
      SELECT p.id, v_processed_by, 'rejected', 'refund', '#' || lpad(v_refund_id::text,4,'0'),
             jsonb_build_object('reason', v_rejection_reason,
                                 'customerName', (SELECT customer_name FROM transactions WHERE transaction_id = rec.transaction_id), 'total', v_amount),
             v_processed
      FROM profiles p WHERE p.name = v_processed_by;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 11. Loyalty reversal pass — mirrors revertPurchase / approve_return's
--     exact formula for every Approved money-back refund/return against
--     a customer-linked transaction. Safe because each transaction in
--     this seed has at most one such event (step 8 guaranteed no overlap).
-- ============================================================
UPDATE customers c SET
  points = GREATEST(0, c.points - sub.pts_deducted),
  purchases = CASE WHEN sub.full_after THEN GREATEST(0, c.purchases - 1) ELSE c.purchases END,
  total_spent = GREATEST(0, c.total_spent - sub.amt)
FROM (
  SELECT t.customer_id, r.total AS amt, (r.total >= t.total) AS full_after,
         ((CASE WHEN r.total >= t.total THEN 10 ELSE 0 END) + floor(r.total/100))::int AS pts_deducted
  FROM refunds r JOIN transactions t ON t.transaction_id = r.transaction_id
  WHERE r.status = 'Approved' AND t.customer_id IS NOT NULL
  UNION ALL
  SELECT t.customer_id, rt.total AS amt, (rt.total >= t.total) AS full_after,
         ((CASE WHEN rt.total >= t.total THEN 10 ELSE 0 END) + floor(rt.total/100))::int AS pts_deducted
  FROM returns rt JOIN transactions t ON t.transaction_id = rt.transaction_id
  WHERE rt.status = 'Approved' AND rt.method IN ('Cash refund','GCash refund') AND t.customer_id IS NOT NULL
) sub
WHERE c.customer_id = sub.customer_id;

-- ============================================================
-- 12. Cleanup temp tables (transaction-scoped anyway, but tidy)
-- ============================================================
DROP TABLE IF EXISTS seed_customer_ids, product_weight, day_pool, cart_items, picked_for_return, picked_for_refund;

COMMIT;

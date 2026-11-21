-- Small, plain sample set: 5 real sales, then 2 Returns + 2 Refunds
-- against them, with matching activity_log entries. No test/placeholder
-- products used (hilot, sheesshhh, jbjbjhvggvkhj are all excluded).
-- Everything is explicit values, no loops or randomness, so it's easy
-- to read line by line before running.
--
-- Wrapped in one transaction: if anything fails, nothing is left
-- half-applied.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

BEGIN;

DO $$
DECLARE
  v_t1 int; v_t2 int; v_t3 int; v_t4 int; v_t5 int;
  v_item_t2 int; -- transaction_items.item_id for the STX365 Keyboard line on T2
  v_item_t4 int; -- transaction_items.item_id for the H20 Headset line on T4
  v_return1_id int;
  v_return2_id int;
  v_refund1_id int;
  v_refund2_id int;
BEGIN
  -- ============================================================
  -- 5 sample sales (real products only, no test items)
  -- ============================================================

  -- T1: AMD Ryzen 5 5500GT x1 @ 11250 — Walk-in, Cashier, Cash
  INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
  VALUES (NULL, 'Walk-in', 'Cash', 11250, 0, 1350.00, 12600.00, 12600, 'Completed', 'Cashier', now() - interval '2 days')
  RETURNING transaction_id INTO v_t1;
  INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
  VALUES (v_t1, 43, 'AMD Ryzen 5 5500GT', 1, 11250, 10500, now() - interval '2 days');
  UPDATE products SET stock = stock - 1, sold = sold + 1, last_sold_at = now() - interval '2 days' WHERE product_id = 43;

  -- T2: STX365 Keyboard Rainbow Ledlight x2 @ 480 = 960 — customer-linked, Cashier 2, GCash
  INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
  SELECT c.customer_id, c.name, 'GCash', 960, 0, 115.20, 1075.20, NULL, 'Completed', 'Cashier 2', now() - interval '1 day'
  FROM customers c WHERE c.email = 'markanthony.yap77@gmail.com'
  RETURNING transaction_id INTO v_t2;
  INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
  VALUES (v_t2, 37, 'STX365 Keyboard Rainbow Ledlight', 2, 480, 450, now() - interval '1 day')
  RETURNING item_id INTO v_item_t2;
  UPDATE products SET stock = stock - 2, sold = sold + 2, last_sold_at = now() - interval '1 day' WHERE product_id = 37;

  -- T3: INPLAY 400W Power Supply x1 @ 600 — Walk-in, Gapuz Admin, Cash
  INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
  VALUES (NULL, 'Walk-in', 'Cash', 600, 0, 72.00, 672.00, 700, 'Completed', 'Gapuz Admin', now() - interval '3 days')
  RETURNING transaction_id INTO v_t3;
  INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
  VALUES (v_t3, 51, 'INPLAY 400W Power Supply', 1, 600, 500, now() - interval '3 days');
  UPDATE products SET stock = stock - 1, sold = sold + 1, last_sold_at = now() - interval '3 days' WHERE product_id = 51;

  -- T4: H20 Headset x3 @ 320 = 960 — customer-linked, Cashier, Cash+GCash
  INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
  SELECT c.customer_id, c.name, 'Cash+GCash', 960, 0, 115.20, 1075.20, 500, 'Completed', 'Cashier', now() - interval '4 days'
  FROM customers c WHERE c.email = 'cristina.borja09@gmail.com'
  RETURNING transaction_id INTO v_t4;
  INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
  VALUES (v_t4, 28, 'H20 Headset', 3, 320, 300, now() - interval '4 days')
  RETURNING item_id INTO v_item_t4;
  UPDATE products SET stock = stock - 3, sold = sold + 3, last_sold_at = now() - interval '4 days' WHERE product_id = 28;

  -- T5: AMD RYZEN 7 5700G x1 @ 14875 — Walk-in, Cashier 2, GCash
  INSERT INTO transactions (customer_id, customer_name, payment, subtotal, disc_amt, vat, total, cash_given, status, cashier_name, created_at)
  VALUES (NULL, 'Walk-in', 'GCash', 14875, 0, 1785.00, 16660.00, NULL, 'Completed', 'Cashier 2', now() - interval '1 day')
  RETURNING transaction_id INTO v_t5;
  INSERT INTO transaction_items (transaction_id, product_id, name, qty, price, cost_price, created_at)
  VALUES (v_t5, 45, 'AMD RYZEN 7 5700G', 1, 14875, 13500, now() - interval '1 day');
  UPDATE products SET stock = stock - 1, sold = sold + 1, last_sold_at = now() - interval '1 day' WHERE product_id = 45;

  -- ============================================================
  -- Loyalty credit for the 2 customer-linked sales (T2, T4) — mirrors
  -- addPoints: +10 + floor(total/100) per completed sale.
  -- ============================================================
  UPDATE customers SET points = points + 10 + floor(1075.20/100), purchases = purchases + 1, total_spent = total_spent + 1075.20
  WHERE customer_id = (SELECT customer_id FROM transactions WHERE transaction_id = v_t2);
  UPDATE customers SET points = points + 10 + floor(1075.20/100), purchases = purchases + 1, total_spent = total_spent + 1075.20
  WHERE customer_id = (SELECT customer_id FROM transactions WHERE transaction_id = v_t4);

  -- ============================================================
  -- Return 1: Approved, 1 of the 2 keyboards from T2, Resellable
  -- ============================================================
  INSERT INTO returns (transaction_id, customer_name, reason, method, subtotal, vat, total, status,
                        processed_by, items, evidence_photos, submitted_by, conditions, created_at, processed_at)
  VALUES (v_t2, (SELECT customer_name FROM transactions WHERE transaction_id = v_t2),
          'Customer changed mind', 'GCash refund', 480, 57.60, 537.60, 'Approved',
          'Gapuz Admin',
          jsonb_build_array(jsonb_build_object('item_id', v_item_t2, 'product_id', 37, 'qty', 1, 'serials', '[]'::jsonb)),
          '[]'::jsonb, 'Cashier 2',
          jsonb_build_object('item:' || v_item_t2 || ':0', jsonb_build_object('status','Resellable')),
          now() - interval '12 hours', now() - interval '6 hours')
  RETURNING return_id INTO v_return1_id;
  UPDATE products SET stock = stock + 1 WHERE product_id = 37; -- resellable unit goes back to stock

  -- Loyalty reversal — GCash refund (money-back) on a customer-linked
  -- transaction, not a full refund (537.60 < 1075.20), mirrors
  -- approve_return: points -= floor(total/100) only, purchases untouched.
  UPDATE customers SET points = GREATEST(0, points - floor(537.60/100)), total_spent = GREATEST(0, total_spent - 537.60)
  WHERE customer_id = (SELECT customer_id FROM transactions WHERE transaction_id = v_t2);

  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Cashier 2', 'created', 'return', '#' || lpad(v_return1_id::text,4,'0'),
         jsonb_build_object('return_id', v_return1_id, 'total', 537.60), now() - interval '12 hours'
  FROM profiles WHERE name = 'Cashier 2';
  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Gapuz Admin', 'approved', 'return', '#' || lpad(v_return1_id::text,4,'0'),
         jsonb_build_object('total', 537.60), now() - interval '6 hours'
  FROM profiles WHERE name = 'Gapuz Admin';

  -- ============================================================
  -- Return 2: Rejected, 1 of the 3 headsets from T4
  -- ============================================================
  INSERT INTO returns (transaction_id, customer_name, reason, method, subtotal, vat, total, status,
                        processed_by, items, evidence_photos, rejection_reason, submitted_by, created_at, processed_at)
  VALUES (v_t4, (SELECT customer_name FROM transactions WHERE transaction_id = v_t4),
          'Defective product', 'Cash refund', 320, 38.40, 358.40, 'Rejected',
          'Gapuz Admin',
          jsonb_build_array(jsonb_build_object('item_id', v_item_t4, 'product_id', 28, 'qty', 1, 'serials', '[]'::jsonb)),
          '[]'::jsonb, 'Unit tested fine in-store, no defect found on inspection.', 'Cashier',
          now() - interval '2 days', now() - interval '1 day')
  RETURNING return_id INTO v_return2_id;

  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Cashier', 'created', 'return', '#' || lpad(v_return2_id::text,4,'0'),
         jsonb_build_object('return_id', v_return2_id, 'total', 358.40), now() - interval '2 days'
  FROM profiles WHERE name = 'Cashier';
  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Gapuz Admin', 'rejected', 'return', '#' || lpad(v_return2_id::text,4,'0'),
         jsonb_build_object('reason', 'Unit tested fine in-store, no defect found on inspection.',
                             'customerName', (SELECT customer_name FROM transactions WHERE transaction_id = v_t4), 'total', 358.40),
         now() - interval '1 day'
  FROM profiles WHERE name = 'Gapuz Admin';

  -- ============================================================
  -- Refund 1: Approved, partial amount on T1
  -- ============================================================
  INSERT INTO refunds (transaction_id, customer_name, reason, refund_method, total, status, processed_by,
                        subtotal, vat, submitted_by, created_at, processed_at)
  VALUES (v_t1, (SELECT customer_name FROM transactions WHERE transaction_id = v_t1),
          'Wrong quantity charged', 'Cash', 2000, 'Approved', 'Cashier',
          round(2000/1.12,2), round(2000-2000/1.12,2), 'Cashier',
          now() - interval '1 day', now() - interval '18 hours')
  RETURNING refund_id INTO v_refund1_id;

  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Cashier', 'submitted', 'refund', '#' || lpad(v_refund1_id::text,4,'0'),
         jsonb_build_object('refund_id', v_refund1_id, 'total', 2000), now() - interval '1 day'
  FROM profiles WHERE name = 'Cashier';
  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Gapuz Admin', 'approved', 'refund', '#' || lpad(v_refund1_id::text,4,'0'),
         jsonb_build_object('total', 2000), now() - interval '18 hours'
  FROM profiles WHERE name = 'Gapuz Admin';

  -- ============================================================
  -- Refund 2: Pending, on T5
  -- ============================================================
  INSERT INTO refunds (transaction_id, customer_name, reason, refund_method, total, status, processed_by,
                        subtotal, vat, submitted_by, created_at)
  VALUES (v_t5, (SELECT customer_name FROM transactions WHERE transaction_id = v_t5),
          'Other', 'GCash', 3000, 'Pending', 'Cashier 2',
          round(3000/1.12,2), round(3000-3000/1.12,2), 'Cashier 2',
          now() - interval '6 hours')
  RETURNING refund_id INTO v_refund2_id;

  INSERT INTO activity_log (actor_id, actor_name, action, entity_type, entity_label, details, created_at)
  SELECT id, 'Cashier 2', 'submitted', 'refund', '#' || lpad(v_refund2_id::text,4,'0'),
         jsonb_build_object('refund_id', v_refund2_id, 'total', 3000), now() - interval '6 hours'
  FROM profiles WHERE name = 'Cashier 2';
END $$;

COMMIT;

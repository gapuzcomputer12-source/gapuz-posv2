-- Clears every sales/activity record while leaving inventory (products,
-- categories) and staff login accounts (profiles) untouched.
--
-- Scope, per your answers:
--   CLEARED : transactions, transaction_items, refunds, returns, holds,
--             activity_log, customers.
--   KEPT    : products (incl. stock/price/cost), categories, profiles (staff).
--   RESET   : products.sold -> 0 and products.last_sold_at -> NULL, since
--             those two columns are derived from sales history, not actual
--             inventory, and would otherwise show stale numbers with
--             nothing behind them.
--   SERIALS : product_serials rows are NOT deleted and their `status` is
--             left exactly as-is (a "Sold" serial stays "Sold" — per your
--             choice not to put it back into available stock). Their
--             transaction_id / transaction_item_id links clear
--             automatically via ON DELETE SET NULL once the transactions
--             below are deleted, so you don't end up with serials pointing
--             at rows that no longer exist.
--
-- THIS IS IRREVERSIBLE. There is no undo once you run this — make sure
-- you actually want every sale, refund, return, hold, activity-log entry,
-- and customer gone before running it. Consider an export/backup first
-- (e.g. the Reports page's own Excel export, or a Supabase project backup)
-- if you might want this data later.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

BEGIN;

DELETE FROM transaction_items;
DELETE FROM refunds;
DELETE FROM returns;
DELETE FROM holds;
DELETE FROM activity_log;
DELETE FROM transactions;
DELETE FROM customers;

UPDATE products SET sold = 0, last_sold_at = NULL;

-- Optional: restart the id sequences so the next transaction/refund/etc.
-- starts back at #0001 instead of continuing from wherever it left off.
-- Comment this block out if you'd rather keep incrementing from the old
-- numbers (e.g. to avoid ever reusing a transaction # that appeared on a
-- printed receipt).
ALTER SEQUENCE transactions_transaction_id_seq RESTART WITH 1;
ALTER SEQUENCE transaction_items_item_id_seq RESTART WITH 1;
ALTER SEQUENCE refunds_refund_id_seq RESTART WITH 1;
ALTER SEQUENCE returns_return_id_seq RESTART WITH 1;
ALTER SEQUENCE holds_hold_id_seq RESTART WITH 1;
ALTER SEQUENCE activity_log_log_id_seq RESTART WITH 1;
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;

COMMIT;

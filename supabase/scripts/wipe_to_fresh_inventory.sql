-- Wipes ALL transactional/history data so the store looks brand new, while
-- keeping the product catalog itself (names, prices, images, categories,
-- reward tiers, etc.) and staff logins untouched.
--
-- KEPT    : products (name/price/cost/image/category/reward_tier/etc.),
--           categories, profiles / auth.users (staff logins),
--           store_settings (GCash QR, account name),
--           product_serials (rows AND status are left exactly as-is for
--           every serial-tracked product — see below for why).
-- DELETED : transactions, transaction_items, refunds, returns, holds,
--           activity_log, customers, reward_redemptions.
-- RESET   : every product's sold -> 0 and last_sold_at -> NULL ("new"),
--           and stock -> 0 for every NON-serial-tracked product.
-- NOT RESET: stock for serial-tracked products (has_serial = true) is left
--           alone, on purpose — that stock number is really just a count
--           of real product_serials rows, not an independent value you
--           can safely overwrite. Zeroing it here without also clearing
--           out product_serials would leave the two out of sync (stock
--           says 0, but "In Stock" serials would still exist underneath).
--           If you also want those reset to empty, that needs a second,
--           deliberate pass — ask for it separately; this script
--           intentionally leaves serial-tracked inventory untouched.
--
-- THIS IS IRREVERSIBLE once committed — every sale, refund, return, hold,
-- activity-log entry, customer, and reward redemption will be gone for
-- good. Export anything you might want later (Reports page -> Excel
-- export, or a full Supabase project backup) before running this.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

BEGIN;

DELETE FROM activity_log;
DELETE FROM returns;
DELETE FROM refunds;
DELETE FROM holds;
DELETE FROM reward_redemptions;
DELETE FROM transaction_items;
DELETE FROM transactions;
DELETE FROM customers;

-- "Indicate all products as new."
UPDATE products SET sold = 0, last_sold_at = NULL;

-- Stock -> 0 for everything EXCEPT serial-tracked products (see note above).
UPDATE products SET stock = 0 WHERE has_serial = false;

-- Restart id sequences so new rows start back at #1. Deliberately NOT
-- restarting products_product_id_seq / categories_category_id_seq /
-- product_serials_serial_id_seq since those tables/rows are kept —
-- restarting would make the next INSERT collide with a kept row's id.
ALTER SEQUENCE transactions_transaction_id_seq RESTART WITH 1;
ALTER SEQUENCE transaction_items_item_id_seq RESTART WITH 1;
ALTER SEQUENCE refunds_refund_id_seq RESTART WITH 1;
ALTER SEQUENCE returns_return_id_seq RESTART WITH 1;
ALTER SEQUENCE holds_hold_id_seq RESTART WITH 1;
ALTER SEQUENCE activity_log_log_id_seq RESTART WITH 1;
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;
ALTER SEQUENCE reward_redemptions_no_seq RESTART WITH 1;

COMMIT;

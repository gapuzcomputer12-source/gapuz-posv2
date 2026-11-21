-- Wipes all sample transactional/activity data before loading real demo
-- data. Keeps products, categories, staff logins (profiles/auth.users),
-- and any product_serials still physically "In Stock".
--
-- KEPT   : products (incl. stock/price/cost/settings), categories,
--          profiles / auth.users, product_serials with status 'In Stock'.
-- DELETED: activity_log, returns, refunds, holds, transaction_items,
--          transactions, customers, product_serials with status
--          'Sold' or 'Defective'.
-- RESET  : products.last_sold_at -> NULL, products.sold -> 0.
--          products.stock is NOT touched.
--
-- Evidence photos (Storage 'return-evidence' bucket) are handled
-- SEPARATELY, not by this script: Supabase runs a protective trigger
-- (storage.protect_delete()) that rejects any direct SQL DELETE on
-- storage.objects with "Direct deletion from storage tables is not
-- allowed. Use the Storage API instead." After this script, go to
-- Dashboard -> Storage -> return-evidence -> select all -> Delete.
-- That's the only path Supabase allows, and it purges the actual
-- blobs (not just metadata), so it's the more thorough option anyway.
--
-- No tables/columns/RPCs/RLS policies/triggers/views are dropped —
-- data only. Everything below runs in one transaction: if any
-- statement fails, the whole thing rolls back and nothing changes.
--
-- THIS IS IRREVERSIBLE once committed. Run reset_demo_data_counts.sql
-- before and after to confirm the before/after state.
--
-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.

BEGIN;

DELETE FROM activity_log;
DELETE FROM returns;
DELETE FROM refunds;
DELETE FROM holds;
DELETE FROM transaction_items;
DELETE FROM transactions;
DELETE FROM customers;

DELETE FROM product_serials WHERE status IN ('Sold', 'Defective');

UPDATE products SET last_sold_at = NULL, sold = 0;

-- Restart ID sequences so new rows start back at #1. Deliberately NOT
-- restarting product_serials_serial_id_seq / products_product_id_seq /
-- categories_category_id_seq since those tables keep existing rows —
-- restarting would make the next INSERT collide with a kept row's id.
ALTER SEQUENCE transactions_transaction_id_seq RESTART WITH 1;
ALTER SEQUENCE transaction_items_item_id_seq RESTART WITH 1;
ALTER SEQUENCE refunds_refund_id_seq RESTART WITH 1;
ALTER SEQUENCE returns_return_id_seq RESTART WITH 1;
ALTER SEQUENCE holds_hold_id_seq RESTART WITH 1
ALTER SEQUENCE activity_log_log_id_seq RESTART WITH 1;
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;

COMMIT;

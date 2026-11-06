-- Migration: enforce admin-only writes in RLS for actions that are
-- supposed to be admin-only in the app (product/category catalog
-- management, refund approval, marking a transaction refunded).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: the original policies used `USING (true)` / `WITH CHECK (true)`,
-- meaning ANY authenticated user (cashier or admin) could insert/update/
-- delete these rows directly via the Supabase REST API — bypassing the
-- app's "adminOnly" route guards and button checks entirely. A cashier
-- could, for example, call supabase.from('refunds').update({status:
-- 'Approved'}) from the browser console and approve their own refund.
--
-- NOT changed here: products UPDATE stays open to all authenticated
-- users, because cashiers legitimately need it to deduct stock at
-- checkout (src/store/index.js deductStock). Locking that down properly
-- means moving stock deduction into a SECURITY DEFINER RPC function
-- instead of a raw table UPDATE — a separate fix that also closes the
-- stock race-condition item on the TODO list.
--
-- NOT changed here: customers table — Customers.jsx has no admin-only
-- restriction in the UI today (any signed-in user can add/edit/delete a
-- customer), so leaving RLS open there matches the app's actual intended
-- behavior, not a bug.

-- PRODUCTS — only admins add or remove products (editing/restocking is
-- still open, since checkout needs to update stock as any signed-in user)
DROP POLICY IF EXISTS "Allow authenticated insert" ON products;
CREATE POLICY "Admins can insert products" ON products
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Allow authenticated delete" ON products;
CREATE POLICY "Admins can delete products" ON products
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- CATEGORIES — only admins manage categories
DROP POLICY IF EXISTS "Allow authenticated insert" ON categories;
CREATE POLICY "Admins can insert categories" ON categories
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Allow authenticated update" ON categories;
CREATE POLICY "Admins can update categories" ON categories
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Allow authenticated delete" ON categories;
CREATE POLICY "Admins can delete categories" ON categories
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- REFUNDS — any signed-in user can submit a refund request (INSERT stays
-- open), but only an admin can approve/reject one (UPDATE).
DROP POLICY IF EXISTS "Allow authenticated update" ON refunds;
CREATE POLICY "Admins can update refunds" ON refunds
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- TRANSACTIONS — status only changes when an admin approves a refund
-- (marks the sale Refunded/Partially Refunded), so restrict UPDATE too.
DROP POLICY IF EXISTS "Allow authenticated update" ON transactions;
CREATE POLICY "Admins can update transactions" ON transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

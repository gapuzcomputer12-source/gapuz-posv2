-- Migration: let Cashiers read their OWN activity_log entries (so the
-- Cashier's new Activity Log page has something to show), while Admins keep
-- seeing everything. Run this once in Supabase Dashboard -> SQL Editor ->
-- New query -> Run.
--
-- Why: activity_log was admin-only SELECT (add_activity_log.sql) because
-- only admins had a page for it. Cashiers are getting their own Activity
-- Log page now, scoped to "their own activities" — this has to be enforced
-- in RLS, not just hidden in the frontend, or a cashier could still read
-- everyone's log rows via the Supabase client directly.
--
-- Postgres evaluates multiple permissive SELECT policies with OR, so an
-- admin matches the first policy (sees all rows) and a cashier matches only
-- the second (sees just their own, matched by actor_id = auth.uid()) — no
-- change needed to the existing INSERT policy, and still no UPDATE/DELETE
-- policies at all, so the log stays read-only/append-only exactly as before.

DROP POLICY IF EXISTS "Admins can read activity log" ON activity_log;

CREATE POLICY "Admins can read all activity log" ON activity_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY "Users can read their own activity log" ON activity_log
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- Migration: close the last open door on the products table — "Allow
-- authenticated update" let ANY signed-in user (cashier or admin) update
-- any column on any product directly via the Supabase REST API, e.g.
-- `supabase.from('products').update({price: 0})` from the browser console.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- fix_role_based_rls.sql deliberately left this policy open, noting that
-- closing it required moving stock deduction into a SECURITY DEFINER RPC
-- first (deduct_stock ran with the CALLER's own privileges, relying on
-- this exact policy to let a cashier's checkout write stock down). This
-- migration does that, then locks the policy down for real.
--
-- Audit of every place a cashier session was touching `products` directly
-- before this migration:
--   * deductStock (checkout)      -> supabase.rpc('deduct_stock', ...)   — NOT SECURITY DEFINER until this migration; fixed below.
--   * add_serials/delete_serial    -> already SECURITY DEFINER with an explicit admin check (add_serial_tracking.sql) — unaffected.
--   * mark_serials_sold            -> already SECURITY DEFINER, writes product_serials only, never products — unaffected.
--   * approve_return                -> already SECURITY DEFINER (add_returns_table.sql) — unaffected.
--   * updateProduct/restockProduct -> plain supabase.from('products').update(...), but both are ONLY called from
--                                      Products.jsx, which is already an admin-only route (<Guard adminOnly>). A real
--                                      admin session satisfies the new policy below, so no code change is needed there.
--   * Refunds.jsx handleApprove     -> used to call restockProduct() too; removed as part of the money-only refund
--                                      redesign (see add_create_refund_rpc.sql) — refunds never touch products now.

-- deduct_stock must become SECURITY DEFINER (it still only requires the
-- caller to be signed in — any cashier can check out, not just admins —
-- same return shape as update_low_stock_range.sql, so CREATE OR REPLACE
-- is enough here, no DROP needed).
CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item   jsonb;
  v_id   int;
  v_qty  int;
  v_prev int;
  v_next int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
    out_low    := (v_prev > v_next AND v_next BETWEEN 1 AND 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

DROP POLICY IF EXISTS "Allow authenticated update" ON products;
CREATE POLICY "Admins can update products" ON products
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.active))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.active));

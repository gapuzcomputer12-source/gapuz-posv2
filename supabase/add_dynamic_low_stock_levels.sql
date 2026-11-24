-- Migration: replace the fixed "1-3 units = low stock" rule with a
-- per-product / per-category configurable threshold.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Why: slow-selling expensive items (GPUs, processors) only need a heads-up
-- at 2 units left, while fast-selling cheap items (mice, cables) need a
-- much higher alert level like 10-15, or admins miss the window to reorder
-- before actually running out. A single store-wide threshold of 3 can't
-- represent that.
--
-- What this does:
--   1. Adds a nullable `low_stock_level` column to both `categories` and
--      `products` (NULL = "use the fallback", exactly today's behavior).
--      Both get a CHECK (>= 0) so a level can never be negative.
--   2. Adds effective_low_stock_level(product_level, category) — the ONE
--      shared rule for resolving a product's actual alert threshold:
--        a. the product's own low_stock_level, if set
--        b. else its category's low_stock_level, if set
--        c. else the system default of 3 (unchanged from before)
--      The frontend's getEffectiveLowStockLevel() in src/utils/helpers.js
--      mirrors this exact rule, so the DB and UI never disagree.
--   3. Rewrites deduct_stock (the checkout RPC) to look up each product's
--      effective level and fire the "low" signal only on a genuine crossing
--      from above that level down to at-or-below it (0 still only ever
--      fires "out", never "low" — unchanged). This widens/narrows the
--      alert window per product instead of using the fixed [1,3] range.
--      The RPC's return shape gains out_level (the effective level used),
--      so existing callers must be updated to read it — this is why the
--      function has to be dropped first (Postgres won't let CREATE OR
--      REPLACE change a function's output columns).
--
-- Products/categories that never set a level keep alerting at exactly 3,
-- same as before this migration.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS low_stock_level INTEGER;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_low_stock_level_check;
ALTER TABLE categories ADD CONSTRAINT categories_low_stock_level_check CHECK (low_stock_level >= 0);

ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_level INTEGER;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_low_stock_level_check;
ALTER TABLE products ADD CONSTRAINT products_low_stock_level_check CHECK (low_stock_level >= 0);

-- ── effective_low_stock_level ──────────────────────────────────────
-- p_category is matched by name since products.category is a free-text
-- column (not a foreign key to categories.category_id) throughout this
-- schema — see categories' own comment in schema.sql.
CREATE OR REPLACE FUNCTION effective_low_stock_level(p_low_stock_level INT, p_category TEXT)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    p_low_stock_level,
    (SELECT low_stock_level FROM categories WHERE name = p_category),
    3
  )
$$;

-- ── deduct_stock ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS deduct_stock(jsonb);

CREATE OR REPLACE FUNCTION deduct_stock(items jsonb)
RETURNS TABLE (out_id int, out_stock int, out_zeroed boolean, out_low boolean, out_level int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item        jsonb;
  v_id        int;
  v_qty       int;
  v_prev      int;
  v_next      int;
  v_category  text;
  v_own_level int;
  v_level     int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    v_id  := (item->>'id')::int;
    v_qty := (item->>'qty')::int;

    SELECT stock, category, low_stock_level INTO v_prev, v_category, v_own_level
      FROM products WHERE product_id = v_id FOR UPDATE;
    IF v_prev IS NULL THEN
      CONTINUE;
    END IF;

    v_next := GREATEST(v_prev - v_qty, 0);
    v_level := effective_low_stock_level(v_own_level, v_category);

    UPDATE products SET stock = v_next, sold = sold + v_qty WHERE product_id = v_id;

    out_id     := v_id;
    out_stock  := v_next;
    out_level  := v_level;
    out_zeroed := (v_prev > 0 AND v_next = 0);
    -- Fires only on a genuine decrease that lands (or passes through) at or
    -- below this product's own effective level — never on 0 (that's
    -- out_zeroed's job), and never again while stock sits unchanged at an
    -- already-low number, so a batch sale that skips straight past several
    -- values still alerts exactly once for wherever it landed.
    out_low    := (v_prev > v_next AND v_next > 0 AND v_next <= v_level);
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock(jsonb) TO authenticated;

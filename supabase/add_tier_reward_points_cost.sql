-- Migration: tier rewards now COST points — claiming a Silver/Gold/Platinum
-- reward deducts that tier's minimum points (Silver 500, Gold 1,500,
-- Platinum 3,000 — same thresholds as src/utils/loyalty.js's TIERS, which
-- is the one place the FRONTEND reads them from; the SQL side below is the
-- one and only place they're duplicated server-side, same as the existing
-- tier-rank check already in this function does). Since points now drop
-- after a claim, a customer can fall back under a tier and legitimately
-- re-qualify for it later — so a tier's reward is no longer "once ever,"
-- it's "once per time you can afford it."
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. Remove the one-claim-per-tier restriction. Claiming again whenever
--    the customer has enough points again is now the intended behavior.
alter table reward_redemptions drop constraint if exists reward_redemptions_customer_tier_unique;

-- 2. claim_tier_reward — same "lock product then customer, validate,
--    mutate, log" shape as before, but now: deducts the tier's points
--    (never below 0), no longer checks/blocks on a prior claim, and
--    returns the customer's new points balance so the frontend can show
--    before -> after and recompute the (possibly lower) tier with the
--    existing getTier() helper — the tier itself is never stored, only
--    points are, so "the tier is recalculated from the remaining points"
--    falls out of that for free.
-- RETURNS TABLE's column list is changing (points_used, out_customer_points
-- added), so the function must be dropped first — Postgres won't let
-- CREATE OR REPLACE change a function's output columns.
drop function if exists claim_tier_reward(int, int, int);

create or replace function claim_tier_reward(
  p_customer_id int, p_product_id int, p_serial_id int default null
)
returns table (
  id uuid, redemption_no text, customer_id int, product_id int, serial_id int,
  tier text, points_used int, redeemed_by_name text, created_at timestamptz,
  out_stock int, out_zeroed boolean, out_low boolean, out_level int, out_customer_points int
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_product        products%rowtype;
  v_customer       customers%rowtype;
  v_serial         product_serials%rowtype;
  v_tier           text;
  v_tier_rank      int;
  v_customer_rank  int;
  v_cost           int;
  v_new_points     int;
  v_next_stock     int;
  v_level          int;
  v_redemption_no  text;
  v_id             uuid;
  v_actor_name     text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select name into v_actor_name from profiles where id = auth.uid();
  if not exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','cashier')) then
    raise exception 'Not authorized';
  end if;

  select * into v_product from products where product_id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_product.is_service then
    raise exception 'Services cannot be redeemed';
  end if;
  if v_product.reward_tier is null then
    raise exception 'This item is not a tier reward';
  end if;
  if v_product.stock < 1 then
    raise exception 'Out of stock';
  end if;

  v_tier := v_product.reward_tier;
  v_tier_rank := case v_tier when 'silver' then 1 when 'gold' then 2 when 'platinum' then 3 else 0 end;
  v_cost := case v_tier when 'silver' then 500 when 'gold' then 1500 when 'platinum' then 3000 else 0 end;

  if v_product.has_serial then
    if p_serial_id is null then
      raise exception 'Please select a serial number';
    end if;
    select * into v_serial from product_serials where serial_id = p_serial_id for update;
    if not found then
      raise exception 'Serial not found';
    end if;
    if v_serial.product_id <> p_product_id then
      raise exception 'Serial belongs to a different product';
    end if;
    if v_serial.status <> 'In Stock' then
      raise exception 'Serial is not in stock (status: %)', v_serial.status;
    end if;
  end if;

  select * into v_customer from customers where customer_id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found';
  end if;

  v_customer_rank := case
    when v_customer.points >= 3000 then 3
    when v_customer.points >= 1500 then 2
    when v_customer.points >= 500  then 1
    else 0
  end;

  if v_customer_rank < v_tier_rank then
    raise exception 'Reach % to unlock this reward', initcap(v_tier);
  end if;
  -- Mathematically implied by the rank check above (rank thresholds and
  -- tier cost are the same numbers), but kept explicit per spec and as a
  -- defense-in-depth belt-and-suspenders check.
  if v_customer.points < v_cost then
    raise exception 'Not enough points';
  end if;

  -- Deduct the tier's cost — never below 0 (GREATEST is defensive on top
  -- of the check just above, same style as revertPurchase elsewhere).
  v_new_points := greatest(v_customer.points - v_cost, 0);
  update customers set points = v_new_points where customer_id = p_customer_id;

  -- Stock only — sold/last_sold_at are never touched (a claim is not a
  -- sale), same reasoning as before this migration.
  v_next_stock := v_product.stock - 1;
  update products set stock = v_next_stock where product_id = p_product_id;

  if v_product.has_serial then
    update product_serials set status = 'Redeemed' where serial_id = p_serial_id;
  end if;

  v_redemption_no := 'RDM-' || lpad(nextval('reward_redemptions_no_seq')::text, 4, '0');

  insert into reward_redemptions (redemption_no, customer_id, product_id, serial_id, quantity, points_used, tier, redeemed_by, redeemed_by_name)
  values (v_redemption_no, p_customer_id, p_product_id, p_serial_id, 1, v_cost, v_tier, auth.uid(), v_actor_name)
  returning reward_redemptions.id into v_id;

  insert into activity_log (actor_id, actor_name, action, entity_type, entity_label, details)
  values (auth.uid(), v_actor_name, 'claimed', 'reward', v_product.name,
          jsonb_build_object('customerName', v_customer.name, 'tier', v_tier, 'pointsUsed', v_cost, 'redemptionNo', v_redemption_no));

  v_level := effective_low_stock_level(v_product.low_stock_level, v_product.category);

  return query
    select r.id, r.redemption_no, r.customer_id, r.product_id, r.serial_id, r.tier, r.points_used, r.redeemed_by_name, r.created_at,
           v_next_stock,
           (v_product.stock > 0 and v_next_stock = 0),
           (v_product.stock > v_next_stock and v_next_stock > 0 and v_next_stock <= v_level),
           v_level,
           v_new_points
    from reward_redemptions r where r.id = v_id;
end;
$$;

grant execute on function claim_tier_reward(int, int, int) to authenticated;

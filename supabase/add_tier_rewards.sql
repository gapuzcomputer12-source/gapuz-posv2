-- Migration: points-exchange rewards -> TIER rewards.
-- Items no longer have a points price. Each tier (Silver/Gold/Platinum) has
-- its own list of free items, set by the Administrator; a customer who has
-- REACHED a tier can claim ONE free item from that tier's list, ONCE per
-- tier, for free — their points balance and tier are never touched by a
-- claim. Bronze has no reward list (it's the base tier everyone starts at).
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. COLUMN — which products are a tier reward, and for which tier. NULL
--    means "not a reward". reward_points (from the old points-exchange
--    system) is left in place, untouched, per "keep the column for now" —
--    nothing in the app reads or writes it after this migration.
alter table products add column if not exists reward_tier text;
alter table products drop constraint if exists products_reward_tier_check;
alter table products add constraint products_reward_tier_check
  check (reward_tier is null or (reward_tier in ('silver','gold','platinum') and not is_service));

-- 2. COLUMN — which tier a redemption row claimed. Nullable so every old
--    points-exchange row (there is no tier concept for those) just reads
--    NULL/"—" — see "old redemption records must still display correctly".
alter table reward_redemptions add column if not exists tier text;
alter table reward_redemptions drop constraint if exists reward_redemptions_tier_check;
alter table reward_redemptions add constraint reward_redemptions_tier_check
  check (tier is null or tier in ('silver','gold','platinum'));

-- 3. ONE CLAIM PER CUSTOMER PER TIER. Postgres never treats two NULLs as
--    equal in a UNIQUE constraint, so every old row (tier IS NULL) is
--    completely invisible to this constraint and can't collide with
--    anything — only two rows that both name the SAME real tier for the
--    SAME customer would ever conflict, which is exactly the rule we want.
alter table reward_redemptions drop constraint if exists reward_redemptions_customer_tier_unique;
alter table reward_redemptions add constraint reward_redemptions_customer_tier_unique
  unique (customer_id, tier);

-- 4. claim_tier_reward — replaces redeem_reward entirely. Same "lock
--    product then customer, validate, mutate, log" shape as redeem_reward,
--    but: no points are ever deducted, and a customer can only ever claim
--    a given tier's reward once (enforced here via an EXISTS check, which
--    is race-safe because the customer row is already locked FOR UPDATE by
--    the time it runs — a second concurrent claim attempt for the same
--    customer simply queues behind the row lock rather than racing — and
--    backed by the UNIQUE constraint above as a second line of defense).
--    Tier thresholds mirror src/utils/loyalty.js's TIERS exactly
--    (silver 500 / gold 1500 / platinum 3000).
drop function if exists redeem_reward(int, int, int, int, text);

create or replace function claim_tier_reward(
  p_customer_id int, p_product_id int, p_serial_id int default null
)
returns table (
  id uuid, redemption_no text, customer_id int, product_id int, serial_id int,
  tier text, redeemed_by_name text, created_at timestamptz,
  out_stock int, out_zeroed boolean, out_low boolean, out_level int
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

  if exists (select 1 from reward_redemptions where customer_id = p_customer_id and tier = v_tier) then
    raise exception 'Already claimed the % reward', initcap(v_tier);
  end if;

  -- Stock only — points/tier are never touched by a claim.
  v_next_stock := v_product.stock - 1;
  update products set stock = v_next_stock where product_id = p_product_id;

  if v_product.has_serial then
    update product_serials set status = 'Redeemed' where serial_id = p_serial_id;
  end if;

  v_redemption_no := 'RDM-' || lpad(nextval('reward_redemptions_no_seq')::text, 4, '0');

  insert into reward_redemptions (redemption_no, customer_id, product_id, serial_id, quantity, points_used, tier, redeemed_by, redeemed_by_name)
  values (v_redemption_no, p_customer_id, p_product_id, p_serial_id, 1, 0, v_tier, auth.uid(), v_actor_name)
  returning reward_redemptions.id into v_id;

  insert into activity_log (actor_id, actor_name, action, entity_type, entity_label, details)
  values (auth.uid(), v_actor_name, 'claimed', 'reward', v_product.name,
          jsonb_build_object('customerName', v_customer.name, 'tier', v_tier, 'redemptionNo', v_redemption_no));

  v_level := effective_low_stock_level(v_product.low_stock_level, v_product.category);

  return query
    select r.id, r.redemption_no, r.customer_id, r.product_id, r.serial_id, r.tier, r.redeemed_by_name, r.created_at,
           v_next_stock,
           (v_product.stock > 0 and v_next_stock = 0),
           (v_product.stock > v_next_stock and v_next_stock > 0 and v_next_stock <= v_level),
           v_level
    from reward_redemptions r where r.id = v_id;
end;
$$;

grant execute on function claim_tier_reward(int, int, int) to authenticated;

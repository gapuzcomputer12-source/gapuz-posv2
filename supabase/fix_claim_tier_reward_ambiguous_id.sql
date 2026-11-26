-- Fix: claim_tier_reward (add_tier_rewards.sql) failed with
-- "column reference 'id' is ambiguous" when actually claiming a reward.
--
-- Cause: RETURNS TABLE (id uuid, customer_id int, product_id int,
-- serial_id int, tier text, ...) makes PL/pgSQL declare id/customer_id/
-- product_id/serial_id/tier as plain variables, visible through the whole
-- function body — colliding with the real table columns of the same name
-- (profiles.id, products.product_id, customers.customer_id,
-- product_serials.serial_id, reward_redemptions.tier). The very first hit
-- was `select name into v_actor_name from profiles where id = auth.uid();`.
--
-- Fix: add `#variable_conflict use_column` as the first line of the
-- function body — tells PL/pgSQL to prefer the table column whenever a
-- bare name is ambiguous, which is the correct resolution at every one of
-- those spots. Nothing else changes.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.
-- (add_tier_rewards.sql in this repo has also been corrected with the same
-- fix, so a fresh install won't hit this.)

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

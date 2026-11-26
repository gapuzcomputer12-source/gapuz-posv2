-- Migration: loyalty points -> free item exchange (rewards).
-- Not a discount — prices/VAT/normal sales are untouched. A redemption
-- never writes a transactions row, so it can never show up in sales
-- totals, VAT, Top/Least Selling, Slow-Moving, or Restock Recommendations
-- (all of those are computed from transactions/transaction_items — see
-- Reports.jsx — not from products.sold). redeem_reward below deducts
-- products.stock directly and deliberately leaves products.sold and
-- products.last_sold_at untouched, for that exact reason.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create extension if not exists pgcrypto;

-- 1. COLUMN — which products can be redeemed, and for how many points.
--    NULL (the default) means "not a reward". The CHECK also enforces
--    "services cannot be rewards" at the DB level, not just in the UI.
alter table products add column if not exists reward_points integer;
alter table products drop constraint if exists products_reward_points_check;
alter table products add constraint products_reward_points_check
  check (reward_points is null or (reward_points > 0 and not is_service));

-- 2. STATUS — a redeemed serial is neither back in stock nor part of a
--    sale, so it gets its own status alongside the existing three.
alter table product_serials drop constraint if exists product_serials_status_check;
alter table product_serials add constraint product_serials_status_check
  check (status in ('In Stock','Sold','Defective','Redeemed'));

-- 3. REWARD_REDEMPTIONS — append-only audit trail, one row per exchange.
--    redeemed_by_name is a denormalized snapshot (same reasoning as
--    transactions.cashier_name / refunds.processed_by elsewhere in this
--    schema) so Reports' "Staff" column keeps working even if the staff
--    account is later deleted.
create table if not exists reward_redemptions (
  id              uuid primary key default gen_random_uuid(),
  redemption_no   text not null unique,
  customer_id     integer references customers(customer_id) on delete set null,
  product_id      integer references products(product_id) on delete set null,
  serial_id       integer references product_serials(serial_id) on delete set null,
  quantity        integer not null default 1 check (quantity > 0),
  points_used     integer not null check (points_used >= 0),
  redeemed_by     uuid references auth.users(id) on delete set null,
  redeemed_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_reward_redemptions_created_at on reward_redemptions(created_at);
create index if not exists idx_reward_redemptions_customer    on reward_redemptions(customer_id);

create sequence if not exists reward_redemptions_no_seq;

alter table reward_redemptions enable row level security;

drop policy if exists "Staff can read reward redemptions" on reward_redemptions;
create policy "Staff can read reward redemptions" on reward_redemptions
  for select to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','cashier')));

-- Deliberately NO insert/update/delete policy — rows are written only by
-- redeem_reward below (SECURITY DEFINER, bypasses RLS), matching the
-- product_serials pattern elsewhere in this schema: a raw
-- supabase.from('reward_redemptions') call from the client can never
-- write, only the validated RPC can.

-- 4. redeem_reward — the one atomic path to exchange points for an item.
--    Locks the product row, then the customer row (FOR UPDATE), in that
--    order, before validating anything — mirrors create_return/create_refund's
--    own "lock first, validate against the locked row" shape elsewhere in
--    this schema. Any RAISE EXCEPTION rolls back everything (points, stock,
--    serial status) since this all runs inside the caller's transaction.
create or replace function redeem_reward(
  p_customer_id int, p_product_id int, p_serial_id int default null, p_quantity int default 1,
  p_redeemed_by_name text default 'Staff'
)
returns table (
  id uuid, redemption_no text, customer_id int, product_id int, serial_id int,
  quantity int, points_used int, redeemed_by_name text, created_at timestamptz,
  out_stock int, out_zeroed boolean, out_low boolean, out_level int, out_customer_points int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product        products%rowtype;
  v_customer       customers%rowtype;
  v_serial         product_serials%rowtype;
  v_points_needed  int;
  v_next_stock     int;
  v_level          int;
  v_redemption_no  text;
  v_id             uuid;
  v_new_points     int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('admin','cashier')) then
    raise exception 'Not authorized';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be at least 1';
  end if;

  select * into v_product from products where product_id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_product.is_service then
    raise exception 'Services cannot be redeemed';
  end if;
  if v_product.reward_points is null then
    raise exception 'This item cannot be exchanged for points';
  end if;
  if v_product.stock < p_quantity then
    raise exception 'Out of stock';
  end if;

  if v_product.has_serial then
    if p_quantity <> 1 then
      raise exception 'Serial-tracked rewards can only be redeemed one at a time';
    end if;
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

  v_points_needed := v_product.reward_points * p_quantity;
  if v_customer.points < v_points_needed then
    raise exception 'Not enough points';
  end if;

  -- Points can never go below 0 — GREATEST is defensive on top of the
  -- check just above, same belt-and-suspenders style as revertPurchase.
  update customers set points = greatest(points - v_points_needed, 0) where customer_id = p_customer_id
    returning points into v_new_points;

  -- Stock only — NOT sold, NOT last_sold_at. A redemption is not a sale
  -- (see the migration-level comment at the top of this file).
  v_next_stock := v_product.stock - p_quantity;
  update products set stock = v_next_stock where product_id = p_product_id;

  if v_product.has_serial then
    update product_serials set status = 'Redeemed' where serial_id = p_serial_id;
  end if;

  v_redemption_no := 'RDM-' || lpad(nextval('reward_redemptions_no_seq')::text, 4, '0');

  insert into reward_redemptions (redemption_no, customer_id, product_id, serial_id, quantity, points_used, redeemed_by, redeemed_by_name)
  values (v_redemption_no, p_customer_id, p_product_id, p_serial_id, p_quantity, v_points_needed, auth.uid(), p_redeemed_by_name)
  returning reward_redemptions.id into v_id;

  insert into activity_log (actor_id, actor_name, action, entity_type, entity_label, details)
  values (auth.uid(), p_redeemed_by_name, 'redeemed', 'reward', v_product.name,
          jsonb_build_object('customerName', v_customer.name, 'pointsUsed', v_points_needed, 'redemptionNo', v_redemption_no));

  -- Same "low"/"out" crossing rule as deduct_stock, so the frontend can
  -- feed this straight into the exact same notifyLowStock call a sale uses.
  v_level := effective_low_stock_level(v_product.low_stock_level, v_product.category);

  return query
    select r.id, r.redemption_no, r.customer_id, r.product_id, r.serial_id, r.quantity, r.points_used, r.redeemed_by_name, r.created_at,
           v_next_stock,
           (v_product.stock > 0 and v_next_stock = 0),
           (v_product.stock > v_next_stock and v_next_stock > 0 and v_next_stock <= v_level),
           v_level,
           v_new_points
    from reward_redemptions r where r.id = v_id;
end;
$$;

grant execute on function redeem_reward(int, int, int, int, text) to authenticated;

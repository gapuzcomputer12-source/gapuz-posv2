-- Fix: "column reference 'transaction_id' is ambiguous" when calling
-- get_transaction_settlement(). Same root cause as
-- fix_claim_tier_reward_ambiguous_id.sql: the function's `returns
-- table(transaction_id int, ..., status text, ...)` output columns become
-- PL/pgSQL variables that collide with the real transactions.transaction_id
-- / returns.status / refunds.status columns referenced in the function
-- body. Fixed the same proven way — #variable_conflict use_column makes
-- every bare reference resolve to the table column instead.
--
-- This only needs to be run if you already ran add_transaction_settlement.sql
-- and hit the ambiguous-column error. Safe to run even if you haven't —
-- CREATE OR REPLACE with the same signature just (re)defines the function.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create or replace function get_transaction_settlement(p_transaction_id int)
returns table(
  transaction_id int,
  amount_paid numeric,
  approved_returned numeric,
  pending_returned numeric,
  approved_refunded numeric,
  pending_refunded numeric,
  remaining_refundable numeric,
  status text,
  pending_kind text,
  pending_id int,
  serial_statuses jsonb,
  item_qty_claimed jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  v_total numeric;
  v_appr_ret numeric;
  v_pend_ret numeric;
  v_appr_ref numeric;
  v_pend_ref numeric;
  v_remaining numeric;
  v_status text;
  v_pending_kind text;
  v_pending_id int;
  v_serial_statuses jsonb;
  v_item_qty jsonb;
begin
  select total into v_total from transactions where transaction_id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found';
  end if;

  select coalesce(sum(total), 0) into v_appr_ret from returns where transaction_id = p_transaction_id and status = 'Approved';
  select coalesce(sum(total), 0) into v_pend_ret from returns where transaction_id = p_transaction_id and status = 'Pending';
  select coalesce(sum(total), 0) into v_appr_ref from refunds where transaction_id = p_transaction_id and status = 'Approved';
  select coalesce(sum(total), 0) into v_pend_ref from refunds where transaction_id = p_transaction_id and status = 'Pending';

  v_remaining := greatest(0, v_total - v_appr_ret - v_appr_ref - v_pend_ret - v_pend_ref);

  select return_id into v_pending_id from returns where transaction_id = p_transaction_id and status = 'Pending' order by created_at desc limit 1;
  if v_pending_id is not null then
    v_pending_kind := 'return';
  else
    select refund_id into v_pending_id from refunds where transaction_id = p_transaction_id and status = 'Pending' order by created_at desc limit 1;
    if v_pending_id is not null then v_pending_kind := 'refund'; end if;
  end if;

  if v_pending_kind is not null then
    v_status := 'pending';
  elsif v_remaining <= 0 then
    v_status := 'settled';
  elsif v_appr_ret > 0 or v_appr_ref > 0 then
    v_status := 'partial';
  else
    v_status := 'available';
  end if;

  -- Per-serial status: one row per serial referenced by any Pending/
  -- Approved return on this transaction (a serial absent here is still
  -- Available). An Approved hit always wins over a Pending one for the
  -- same serial.
  select coalesce(jsonb_agg(jsonb_build_object('itemId', item_id, 'productId', product_id, 'serial', serial, 'status', unit_status)), '[]'::jsonb)
  into v_serial_statuses
  from (
    select item_id, product_id, serial,
           case when bool_or(rstatus = 'Approved') then 'returned' else 'pending' end as unit_status
    from (
      select (ri->>'item_id')::int as item_id, (ri->>'product_id')::int as product_id,
             s as serial, r.status as rstatus
      from returns r, jsonb_array_elements(r.items) ri, jsonb_array_elements_text(coalesce(ri->'serials', '[]'::jsonb)) s
      where r.transaction_id = p_transaction_id and r.status in ('Approved', 'Pending')
    ) raw
    group by item_id, product_id, serial
  ) grouped;

  -- Per-item quantity already claimed on non-serial lines.
  select coalesce(jsonb_agg(jsonb_build_object('itemId', item_id, 'productId', product_id, 'returnedQty', coalesce(returned_qty,0), 'pendingQty', coalesce(pending_qty,0))), '[]'::jsonb)
  into v_item_qty
  from (
    select item_id, product_id,
           sum(qty) filter (where rstatus = 'Approved') as returned_qty,
           sum(qty) filter (where rstatus = 'Pending')  as pending_qty
    from (
      select (ri->>'item_id')::int as item_id, (ri->>'product_id')::int as product_id,
             coalesce((ri->>'qty')::int, 0) as qty, r.status as rstatus
      from returns r, jsonb_array_elements(r.items) ri
      where r.transaction_id = p_transaction_id and r.status in ('Approved', 'Pending')
        and jsonb_array_length(coalesce(ri->'serials', '[]'::jsonb)) = 0
    ) raw
    group by item_id, product_id
  ) grouped;

  return query select p_transaction_id, v_total, v_appr_ret, v_pend_ret, v_appr_ref, v_pend_ref, v_remaining, v_status, v_pending_kind, v_pending_id, v_serial_statuses, v_item_qty;
end;
$$;

grant execute on function get_transaction_settlement(int) to authenticated;

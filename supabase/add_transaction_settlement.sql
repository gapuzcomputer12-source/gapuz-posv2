-- Migration: single source of truth for "how much of this transaction is
-- still available to return/refund" — fixes the Return/Refund pages' badge
-- vs. clickable-state mismatch (see chat for the full bug report + root
-- cause writeup). Replaces three separate, drifting client-side
-- computations (SaleLookup.jsx's isFullyRefunded/isFullyReturned/
-- isFullyClaimed/getStatusPill, and the ad hoc checks inside Returns.jsx/
-- Refunds.jsx's handleLookup) with ONE function, also called from inside
-- create_return/create_refund themselves so the server enforces exactly
-- what the UI shows — for walk-in and registered sales alike, since
-- everything here keys off transaction_id only, never customer_id.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- ── get_transaction_settlement ──────────────────────────────────────
-- Status rules (Approved AND Pending requests count; Rejected never does):
--   'pending'   — a Pending return or refund already exists on this txn.
--                 Outranks everything else: no new request can be filed
--                 until that one is decided, so nothing else matters yet.
--   'settled'   — nothing left: amount_paid - every Approved/Pending
--                 return's total (ANY method — a Replacement return still
--                 fully claims the item, it just doesn't move cash, see
--                 isMoneyBack in salesMetrics.js for why that distinction
--                 matters for REVENUE reporting but not for this) minus
--                 every Approved/Pending refund's total <= 0.
--   'partial'   — some Approved return/refund already exists, but there's
--                 still remaining_refundable left.
--   'available' — nothing filed against this transaction yet.
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

-- ── create_refund ────────────────────────────────────────────────────
-- Now locks the transaction row (SELECT ... FOR UPDATE) before reading its
-- settlement, so two simultaneous submissions against the same sale can't
-- both read "remaining = X" and both insert — the second call blocks until
-- the first's INSERT actually commits, then re-reads fresh numbers.
create or replace function create_refund(
  p_transaction_id int, p_amount numeric, p_reason text, p_method text, p_notes text,
  p_client_request_id uuid default null, p_notify_email text default null, p_gcash_reference text default null)
returns table(id int, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx         transactions%rowtype;
  v_settlement record;
  v_name       text;
  v_id         int;
  v_existing   int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_client_request_id is not null then
    select refund_id into v_existing from refunds where client_request_id = p_client_request_id;
    if found then
      return query select v_existing, false;
      return;
    end if;
  end if;

  if p_notify_email is null or trim(p_notify_email) = '' or p_notify_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'A valid customer email is required to submit this request';
  end if;

  if p_method = 'GCash' and (p_gcash_reference is null or p_gcash_reference !~ '^\d{13}$') then
    raise exception 'A valid 13-digit GCash reference number is required for a GCash refund';
  end if;

  select * into v_tx from transactions where transaction_id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction not found';
  end if;

  if now() > v_tx.created_at + interval '7 days' then
    raise exception 'Refund period expired: refunds can only be requested within 7 days of purchase';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero';
  end if;

  if exists (
    select 1 from refunds
    where transaction_id = p_transaction_id and status = 'Pending'
      and total = p_amount and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'A matching refund request was just submitted for this transaction — please wait a moment before retrying';
  end if;

  select * into v_settlement from get_transaction_settlement(p_transaction_id);
  if v_settlement.status = 'pending' then
    raise exception 'This transaction already has a pending request awaiting a decision';
  end if;
  if v_settlement.status = 'settled' then
    raise exception 'This transaction has already been fully settled — nothing left to refund';
  end if;
  if p_amount > v_settlement.remaining_refundable then
    raise exception 'Refund amount exceeds what is left to refund on this transaction';
  end if;

  select name into v_name from profiles where profiles.id = auth.uid();

  begin
    insert into refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by, submitted_by, client_request_id, notify_email, gcash_reference)
    values (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name, v_name, p_client_request_id, lower(trim(p_notify_email)), p_gcash_reference)
    returning refund_id into v_id;
  exception when unique_violation then
    select refund_id into v_id from refunds where client_request_id = p_client_request_id;
    return query select v_id, false;
    return;
  end;

  return query select v_id, true;
end;
$$;

-- ── create_return ────────────────────────────────────────────────────
-- Same row-lock + settlement gate added up front; the existing per-item
-- and per-serial checks below it are unchanged (and still the authority
-- on exactly which units are being requested within whatever's left).
create or replace function create_return(
  p_transaction_id int, p_items jsonb, p_reason text, p_method text, p_notes text,
  p_subtotal numeric, p_vat numeric, p_total numeric, p_evidence_photos jsonb default '[]'::jsonb,
  p_client_request_id uuid default null, p_notify_email text default null)
returns table(id int, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx      transactions%rowtype;
  v_settlement record;
  v_id      int;
  it        jsonb;
  s         text;
  v_item_id int;
  v_prod_id int;
  v_sold_qty int;
  v_req_qty  int;
  v_already_returned int;
  v_name     text;
  v_existing int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_client_request_id is not null then
    select return_id into v_existing from returns where client_request_id = p_client_request_id;
    if found then
      return query select v_existing, false;
      return;
    end if;
  end if;

  if p_notify_email is null or trim(p_notify_email) = '' or p_notify_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'A valid customer email is required to submit this request';
  end if;

  select * into v_tx from transactions where transaction_id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction not found';
  end if;
  if now() > v_tx.created_at + interval '7 days' then
    raise exception 'Return period expired: items can only be returned within 7 days of purchase';
  end if;

  select * into v_settlement from get_transaction_settlement(p_transaction_id);
  if v_settlement.status = 'pending' then
    raise exception 'This transaction already has a pending request awaiting a decision';
  end if;
  if v_settlement.status = 'settled' then
    raise exception 'This transaction has already been fully settled — nothing left to return';
  end if;

  if p_method in ('Cash refund', 'GCash refund') then
    if p_total > v_settlement.remaining_refundable then
      raise exception 'This return would exceed what remains to be paid back on this transaction';
    end if;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_item_id := (it->>'item_id')::int;
    v_prod_id := (it->>'product_id')::int;

    select qty into v_sold_qty from transaction_items
      where item_id = v_item_id and transaction_id = p_transaction_id;
    if not found then
      raise exception 'Item % was not part of this transaction', v_item_id;
    end if;

    if jsonb_array_length(coalesce(it->'serials','[]'::jsonb)) > 0 then
      if (select count(distinct x) from jsonb_array_elements_text(it->'serials') x) <> jsonb_array_length(it->'serials') then
        raise exception 'Duplicate serial in return request for item %', v_item_id;
      end if;
      for s in select jsonb_array_elements_text(it->'serials') loop
        if not exists (
          select 1 from product_serials
          where serial_number = s and transaction_id = p_transaction_id and status = 'Sold'
        ) then
          raise exception 'Serial % was not sold in this transaction or was already returned', s;
        end if;
        if exists (
          select 1 from returns r,
            jsonb_array_elements(r.items) ri,
            jsonb_array_elements_text(coalesce(ri->'serials','[]'::jsonb)) rs
          where r.status = 'Pending' and rs = s
        ) then
          raise exception 'Serial % already has a pending return', s;
        end if;
      end loop;
    else
      v_req_qty := coalesce((it->>'qty')::int, 0);
      select coalesce(sum((ri->>'qty')::int), 0) into v_already_returned
        from returns r, jsonb_array_elements(r.items) ri
        where r.status in ('Pending','Approved')
          and (ri->>'item_id')::int = v_item_id
          and jsonb_array_length(coalesce(ri->'serials','[]'::jsonb)) = 0;
      if v_req_qty <= 0 or v_req_qty > (v_sold_qty - v_already_returned) then
        raise exception 'Return quantity for item % exceeds what is left to return', v_item_id;
      end if;
    end if;
  end loop;

  select name into v_name from profiles where profiles.id = auth.uid();

  begin
    insert into returns(transaction_id, customer_name, reason, method, notes,
                        subtotal, vat, total, items, status, evidence_photos, submitted_by, client_request_id, notify_email)
    values (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
            p_subtotal, p_vat, p_total, p_items, 'Pending', coalesce(p_evidence_photos, '[]'::jsonb), v_name, p_client_request_id, lower(trim(p_notify_email)))
    returning return_id into v_id;
  exception when unique_violation then
    select return_id into v_id from returns where client_request_id = p_client_request_id;
    return query select v_id, false;
    return;
  end;

  return query select v_id, true;
end;
$$;

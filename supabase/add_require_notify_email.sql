-- Migration: require a valid notify_email on every NEW return/refund
-- request. Enforced inside create_refund / create_return themselves, NOT
-- a table-level CHECK constraint — a CHECK would also run on every future
-- UPDATE to an OLD row (approve_return/reject_return/updateRefund/
-- reject_refund all UPDATE the row to change its status), and every old
-- request submitted before this feature existed has notify_email = NULL.
-- A blanket "must be present" CHECK would then block approving/rejecting
-- those old requests forever (violates "old requests ... must still be
-- approvable/rejectable"). Scoping the check to the INSERT path (these two
-- functions are the ONLY way a row is ever inserted — RLS blocks a raw
-- insert) gets the same guarantee for new requests with none of that risk.
--
-- Neither function's signature changes, so no DROP is needed —
-- CREATE OR REPLACE is enough.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create or replace function create_refund(
  p_transaction_id int, p_amount numeric, p_reason text, p_method text, p_notes text,
  p_client_request_id uuid default null, p_notify_email text default null)
returns table(id int, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx       transactions%rowtype;
  v_claimed  numeric;
  v_name     text;
  v_id       int;
  v_existing int;
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

  select * into v_tx from transactions where transaction_id = p_transaction_id;
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

  select coalesce(sum(total), 0) into v_claimed
    from refunds where transaction_id = p_transaction_id and status in ('Pending', 'Approved');
  select v_claimed + coalesce(sum(total), 0) into v_claimed
    from returns where transaction_id = p_transaction_id and status in ('Pending', 'Approved')
      and method in ('Cash refund', 'GCash refund');

  if p_amount > (v_tx.total - v_claimed) then
    raise exception 'Refund amount exceeds what is left to refund on this transaction';
  end if;

  select name into v_name from profiles where profiles.id = auth.uid();

  begin
    insert into refunds(transaction_id, customer_name, reason, refund_method, notes, total, status, processed_by, submitted_by, client_request_id, notify_email)
    values (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes, p_amount, 'Pending', v_name, v_name, p_client_request_id, lower(trim(p_notify_email)))
    returning refund_id into v_id;
  exception when unique_violation then
    select refund_id into v_id from refunds where client_request_id = p_client_request_id;
    return query select v_id, false;
    return;
  end;

  return query select v_id, true;
end;
$$;

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
  v_id      int;
  it        jsonb;
  s         text;
  v_item_id int;
  v_prod_id int;
  v_sold_qty int;
  v_req_qty  int;
  v_already_returned int;
  v_claimed  numeric;
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

  select * into v_tx from transactions where transaction_id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found';
  end if;
  if now() > v_tx.created_at + interval '7 days' then
    raise exception 'Return period expired: items can only be returned within 7 days of purchase';
  end if;

  if p_method in ('Cash refund', 'GCash refund') then
    select coalesce(sum(total), 0) into v_claimed
      from refunds where transaction_id = p_transaction_id and status in ('Pending', 'Approved');
    if v_claimed + p_total > v_tx.total then
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

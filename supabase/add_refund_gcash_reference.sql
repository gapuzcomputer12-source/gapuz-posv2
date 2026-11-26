-- Migration: require a 13-digit GCash reference number on every NEW refund
-- filed with method = 'GCash' (the reference for the money sent BACK to the
-- customer — distinct from transactions.gcash_reference, which is the
-- customer's original payment reference on the sale).
--
-- Enforced inside create_refund itself, NOT a table-level CHECK — same
-- reasoning as add_require_notify_email.sql: a CHECK would also run on
-- every future UPDATE to an OLD row (updateRefund/reject_refund update the
-- row to change its status), and every GCash refund filed before this
-- feature existed has gcash_reference = NULL. Scoping the check to the
-- INSERT path (create_refund is the only way a row is ever inserted — RLS
-- blocks a raw insert) gets the same guarantee for new refunds with none of
-- that risk.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table refunds add column if not exists gcash_reference text;

create or replace function create_refund(
  p_transaction_id int, p_amount numeric, p_reason text, p_method text, p_notes text,
  p_client_request_id uuid default null, p_notify_email text default null, p_gcash_reference text default null)
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

  if p_method = 'GCash' and (p_gcash_reference is null or p_gcash_reference !~ '^\d{13}$') then
    raise exception 'A valid 13-digit GCash reference number is required for a GCash refund';
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

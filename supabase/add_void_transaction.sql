-- Migration: Void Transaction — cancel a whole sale that was a mistake, no
-- admin approval needed. A voided sale is never deleted: it stays in
-- history with status='Voided' and everything it changed is reversed.
--
-- IMPORTANT — about `status`: transactions.status ALREADY EXISTS and is
-- already used for 'Completed' / 'Refunded' / 'Partially Refunded' (see
-- Refunds.jsx's status-sync effect and Cart.jsx's checkout insert). The
-- spec for this feature asked for a NEW `status` column with a CHECK
-- constrained to only 'completed'/'voided' — that would have broken the
-- existing Refunded/Partially Refunded tracking outright, since no row
-- could ever be set to those values again. Instead this reuses the SAME
-- column (it has always been free-form text, no existing CHECK) and adds
-- 'Voided' as one more value, capitalized to match the existing
-- 'Completed'/'Refunded'/'Pending' convention. Nothing else about `status`
-- changes.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- ── 1. Columns ───────────────────────────────────────────────────────
alter table transactions add column if not exists voided_at timestamptz;
alter table transactions add column if not exists voided_by uuid references profiles(id);
alter table transactions add column if not exists void_reason text;
-- All existing rows are untouched — status stays whatever it already was
-- ('Completed'/'Refunded'/'Partially Refunded'), voided_at/by/reason stay
-- NULL until a row is actually voided.

-- ── 2. GCash unique index — now partial on NOT voided too ────────────
-- A voided sale's reference number must be reusable (the sale gets rung
-- up again correctly, possibly with the same GCash transaction if the
-- customer re-sends — or more commonly, voided before any GCash payment
-- was real, test sale, etc). Dropping and recreating rather than altering
-- in place since Postgres has no ALTER INDEX ... SET WHERE.
drop index if exists idx_transactions_gcash_reference;
create unique index idx_transactions_gcash_reference
  on transactions(gcash_reference)
  where gcash_reference is not null and status <> 'Voided';

-- ── 3. void_transaction ──────────────────────────────────────────────
-- Admin: any sale from today (Asia/Manila date). Cashier: only their own
-- sale (cashier_id, falling back to cashier_name for pre-migration rows),
-- within 15 minutes of the sale. Refuses if already voided or if ANY
-- return/refund (pending or approved) exists — reuses
-- get_transaction_settlement's own aggregation so "has a request" is
-- never computed two different ways. All of it in one DB transaction:
-- mark voided, restock, un-sell serials, reverse loyalty stats, log it.
create or replace function void_transaction(p_txn_id int, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_name text;
  v_caller_role text;
  v_tx transactions%rowtype;
  v_settlement record;
  v_points_to_remove int;
  v_label text;
begin
  select id, name, role into v_caller_id, v_caller_name, v_caller_role from profiles where id = auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Reason is required.';
  end if;

  select * into v_tx from transactions where transaction_id = p_txn_id for update;
  if not found then
    raise exception 'Transaction not found';
  end if;

  if v_tx.status = 'Voided' then
    raise exception 'This sale is already voided.';
  end if;

  select * into v_settlement from get_transaction_settlement(p_txn_id);
  if v_settlement.status <> 'available' then
    raise exception 'This sale has a return/refund. Void is not allowed.';
  end if;

  if v_caller_role = 'admin' then
    if (v_tx.created_at at time zone 'Asia/Manila')::date <> (now() at time zone 'Asia/Manila')::date then
      raise exception 'Only today''s sales can be voided. Use Return/Refund instead.';
    end if;
  else
    if not (
      (v_tx.cashier_id is not null and v_tx.cashier_id = v_caller_id)
      or (v_tx.cashier_id is null and v_tx.cashier_name = v_caller_name)
    ) then
      raise exception 'You can only void your own sales.';
    end if;
    if now() - v_tx.created_at > interval '15 minutes' then
      raise exception 'Void time limit passed (15 minutes). Please ask the admin.';
    end if;
  end if;

  -- a. Mark voided.
  update transactions set status = 'Voided', voided_at = now(), voided_by = v_caller_id, void_reason = p_reason
    where transaction_id = p_txn_id;

  -- b. Return stock + undo the `sold` counter (exact inverse of
  -- deduct_stock, which this same checkout flow calls at sale time).
  update products pr set stock = pr.stock + ti.qty, sold = greatest(0, pr.sold - ti.qty)
    from transaction_items ti
    where ti.transaction_id = p_txn_id and pr.product_id = ti.product_id;

  -- c. Any serial sold on this transaction goes back to 'In Stock' (the
  -- exact inverse of mark_serials_sold's 'In Stock' -> 'Sold' transition —
  -- product_serials.status only allows 'In Stock'/'Sold'/'Defective').
  update product_serials set status = 'In Stock'
    where transaction_id = p_txn_id and status = 'Sold';

  -- d. Reverse the loyalty stats addPoints credited at sale time — same
  -- formula, treated as a full reversal of this one sale (a void always
  -- undoes the whole thing, never partial), never below 0. Tier is never
  -- stored, so it updates automatically from the new points value.
  if v_tx.customer_id is not null then
    v_points_to_remove := 10 + floor(v_tx.total / 100);
    update customers set
      points = greatest(0, points - v_points_to_remove),
      purchases = greatest(0, purchases - 1),
      total_spent = greatest(0, total_spent - v_tx.total)
    where customer_id = v_tx.customer_id;
  end if;

  -- e. Activity log — `details.reason` renders as "Reason: <reason>" via
  -- ActivityLog.jsx's existing generic detailsText case, no UI change
  -- needed there for the reason line itself.
  v_label := '#' || lpad(p_txn_id::text, 4, '0');
  insert into activity_log(actor_id, actor_name, action, entity_type, entity_label, details)
  values (
    v_caller_id, coalesce(v_caller_name, 'Unknown'), 'voided', 'sale', v_label,
    jsonb_build_object('total', v_tx.total, 'role', v_caller_role, 'reason', p_reason)
  );
end;
$$;

grant execute on function void_transaction(int, text) to authenticated;

-- ── 4. get_transaction_details — add void fields ──────────────────────
-- Same function as add_transaction_details.sql, with status/voidedAt/
-- voidedByName/voidReason/isSameDayManila added to the returned jsonb so
-- the modal can render the VOIDED banner and decide the Void button's
-- enabled state without a second round trip.
create or replace function get_transaction_details(p_transaction_id int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_name text;
  v_caller_role text;
  v_tx record;
  v_customer jsonb;
  v_items jsonb;
  v_settlement record;
  v_requests jsonb;
  v_request_labels text[];
  v_activity jsonb;
  v_points_earned int;
  v_points_reversed int;
  v_sale_label text;
  v_voided_by_name text;
  v_is_today_manila boolean;
begin
  select id, name, role into v_caller_id, v_caller_name, v_caller_role from profiles where id = auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_tx from transactions where transaction_id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found';
  end if;

  if v_caller_role is distinct from 'admin' then
    if not (
      (v_tx.cashier_id is not null and v_tx.cashier_id = v_caller_id)
      or (v_tx.cashier_id is null and v_tx.cashier_name = v_caller_name)
    ) then
      raise exception 'Not authorized to view this transaction';
    end if;
  end if;

  v_sale_label := '#' || lpad(p_transaction_id::text, 4, '0');
  v_is_today_manila := (v_tx.created_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date;

  if v_tx.voided_by is not null then
    select name into v_voided_by_name from profiles where id = v_tx.voided_by;
  end if;

  if v_tx.customer_id is not null then
    select jsonb_build_object('id', customer_id, 'name', name, 'email', email, 'phone', phone, 'points', points)
      into v_customer from customers where customer_id = v_tx.customer_id;
  end if;

  select * into v_settlement from get_transaction_settlement(p_transaction_id);

  with serial_claims as (
    select distinct on (s)
      s as serial, r.return_id, r.status as rstatus
    from returns r, jsonb_array_elements(r.items) ri, jsonb_array_elements_text(coalesce(ri->'serials', '[]'::jsonb)) s
    where r.transaction_id = p_transaction_id and r.status in ('Approved', 'Pending')
    order by s, (r.status = 'Approved') desc, r.created_at desc
  ),
  item_claims as (
    select (ri->>'item_id')::int as item_id,
           sum((ri->>'qty')::int) filter (where r.status = 'Approved') as returned_qty,
           sum((ri->>'qty')::int) filter (where r.status = 'Pending')  as pending_qty,
           max(r.return_id) filter (where r.status = 'Pending')  as pending_request_id,
           max(r.return_id) filter (where r.status = 'Approved') as approved_request_id
    from returns r, jsonb_array_elements(r.items) ri
    where r.transaction_id = p_transaction_id and r.status in ('Approved', 'Pending')
      and jsonb_array_length(coalesce(ri->'serials', '[]'::jsonb)) = 0
    group by (ri->>'item_id')::int
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', ti.item_id, 'productId', ti.product_id, 'name', ti.name, 'price', ti.price, 'qty', ti.qty,
    'category', p.category, 'image', p.image, 'icon', p.icon, 'hasSerial', coalesce(p.has_serial, false),
    'serials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'serialNumber', ps.serial_number,
        'status', case when sc.rstatus = 'Approved' then 'Returned' when sc.rstatus = 'Pending' then 'Pending return' else 'Sold' end,
        'requestId', sc.return_id
      ) order by ps.serial_number)
      from product_serials ps
      left join serial_claims sc on sc.serial = ps.serial_number
      where ps.transaction_item_id = ti.item_id
    ), '[]'::jsonb),
    'returnedQty', coalesce(ic.returned_qty, 0), 'pendingQty', coalesce(ic.pending_qty, 0),
    'pendingRequestId', ic.pending_request_id, 'approvedRequestId', ic.approved_request_id
  )), '[]'::jsonb)
  into v_items
  from transaction_items ti
  left join products p on p.product_id = ti.product_id
  left join item_claims ic on ic.item_id = ti.item_id
  where ti.transaction_id = p_transaction_id;

  select coalesce(jsonb_agg(req_json order by req_created_at desc), '[]'::jsonb) into v_requests
  from (
    select jsonb_build_object('kind', 'return', 'id', return_id, 'amount', total, 'status', status, 'rejectionReason', rejection_reason, 'createdAt', created_at) as req_json, created_at as req_created_at
    from returns where transaction_id = p_transaction_id
    union all
    select jsonb_build_object('kind', 'refund', 'id', refund_id, 'amount', total, 'status', status, 'rejectionReason', rejection_reason, 'createdAt', created_at), created_at
    from refunds where transaction_id = p_transaction_id
  ) u;

  select array_agg(distinct lbl) into v_request_labels
  from (
    select '#' || lpad(return_id::text, 4, '0') as lbl from returns where transaction_id = p_transaction_id
    union all
    select '#' || lpad(refund_id::text, 4, '0') from refunds where transaction_id = p_transaction_id
  ) u;

  select coalesce(jsonb_agg(jsonb_build_object(
    'action', action, 'entityType', entity_type, 'entityLabel', entity_label,
    'actorName', actor_name, 'details', details, 'createdAt', created_at
  ) order by created_at asc), '[]'::jsonb)
  into v_activity
  from activity_log
  where (entity_type = 'sale' and entity_label = v_sale_label)
     or (entity_type in ('return', 'refund', 'email') and entity_label = any (coalesce(v_request_labels, array[]::text[])));

  v_points_earned := (case when v_tx.customer_id is not null then 10 + floor(v_tx.total / 100) else 0 end)::int;
  v_points_reversed := (case when v_tx.customer_id is not null then
      floor((coalesce(v_settlement.approved_returned, 0) + coalesce(v_settlement.approved_refunded, 0)) / 100)
      + case when v_tx.total > 0 and (coalesce(v_settlement.approved_returned, 0) + coalesce(v_settlement.approved_refunded, 0)) >= v_tx.total then 10 else 0 end
    else 0 end)::int;

  return jsonb_build_object(
    'id', v_tx.transaction_id, 'createdAt', v_tx.created_at, 'status', v_tx.status,
    'voidedAt', v_tx.voided_at, 'voidedByName', v_voided_by_name, 'voidReason', v_tx.void_reason,
    'isSameDayManila', v_is_today_manila,
    'customerId', v_tx.customer_id, 'customerName', v_tx.customer_name,
    'cashierName', v_tx.cashier_name, 'cashierId', v_tx.cashier_id,
    'payment', v_tx.payment, 'subtotal', v_tx.subtotal, 'vat', v_tx.vat, 'total', v_tx.total,
    'cashGiven', v_tx.cash_given, 'gcashReference', v_tx.gcash_reference,
    'customer', v_customer, 'items', v_items,
    'settlement', jsonb_build_object(
      'status', v_settlement.status,
      'approvedReturned', v_settlement.approved_returned, 'pendingReturned', v_settlement.pending_returned,
      'approvedRefunded', v_settlement.approved_refunded, 'pendingRefunded', v_settlement.pending_refunded,
      'remainingRefundable', v_settlement.remaining_refundable
    ),
    'requests', v_requests, 'activity', v_activity,
    'pointsEarned', v_points_earned, 'pointsReversed', v_points_reversed,
    'callerRole', v_caller_role
  );
end;
$$;

grant execute on function get_transaction_details(int) to authenticated;

-- ── 5. Block Return/Refund on a voided sale ───────────────────────────
-- Same functions as add_transaction_settlement.sql, with one check added
-- right after the row lock; everything else is unchanged.
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

  if v_tx.status = 'Voided' then
    raise exception 'This sale was voided and cannot be refunded';
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

  if v_tx.status = 'Voided' then
    raise exception 'This sale was voided and cannot be returned';
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

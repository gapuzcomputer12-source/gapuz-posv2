-- Migration: Transaction Details — adds a real identity link from a sale to
-- the cashier who made it, and a single gated function that assembles
-- everything the new TransactionDetailsModal needs in one call.
--
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- ── 1. cashier_id ────────────────────────────────────────────────────
-- cashier_name has always been a free-text column (no FK to a user), which
-- is why the cashier dashboard's "my transactions" was only ever a
-- client-side name match. This adds a real identity link, used going
-- forward by the trigger below and consulted first by
-- get_transaction_details (falling back to the old name match only for
-- rows that predate this column).
alter table transactions add column if not exists cashier_id uuid references profiles(id) on delete set null;

-- Best-effort backfill for existing rows — exact name match only; stays
-- NULL (handled by the name-match fallback everywhere else) if none found,
-- including when a name collision would make the match ambiguous.
update transactions t
set cashier_id = p.id
from profiles p
where t.cashier_id is null and p.name = t.cashier_name;

-- Auto-fills cashier_id on every future INSERT, so no checkout/client code
-- needs to change — auth.uid() reflects the actual signed-in user making
-- the request, same as every other RLS/auth.uid() check in this schema.
create or replace function set_transaction_cashier_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cashier_id is null then
    new.cashier_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_transaction_cashier_id on transactions;
create trigger trg_set_transaction_cashier_id
before insert on transactions
for each row execute function set_transaction_cashier_id();

-- ── 2. get_transaction_details ──────────────────────────────────────
-- Single gated entry point for the Transaction Details modal — everything
-- else (transaction_items, product_serials, customers, returns, refunds)
-- is readable by any authenticated user via existing "USING (true)"
-- policies, but activity_log is admin-only, so this function is what
-- actually decides who gets to see a given transaction's full detail at
-- all, and callers must go through it rather than querying those tables
-- directly for this feature. Admin: any transaction. Cashier: only their
-- own (by cashier_id, falling back to cashier_name for pre-migration
-- rows) — raises otherwise.
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

  if v_tx.customer_id is not null then
    select jsonb_build_object('id', customer_id, 'name', name, 'email', email, 'phone', phone, 'points', points)
      into v_customer from customers where customer_id = v_tx.customer_id;
  end if;

  select * into v_settlement from get_transaction_settlement(p_transaction_id);

  -- Items + serials with per-serial return/pending status and WHICH
  -- request claimed it (Approved beats Pending for the same serial; most
  -- recent wins a tie) — the one piece get_transaction_settlement doesn't
  -- carry (it only needs aggregate counts, this modal needs the request #).
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

  -- Returns/refunds filed against this transaction — newest first.
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

  -- Timeline: the sale itself, plus every return/refund (and their
  -- decision/notification emails) filed against it — matched the exact
  -- same way the rest of the app already matches activity_log rows, by
  -- entity_type + the zero-padded #id label.
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
    'id', v_tx.transaction_id, 'createdAt', v_tx.created_at,
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

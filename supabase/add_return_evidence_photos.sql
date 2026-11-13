-- Migration: evidence photos for Returns. A cashier can attach up to 5
-- photos (compressed client-side — see src/utils/compressImage.js) when
-- submitting a return; an admin reviews them in ReturnDetailsModal via
-- short-lived signed URLs. Scoped to Returns only, not Refunds — a Refund
-- is money-only with no physical item to photograph.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. STORAGE BUCKET — private. The app never requests a public URL; every
--    read goes through storage.createSignedUrls (see getEvidencePhotoUrls
--    in src/store/index.js), fetched only when a return's detail modal is
--    actually opened, not for the whole Return History list.
insert into storage.buckets (id, name, public)
values ('return-evidence', 'return-evidence', false)
on conflict (id) do nothing;

-- RLS is already enabled on storage.objects by default on every Supabase
-- project — no ALTER TABLE needed here (and the SQL Editor's role doesn't
-- own that table anyway, so it couldn't run that statement even if it were
-- needed).

drop policy if exists "Authenticated can upload return evidence" on storage.objects;
create policy "Authenticated can upload return evidence" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'return-evidence');

drop policy if exists "Authenticated can read return evidence" on storage.objects;
create policy "Authenticated can read return evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'return-evidence');

-- Needed so a cashier can remove/retake a photo they just took, before
-- the return is even submitted (photos upload to a per-session draft
-- folder as soon as they're taken, ahead of the return_id existing).
drop policy if exists "Authenticated can delete return evidence" on storage.objects;
create policy "Authenticated can delete return evidence" on storage.objects
  for delete to authenticated
  using (bucket_id = 'return-evidence');

-- 2. COLUMN — array of storage object paths, e.g.
--    ["<draft-uuid>/<timestamp>-<n>.jpg"]. Written once, at submission
--    time, by create_return below; never touched afterward.
alter table returns add column if not exists evidence_photos jsonb not null default '[]'::jsonb;

-- 3. create_return — adding a new parameter changes the function's
--    signature (arity), so the old 8-arg overload must be dropped first,
--    same reason earlier migrations in this project dropped
--    approve_return/create_return before widening their argument list.
-- Everything else below (the 7-day window, the per-product money guard,
-- the per-serial/per-qty validation) is copied verbatim, unchanged, from
-- the current create_return — only p_evidence_photos and the one new
-- INSERT column are new.
drop function if exists create_return(int, jsonb, text, text, text, numeric, numeric, numeric);

create or replace function create_return(
  p_transaction_id int, p_items jsonb, p_reason text, p_method text, p_notes text,
  p_subtotal numeric, p_vat numeric, p_total numeric, p_evidence_photos jsonb default '[]'::jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_tx      transactions%ROWTYPE;
  v_id      INT;
  it        JSONB;
  s         TEXT;
  v_item_id INT;
  v_prod_id INT;
  v_sold_qty INT;
  v_req_qty  INT;
  v_already_returned INT;
  v_claimed  NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_tx FROM transactions WHERE transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF now() > v_tx.created_at + interval '7 days' THEN
    RAISE EXCEPTION 'Return period expired: items can only be returned within 7 days of purchase';
  END IF;

  IF p_method IN ('Cash refund', 'GCash refund') THEN
    SELECT COALESCE(SUM(total), 0) INTO v_claimed
      FROM refunds WHERE transaction_id = p_transaction_id AND status IN ('Pending', 'Approved');
    IF v_claimed + p_total > v_tx.total THEN
      RAISE EXCEPTION 'This return would exceed what remains to be paid back on this transaction';
    END IF;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (it->>'item_id')::INT;
    v_prod_id := (it->>'product_id')::INT;

    SELECT qty INTO v_sold_qty FROM transaction_items
      WHERE item_id = v_item_id AND transaction_id = p_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % was not part of this transaction', v_item_id;
    END IF;

    IF jsonb_array_length(COALESCE(it->'serials','[]'::jsonb)) > 0 THEN
      IF (SELECT COUNT(DISTINCT x) FROM jsonb_array_elements_text(it->'serials') x) <> jsonb_array_length(it->'serials') THEN
        RAISE EXCEPTION 'Duplicate serial in return request for item %', v_item_id;
      END IF;
      FOR s IN SELECT jsonb_array_elements_text(it->'serials') LOOP
        IF NOT EXISTS (
          SELECT 1 FROM product_serials
          WHERE serial_number = s AND transaction_id = p_transaction_id AND status = 'Sold'
        ) THEN
          RAISE EXCEPTION 'Serial % was not sold in this transaction or was already returned', s;
        END IF;
        IF EXISTS (
          SELECT 1 FROM returns r,
            jsonb_array_elements(r.items) ri,
            jsonb_array_elements_text(COALESCE(ri->'serials','[]'::jsonb)) rs
          WHERE r.status = 'Pending' AND rs = s
        ) THEN
          RAISE EXCEPTION 'Serial % already has a pending return', s;
        END IF;
      END LOOP;
    ELSE
      v_req_qty := COALESCE((it->>'qty')::INT, 0);
      SELECT COALESCE(SUM((ri->>'qty')::INT), 0) INTO v_already_returned
        FROM returns r, jsonb_array_elements(r.items) ri
        WHERE r.status IN ('Pending','Approved')
          AND (ri->>'item_id')::INT = v_item_id
          AND jsonb_array_length(COALESCE(ri->'serials','[]'::jsonb)) = 0;
      IF v_req_qty <= 0 OR v_req_qty > (v_sold_qty - v_already_returned) THEN
        RAISE EXCEPTION 'Return quantity for item % exceeds what is left to return', v_item_id;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO returns(transaction_id, customer_name, reason, method, notes,
                      subtotal, vat, total, items, status, evidence_photos)
  VALUES (p_transaction_id, v_tx.customer_name, p_reason, p_method, p_notes,
          p_subtotal, p_vat, p_total, p_items, 'Pending', COALESCE(p_evidence_photos, '[]'::jsonb))
  RETURNING return_id INTO v_id;

  RETURN v_id;
END;
$$;

grant execute on function create_return(int, jsonb, text, text, text, numeric, numeric, numeric, jsonb) to authenticated;

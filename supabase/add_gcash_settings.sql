-- Migration: GCash reference numbers + store GCash QR settings.
-- No payment gateway involved — this only lets the cashier record proof of
-- an already-completed GCash payment (a 13-digit reference number) and
-- shows the store's own GCash QR code at checkout so the customer can scan
-- and pay. Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- 1. COLUMN — nullable; old transactions (Cash, or GCash sales made before
--    this feature existed) simply have NULL here and the UI shows "—".
alter table transactions add column if not exists gcash_reference text;

-- 2. UNIQUE INDEX — partial (WHERE gcash_reference IS NOT NULL) so any
--    number of old/Cash rows can keep NULL without colliding, but the same
--    GCash reference can never be used on two different sales.
drop index if exists idx_transactions_gcash_reference;
create unique index idx_transactions_gcash_reference
  on transactions(gcash_reference)
  where gcash_reference is not null;

-- 3. STORE_SETTINGS — single-row table (id is always 1) holding the
--    store's GCash QR + account name. Pre-seeded here so the app only ever
--    needs UPDATE, never INSERT (simpler RLS: admins can update, nobody
--    needs insert rights at all).
create table if not exists store_settings (
  id                 smallint primary key default 1 check (id = 1),
  gcash_qr_path      text,
  gcash_account_name text,
  updated_at         timestamptz default now()
);
insert into store_settings (id) values (1) on conflict (id) do nothing;

alter table store_settings enable row level security;

drop policy if exists "Authenticated can read store settings" on store_settings;
create policy "Authenticated can read store settings" on store_settings
  for select to authenticated
  using (true);

drop policy if exists "Admins can update store settings" on store_settings;
create policy "Admins can update store settings" on store_settings
  for update to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

-- 4. STORAGE BUCKET — private, same reasoning as return-evidence: the app
--    never requests a public URL, it fetches a short-lived signed URL
--    (see getStoreAssetUrl in src/store/index.js) only when actually
--    needed (checkout open, or the GCash Settings preview).
insert into storage.buckets (id, name, public)
values ('store-assets', 'store-assets', false)
on conflict (id) do nothing;

drop policy if exists "Admins can upload store assets" on storage.objects;
create policy "Admins can upload store assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-assets' and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

drop policy if exists "Authenticated can read store assets" on storage.objects;
create policy "Authenticated can read store assets" on storage.objects
  for select to authenticated
  using (bucket_id = 'store-assets');

-- Lets an admin remove the previous QR file when replacing it (a fresh
-- timestamped path is uploaded each time rather than overwriting in place,
-- so the old object needs deleting or it just becomes an orphan).
drop policy if exists "Admins can delete store assets" on storage.objects;
create policy "Admins can delete store assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-assets' and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

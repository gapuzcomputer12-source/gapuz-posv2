-- Migration: distinguish "Walk-in Customer was explicitly chosen" from
-- "no customer was chosen at all" on held orders, so restoring a hold can
-- tell the two apart. holds.customer_id alone can't do this — both cases
-- store NULL there, since Walk-in has no real customer row to reference.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

alter table holds add column if not exists customer_chosen boolean not null default false;

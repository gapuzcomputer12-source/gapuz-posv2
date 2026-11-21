# Gapuz POS — Database Data Dictionary

Stack: Supabase (Postgres) + `auth.users`/`auth` for login. Compiled 2026-11-13
from `supabase/schema.sql` **plus every migration file in `supabase/*.sql`**,
reconciled against `git log` so the version shown for every column/function is
the actual final state after all 28 files are applied in order — not just
whatever `schema.sql` currently contains on disk.

> **`schema.sql` is NOT fully up to date.** It was last edited in commit
> `afea97e` (2026-11-13 08:11). Three later migrations change things it still
> shows the old way:
> - `transaction_items.cost_price` (added 2026-11-07, `schema.sql` predates it — wait, predates its own edit; in practice `schema.sql`'s `transaction_items` CREATE TABLE still lacks the column) → **actually present** in the live DB via `add_cost_price_to_transaction_items.sql`.
> - `products.is_service`, `products.is_available`, `deduct_stock()`'s SECURITY DEFINER / service-skip / `last_sold_at` logic, and the products `UPDATE` policy lockdown → all added **after** `schema.sql`'s last edit, in commit `ccb3455` (09:43) the same day.
> - `refunds.rejection_reason`, `refunds.submitted_by`, `returns.rejection_reason`, `returns.submitted_by`, `returns.conditions`, `returns.evidence_photos` → added across several migrations, none folded back into `schema.sql`.
>
> If you ever run `schema.sql` fresh on a new project, you must also run the
> migration files afterward in the order listed in §8 to reach the schema
> documented below. This dictionary describes the **end state**, not any one
> file in isolation.

---

## 1. Tables at a glance

| Table | Purpose | Row = |
|---|---|---|
| `profiles` | Staff account (role + display name), 1:1 with `auth.users` | one login |
| `products` | Catalog — physical goods and services | one SKU |
| `categories` | Admin-managed product category list | one category |
| `product_serials` | Per-unit serial tracking for serialized products | one physical unit |
| `customers` | Loyalty customers | one customer |
| `transactions` | Completed sales | one sale |
| `transaction_items` | Line items of a sale | one line |
| `refunds` | Money-only refund requests (no item comes back) | one refund request |
| `returns` | Merchandise returns (item physically comes back) | one return request |
| `holds` | Parked carts | one parked cart |
| `activity_log` | Append-only audit trail | one staff action |

---

## 2. `profiles`

One row per `auth.users` row — attaches a name/role to a Supabase Auth login. No separate "users" table; Supabase Auth owns credentials.

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | PK | — | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | VARCHAR(100) | NOT NULL | — | display name |
| `email` | VARCHAR(100) | null | — | added by `add_email_to_profiles.sql` |
| `role` | VARCHAR(20) | NOT NULL | `'cashier'` | `CHECK (role IN ('admin','cashier'))` |
| `active` | BOOLEAN | NOT NULL | `true` | added by `add_active_to_profiles.sql` — a suspended staff account; most later RPCs check `role='admin' AND active`, a few older ones only check `role='admin'` (see §7 footnote) |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**RLS:** any authenticated user can `SELECT` all profiles. No INSERT/UPDATE/DELETE policy at all in `schema.sql` — staff management (`createStaff`/`updateStaff`/`toggleStaffStatus`/`deleteStaff` in `src/store/index.js`) goes through Supabase Admin API calls server-side, not direct table writes under RLS, so this table has no app-facing write policy on purpose.

---

## 3. `products`

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `product_id` | SERIAL | PK | — | |
| `name` | VARCHAR(150) | NOT NULL | — | |
| `category` | VARCHAR(50) | NOT NULL | — | free text, but populated from `categories.name` in the UI |
| `price` | NUMERIC(10,2) | NOT NULL | — | selling price, VAT-exclusive |
| `cost_price` | NUMERIC(10,2) | NOT NULL | `0` | |
| `stock` | INTEGER | NOT NULL | `0` | single source of truth for quantity, even for serialized products |
| `barcode` | VARCHAR(50) | null | — | |
| `icon` | VARCHAR(10) | null | — | emoji fallback shown when no `image` |
| `image` | TEXT | null | — | |
| `sold` | INTEGER | NOT NULL | `0` | lifetime units sold, incremented by `deduct_stock()` |
| `has_serial` | BOOLEAN | NOT NULL | `false` | added by `add_serial_tracking.sql` — gates the serial-number UI/validation |
| `is_service` | BOOLEAN | NOT NULL | `false` | added by `add_is_service_flag.sql`; backfilled once from `category='Services'`. Decouples "no stock to track" from the category string |
| `is_available` | BOOLEAN | NOT NULL | `true` | added by `add_service_availability_and_notes.sql` — lets a service be hidden from the POS grid/search without deleting it |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |
| `last_sold_at` | TIMESTAMPTZ | null | — | added by `add_serial_tracking.sql`'s column, but never actually written until `add_last_sold_at_tracking.sql` wired `deduct_stock()` to stamp it + backfilled it once from transaction history |

**RLS:** `SELECT` open to all authenticated. `INSERT`/`DELETE` admin-only. `UPDATE` was open to **any** authenticated user until `lockdown_products_update_rls.sql`, which replaced it with `"Admins can update products"` (`role='admin' AND active`) once `deduct_stock()` became `SECURITY DEFINER` (so cashier checkout no longer needs direct `UPDATE` rights).

**Indexes:** `idx_products_category`.

---

## 4. `categories`

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `category_id` | SERIAL | PK | — | |
| `name` | VARCHAR(50) | NOT NULL, UNIQUE | — | |
| `badge_color` | VARCHAR(20) | NOT NULL | `'badge-accent'` | CSS class name |
| `icon` | VARCHAR(30) | null | — | added by `add_category_icon.sql`; manual override for the keyword-based auto-icon matcher |
| `sort_order` | INTEGER | NOT NULL | `0` | |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**RLS:** `SELECT` open. `INSERT`/`UPDATE`/`DELETE` admin-only (`fix_role_based_rls.sql`).

---

## 5. `product_serials`

One row per physical unit of a serialized product. `products.stock` stays authoritative for quantity; this is a side-channel for *which* units make it up.

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `serial_id` | SERIAL | PK | — | |
| `product_id` | INTEGER | NOT NULL | — | `REFERENCES products ON DELETE CASCADE` |
| `serial_number` | VARCHAR(100) | NOT NULL, UNIQUE | — | globally unique across all products |
| `status` | VARCHAR(20) | NOT NULL | `'In Stock'` | `CHECK IN ('In Stock','Sold','Defective')` |
| `transaction_id` | INTEGER | null | — | `REFERENCES transactions ON DELETE SET NULL` — set when sold |
| `transaction_item_id` | INTEGER | null | — | `REFERENCES transaction_items ON DELETE SET NULL` |
| `sold_at` | TIMESTAMPTZ | null | — | |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | |

**RLS:** `SELECT` open. `INSERT`/`UPDATE`/`DELETE` admin-only as defense-in-depth — in practice all writes go through `add_serials` / `delete_serial` / `mark_serials_sold` (all `SECURITY DEFINER`), never a raw table write.

**Indexes:** `idx_product_serials_product`, `idx_product_serials_status`, `idx_product_serials_txn`.

---

## 6. `customers`

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `customer_id` | SERIAL | PK | — | |
| `name` | VARCHAR(100) | NOT NULL | — | |
| `email` | VARCHAR(100) | null | — | |
| `phone` | VARCHAR(20) | null | — | |
| `address` | TEXT | null | — | |
| `points` | INTEGER | NOT NULL | `0` | loyalty points — see formula below |
| `purchases` | INTEGER | NOT NULL | `0` | count of fully-settled purchases |
| `total_spent` | NUMERIC(10,2) | NOT NULL | `0` | |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**Loyalty tier** (derived, not stored — `getTier()` in `src/utils/helpers.js`, matching the `customer_loyalty` view): Bronze 0–499, Silver 500–1,499, Gold 1,500–2,999, Platinum 3,000+.

**Points formula** (`addPoints` in `src/store/index.js`, client-side `UPDATE`): on a completed sale, `points += 10 + floor(total/100)`, `purchases += 1`, `total_spent += total`. Reversed on a refund/return that fully settles the sale (`revertPurchase` client-side for refunds; the same formula is duplicated server-side inside `approve_return()` for a money-back return — see §7).

**RLS:** `SELECT`/`INSERT`/`UPDATE`/`DELETE` all open to any authenticated user — deliberate; `Customers.jsx` has no admin-only restriction in the UI.

---

## 7. `transactions`

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `transaction_id` | SERIAL | PK | — | |
| `customer_id` | INTEGER | null | — | `REFERENCES customers ON DELETE SET NULL` |
| `customer_name` | VARCHAR(100) | | `'Walk-in'` | denormalized snapshot at sale time |
| `payment` | VARCHAR(30) | NOT NULL | — | free text: `"Cash"`, `"GCash"`, `"Card"`, or a combo like `"Cash+GCash"` for split payments |
| `subtotal` | NUMERIC(10,2) | NOT NULL | `0` | |
| `disc_amt` | NUMERIC(10,2) | NOT NULL | `0` | |
| `vat` | NUMERIC(10,2) | NOT NULL | `0` | |
| `total` | NUMERIC(10,2) | NOT NULL | `0` | |
| `cash_given` | NUMERIC(10,2) | null | — | |
| `status` | VARCHAR(20) | NOT NULL | `'Completed'` | not DB-enforced; see §9 for the values actually used |
| `cashier_name` | VARCHAR(100) | null | — | |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**RLS:** `SELECT` open. `INSERT` open to any authenticated user (checkout). `UPDATE` admin-only (`fix_role_based_rls.sql`) — only ever used to flip `status` after a refund/return decision. No `DELETE` policy — the only deletion path is `void_failed_sale()` (§7's RPC list), a narrow rollback for a sale seconds old with no serial marked Sold against it yet.

**Indexes:** `idx_transactions_customer`, `idx_transactions_created_at`.

---

## 8. `transaction_items`

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `item_id` | SERIAL | PK | — | |
| `transaction_id` | INTEGER | NOT NULL | — | `REFERENCES transactions ON DELETE CASCADE` |
| `product_id` | INTEGER | null | — | `REFERENCES products ON DELETE SET NULL` |
| `name` | VARCHAR(150) | NOT NULL | — | snapshot of product name at sale time |
| `qty` | INTEGER | NOT NULL | `1` | |
| `price` | NUMERIC(10,2) | NOT NULL | — | snapshot selling price, VAT-exclusive |
| `cost_price` | NUMERIC(10,2) | NOT NULL | `0` | added by `add_cost_price_to_transaction_items.sql` — snapshot cost at sale time, so profit math survives a later cost-price edit on the product |
| `notes` | TEXT | null | — | added by `add_service_availability_and_notes.sql` — per-line job note for a service item, printed on the receipt |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**RLS:** `SELECT`/`INSERT` open to any authenticated user. No `UPDATE`/`DELETE` policy.

**Indexes:** `idx_transaction_items_txn`, `idx_transaction_items_prod`.

---

## 9. `refunds`

Money-only (post-redesign): a flat peso amount handed back, with **no items/qty attached** — nothing physically comes back (that's a Return instead).

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `refund_id` | SERIAL | PK | — | |
| `transaction_id` | INTEGER | null | — | `REFERENCES transactions ON DELETE SET NULL` |
| `customer_name` | VARCHAR(100) | | `'Walk-in'` | |
| `reason` | VARCHAR(150) | null | — | |
| `refund_method` | VARCHAR(30) | null | — | e.g. `"Cash refund"`, `"GCash refund"` |
| `total` | NUMERIC(10,2) | NOT NULL | `0` | the refund amount |
| `status` | VARCHAR(20) | NOT NULL | `'Pending'` | `CHECK IN ('Pending','Approved','Rejected')` |
| `processed_by` | VARCHAR(100) | null | — | name of whoever last decided it (set at submission by `create_refund`, **not** overwritten on approval, overwritten by `reject_refund` with the rejecting admin's name) |
| `submitted_by` | TEXT | null | — | added by `add_return_refund_submitted_by.sql` — the actual original submitter, independent of `processed_by`'s overloaded meaning. Only reliable for rows created after this migration; backfilled once for pre-existing non-Rejected rows from `processed_by` |
| `items` | JSONB | null | — | legacy — pre-redesign refunds carried item/qty detail here; `create_refund` never writes it anymore, so it's `NULL` for every row going forward |
| `subtotal` | NUMERIC(10,2) | | `0` | legacy, same reason — never written post-redesign |
| `vat` | NUMERIC(10,2) | | `0` | legacy, same reason |
| `rejection_reason` | TEXT | null | — | added by `add_rejection_reason_and_reject_rpcs.sql`; `CHECK` constraint `refunds_rejection_requires_reason` requires ≥5 trimmed chars whenever `status='Rejected'` |
| `notes` | TEXT | null | — | |
| `created_at` | TIMESTAMPTZ | | `NOW()` | submission time |
| `processed_at` | TIMESTAMPTZ | null | — | approval/rejection time, added by `add_processed_at.sql` |

**RLS:** `SELECT` open. **No INSERT policy** — `add_create_refund_rpc.sql` dropped the original open one; a refund can only be created via `create_refund()`. `UPDATE` admin-only — used directly (not via RPC) for approval, and via `reject_refund()` for rejection (the `CHECK` constraint makes a raw rejecting `UPDATE` fail without a valid `rejection_reason`, which only the RPC sets).

**Indexes:** `idx_refunds_transaction`, `idx_refunds_status`.

---

## 10. `returns`

An item physically comes back. Approval decides, **per unit**, whether it's Resellable (back to stock) or Defective (not restocked).

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `return_id` | SERIAL | PK | — | |
| `transaction_id` | INTEGER | null | — | `REFERENCES transactions ON DELETE SET NULL` |
| `customer_name` | VARCHAR(100) | | `'Walk-in'` | |
| `reason` | VARCHAR(150) | null | — | |
| `method` | VARCHAR(30) | null | — | `"Cash refund"`, `"GCash refund"`, or `"Replacement"` (no money back — swaps the unit) |
| `notes` | TEXT | null | — | |
| `subtotal` | NUMERIC(10,2) | | `0` | |
| `vat` | NUMERIC(10,2) | | `0` | |
| `total` | NUMERIC(10,2) | NOT NULL | `0` | |
| `status` | VARCHAR(20) | NOT NULL | `'Pending'` | `CHECK IN ('Pending','Approved','Rejected')` |
| `processed_by` | VARCHAR(100) | null | — | same overloaded semantics as `refunds.processed_by` |
| `submitted_by` | TEXT | null | — | added by `add_return_refund_submitted_by.sql`; unlike refunds, **no backfill was possible** — every pre-existing return (any status) has this `NULL` |
| `items` | JSONB | null | — | the actual returned lines: `[{item_id, product_id, qty, serials:[...]}, ...]` — always populated (returns always carry real item detail, unlike refunds) |
| `conditions` | JSONB | NOT NULL | `'{}'::jsonb` | added by `add_return_unit_conditions.sql` — the per-unit Resellable/Defective decision made at approval, keyed one entry per physical unit (see §7's `approve_return`) |
| `evidence_photos` | JSONB | NOT NULL | `'[]'::jsonb` | added by `add_return_evidence_photos.sql` — array of `return-evidence` storage object paths, up to 5, written once at submission |
| `rejection_reason` | TEXT | null | — | same `CHECK` pattern as refunds (`returns_rejection_requires_reason`) |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |
| `processed_at` | TIMESTAMPTZ | null | — | |

**RLS:** `SELECT` open. **No INSERT policy at all, ever** — only `create_return()` can create a row. `UPDATE` admin-only (approval path also goes through `approve_return()`, rejection through `reject_return()`).

**Indexes:** `idx_returns_transaction`, `idx_returns_status`.

---

## 11. `holds`

Parked carts (cashier saves a cart to resume later).

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `hold_id` | SERIAL | PK | — | |
| `label` | VARCHAR(100) | NOT NULL | — | |
| `items` | JSONB | NOT NULL | — | cart snapshot |
| `customer_id` | INTEGER | null | — | `REFERENCES customers ON DELETE SET NULL` |
| `saved_at` | TIMESTAMPTZ | | `NOW()` | |

**RLS:** `SELECT`/`INSERT`/`DELETE` open to any authenticated user. No `UPDATE` policy.

---

## 12. `activity_log`

Append-only audit trail. No UPDATE/DELETE policy anywhere, on purpose — once written, an entry can't be altered or removed through the app.

| Column | Type | Null? | Default | Notes |
|---|---|---|---|---|
| `log_id` | SERIAL | PK | — | |
| `actor_id` | UUID | null | — | `REFERENCES auth.users ON DELETE SET NULL` |
| `actor_name` | VARCHAR(100) | NOT NULL | — | |
| `action` | VARCHAR(20) | NOT NULL | — | free text, see below for the values actually written |
| `entity_type` | VARCHAR(20) | NOT NULL | — | free text, see below |
| `entity_label` | VARCHAR(150) | null | — | e.g. a product name, `#0042` for a refund/return |
| `details` | JSONB | null | — | action-specific extra data (e.g. `{qty, newStock}` for a restock) |
| `created_at` | TIMESTAMPTZ | | `NOW()` | |

**Values actually written** (`logActivity()` call sites in `src/store/index.js`):

| `entity_type` | `action` values seen |
|---|---|
| `staff` | `created`, `updated`, `reactivated`, `suspended`, `deleted` |
| `product` | `created`, `updated`, `deleted`, `restocked` |
| `serial` | `added`, `deleted` |
| `category` | `created`, `updated`, `deleted` |
| `customer` | `deleted` |
| `refund` | `submitted`, `approved`, `rejected` |
| `return` | `created`, `approved`, `rejected` |

**RLS:** `SELECT` admin-only. `INSERT` open to any authenticated user (a cashier submitting a refund writes its own log entry). No `UPDATE`/`DELETE` policy.

**Indexes:** `idx_activity_log_created_at`.

---

## 13. Views

All three created `WITH (security_invoker = true)` (fixed retroactively by `fix_security_definer_views.sql` for an already-deployed DB) — each runs under the **querying user's own RLS**, not the view owner's.

| View | Grouped by | Columns | Notes |
|---|---|---|---|
| `sales_summary` | `DATE(created_at), payment` | `sale_date, total_transactions, total_subtotal, total_discount, total_vat, total_revenue, payment_method` | one row per day per payment method |
| `product_sales` | one row per product | `product_id, name, category, price, cost_price, stock, sold, margin_percent, margin_status` | `margin_status`: `'At Loss'` if `price<cost_price`, `'Low Margin'` if margin ≤15%, else `'Healthy'` |
| `customer_loyalty` | one row per customer | `customer_id, name, points, purchases, total_spent, loyalty_tier` | tier thresholds match §6 |

---

## 14. Functions (RPCs) — final signatures and behavior

All are `plpgsql`. Unless noted, `SECURITY DEFINER` functions set `search_path = public` and are granted to the `authenticated` role.

| Function | Security | Auth check | Purpose |
|---|---|---|---|
| `deduct_stock(items jsonb) → TABLE(out_id, out_stock, out_zeroed, out_low)` | DEFINER | signed-in | Atomic per-row stock deduction at checkout (`SELECT...FOR UPDATE` avoids overselling under concurrent checkouts). Skips rows where `product_id` no longer exists. For a **service** row (`is_service`): no stock change, but still increments `sold` and stamps `last_sold_at`. For a physical row: `stock = GREATEST(stock-qty,0)`, `sold += qty`, `last_sold_at = now()`. `out_zeroed` fires once on a real `>0 → 0` crossing; `out_low` fires whenever a real decrease lands the new stock in `[1,3]` (drives the low-stock email alert). |
| `add_serials(p_product_id int, p_serials text[]) → int` | DEFINER | admin only | Bulk-registers serials for incoming stock; `stock += count inserted` in the same call. Blank entries are skipped. |
| `delete_serial(p_serial_id int) → void` | DEFINER | admin only | Deletes a serial only while `status='In Stock'`; `stock -= 1` atomically. |
| `mark_serials_sold(p_transaction_id int, p_items jsonb) → void` | DEFINER | signed-in | At checkout, flips each scanned serial to `Sold`, linked to the transaction/item. Validates product match and `In Stock` status per serial; any failure rolls back the whole call. |
| `void_failed_sale(p_transaction_id int) → void` | DEFINER | signed-in | Deletes a transaction only if it's <2 minutes old **and** has no serial successfully marked Sold against it — the one safe rollback path when checkout fails partway through. Not a general delete capability. |
| `create_refund(p_transaction_id int, p_amount numeric, p_reason text, p_method text, p_notes text) → int` | DEFINER | signed-in | The only way a refund row is created. Enforces: 7-day window from `transactions.created_at`; `amount > 0`; `amount` can't exceed `transaction.total` minus everything already Pending/Approved in `refunds` **and** money-back `returns` on that transaction. Sets `processed_by` and `submitted_by` to the caller's name. |
| `reject_refund(p_refund_id int, p_reason text) → void` | DEFINER | admin + active | Only path to `status='Rejected'` on a refund. Requires ≥5-char reason; refund must be `Pending`. Touches only the refund row (no stock/points impact — correct, since a rejection is a no-op on inventory/money). |
| `create_return(p_transaction_id int, p_items jsonb, p_reason text, p_method text, p_notes text, p_subtotal numeric, p_vat numeric, p_total numeric, p_evidence_photos jsonb DEFAULT '[]') → int` | DEFINER | signed-in | The only way a return row is created. Enforces: 7-day window; for a money-back `method`, the return's total plus everything already Pending/Approved in `refunds` can't exceed the transaction total; per serialized line, each serial must be `Sold` on *this* transaction and have no other Pending return on it (no duplicate serials in one request); per non-serialized line, requested qty can't exceed sold-qty minus whatever's already Pending/Approved against that line. Stores `submitted_by`. |
| `reject_return(p_return_id int, p_reason text) → void` | DEFINER | admin + active | Mirror of `reject_refund` for returns. |
| `approve_return(p_return_id int, p_conditions jsonb DEFAULT '{}', p_replacements jsonb DEFAULT '{}') → void` | DEFINER | admin + active | The core approval logic — see breakdown below. |

### `approve_return` — current behavior in detail

1. Return must be `Pending`.
2. **Every returned unit must have an explicit condition** — no default. Unit keys: one per serial for a serialized line; `item:<item_id>:<0-based unit index>` per physical unit for a non-serialized line. `p_conditions` must contain **exactly** the expected key set (no missing, no extra) with each value's `status` being `'Resellable'` or `'Defective'`, or the whole call is rejected.
3. Per unit: `Defective` → serial flips to `Defective` (not restocked) / non-serial unit isn't counted toward resell; `Resellable` → serial flips to `In Stock` (unlinked from the transaction) / non-serial unit counts toward resell. Resellable units' count is added back to `products.stock`.
4. If `method = 'Replacement'`: for each returned serial, `p_replacements` must supply an in-stock serial of the **same product**, which is marked `Sold` under the *original* transaction and `stock -= 1`; for a non-serialized line, `stock -= qty` outright (no serial to pick for the replacement side).
5. If `method` is a money-back method (`'Cash refund'`/`'GCash refund'`): reverses the customer's loyalty stats — computes whether this approval is what pushes the transaction from "not fully settled" to "fully settled" (`refunds + money-back returns ≥ transaction.total`); if so, also removes the flat +10 purchase bonus and decrements `purchases`. Always removes `floor(return.total/100)` points and `total_spent -= return.total`, floored at 0.
6. Sets `status='Approved'`, `processed_at=now()`, `processed_by=<admin name>`, `conditions=p_conditions`.

**Not an RPC, but relevant:** refund **approval** (as opposed to rejection) is a plain client-side `UPDATE refunds SET status='Approved', processed_at=now()` under the `"Admins can update refunds"` RLS policy — it never touches stock, serials, or points (correct, since a refund is money-only and was never backed by physical inventory in the first place).

---

## 15. Storage

| Bucket | Public? | Policies |
|---|---|---|
| `return-evidence` | No (private) | Any authenticated user can `INSERT`/`SELECT`/`DELETE` objects in this bucket (scoped to `bucket_id = 'return-evidence'` only). The app never requests a public URL — every read goes through a short-lived signed URL (`storage.createSignedUrls`), fetched only when a return's detail modal is opened. `DELETE` is allowed so a cashier can retake a photo before the return is even submitted (photos upload to a per-session draft folder ahead of the `return_id` existing). |

---

## 16. Status / free-text value conventions (not DB enums, except where noted)

| Column | Values | DB-enforced? |
|---|---|---|
| `profiles.role` | `admin`, `cashier` | Yes, `CHECK` |
| `refunds.status` / `returns.status` | `Pending`, `Approved`, `Rejected` | Yes, `CHECK` |
| `product_serials.status` | `In Stock`, `Sold`, `Defective` | Yes, `CHECK` |
| `transactions.status` | `Completed`, `Refunded`, `Returned`, `Partially Returned` (computed client-side by `txnStatus()` in `Reports.jsx`; the stored column itself is only ever written as `'Completed'` at insert, or flipped by refund/return approval) | No |
| `refunds.refund_method` / `returns.method` | `Cash refund`, `GCash refund`, `Replacement` (returns only — no money back) | No — `isMoneyBack()` in `src/utils/helpers.js` treats anything **not** in `{Cash refund, GCash refund}` as non-money-back |
| `transactions.payment` | `Cash`, `GCash`, `Card`, or a `"+"`-joined combo for split payments | No |

---

## 17. Table relationships (foreign keys)

```
auth.users ──1:1── profiles
auth.users ──0:N── activity_log.actor_id (SET NULL)

customers ──0:N── transactions.customer_id (SET NULL)
customers ──0:N── holds.customer_id (SET NULL)

products ──0:N── transaction_items.product_id (SET NULL)
products ──1:N── product_serials.product_id (CASCADE)

transactions ──1:N── transaction_items.transaction_id (CASCADE)
transactions ──0:N── refunds.transaction_id (SET NULL)
transactions ──0:N── returns.transaction_id (SET NULL)
transactions ──0:N── product_serials.transaction_id (SET NULL)

transaction_items ──0:N── product_serials.transaction_item_id (SET NULL)
```

No FK from `refunds`/`returns` back to `products`/`transaction_items` — both reference the sale (and, for returns, embed item detail in `items jsonb`) rather than joining to live rows, since a product can later be edited/deleted independent of a historical request.

---

## 18. Migration file order (for reference / rebuilding from scratch)

Chronological order, by commit, as reconciled from `git log`:

1. `schema.sql` (base — but see the staleness note at the top of this doc)
2. `fix_security_definer_views.sql`
3. `add_active_to_profiles.sql`, `add_email_to_profiles.sql`
4. `add_activity_log.sql`
5. `add_category_icon.sql`, `seed_category_icons.sql`
6. `add_deduct_stock_rpc.sql` → `add_processed_at.sql` → `add_returns_table.sql` → `fix_role_based_rls.sql` → `seed_more_products.sql` *(early returns/refunds workflow — later superseded)*
7. `add_low_stock_threshold.sql` → `update_low_stock_range.sql`
8. `add_cost_price_to_transaction_items.sql`
9. `insert_15_products.sql` *(seed data)*
10. *(Returns feature removed from the codebase, then re-added — see commit messages)*
11. `add_serial_tracking.sql` → `add_returns_table.sql` (re-added) → `add_return_money_overlap_and_replacement.sql` → `add_return_unit_conditions.sql` → `add_return_evidence_photos.sql` → `add_create_refund_rpc.sql` → `add_rejection_reason_and_reject_rpcs.sql` → `audit_restocked_refunds_with_sold_serials.sql` *(read-only)* → `lockdown_products_update_rls.sql`
12. `add_last_sold_at_tracking.sql` → `add_is_service_flag.sql` → `add_service_availability_and_notes.sql` → `add_return_refund_submitted_by.sql`
13. `clear_sales_data.sql` *(destructive, manual-run data wipe — not a structural migration)*

`audit_restocked_refunds_with_sold_serials.sql` and `clear_sales_data.sql` are **not schema migrations** — the first is a read-only diagnostic query, the second is a manual data-wipe utility (irreversible; resets sequences). Everything else is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS` guards throughout) and safe to re-run.

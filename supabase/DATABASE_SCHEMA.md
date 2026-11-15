# Gapuz POS — Database Schema & Relationships

Stack: **Supabase (PostgreSQL)**. Source of truth reconstructed from `supabase/schema.sql` plus every migration file in `supabase/*.sql` (listed at the bottom), reflecting the **current** state of the database — not just the original base schema.

> Auth note: there is no local `users` table. Logins go through Supabase's built-in `auth.users`. The `profiles` table attaches a name/role to each auth user.

---

## 1. Entity-Relationship Overview

```
auth.users (Supabase Auth)
     │ 1:1
     ▼
 profiles (admin/cashier)
     │
     │ (actor_id)                (processed_by / submitted_by — by name, not FK)
     ├──────────────► activity_log
     │
     │                                   categories (name)
     │                                        │ (soft link by name string, no FK)
     │                                        ▼
customers 1───∞ transactions 1───∞ transaction_items ∞───1 products 1───∞ product_serials
     │                 │                                        ▲                │
     │                 │ 1───∞ refunds                           │ (product_id)   │ (transaction_id /
     │                 │ 1───∞ returns ─────────────────────────┘                │  transaction_item_id,
     │                 │                                                          │  nullable, set on sale)
     │                 └───────────────────────────────────────────────────────────┘
     │
     └── (customer_id, nullable) also referenced by: holds
```

Key idea: **`products.stock` is the single source of truth for quantity.** `product_serials` is a side-channel (one row per physical serialized unit) kept in sync with `stock` only through RPC functions — never touched directly by the app.

---

## 2. Tables

### 2.1 `profiles`
One row per Supabase Auth user — attaches a name/role to a login.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | VARCHAR(100) NOT NULL | |
| `email` | VARCHAR(100) | backfilled from `auth.users.email` |
| `role` | VARCHAR(20) NOT NULL DEFAULT `'cashier'` | CHECK IN (`admin`, `cashier`) |
| `active` | BOOLEAN NOT NULL DEFAULT `true` | suspend/reactivate staff without deleting |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

**Relationships:** referenced by `activity_log.actor_id` (SET NULL on delete). Role/active checks gate nearly every admin-only RLS policy and RPC in this database.

---

### 2.2 `products`
Catalog of physical products and services.

| Column | Type | Notes |
|---|---|---|
| `product_id` | SERIAL PK | |
| `name` | VARCHAR(150) NOT NULL | |
| `category` | VARCHAR(50) NOT NULL | free text, loosely tied to `categories.name` (no FK) |
| `price` | NUMERIC(10,2) NOT NULL | |
| `cost_price` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `stock` | INTEGER NOT NULL DEFAULT 0 | authoritative quantity |
| `barcode` | VARCHAR(50) | |
| `icon` | VARCHAR(10) | |
| `image` | TEXT | |
| `sold` | INTEGER NOT NULL DEFAULT 0 | lifetime units sold |
| `has_serial` | BOOLEAN NOT NULL DEFAULT `false` | whether units are tracked individually in `product_serials` |
| `is_service` | BOOLEAN NOT NULL DEFAULT `false` | services skip stock deduction entirely |
| `is_available` | BOOLEAN NOT NULL DEFAULT `true` | hide a service from POS without deleting it |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |
| `last_sold_at` | TIMESTAMPTZ | stamped by `deduct_stock()` |

**Relationships:**
- Referenced by `transaction_items.product_id` (SET NULL)
- Referenced by `product_serials.product_id` (CASCADE)
- `category` loosely corresponds to `categories.name` by string match only — **not a real foreign key**

---

### 2.3 `customers`
| Column | Type | Notes |
|---|---|---|
| `customer_id` | SERIAL PK | |
| `name` | VARCHAR(100) NOT NULL | |
| `email` | VARCHAR(100) | |
| `phone` | VARCHAR(20) | |
| `address` | TEXT | |
| `points` | INTEGER NOT NULL DEFAULT 0 | loyalty points |
| `purchases` | INTEGER NOT NULL DEFAULT 0 | lifetime completed-purchase count |
| `total_spent` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

**Relationships:** referenced by `transactions.customer_id` (SET NULL) and `holds.customer_id` (SET NULL). Points/spend are adjusted by refund/return approval RPCs when money actually comes back.

---

### 2.4 `transactions`
One row per completed sale.

| Column | Type | Notes |
|---|---|---|
| `transaction_id` | SERIAL PK | |
| `customer_id` | INTEGER, FK → `customers.customer_id` ON DELETE SET NULL | nullable (walk-in) |
| `customer_name` | VARCHAR(100) DEFAULT `'Walk-in'` | denormalized snapshot |
| `payment` | VARCHAR(30) NOT NULL | free text: "Cash", "GCash", "Card", "Cash+GCash", etc. |
| `subtotal` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `disc_amt` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `vat` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `total` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `cash_given` | NUMERIC(10,2) | |
| `status` | VARCHAR(20) NOT NULL DEFAULT `'Completed'` | |
| `cashier_name` | VARCHAR(100) | denormalized |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | sale time; 7-day refund/return window is computed from this |

**Relationships:** parent of `transaction_items` (CASCADE), `refunds` (SET NULL), `returns` (SET NULL), `product_serials` (SET NULL on `transaction_id`).

---

### 2.5 `transaction_items`
Line items per sale.

| Column | Type | Notes |
|---|---|---|
| `item_id` | SERIAL PK | |
| `transaction_id` | INTEGER NOT NULL, FK → `transactions.transaction_id` ON DELETE CASCADE | |
| `product_id` | INTEGER, FK → `products.product_id` ON DELETE SET NULL | |
| `name` | VARCHAR(150) NOT NULL | snapshot of product name at sale time |
| `qty` | INTEGER NOT NULL DEFAULT 1 | |
| `price` | NUMERIC(10,2) NOT NULL | snapshot of selling price at sale time |
| `cost_price` | NUMERIC(10,2) NOT NULL DEFAULT 0 | snapshot of cost at sale time (added later; backfilled from current product cost) |
| `notes` | TEXT | per-line job note for service items, printed on receipt |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

**Relationships:** referenced by `product_serials.transaction_item_id` (SET NULL) — links a specific serial to the exact line it was sold on.

---

### 2.6 `refunds`
Money-only refund requests (no item/stock impact — see §4 "Refunds vs Returns").

| Column | Type | Notes |
|---|---|---|
| `refund_id` | SERIAL PK | |
| `transaction_id` | INTEGER, FK → `transactions.transaction_id` ON DELETE SET NULL | |
| `customer_name` | VARCHAR(100) DEFAULT `'Walk-in'` | |
| `reason` | VARCHAR(150) | |
| `refund_method` | VARCHAR(30) | |
| `total` | NUMERIC(10,2) NOT NULL DEFAULT 0 | flat peso amount |
| `status` | VARCHAR(20) NOT NULL DEFAULT `'Pending'` | CHECK IN (`Pending`,`Approved`,`Rejected`) |
| `processed_by` | VARCHAR(100) | name of submitter at insert; **overwritten** by the rejecting admin's name on reject |
| `items` | JSONB | legacy; retained for old pre-money-only rows |
| `subtotal` | NUMERIC(10,2) DEFAULT 0 | |
| `vat` | NUMERIC(10,2) DEFAULT 0 | |
| `notes` | TEXT | |
| `rejection_reason` | TEXT | required (≥5 chars, CHECK constraint) when `status = 'Rejected'` |
| `submitted_by` | TEXT | the actual original submitter, independent of `processed_by` |
| `client_request_id` | UUID, UNIQUE | idempotency key for duplicate-submit protection |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |
| `processed_at` | TIMESTAMPTZ | stamped on approve/reject |

**Writable only through RPCs:** `create_refund`, `reject_refund` (approval is a direct admin-gated `UPDATE`). No direct client `INSERT` policy remains.

---

### 2.7 `holds`
Parked/suspended carts.

| Column | Type | Notes |
|---|---|---|
| `hold_id` | SERIAL PK | |
| `label` | VARCHAR(100) NOT NULL | |
| `items` | JSONB NOT NULL | cart contents snapshot |
| `customer_id` | INTEGER, FK → `customers.customer_id` ON DELETE SET NULL | |
| `saved_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

---

### 2.8 `categories`
Admin-managed product category list (lets categories be added/removed from the UI instead of hardcoded).

| Column | Type | Notes |
|---|---|---|
| `category_id` | SERIAL PK | |
| `name` | VARCHAR(50) NOT NULL UNIQUE | matched against `products.category` by string, not FK |
| `badge_color` | VARCHAR(20) NOT NULL DEFAULT `'badge-accent'` | |
| `icon` | VARCHAR(30) | manual icon override |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

---

### 2.9 `activity_log`
Append-only audit trail (no UPDATE/DELETE policy exists, by design).

| Column | Type | Notes |
|---|---|---|
| `log_id` | SERIAL PK | |
| `actor_id` | UUID, FK → `auth.users(id)` ON DELETE SET NULL | |
| `actor_name` | VARCHAR(100) NOT NULL | |
| `action` | VARCHAR(20) NOT NULL | e.g. `submitted`, `created`, `approved`, `rejected`, `deleted` |
| `entity_type` | VARCHAR(20) NOT NULL | e.g. `refund`, `return`, `product`, `staff` |
| `entity_label` | VARCHAR(150) | human-readable label, e.g. `#0001` |
| `details` | JSONB | |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |

**Read access:** admins only (RLS).

---

### 2.10 `product_serials`
One row per physical serialized unit (GPUs, laptops, etc.). `products.stock` stays authoritative; this is a side-channel.

| Column | Type | Notes |
|---|---|---|
| `serial_id` | SERIAL PK | |
| `product_id` | INTEGER NOT NULL, FK → `products.product_id` ON DELETE CASCADE | |
| `serial_number` | VARCHAR(100) NOT NULL UNIQUE | |
| `status` | VARCHAR(20) NOT NULL DEFAULT `'In Stock'` | CHECK IN (`In Stock`,`Sold`,`Defective`) |
| `transaction_id` | INTEGER, FK → `transactions.transaction_id` ON DELETE SET NULL | set when sold |
| `transaction_item_id` | INTEGER, FK → `transaction_items.item_id` ON DELETE SET NULL | set when sold |
| `sold_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT `NOW()` | |

**Writable only through RPCs:** `add_serials`, `delete_serial`, `mark_serials_sold`, `approve_return` (restock/defective/replacement). No direct client writes.

---

### 2.11 `returns`
Physical merchandise returns (item comes back) — distinct from `refunds` (money-only, no item movement).

| Column | Type | Notes |
|---|---|---|
| `return_id` | SERIAL PK | |
| `transaction_id` | INTEGER, FK → `transactions.transaction_id` ON DELETE SET NULL | |
| `customer_name` | VARCHAR(100) DEFAULT `'Walk-in'` | |
| `reason` | VARCHAR(150) | |
| `method` | VARCHAR(30) | e.g. `Cash refund`, `GCash refund`, `Replacement` |
| `notes` | TEXT | |
| `subtotal` | NUMERIC(10,2) DEFAULT 0 | |
| `vat` | NUMERIC(10,2) DEFAULT 0 | |
| `total` | NUMERIC(10,2) NOT NULL DEFAULT 0 | |
| `status` | VARCHAR(20) NOT NULL DEFAULT `'Pending'` | CHECK IN (`Pending`,`Approved`,`Rejected`) |
| `processed_by` | VARCHAR(100) | |
| `items` | JSONB | `[{item_id, product_id, qty, serials: [...]}]` |
| `evidence_photos` | JSONB NOT NULL DEFAULT `'[]'` | array of private-bucket storage paths (≤5 photos) |
| `rejection_reason` | TEXT | required (≥5 chars, CHECK) when `status = 'Rejected'` |
| `submitted_by` | TEXT | original submitter |
| `conditions` | JSONB NOT NULL DEFAULT `'{}'` | per-unit Resellable/Defective decision, keyed by serial or `item:<item_id>:<unit_index>` |
| `client_request_id` | UUID, UNIQUE | idempotency key |
| `created_at` | TIMESTAMPTZ DEFAULT `NOW()` | |
| `processed_at` | TIMESTAMPTZ | |

**Writable only through RPCs:** `create_return` (no direct INSERT policy exists), `reject_return`; approval via `approve_return`.

---

## 3. Storage

### `return-evidence` bucket (private)
- Holds cashier-uploaded evidence photos for returns.
- Accessed only via short-lived signed URLs (never public).
- Policies: `authenticated` can INSERT, SELECT, DELETE objects where `bucket_id = 'return-evidence'`.
- Paths referenced by `returns.evidence_photos` (JSONB array of object paths).

---

## 4. Business Rules Encoded in the Schema

- **Refunds vs Returns:** A **Refund** is a flat peso amount with no item/serial/stock impact (billing correction, cancelled service). A **Return** means a physical item comes back — approval marks each unit Resellable (restocked) or Defective (not restocked), and can optionally issue a Replacement unit.
- **7-day window:** Both `create_refund` and `create_return` reject requests once `now() > transactions.created_at + interval '7 days'`.
- **Double-deduction guard:** a money-back Return and a Refund on the same transaction are capped so their combined total can never exceed `transactions.total`.
- **Idempotent submission:** `client_request_id` (UUID, unique) lets `create_refund`/`create_return` dedupe retried submits from spam-clicking — same id returns the existing row instead of inserting a duplicate.
- **Loyalty reversal:** approving a money-back Return reverses the customer's `points`/`purchases`/`total_spent` using the same formula as refund approval, applied only once a transaction crosses into "fully settled."
- **Serial lifecycle:** `product_serials.status` moves `In Stock → Sold → (In Stock | Defective)` only via `add_serials` / `mark_serials_sold` / `approve_return`, never by direct client writes.
- **Services:** `is_service = true` products are skipped entirely by `deduct_stock` (no stock change) but still increment `sold` and `last_sold_at`.
- **Low-stock signal:** `deduct_stock` returns `out_low = true` whenever a real decrease lands stock in the range 1–3 (not just an exact crossing through 3), and `out_zeroed = true` when stock hits exactly 0.

---

## 5. RPC Functions (all SECURITY DEFINER unless noted)

| Function | Purpose |
|---|---|
| `deduct_stock(items jsonb)` | Atomic, row-locked stock deduction at checkout; skips services; returns zeroed/low-stock signals. |
| `add_serials(product_id, serials[])` | Admin-only; registers new serials and bumps `products.stock` atomically. |
| `delete_serial(serial_id)` | Admin-only; deletes an `In Stock` serial and decrements `products.stock`. |
| `mark_serials_sold(transaction_id, items)` | Marks scanned serials `Sold`, linked to the transaction/item. |
| `void_failed_sale(transaction_id)` | Rolls back a transaction inserted seconds ago if serial-marking failed right after — narrow, audited undo path. |
| `create_refund(...)` | The only way a refund row can be created; enforces 7-day window, remaining-balance cap, and idempotency via `client_request_id`. |
| `reject_refund(refund_id, reason)` | Admin-only; moves a Pending refund to Rejected with a required reason. |
| `create_return(...)` | The only way a return row can be created; enforces 7-day window, serial/qty validation, money-overlap guard, idempotency. |
| `approve_return(return_id, conditions, replacements)` | Admin-only; requires an explicit Resellable/Defective condition per unit; restocks, flags defective, handles Replacement, reverses loyalty points for money-back methods. |
| `reject_return(return_id, reason)` | Admin-only; moves a Pending return to Rejected with a required reason. |

---

## 6. Views (all `security_invoker = true`, so RLS of the querying user applies)

| View | Purpose |
|---|---|
| `sales_summary` | Daily totals (subtotal, discount, VAT, revenue) grouped by date + payment method. |
| `product_sales` | Per-product margin % and margin status (`At Loss` / `Low Margin` / `Healthy`). |
| `customer_loyalty` | Customers ranked by points with a computed loyalty tier (`Bronze`/`Silver`/`Gold`/`Platinum`). |

---

## 7. Row-Level Security Summary

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `profiles` | any authenticated | — | — | — |
| `products` | any authenticated | admin only | admin only (+ active) | admin only |
| `customers` | any authenticated | any authenticated | any authenticated | any authenticated |
| `transactions` | any authenticated | any authenticated | admin only | — |
| `transaction_items` | any authenticated | any authenticated | — | — |
| `refunds` | any authenticated | **RPC only** (`create_refund`) | admin only | — |
| `holds` | any authenticated | any authenticated | — | any authenticated |
| `categories` | any authenticated | admin only | admin only | admin only |
| `activity_log` | **admin only** | any authenticated (append-only) | — | — |
| `product_serials` | any authenticated | admin only (defense-in-depth; real writes via RPC) | admin only (same) | admin only (same) |
| `returns` | any authenticated | **RPC only** (`create_return`) | admin only | — |

---

## 8. Indexes

```
idx_transactions_customer, idx_transactions_created_at
idx_transaction_items_txn, idx_transaction_items_prod
idx_refunds_transaction, idx_refunds_status
idx_products_category
idx_activity_log_created_at
idx_product_serials_product, idx_product_serials_status, idx_product_serials_txn
idx_returns_transaction, idx_returns_status
```

---

## 9. Source Files

Reconstructed from `supabase/schema.sql` (base) plus these migrations (chronological by dependency, applied on top):

`add_active_to_profiles.sql`, `add_email_to_profiles.sql`, `add_category_icon.sql`, `add_activity_log.sql`, `add_deduct_stock_rpc.sql`, `fix_role_based_rls.sql`, `add_serial_tracking.sql`, `add_returns_table.sql`, `add_create_refund_rpc.sql`, `add_cost_price_to_transaction_items.sql`, `add_processed_at.sql`, `add_low_stock_threshold.sql`, `update_low_stock_range.sql`, `add_is_service_flag.sql`, `add_last_sold_at_tracking.sql`, `add_service_availability_and_notes.sql`, `add_return_evidence_photos.sql`, `add_return_money_overlap_and_replacement.sql`, `add_return_unit_conditions.sql`, `add_rejection_reason_and_reject_rpcs.sql`, `add_return_refund_submitted_by.sql`, `add_submit_idempotency_and_dup_guards.sql`, `fix_create_refund_return_ambiguous_id.sql`, `lockdown_products_update_rls.sql`, `fix_security_definer_views.sql`, `fix_object_object_activity_labels.sql`.

Not schema-affecting (seed data / one-off audits, excluded above): `insert_15_products.sql`, `seed_category_icons.sql`, `seed_more_products.sql`, `clear_sales_data.sql`, `audit_restocked_refunds_with_sold_serials.sql`, `find_duplicate_pending_returns_refunds.sql`.

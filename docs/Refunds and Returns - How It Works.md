# Refunds and Returns — How It Works

A read-only audit of exactly what the code does, written from the source
(`src/pages/Refunds.jsx`, `src/pages/Returns.jsx`, `src/store/index.js`,
`supabase/add_returns_table.sql`, `supabase/schema.sql`) on 2026-11-12. No
code was changed to produce this — it's a snapshot of current behavior,
file and function cited for every answer.

---

## REFUNDS

### 1. Steps the cashier goes through
`src/pages/Refunds.jsx` — a 4-step wizard (`STEPS` constant, `step` state):
1. **Look up transaction** — `SaleLookup` component (`mode="refund"`) →
   `handleLookup()`. Scan a serial or type/click a transaction ID.
2. **Select items** — tick which line items (and how many units of each)
   to refund.
3. **Refund details** — pick a `reason` (dropdown, `REFUND_REASONS`), a
   `refundMethod` (Cash/GCash/Store Credit), and optional `notes`.
4. **Confirm & submit** — review totals, click "Submit Refund" →
   `handleSubmit()`.

### 2. Items/products or just an amount?
Specific items. `handleSubmit()` (line 263) builds `selectedList` from
`selectedTxn.items` filtered to `refundItems[item.id]?.selected`, each
carrying its own `refundQty` (set via the qty stepper,
`setRefundItemQty`, capped by `remainingQty()`). There is no freeform
"amount" field anywhere — the total is always computed from selected
items × qty × price (+12% VAT), via `calcTotals()`.

### 3. What gets saved on submit
`addRefund()` in `src/store/index.js` (line 563) inserts into the
**`refunds`** table: `transaction_id, customer_name, reason,
refund_method, notes, total, status, processed_by, items, subtotal, vat`.
`status` is always hardcoded `'Pending'` by `handleSubmit`, regardless of
who submits — there is no "auto-approve" path. `items` is the JSON array
of selected line items with their `refundQty`.

### 4. What happens on Admin APPROVAL
`handleApprove()` in `Refunds.jsx` (line 288), triggered from the
"Approve" button in `RefundDetailsModal.jsx`:
- `updateRefund(r.id, {status:'Approved'})` — sets `refunds.status =
  'Approved'` and stamps `processed_at` (in `store/index.js`,
  `updateRefund`).
- For each refunded item: `restockProduct(prod.id, item.refundQty ||
  item.qty || 1)` — **stock goes UP** by the refunded quantity. This is a
  plain `products.stock` update (`restockProduct` in `store/index.js`),
  not an RPC.
- `syncRefundToTransaction(r)` reverses the customer's loyalty
  points/spend (`revertPurchase` in `store/index.js`) if the sale had a
  linked customer, and a separate effect (lines 165–189) recomputes the
  transaction's `status` column to `Refunded`/`Partially Refunded`.
- **Serial numbers are never touched.** No code path in the refund flow
  writes to `product_serials`. A refunded serialized item's serial stays
  whatever it was (typically still `Sold`) — only stock count goes up,
  with no serial record pointing to it anymore being correct. (This is a
  real gap — see Q16.)

### 5. What happens on REJECTION
`handleReject()` (line 306): only `updateRefund(r.id,
{status:'Rejected'})`. No stock change, no points reversal, nothing
else.

### 6. Day limit?
**Not implemented** as an enforced rule. `RefundDetailsModal.jsx` shows a
`REFUND_WINDOW_DAYS = 15` constant purely for display (`overPolicy`,
line 75 — colors the "Xd since purchase" text red past 15 days) but
**never blocks** `handleApprove`. `Refunds.jsx` itself says so directly
in its own comment (line 319): *"no time limit on refunds."* No SQL
check either (refunds insert directly via a plain table policy, not an
RPC — see Q9).

### 7. Can the refund amount exceed the original transaction total?
Not directly possible through the UI — each refund is built from
`item.price × refundQty` for selected items, capped at `remainingQty()`
per item (line 432/468). But nothing stops **several separate refund
requests** from collectively exceeding the total, beyond the per-item
remaining-qty cap (see Q8) — there's no transaction-level total cap.

### 8. Can the same item/transaction be refunded more than once?
Yes, partially — and that's correct for normal partial refunds. What's
blocked: once an item's `remainingQty()` (refunds + returns,
Pending+Approved) hits 0, `handleLookup` (line 230) and the step-2 item
row (line 433) both block it — a checkbox button in `Refunds.jsx`
disables fully-covered items, and `handleLookup` rejects the whole
transaction once every item is fully covered ("This transaction has
already been fully refunded"). This is **client-side only** — there is
no database-level (RPC/trigger) cap on total refunded qty; refunds
insert through a plain RLS `INSERT ... WITH CHECK (true)` policy
(`schema.sql` line 233), so nothing stops a direct API call from
over-refunding.

### 9. Who can submit/approve/reject — enforced how?
- **Submit**: any authenticated user (cashier or admin). Enforced by
  RLS: `CREATE POLICY "Allow authenticated insert" ON refunds FOR
  INSERT TO authenticated WITH CHECK (true)` (`schema.sql` line 233) —
  no role check at all, DB-level.
- **Approve/Reject**: UI-gated — `RefundDetailsModal.jsx` only shows the
  buttons `record.status === 'Pending' && isAdmin`. Also **enforced by
  RLS**: `CREATE POLICY "Admins can update refunds" ON refunds FOR
  UPDATE ... USING (profiles.role = 'admin')` (`schema.sql` line 252) —
  a non-admin's `updateRefund` call would be rejected by Postgres even
  if they bypassed the UI.
- **Restocking on approval**, however, is a plain `products` table
  UPDATE, and `CREATE POLICY "Allow authenticated update" ON products
  FOR UPDATE TO authenticated USING (true)` (line 247) has **no admin
  check** — so stock changes from `handleApprove` are only gated by the
  UI hiding the Approve button, not by RLS.

---

## RETURNS

### 10. Steps the cashier goes through
`src/pages/Returns.jsx` — also a 4-step wizard (`STEPS`):
1. **Find the sale** — `SaleLookup` (`mode="return"`) → `handleLookup()`
   → `findSaleForReturn()`.
2. **Select items** — for serialized items, scan/click individual
   **serial numbers**; for non-serialized items, pick a quantity.
3. **Return details** — reason, `method` (Cash refund / GCash refund /
   Replacement), notes.
4. **Confirm & submit** — `handleSubmit()` → `submitReturn()` → RPC
   `create_return`.

### 11. How it finds the sale
Both — `findSaleForReturn()` (`store/index.js` line 627) tries a
`product_serials.serial_number` match first (serials can be all-digits,
so this is tried before assuming it's a transaction ID), then falls back
to treating the input as a numeric transaction ID.

### 12. What happens on Admin APPROVAL
`approveReturn()` (`store/index.js` line 700) calls RPC
**`approve_return(p_return_id, p_conditions)`**
(`add_returns_table.sql` line 191), run server-side, atomically:
- For each **serialized** unit: if marked Defective in `p_conditions` →
  `product_serials.status = 'Defective'` (stock **not** increased for
  that unit). If Resellable (default) → `product_serials.status='In
  Stock'`, and `transaction_id/transaction_item_id/sold_at` are all
  cleared back to `NULL` — **stock goes up** by 1 per such unit
  (`products.stock = stock + v_resell`).
- For **non-serialized** items: same Resellable/Defective choice per
  line (`item:<item_id>` key in conditions) — stock goes up by the
  returned qty if Resellable, stays the same if Defective.
- `returns.status = 'Approved'`, `processed_at`/`processed_by` stamped.
- **No loyalty-points reversal happens for returns at all** —
  `approve_return` never touches `customers`, and nothing in
  `Returns.jsx`/`store/index.js` calls `revertPurchase` for a return.
  (This is a real gap — points stay as if the sale were never partially
  undone.)

### 13. Is the 7-day limit checked frontend, DB, or both?
Both. Frontend: `Returns.jsx` computes `expired` (line 50, `daysSince >
RETURN_WINDOW_DAYS`) and disables the Submit button (line 417). **The
real enforcement is server-side**: `create_return`
(`add_returns_table.sql` line 114) — `IF now() > v_tx.created_at +
interval '7 days' THEN RAISE EXCEPTION`. The code's own comment says
this directly: "the UI also shows/blocks on this, but the server check
is the one that actually matters."

### 14. Return methods — does Replacement give a new unit and deduct stock?
`RETURN_METHODS = ['Cash refund', 'GCash refund', 'Replacement']`
(`Returns.jsx` line 17). **Replacement is not implemented as a real
swap** — selecting it only changes the stored `method` string and (per
`salesMetrics.js` `MONEY_BACK_METHODS`) excludes that return from
revenue deduction (treated as non-money-back). Nothing in
`create_return`/`approve_return` or anywhere else gives the customer a
new unit or deducts a second unit's stock — a "Replacement" return
still just restocks the returned unit like any other approved return
(if marked Resellable). No new sale/transaction is created.

### 15. Can the same serial/item be returned more than once?
Blocked server-side in `create_return`: for serials, it requires
`product_serials.status='Sold'` on that exact transaction (line
142–147) — once approved, the serial is no longer `Sold`, so it can't be
selected again; it also blocks a serial that already has a **Pending**
return (line 148–155, Approved isn't explicitly checked here but
Approved serials are already non-`Sold` so the first check already
catches that case). For non-serialized lines, it sums existing
Pending+Approved returns for that `item_id` and rejects if the new
request would exceed what's left (line 158–172).

---

## OVERLAP

### 16. Can the same item get BOTH a refund and a return? Is anything blocking it?
Partially blocked, asymmetrically, and one bug was found and fixed while
building this:
- **Return while a refund exists**: blocked **server-side**, in
  `create_return` itself (`add_returns_table.sql` line 128–135) —
  checks for a Pending/Approved refund on the same `product_id` and
  raises an exception. This is a real database-level guarantee, not
  just UI.
- **Refund while a return exists**: **not blocked in the database at
  all.** There is no RPC for refund submission (`addRefund` is a plain
  `refunds` table INSERT), and no trigger/check constraint checks
  `returns`. The only protection is **client-side**, in `Refunds.jsx`'s
  `handleLookup`/`remainingQty()` (lines 122–137, 230). A direct
  Supabase API call (or a client bug) bypassing that JS check would not
  be stopped.
- While that client-side check was being built, a bug was found: it was
  comparing a camelCase field (`i.productId`) against a return's stored
  items, which are actually saved **snake_case**
  (`item_id`/`product_id` — literally the raw object `Returns.jsx`
  sends to `create_return`, stored verbatim in `returns.items` JSONB).
  That mismatch meant the check silently never matched anything until
  it was fixed — so this protection is narrow (client-only), not a
  database guarantee.

### 17. Are Refunds and Returns both subtracted in Sales Reports? Double-counted?
Both subtracted. `computeSalesMetrics()` (`src/utils/salesMetrics.js`
line 25): `deducted = refundTotal + returnTotal`, `netSales =
grossSales - deducted`, same pattern for profit and VAT. Both are
counted in the period they were **approved** (`processed_at`), not the
original sale date (`approvedDate()` helper). On double-counting: the
code's own comment (line 41–43) asserts it can't happen "since
create_return also refuses any item that already has a Pending/Approved
Refund against it" — true for the return→refund direction
(DB-enforced), but as noted in Q16, the refund→return direction has no
DB-level guard, only the client-side check, so the comment's guarantee
is **weaker than it reads** for that direction.

### 18. Refund vs Return — the real difference
- **Refund** (`Refunds.jsx`/`refunds` table): the customer keeps nothing
  back physically tracked — it's purely a money-back decision. Approval
  just bumps `products.stock` up by the refunded quantity and reverses
  loyalty points; no serial/condition tracking at all.
- **Return** (`Returns.jsx`/`returns` table, via
  `create_return`/`approve_return` RPCs): the unit **physically comes
  back**, and the Admin decides per unit whether it's Resellable (goes
  back to stock / serial flips to `In Stock`) or Defective (stock not
  increased / serial flips to `Defective`). It also enforces a real
  7-day window server-side and real serial/quantity validation that
  Refunds has none of.

---

## Summary

| Question | Refunds | Returns |
|---|---|---|
| Item physically comes back? | No — money-only, no serial/condition tracking | Yes — Resellable/Defective decided per unit on approval |
| Stock changes? | Up, by refunded qty, on approval (`restockProduct`) | Up, only if Resellable, on approval (`approve_return`) |
| Serial numbers changed? | Not implemented — never touched | Yes — `In Stock` (Resellable, unlinked from the sale) or `Defective` |
| Day limit? | Not implemented (15-day badge is display-only) | Yes, 7 days — enforced in both UI and `create_return` (DB is authoritative) |
| Double-payout blocked? | Client-side only (DB has no guard) | Refund-first case is DB-enforced (`create_return`); same-flow double-return is DB-enforced |
| Who approves? | Admin — UI-gated and RLS-enforced (`profiles.role='admin'`) | Admin — UI-gated and RLS/RPC-enforced (`approve_return` checks `role='admin' AND active`) |

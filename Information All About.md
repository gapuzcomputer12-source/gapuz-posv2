# Gapuz POS System — Complete System Information

**System name:** Gapuz Web-Based Inventory and Point of Sale (POS) System
**For:** Gapuz Computer Services and Accessories
**Version:** 3.0.0 (`package.json`)

> This document was rewritten from a direct read of the current codebase. The database schema is documented separately in `supabase/DATABASE_SCHEMA.md` (tables, RPCs, RLS, relationships) — this file covers the application layer: pages, flows, business rules, and architecture.

---

## 1. System Overview

A web-based application that lets **Administrator** and **Cashier** users manage sales, inventory, customers, refunds, and returns for a computer parts/accessories shop. All data lives in the cloud (Supabase); nothing requires a local server. Hosted on Vercel.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18.3 |
| Build tool / dev server | Vite 6 |
| Styling | Tailwind CSS 3.4 (plus a large hand-written `index.css` for the Reports/Dashboard design system) |
| Routing | React Router DOM 6.20 |
| State management | Zustand 4.5 (`persist` middleware for theme only; everything else is live Supabase data) |
| Backend / database | Supabase Cloud (PostgreSQL) |
| Authentication | Supabase Auth (email + password) |
| Serverless logic | Supabase Edge Functions (Deno/TypeScript) |
| Charts | Recharts 2.10 |
| Printing | react-to-print |
| Barcode/QR/serial scanning | html5-qrcode (camera) + manual text entry; qrcode.react for QR generation |
| Excel export | ExcelJS (`.xlsx`, not CSV — see Reports) |
| Dates | date-fns |
| Icons | lucide-react |
| Email delivery | Brevo SMTP relay, via edge functions |
| Hosting | Vercel |

---

## 3. User Roles & Access Control

Two roles, stored in `profiles.role`: `admin` and `cashier`.

### Route-level access (`src/App.jsx`)

| Route | Cashier | Admin |
|---|---|---|
| `/pos` | ✅ | ✅ |
| `/dashboard` | ✅ (own-data view) | ✅ (shop-wide view) |
| `/customers` | ✅ | ✅ |
| `/refunds` | ✅ (submit only) | ✅ (submit + approve/reject) |
| `/returns` | ✅ (submit only) | ✅ (submit + approve/reject) |
| `/products` | ❌ | ✅ |
| `/reports` | ❌ | ✅ |
| `/staff` | ❌ | ✅ |
| `/activity-log` | ❌ | ✅ |

A cashier hitting an admin-only route is redirected to `/pos`. The sidebar itself hides admin-only nav items for cashiers (not just route-guarded) — see §5.

---

## 4. App Shell (`Layout.jsx`)

- **Sidebar**: POS, Dashboard (unlabeled section), then **Management** (Products*, Customers, Staff Accounts*, Activity Log*) and **Finance** (Reports*, Refunds, Returns) — `*` = admin-only, filtered out of the menu entirely for cashiers.
- **Pending-request badge**: only the **Refunds** nav item shows a live red count of Pending refunds created since the page was last opened (per-device, cleared the moment Refunds is viewed). **Returns has no equivalent badge** — a known inconsistency.
- **Topbar**: current page icon/label, role pill, fullscreen toggle, profile menu (avatar initials, name, role, theme toggle, Edit Profile, Logout).
- **Edit Profile modal**: change display name; optional password change requires re-entering the current password first.
- **Data loading**: on mount (and on role change) the shell eagerly fetches products, customers, transactions, refunds, returns, holds, and categories for everyone; staff + activity log are fetched **only when `role==='admin'`**, since `profiles` has no RLS restriction and would otherwise leak the staff list to a cashier session that just has no route to view it.
- **No realtime subscriptions anywhere.** The only live-refresh behavior is a window `focus` listener that refetches refunds + returns (so an admin's remote approve/reject shows up when a cashier tabs back in) — everything else only updates on next navigation/action.
- **Mobile**: sidebar becomes a slide-in drawer below the `useBreakpoint()` threshold.

---

## 5. Features by Module

### 5.1 Authentication (`Login.jsx`, `ResetPassword.jsx`)
- Email + password sign-in via Supabase Auth.
- Animated mascot: eyes track the cursor, closes its eyes on password-field focus, "peeks" when the show/hide toggle is tapped, shakes on a failed login, hops on success. Time-of-day greeting. `prefers-reduced-motion`-aware.
- A suspended/banned account shows "This account has been suspended. Contact your administrator."; any other failure shows a generic "Invalid email or password" (doesn't leak which part was wrong).
- "Forgot password" always shows the same success toast regardless of whether the email exists (checked via the `check-email` edge function, but the response doesn't change user-facing behavior — avoids leaking registered emails).
- `ResetPassword.jsx` verifies the emailed link via `supabase.auth.verifyOtp` (not PKCE), so the link can be opened on a different device than the one that requested it; guards against React StrictMode firing the one-time verification twice in dev.
- New password enforced by a live strength checklist (`isPasswordStrong`).

### 5.2 Point of Sale / Checkout (`POS.jsx`, `Cart.jsx`)
- Product grid: thumbnail, stock badge (count / "LOW" at ≤3 / grayed "OUT OF STOCK" at 0); services show a blue "Service" pill instead and are hidden from the grid entirely if `isAvailable = false`.
- Search (name or barcode), category chip filter, sort (Name / Price ↑↓ / Stock). `/` focuses search, `Esc` clears it.
- **Barcode/serial scanning** (`ScanInput.jsx`): camera scan via html5-qrcode (CODE_128/CODE_39/EAN_13/QR) or manual typing, debounced to require two consecutive identical reads. A scan checks `product_serials` first, then `products.barcode`. Visual feedback via `ScanResultPill` (success/duplicate/error) plus an audio beep.
- **Serialized products**: clicking a `hasSerial` product opens a "Scan Serial" modal that keeps accepting scans for that line; cart quantity for that line always equals the number of scanned serials (not independently editable). Checkout is blocked if any serialized line's scanned-serial count doesn't match its quantity.
- Cart: qty stepper capped at live stock (99 for services); service lines can carry an optional ≤150-char job note, printed on the receipt.
- **Hold orders**: park the current cart + selected customer under a label; Holds modal is paginated (8/page); `/pos?holds=1` deep-links straight into it (used by a Dashboard link).
- **Payment**: Cash, GCash, or Split (two methods combined, e.g. `"Cash+GCash"`, remainder auto-computed). No Card option (legacy Card-paid sales remain in history unchanged). Cash blocks checkout if tendered amount is insufficient and shows live change due, with an explicit "Change Given" acknowledgment step before the receipt reveals.
- **VAT**: flat 12% of subtotal, no discount feature.
- Checkout is 3 steps (method → processing → success) with a synchronous double-submit guard. On success: `deduct_stock` RPC runs (atomic, row-locked); for serialized lines, `mark_serials_sold` stamps the scanned serials `Sold` **before** stock deduction — if that fails, `void_failed_sale` deletes the just-created transaction and aborts, so a partial sale never sticks. Registered customers earn loyalty points; walk-ins don't.
- Receipt: printable (react-to-print) and optionally emailed via the `send-receipt` edge function. Footer states "Items are non-refundable after 7 days."

### 5.3 Inventory / Products (`Products.jsx`) — Admin only
- Add/edit/delete products: name, category, price, cost price (not required for services), barcode (auto-generated `BC-<timestamp36>`, regenerable), image or emoji icon.
- **`is_service`** checkbox — hides stock/cost fields, forces no serial tracking, stock always 0. Picking the "Services" category auto-checks it.
- **`is_available`** checkbox (services only) — hides/shows the service in the POS grid without deleting it.
- **`has_serial`** checkbox (non-service only) — switches stock entry off entirely; stock becomes a read-only derived count from registered serials, managed through a "Serials" modal instead of a plain stock field.
- **Serials modal** (`SerialsModal.jsx`): add serials by scan or type (`add_serials` RPC, atomically bumps `products.stock`); delete an In-Stock serial (`delete_serial` RPC, -1 stock); list shows status badges (In Stock/Sold/Defective), Sold rows show the transaction # and date; paginated 8/page.
- **Find Serial** toolbar tool (`FindSerialModal.jsx`): look up any serial across the whole catalog (not scoped to one product) and see its status/sale history.
- Below-cost-price save triggers a confirmation modal ("sells at a loss by X%").
- Restock modal (non-serial products only): add qty, shows a live "new stock" preview.
- Category management modal: add/edit (badge color + icon only, not name)/delete; delete is blocked while any product still uses that category. Icon picker includes an "Auto" keyword-match mode.
- Images are client-resized before upload/storage (longest side capped, re-encoded) to stay under Supabase's storage limits.
- Table: search, category filter, stock-status filter (deep-linkable via `?stock=low|out`, used by Dashboard's attention cards), sort, 8/page pagination. Stock badges show inline "(New)" (≤30 days old) / "(Old)" (unsold 90+ days) hints.

### 5.4 Customers (`Customers.jsx`)
- Add/edit/delete customer records: name, email, phone, address.
- **Validation**: email must be a `@gmail.com` address if provided at all (empty allowed); phone is normalized to `+63` + 10 digits as you type and must fully match that shape to save, otherwise it's cleared.
- Loyalty points/purchases/total spent tracked automatically.
- Loyalty tiers: Bronze (0–499) / Silver (500–1,499) / Gold (1,500–2,999) / Platinum (3,000+).
- Points formula: **10 points per completed transaction + 1 point per ₱100 spent**; reversed symmetrically on refund/return approval (the 10-point bonus only reverses once a transaction becomes *fully* settled).
- "History" button opens a modal with that customer's transactions (filterable), tier + progress to next tier, paginated 8/page.
- Table: search (name/phone/email), sort, 8/page pagination.

### 5.5 Refunds (`Refunds.jsx`) — money-only, no inventory impact
A **3-step wizard**: Look up sale → Details → Confirm.
1. Look up the original transaction by transaction # or a scanned serial.
2. Enter a reason (Service not done / Service cancelled / Wrong quantity charged / Other), a flat peso **amount** (capped at what's actually left to refund on that transaction — i.e. total minus everything already Pending/Approved across refunds *and* money-back returns), method (Cash or GCash), notes.
3. Confirm & submit.

Refunds carry **no items, quantities, or serials** — approving one only changes money and loyalty stats, never stock. Starts **Pending**, must be **Approved or Rejected by an Admin**; rejection requires a reason (≥5 characters, enforced client- and server-side). **7-day window from purchase**, enforced both client-side (UX) and server-side (the real guarantee, inside the `create_refund` RPC). Duplicate-submit protection via a per-form `clientRequestId` the RPC treats as idempotent. Every submit/approve/reject is written to the Activity Log. History table has status filter pills + pagination; sidebar badge counts unseen Pending refunds for admins.

### 5.6 Returns (`Returns.jsx`) — physical item comes back
A **4-step wizard**: Find sale → Select items → Details → Confirm.
1. Look up the sale (transaction # or scanned serial); a fully-returned sale is blocked up front.
2. Select what's coming back — serialized lines pick individual (still-`Sold`) serials by scan or tap; non-serialized lines use a qty stepper capped at what's left to return.
3. Reason (Defective product / Wrong item delivered / Customer changed mind / Item not as described / Duplicate purchase / Other), method — **Cash refund, GCash refund, or Replacement** — notes, and **at least one evidence photo** (camera capture or upload; current UI caps this at 3 photos — note: a database migration comment references "up to 5," so this limit may be worth reconciling if it matters to you).
4. Itemized confirm screen, then submit.

Same 7-day window and idempotency pattern as Refunds. On **admin approval**, every physical unit must get an explicit **Resellable** (back to stock / serial returns to `In Stock`) or **Defective** (not restocked / serial flagged `Defective`) decision — there's no default, the Approve button stays disabled until every unit is set. **Replacement** additionally requires a replacement serial (same product, currently in stock) per returned serial, which gets marked `Sold` under the original transaction. Money-back methods (Cash/GCash refund) reverse the customer's loyalty points/spend the same way Refund approval does. Rejection requires a reason. Every step is activity-logged. History table mirrors Refunds' (status pills, pagination, photo-count badge).

### 5.7 Reports (`Reports.jsx`) — Admin only
Four tabs, each filterable by period (Today / This Week / This Month / This Year / Custom range):
- **Sales** — gross/net sales, returns & refunds, net profit, transaction count, average sale; a sales-vs-returns trend chart (hourly/daily/monthly depending on period span); payment-method donut; **Top Selling** and **Least Selling** product lists (Qty/Revenue toggle, independent 5/10/20/All count selector per card with pagination when "All" is picked — see note below); full transaction history table.
- **Inventory** — stock value (cost & retail), low/out-of-stock counts, 30-day top sellers, restock recommendations (status: Reorder now / Reorder soon / OK / No demand, based on 30-day sales velocity), low-stock & out-of-stock lists, slow-moving products (in stock, unsold 90+ days), products selling below cost, low-margin products (≤15%).
- **Returns & Refunds** — pending/approved/rejected counts and amounts, returned-units-by-condition donut, top rejection/return reasons, defective-returns ledger, combined request history.
- **Customers** — loyalty tier distribution, top spenders for the period, tier criteria reference.

Every table/list is paginated 8/page. Export to **`.xlsx`** (not CSV) via ExcelJS — branded header block, typed money/date/percent cells, bold totals with real `SUM()` formulas, one workbook per currently-open tab, scoped to the selected period; Top/Least Selling sheets respect whatever count is currently selected on screen (full list if "All").

> **Least Selling ranking rule** (current, as of this session's fix): only non-service, in-stock products that have existed in the system for **at least 10 days** are eligible, so brand-new or just-restocked items aren't unfairly flagged as worst sellers. Ties (commonly several products tied at 0 sold) break by stock value (stock × cost price) descending. If nothing qualifies, the card shows "Products need at least 10 days in the system to be ranked" instead of a generic empty state.

### 5.8 Dashboard (`Dashboard.jsx`)
**No tabs** — a single role-based view (this replaces an older tabbed Overview/Inventory/Customers/Refunds/Reports design that no longer exists in the code):
- **Admin view**: KPI row (Sales Today w/ Net sub-value and vs-yesterday %, Transactions, Items Sold, Average Sale, Pending Approvals linking to whichever of Refunds/Returns has more pending) → a 14-day gross-vs-returns revenue chart + a 30-day payment-methods donut → Top Products (last 30 days, fixed top-5, Qty/Revenue toggle — **intentionally separate from and unaffected by** the Reports tab's new 5/10/20/All selector) and Slow-Moving Products (top 5, links to Reports) → recent transactions table (last 5, links to Reports).
- **Cashier view**: own KPIs (My Sales Today, Items Sold) → "My Requests" (own refunds + returns, first 5 + a paginated "view all" modal) and "My Recent Transactions" (same pattern) → a Held Orders card (store-wide) if any holds exist.
- A "Needs Attention" chip row (low stock / out of stock / pending approvals) — admins click through to Products/Reports; cashiers get a read-only popover instead, since they can't reach those admin routes.

### 5.9 Staff Management (`Staff.jsx`) — Admin only
- Add cashier accounts (name, email, password ≥8 chars with upper/lower/number/special — new accounts always start as `cashier`, role is only editable afterward).
- Edit staff: name, email, optional new password, role.
- Suspend/Reactivate — only offered for cashier rows (an admin can't be suspended from this screen); suspension is a real Supabase Auth ban (~100-year `ban_duration`), not just a UI flag.
- Delete — hidden for your own row. The edge function additionally blocks deleting or demoting the **last remaining admin**, so the shop can never be left with zero admins.
- All mutations go through admin-only edge functions (never a direct table write) — see §6.
- Table: search (name/email), 8/page pagination.

### 5.10 Activity Log (`ActivityLog.jsx`) — Admin only
- Tracks: **staff, product, category, customer, refund, serial, return** actions (created/updated/deleted/approved/rejected/suspended/reactivated/restocked/submitted).
- Entries are immutable — the `activity_log` table has no UPDATE/DELETE policy at all, so nothing can alter or erase history once written, by database design.
- Search filters by actor name, entity label, or action text; 8/page pagination.
- Access is enforced both by the route guard and by RLS (`SELECT` is admin-only at the database level).

---

## 6. Backend (Supabase Edge Functions)

All run server-side with the service-role key (never exposed to the browser); all share the same CORS/JSON boilerplate.

| Function | Auth required | Purpose |
|---|---|---|
| `check-email` | None | Checks whether an email belongs to a registered user, ahead of a password-reset request (response doesn't change user-facing behavior, so it can't be used to enumerate accounts) |
| `create-cashier` | Admin JWT | Creates a new auth user + `profiles` row, always as `role='cashier'` (can't mint a second admin this way); rolls back the orphaned auth user if the profile insert fails |
| `update-staff` | Admin JWT | Updates a staff member's name/email/password/role; blocks demoting the last remaining admin |
| `toggle-staff-status` | Admin JWT | Suspends (real Auth-level ban) or reactivates a cashier account; refuses to target an admin account |
| `delete-staff` | Admin JWT | Permanently deletes a staff account; blocks self-delete and blocks deleting the last remaining admin |
| `send-receipt` | **None** (any caller who knows the endpoint) | Emails a styled HTML receipt for a transaction via Brevo SMTP |
| `send-low-stock-alert` | Any signed-in user | Emails every active admin with an email on file when a product crosses into Low (1–3) or Out of Stock (0) |

---

## 7. State Management (`src/store/index.js`)

Zustand, one store per concern — each owns its own Supabase fetch/mutate calls:

| Store | Responsibility |
|---|---|
| `useAuthStore` | Session/user/role, login/logout, session restore on load |
| `useAppStore` | Theme (light/dark), persisted to `localStorage` |
| `useProductStore` | Product catalog, `deduct_stock` RPC call, restock, CRUD |
| `useCategoryStore` | Category CRUD |
| `useCustomerStore` | Customer CRUD, loyalty points math (`addPoints`/`revertPurchase`) |
| `useTransactionStore` | Sale history fetch/insert |
| `useRefundStore` | `create_refund`/approve/`reject_refund` RPCs |
| `useReturnStore` | `create_return`/`approve_return`/`reject_return` RPCs, evidence-photo upload |
| `useSerialStore` | Serial lookup/search (backs Find Serial / Serials modal) |
| `useHoldStore` | Parked carts |
| `useCartStore` | Current cart + checkout totals (VAT, split payment, etc.) |
| `useStaffStore` | Staff list; every mutation proxies to an admin-only edge function |

No realtime subscriptions anywhere — data is fetched on load/navigation and on window focus (refunds/returns only).

---

## 8. Key Business Rules (confirmed from current code, not assumed)

- **VAT**: flat 12% of subtotal; no discount feature exists.
- **Loyalty points**: 10 pts/completed transaction + 1 pt per ₱100 spent; reversed proportionally when a sale is refunded/returned.
- **Loyalty tiers**: Bronze 0–499 / Silver 500–1,499 / Gold 1,500–2,999 / Platinum 3,000+.
- **Refund/Return window: 7 days from purchase** (both client-and server-enforced; the receipt footer and the policy modals both say this).
- **Refunds are money-only** — a flat peso amount against a transaction, never tied to items/qty/serials, never touches stock.
- **Returns are the only path for a physical item to come back** — approval requires an explicit Resellable/Defective call per unit; Replacement additionally issues a new serial.
- **Least Selling eligibility (Reports)**: non-service, in-stock, ≥10 days old.
- **Low stock**: fires at 1–3 units remaining (both the UI badge and the email alert).
- **Slow-moving**: in stock, no sale in 90+ days.
- **Low margin**: ≤15% profit margin.
- **Evidence photos (Returns)**: at least 1 required; current UI cap is 3 (a DB migration comment says "up to 5" — worth reconciling if the limit matters).
- **Pagination**: 8 rows/page everywhere, client-side.
- **Idempotent submission**: Refunds/Returns both generate a `clientRequestId` once per form-open so a spam-click or dropped response can't create a duplicate row.

---

## 9. Known Inconsistencies (surfaced during this review, not yet fixed)

- The Returns nav item has no pending-count badge, unlike Refunds.
- Evidence photo cap: UI code says 3 (`EvidencePhotoPicker.jsx`), a database migration comment says 5 — only one can be the intended limit.
- `Customers.jsx` uses a native `window.confirm()` for delete, while `Staff.jsx` uses the app's styled confirmation modal for the same kind of action.

# Gapuz POS System — Complete System Information

**System name:** Gapuz Web-Based Inventory and Point of Sale (POS) System
**For:** Gapuz Computer Services and Accessories
**Version:** 3.0.0

---

## 1. System Overview

A web-based application that lets **Administrator** and **Cashier** users manage sales, inventory, customers, and refunds for a computer parts/accessories shop. All data lives in the cloud (Supabase); nothing requires a local server.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18.3 |
| Build tool / dev server | Vite 6 |
| Styling | Tailwind CSS 3.4 |
| Routing | React Router DOM 6.20 |
| State management | Zustand 4.5 (with `persist` middleware for local-only state) |
| Backend / database | Supabase Cloud (PostgreSQL) |
| Authentication | Supabase Auth (email + password) |
| Serverless logic | Supabase Edge Functions (Deno/TypeScript) |
| Charts | Recharts 2.10 |
| Printing | react-to-print |
| QR codes | qrcode.react |
| Dates | date-fns |
| Icons | lucide-react |
| Email delivery | Brevo SMTP relay (via edge functions) |
| Hosting | Vercel (gapuz-pos.vercel.app) |

---

## 3. User Roles & Access Control

There are exactly **two roles**, stored in the `profiles.role` column: `admin` and `cashier`.

### Route-level access (`src/App.jsx`)

| Page / Route | Cashier | Admin |
|---|---|---|
| POS (`/pos`) — make a sale | ✅ | ✅ |
| Dashboard (`/dashboard`) | ✅ (limited tabs) | ✅ (all tabs) |
| Customers (`/customers`) | ✅ | ✅ |
| Refunds (`/refunds`) | ✅ (admin approves) | ✅ |
| Returns (`/returns`) | ✅ (admin approves) | ✅ |
| Products / Inventory (`/products`) | ❌ | ✅ |
| Reports (`/reports`) | ❌ | ✅ |
| Staff (`/staff`) | ❌ | ✅ |
| Activity Log (`/activity-log`) | ❌ | ✅ |

A cashier who tries to open an admin-only route is redirected back to `/pos`.

### Extra restriction inside the Dashboard page itself

The Dashboard has its own internal tabs. Even though `/dashboard` is open to cashiers, three of its tabs are hidden for them:

- **Visible to everyone:** Overview, Inventory
- **Admin-only tabs:** Customers, Refunds, Reports

### Summary — what a Cashier can actually do
1. Ring up sales at the POS (search/filter products, cart, checkout, print/email receipt, hold orders)
2. View a limited Dashboard (today's overview + inventory status only)
3. Manage customer records (add/edit/delete, view purchase history)
4. File refund/return requests (but cannot approve/reject — that's admin-only)

### What only an Admin can do (in addition to everything above)
- Manage products & categories (add/edit/delete/restock)
- View full Reports (sales, inventory, loss, customer, refund analytics + CSV export)
- Approve or reject refunds and returns
- Manage staff accounts (create/edit/suspend/reactivate/delete cashiers)
- View the Activity Log (audit trail)
- See full Dashboard (Customers/Refunds/Reports tabs + Inventory Value stat)

---

## 4. Database Schema (Supabase PostgreSQL)

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | One row per login — name, role, active flag | `role` ('admin'/'cashier'), `active` |
| `products` | Inventory catalog | `price`, `cost_price`, `stock`, `sold`, `barcode`, `image`, `last_sold_at` |
| `categories` | Product categories (admin-editable, not hardcoded) | `badge_color`, `icon`, `sort_order` |
| `customers` | Customer directory + loyalty stats | `points`, `purchases`, `total_spent` |
| `transactions` | One row per completed sale | `payment`, `subtotal`, `disc_amt`, `vat`, `total`, `cash_given`, `status`, `cashier_name` |
| `transaction_items` | Line items per sale | `product_id`, `name`, `qty`, `price` |
| `refunds` | Refund requests + outcome | `reason`, `refund_method`, `status` (Pending/Approved/Rejected), `processed_by` |
| `returns` | Merchandise return requests + outcome (mirrors `refunds`) | `reason`, `method`, `status` (Pending/Approved/Rejected), `processed_by`, `items` (JSONB) |
| `holds` | "Parked" carts, saved mid-sale | `items` (JSONB), `label` |
| `activity_log` | Audit trail — who did what | `actor_name`, `action`, `entity_type`, `details` (JSONB) — **insert-only, no update/delete policy, so entries can't be altered or erased once written** |

### Views (read-only, computed)
- `sales_summary` — daily revenue/discount/VAT totals grouped by payment method
- `product_sales` — per-product margin % and margin status (At Loss / Low Margin / Healthy)
- `customer_loyalty` — per-customer loyalty tier (Platinum/Gold/Silver/Bronze)

### Security
- Row-Level Security (RLS) is enabled on every table.
- All authenticated users can read and submit refund/return requests. Role-sensitive writes are now enforced **at the database level**, not just by the React app's route guards: only an admin can INSERT/DELETE products, INSERT/UPDATE/DELETE categories, or UPDATE (approve/reject) a `refunds`, `returns`, or `transactions` row — checked via a `profiles.role = 'admin'` lookup inside the policy itself, so a cashier can't bypass the UI and call the Supabase REST API directly to approve their own refund. `activity_log` similarly restricts SELECT to admins, and has no UPDATE/DELETE policy at all. Staff-management actions run through edge functions that verify the caller is an admin server-side.
- `products.stock` UPDATE is deliberately left open to any authenticated user (cashiers need it to deduct stock at checkout) — but checkout no longer writes stock directly; see the `deduct_stock` RPC below.

### Database functions (RPC)
| Function | Purpose |
|---|---|
| `deduct_stock(items jsonb)` | Atomically deducts stock for every line item in a sale. Locks each product row (`SELECT ... FOR UPDATE`) before computing its new stock, so two cashiers checking out the same product at the same moment queue instead of racing and overselling. Runs with the caller's own privileges (no `SECURITY DEFINER`), so normal RLS still applies. Replaces the old client-side "read stock, subtract, write back" logic in `deductStock` (`src/store/index.js`), which had a race condition. |
| `approve_return(p_return_id int)` | Atomically approves a return and restocks every item it covers in one call. Locks the return row first, so a double-click or dropped connection can't leave the status "Approved" with items partially or doubly restocked — a repeat call sees the status is no longer `Pending` and no-ops. Replaces a two-step client flow (a status `UPDATE`, then an unawaited `forEach` of `restockProduct()` calls) that had both bugs. |

---

## 5. Features by Module

### 5.1 Authentication (`Login.jsx`, `ResetPassword.jsx`)
- Email + password sign-in via Supabase Auth
- "Forgot password" flow — checks if the email is registered (`check-email` function) before sending a reset link, so users get a clear message instead of a silent no-op
- Password reset page (sets a new password after clicking the emailed link)
- In-app profile update: change display name; change password (requires re-entering the current password first, to prevent session hijacking from changing someone's password)
- Login screen has a polished, animated mascot: eyes follow the cursor, "closes its eyes" while the password field is focused and peeks when the show/hide-password toggle is tapped, shakes on a failed login, and hops on a successful one. Time-of-day greeting ("Good morning/afternoon/evening"), staggered entrance animations, and a `prefers-reduced-motion`-aware fallback that disables all of it.

### 5.2 Point of Sale / Sales (`POS.jsx`, `Cart.jsx`)
- Product grid with image/icon thumbnails, stock badges (in stock / low / out of stock)
- Search by name or barcode, filter by category, sort by name/price/stock
- Keyboard shortcuts (`/` to focus search, `Esc` to clear)
- Shopping cart with quantity controls, per-item stock caps
- **Hold orders** — park a cart under a label and restore it later (useful for multiple customers being served at once)
- Discounts — percentage or fixed peso amount
- Automatic **12% VAT** calculation
- Payment methods: Cash, GCash, Card, or **Split Payment** (two methods in one transaction)
- Cash payments calculate change due automatically; blocks checkout if cash given is insufficient
- Walk-in or registered-customer checkout (registered customers earn loyalty points)
- Printable receipt (via react-to-print) and optional **email receipt** to the customer
- Stock is deducted automatically on checkout via an atomic database function (`deduct_stock` RPC), so two cashiers checking out the same item at once can't oversell it; a low-stock email alert fires to all admins the moment any product's stock crosses from >0 to 0

### 5.3 Inventory / Products (`Products.jsx`) — Admin only
- Add / edit / delete products (name, category, selling price, cost price, stock, barcode, image or icon)
- Auto-generated barcodes for new products
- Image upload with automatic resize/compression before storing
- Restock existing products (adds to current stock, logged in Activity Log)
- Manage categories: add/edit/delete, assign a badge color and icon per category
- Warns when saving a product priced below its cost price ("selling at a loss")

### 5.4 Customers (`Customers.jsx`)
- Add / edit / delete customer records (name, email, phone, address)
- View each customer's purchase history
- Loyalty points, total purchases, and total amount spent tracked automatically
- Loyalty tiers (auto-computed from points): **Bronze** (0–499), **Silver** (500–1,499), **Gold** (1,500–2,999), **Platinum** (3,000+)
- Points formula: 10 points per completed transaction + 1 point per ₱100 spent

### 5.5 Refunds (`Refunds.jsx`)
A guided 4-step wizard:
1. Look up the original transaction by its transaction number
2. Select which items (and quantities) are being refunded
3. Enter refund details — reason, refund method (must match the original payment method: Cash→Cash, GCash→GCash, Card→Card), and notes
4. Confirm & submit

Refunds start as **Pending** and must be **Approved or Rejected by an Admin**. Approving a refund restocks the returned items and reverses the customer's loyalty points/purchase stats; every decision is written to the Activity Log. Policy: 15-day return window, original transaction ID required.

### 5.6 Returns (`Returns.jsx`)
A parallel workflow to Refunds with the same 4-step wizard and admin-approval model, used for merchandise returns/exchanges rather than a straight money refund. Returns are now fully **Supabase-backed** (own `returns` table, same as Refunds) — a return submitted on one machine survives a page reload or shows up on another device/cashier terminal, and every submit/approve/reject is written to the Activity Log. Approving a return **automatically restocks the returned items back into inventory** — the status flip and every item's restock happen as a single atomic database call (`approve_return` RPC), so a dropped connection or a double-click can't leave a return "Approved" with items only partially restocked or restocked twice. Rejecting one leaves stock untouched. Returns display as `RTN-0001`-style IDs. Admin approval is enforced both in the UI and by database RLS (a cashier's own REST call to approve a return is rejected server-side, same as Refunds).

### 5.7 Reports (`Reports.jsx`) — Admin only
Five report tabs, each filterable by period (Today / This Week / This Month / This Year):
- **Sales** — revenue, transaction count, VAT, average order value, revenue chart, payment-method breakdown, top/least selling products, full transaction table
- **Inventory** — total products, inventory value, low-stock & out-of-stock counts, old stock (added 90+ days ago, unsold 90+ days), new stock (added within 30 days), category breakdown
- **Loss** — products selling below cost price, estimated total loss, low-margin products (<15% margin)
- **Customer** — loyalty tier distribution, top spenders, tier criteria reference
- **Refund** — refund volume/status breakdown, refund policy summary, refund history table

Includes CSV export of the sales/transaction report.

### 5.8 Dashboard (`Dashboard.jsx`)
A quick at-a-glance home screen with Overview and Inventory tabs for everyone, and Customers/Refunds/Reports tabs reserved for Admins — covering today's revenue, items sold, average order value, 7/14-day revenue trends, stock alerts, loyalty tier counts, and refund status, depending on tab.

### 5.9 Staff Management (`Staff.jsx`) — Admin only
- Add new cashier accounts (name, email, password)
- Edit staff (name, email, password, role)
- Suspend / reactivate accounts (blocks login at the Supabase Auth level, not just an app flag)
- Delete staff accounts
- Safeguards: an admin can't delete or demote themselves into leaving the shop with zero admins; the last remaining admin can never be deleted or demoted

### 5.10 Activity Log (`ActivityLog.jsx`) — Admin only
Searchable, paginated audit trail of every tracked action: staff created/updated/suspended/reactivated/deleted, products created/updated/deleted/restocked, categories created/updated/deleted, customers deleted, refunds submitted/approved/rejected, **returns submitted/approved/rejected**. Entries cannot be edited or deleted once written (enforced at the database level).

### 5.11 Other
- **Light/dark theme toggle** (persisted locally per device)
- Responsive layout — adapts between desktop and mobile/tablet breakpoints

---

## 6. Backend (Supabase Edge Functions)

Server-side functions that use the Supabase service-role key (never exposed to the browser):

| Function | Purpose |
|---|---|
| `check-email` | Checks if an email belongs to a registered user, before sending a password-reset email |
| `create-cashier` | Creates a new staff account (auth user + profile) — admin-only, verified server-side |
| `update-staff` | Updates a staff member's name/email/password/role — admin-only; blocks demoting the last admin |
| `toggle-staff-status` | Suspends/reactivates a staff account (real Auth-level ban, not just a flag) — admin-only |
| `delete-staff` | Permanently deletes a staff account — admin-only; blocks deleting yourself or the last admin |
| `send-receipt` | Emails a transaction receipt to a customer via Brevo SMTP |
| `send-low-stock-alert` | Emails all active admins when a product's stock hits zero |

---

## 7. Key Business Rules

- VAT: 12%, applied after discount
- Loyalty points: 10 pts/transaction + 1 pt per ₱100 spent
- Loyalty tiers: Bronze (0–499) / Silver (500–1,499) / Gold (1,500–2,999) / Platinum (3,000+)
- "Low stock" threshold: 1–5 units remaining
- "Old stock" flag: added 90+ days ago AND not sold in the last 90 days
- "New stock" flag: added within the last 30 days
- "Low margin" flag: profit margin ≤15% of selling price
- Refund window: 15 days from purchase; refund method must match original payment method
- Refunds/returns require admin approval before stock is restored and customer stats are reversed

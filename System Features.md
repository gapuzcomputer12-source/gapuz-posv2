# Gapuz POS System — Features & Functionalities

**System name:** Gapuz Web-Based Inventory and Point of Sale (POS) System
**For:** Gapuz Computer Services and Accessories

This lists every feature/module in the system and what it does, **excluding the Refunds module**.

---

## 1. Authentication (`Login.jsx`, `ResetPassword.jsx`)
- Email + password sign-in via Supabase Auth
- "Forgot password" flow — checks if the email is registered before sending a reset link, so users get a clear message instead of a silent no-op
- Password reset page (sets a new password after clicking the emailed link)
- In-app profile update: change display name; change password (requires re-entering the current password first, to prevent session hijacking)
- Animated login mascot: eyes follow the cursor, closes its eyes while the password field is focused, shakes on a failed login, hops on success; time-of-day greeting; `prefers-reduced-motion`-aware

## 2. Point of Sale / Sales (`POS.jsx`, `Cart.jsx`)
- Product grid with image/icon thumbnails and stock badges (in stock / low / out of stock)
- Search by name or barcode, filter by category, sort by name/price/stock
- Keyboard shortcuts (`/` to focus search, `Esc` to clear)
- Shopping cart with quantity controls and per-item stock caps
- **Hold orders** — park a cart under a label and restore it later
- Discounts — percentage or fixed peso amount
- Automatic **12% VAT** calculation
- Payment methods: Cash, GCash, Card, or **Split Payment** (two methods in one sale)
- Automatic change calculation for cash; blocks checkout if cash given is insufficient
- Walk-in or registered-customer checkout (registered customers earn loyalty points)
- Printable receipt and optional email receipt to the customer
- Stock deducted atomically on checkout (`deduct_stock` RPC) so two cashiers can't oversell the same item; low-stock email alert fires to all admins the moment stock hits zero

## 3. Inventory / Products (`Products.jsx`) — Admin only
- Add / edit / delete products (name, category, selling price, cost price, stock, barcode, image or icon)
- Auto-generated barcodes for new products
- Image upload with automatic resize/compression before storing
- Restock existing products (adds to current stock, logged in Activity Log)
- Manage categories — add/edit/delete, assign a badge color and icon per category
- Warns when saving a product priced below its cost price ("selling at a loss")

## 4. Customers (`Customers.jsx`)
- Add / edit / delete customer records (name, email, phone, address)
- View each customer's purchase history
- Loyalty points, total purchases, and total amount spent tracked automatically
- Loyalty tiers (auto-computed from points): Bronze (0–499), Silver (500–1,499), Gold (1,500–2,999), Platinum (3,000+)
- Points formula: 10 points per completed transaction + 1 point per ₱100 spent

## 5. Returns (`Returns.jsx`)
- Guided 4-step wizard: look up the original transaction → select items/quantities → enter return details (reason, method, notes) → confirm & submit
- Return methods: Cash, GCash, Store Credit, or **Exchange** (merchandise swap, no money given back)
- Submitted as **Pending**; must be **Approved or Rejected by an Admin**
- Approving a return restocks the returned items — the status flip and every item's restock happen as one atomic database call (`approve_return` RPC), so a dropped connection or double-click can't leave it partially processed
- Rejecting a return leaves stock untouched
- Displays as `RTN-0001`-style IDs; every submit/approve/reject is written to the Activity Log
- Admin approval enforced both in the UI and by database row-level security

## 6. Reports (`Reports.jsx`) — Admin only
Report tabs, each filterable by period (Today / This Week / This Month / This Year):
- **Sales** — gross sales, net sales (after approved refunds/returns), net VAT, transaction count, average order value, gross-vs-net revenue chart, payment-method breakdown, top/least selling products, full transaction table, Sales Breakdown card (gross → deductions → net, with refund-rate indicator)
- **Inventory** — total products, inventory value, low-stock & out-of-stock counts, old stock (added 90+ days ago, unsold 90+ days), new stock (added within 30 days), category breakdown
- **Loss** — products selling below cost price, estimated total loss, low-margin products (<15% margin)
- **Customer** — loyalty tier distribution, top spenders, tier criteria reference
- **Refund** — refund/return volume and status breakdown, policy summary, history table
- CSV export of the sales report, including a gross/net/VAT/refund-rate summary and a list of approved refunds/returns for the period

## 7. Dashboard (`Dashboard.jsx`)
- **Overview tab** (everyone) — today's revenue (Net for cashiers; Net/Gross toggle for admins), transactions, items sold, average order value, 7/14-day gross-vs-net revenue trend chart, weekly sales, top products, least-selling products, low-stock/out-of-stock alerts, recent transactions
- **Inventory tab** (everyone) — product/category breakdown, low-stock and out-of-stock lists, top/least selling products
- **Customers tab** (admin only) — loyalty tier breakdown, top customers by spending
- **Refunds tab** (admin only) — refund status breakdown, recent refund requests
- **Reports tab** (admin only) — period-filtered net sales/VAT/transactions/AOV, revenue chart, Sales Breakdown card, top/least selling products this period

## 8. Staff Management (`Staff.jsx`) — Admin only
- Add new cashier accounts (name, email, password)
- Edit staff (name, email, password, role)
- Suspend / reactivate accounts (blocks login at the Supabase Auth level, not just an app flag)
- Delete staff accounts
- Safeguards: an admin can't delete or demote themselves (or anyone) into leaving zero admins — the last remaining admin can never be deleted or demoted

## 9. Activity Log (`ActivityLog.jsx`) — Admin only
- Searchable, paginated audit trail of every tracked action: staff created/updated/suspended/reactivated/deleted; products created/updated/deleted/restocked; categories created/updated/deleted; customers deleted; refunds and returns submitted/approved/rejected
- Entries cannot be edited or deleted once written (enforced at the database level — no UPDATE/DELETE policy on the table)

## 10. Other
- Light/dark theme toggle and English/Filipino language toggle (both persisted locally per device)
- Responsive layout — adapts between desktop and mobile/tablet breakpoints

---

## Key Business Rules (excluding refund-specific rules)
- VAT: 12%, applied after discount
- Loyalty points: 10 pts/transaction + 1 pt per ₱100 spent
- Loyalty tiers: Bronze (0–499) / Silver (500–1,499) / Gold (1,500–2,999) / Platinum (3,000+)
- "Low stock" threshold: 1–5 units remaining
- "Old stock" flag: added 90+ days ago AND not sold in the last 90 days
- "New stock" flag: added within the last 30 days
- "Low margin" flag: profit margin ≤15% of selling price
- Returns require admin approval before stock is restored
- A return only reduces reported sales when money/credit actually goes back (Cash, GCash, Store Credit) — an Exchange does not

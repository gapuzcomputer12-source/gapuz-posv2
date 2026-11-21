# Gapuz POS System — Features & Functionalities

**System name:** Gapuz Web-Based Inventory and Point of Sale (POS) System
**For:** Gapuz Computer Services and Accessories

This lists every feature/module in the system and what it does.

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
- **Hold orders** — park a cart under a label and restore it later; Held Orders list is paginated (8 per page)
- Automatic **12% VAT** calculation (total = subtotal + 12% VAT; the discount feature was removed)
- Payment methods: Cash, GCash, or **Split Payment** (two methods in one sale) — Card was removed as a selectable method; old Card-paid sales remain in history/reports unchanged
- Automatic change calculation for cash; blocks checkout if cash given is insufficient
- Walk-in or registered-customer checkout (registered customers earn loyalty points)
- Printable receipt and optional email receipt to the customer
- Stock deducted atomically on checkout (`deduct_stock` RPC) so two cashiers can't oversell the same item; low-stock email alert fires to all admins the moment stock genuinely decreases to 1, 2, 3 ("Low Stock") or 0 ("Out of Stock") — see §10

## 3. Inventory / Products (`Products.jsx`) — Admin only
- Add / edit / delete products (name, category, selling price, cost price, stock, barcode, image or icon)
- Auto-generated barcodes for new products
- Image upload with automatic resize/compression before storing
- Restock existing products (adds to current stock, logged in Activity Log)
- Manage categories — add/edit/delete, assign a badge color and icon per category; category list is paginated (8 per page)
- Warns when saving a product priced below its cost price ("selling at a loss")
- Product table is paginated (8 per page, Back/Next)

## 4. Customers (`Customers.jsx`)
- Add / edit / delete customer records (name, email, phone, address)
- View each customer's purchase history (paginated modal, 8 per page)
- Loyalty points, total purchases, and total amount spent tracked automatically
- Loyalty tiers (auto-computed from points): Bronze (0–499), Silver (500–1,499), Gold (1,500–2,999), Platinum (3,000+)
- Points formula: 10 points per completed transaction + 1 point per ₱100 spent
- Customer table is paginated (8 per page)

## 5. Refunds (`Refunds.jsx`)
- Guided 4-step wizard: look up the original transaction → select items/quantities → enter refund details (reason, refund method, notes) → confirm & submit
- Refund method: Cash or GCash
- Submitted as **Pending**; must be **Approved or Rejected by an Admin**
- Approving a refund restocks the returned items and reverses the customer's loyalty points/purchase stats
- Rejecting a refund leaves stock and loyalty stats untouched
- Policy: 15-day return window, original transaction ID required
- Every submit/approve/reject is written to the Activity Log
- Admin approval enforced both in the UI and by database row-level security
- Refund History table is paginated (8 per page)
- Sidebar "Refunds" nav item shows a live red badge counting pending requests submitted since the page was last viewed — clears the moment the page is opened (per-device, not synced across admin logins)
- Browser tab title reflects role and workload: cashiers see "Refunds", admins see "Refund Approval" — or `(N) Refund Approval` when N requests are pending

## 6. Reports (`Reports.jsx`) — Admin only
Report tabs, each filterable by period (Today / This Week / This Month / This Year):
- **Sales** — gross sales, net sales (after approved refunds), net VAT, transaction count, average order value, gross-vs-net revenue chart, payment-method breakdown, top/least selling products, full transaction table (paginated), Sales Breakdown card (gross → deductions → net, with refund-rate indicator)
- **Stock Monitoring** (formerly "Inventory") — total products, inventory value, low-stock & out-of-stock counts, old stock (added 90+ days ago, unsold 90+ days, paginated), new stock (added within 30 days, paginated), low stock list (paginated, aligned side-by-side with New Stock), category breakdown
- **Loss** — products selling below cost price (paginated), estimated total loss, low-margin products <15% margin (paginated), loss-from-transactions table (paginated)
- **Customer** — loyalty tier distribution, top spenders, tier criteria reference
- **Refund** — refund volume and status breakdown, policy summary, history table (paginated)
- CSV export of the sales report — RFC 4180-escaped fields (safe against commas/quotes in names), consistent 2-decimal money formatting, UTF-8 BOM so it opens cleanly in Excel without garbled characters; includes a gross/net/VAT/refund-rate summary and a list of approved refunds for the period

## 7. Dashboard (`Dashboard.jsx`)
- **Overview tab** (everyone) — today's revenue (Net for cashiers; Net/Gross toggle for admins), transactions, items sold, average order value, 7/14-day gross-vs-net revenue trend chart, weekly sales, top products, least-selling products (paginated), low-stock/out-of-stock alert cards, recent transactions table (paginated)
- **Inventory tab** (everyone) — product/category breakdown, low-stock and out-of-stock lists (paginated, aligned side-by-side), top/least selling products (least-selling paginated)
- **Customers tab** (admin only) — loyalty tier breakdown, top customers by spending
- **Refunds tab** (admin only) — refund status breakdown, recent refund requests
- **Reports tab** (admin only) — period-filtered net sales/VAT/transactions/AOV, revenue chart, Sales Breakdown card, top/least selling products this period, transaction history table (paginated)

## 8. Staff Management (`Staff.jsx`) — Admin only
- Add new cashier accounts (name, email, password)
- Edit staff (name, email, password, role)
- Suspend / reactivate accounts (blocks login at the Supabase Auth level, not just an app flag)
- Delete staff accounts
- Safeguards: an admin can't delete or demote themselves (or anyone) into leaving zero admins — the last remaining admin can never be deleted or demoted
- Staff table is paginated (8 per page)

## 9. Activity Log (`ActivityLog.jsx`) — Admin only
- Searchable, paginated audit trail (8 per page) of every tracked action: staff created/updated/suspended/reactivated/deleted; products created/updated/deleted/restocked; categories created/updated/deleted; customers deleted; refunds submitted/approved/rejected
- Entries cannot be edited or deleted once written (enforced at the database level — no UPDATE/DELETE policy on the table)

## 10. Low-Stock Email Alerts
- Emails every active admin when a product's stock genuinely decreases (not on every poll) and lands at:
  - **1, 2, or 3 units** → "Low Stock" email, shows the real remaining count
  - **0 units** → "Out of Stock" email
- A batch sale that jumps straight past the threshold (e.g. 6 → 1 in one checkout) still fires correctly — it's based on the resulting stock level, not an exact crossing
- Fires from both checkout deduction and manual stock edits in Products.jsx
- Sent via a Supabase Edge Function (`send-low-stock-alert`) over Brevo SMTP

## 11. Browser Tab Titles & Favicon
- Every page sets a distinct document title with the page name first (e.g. "POS · Gapuz POS", "Inventory · Gapuz POS") so Chrome's tab truncation never hides which page a tab is on
- Login screen keeps the full brand title
- 32×32 and 180×180 (Apple touch icon) favicons generated from the existing "G" logo, plus a theme-color meta tag

## 12. Pagination
- Every table and list across both dashboards shows at most **8 rows per page**, with Back/Next controls and a "Showing X–Y of Z" counter
- Pagination follows search/filter/sort — changing any of them resets the table back to page 1
- Row numbers (where shown) continue correctly across pages
- Side-by-side card pairs (Low Stock / Out of Stock, Low Stock / New Stock) stay visually aligned — the pagination bar pins to the bottom of each card even when one list is shorter than the other
- Short, fixed-size lists (Top Products, Top Customers, cart contents, dropdowns) are intentionally left unpaginated

## 13. Other
- Light/dark theme toggle (persisted locally per device)

---

## Key Business Rules
- VAT: 12% of subtotal (no discount feature)
- Loyalty points: 10 pts/transaction + 1 pt per ₱100 spent
- Loyalty tiers: Bronze (0–499) / Silver (500–1,499) / Gold (1,500–2,999) / Platinum (3,000+)
- "Low stock" threshold: 1–3 units remaining (UI badges and email alerts both use this threshold)
- "Old stock" flag: added 90+ days ago AND not sold in the last 90 days
- "New stock" flag: added within the last 30 days
- "Low margin" flag: profit margin ≤15% of selling price
- Refund window: 15 days from purchase; refund method must match original payment method
- Refunds require admin approval before stock is restored and customer stats are reversed
- Table/list pagination: 8 rows per page everywhere, client-side only

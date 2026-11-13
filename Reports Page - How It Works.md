# Reports Page — Codebase Report

A read-only audit of `src/pages/Reports.jsx` and everything it uses, written
from the source on 2026-11-13. No code was changed to produce this. This
replaces an older version of this doc that described a pre-redesign layout
(5 tabs: Sales/Inventory/Loss/Customer/Refund, CSV export) — the page has
since been rebuilt into the 4-tab, xlsx-export layout documented below.

## 1. Structure

**Tabs** (`REPORT_TABS`): **Sales, Inventory, Returns & Refunds, Customers** — 4 tabs, single-select `SegmentedControl`, no sub-tabs. Loss and Refund (from the old layout) are gone as separate tabs — Loss's content moved into Inventory, Refund's content merged with Returns into one "Returns & Refunds" tab.

**Filters:**
- **Period** segmented control: Today / This Week / This Month / This Year / **Custom** (a popover with two date inputs + Apply). Shown in the toolbar on **every tab** — unlike the old layout, it is not Sales/Refund-only.
- Inventory tab shows a static "Stock as of today" note next to the period control, since stock levels themselves aren't period-filtered (restock/below-cost/slow-moving math still uses the period for "sold" counts).
- Category filter: **not found**. Cashier filter: **not found**.
- `useSearchParams` reads `?tab=` on mount to deep-link into a specific tab (e.g. from Dashboard "View all →" links).

**Who can see it:** not checked in this file — gated upstream by the route guard in `App.jsx` (not re-read for this pass).

**Export:** one `exportXlsx()` → `.xlsx` workbook via `exportXlsx.js` (`createWorkbook`/`addSheet`/`addMultiTableSheet`/`downloadWorkbook`). Replaces the old single-format CSV export. **Is tab-aware** — only the currently active tab's sheets are written, filename is `gapuz-pos-<tab>-<from>-to-<to>.xlsx`.

---

## 2. Each tab, top to bottom

### Sales tab
| Item | Shows | Formula / source |
|---|---|---|
| 6 KPI cards | Gross Sales, Returns & Refunds, Net Sales, Net Profit (+ Gross Profit sub), Transactions, Average Sale | `computeSalesMetrics({from:periodStart,to:periodEnd})` |
| "Sales vs Returns & Refunds" chart | Gross (area/bar) vs Returns (line/bar), bucketed hourly (Today, 8am–8pm) / daily (Week/Month/short Custom) / monthly (Year/long Custom) | `buildBuckets()`, one `computeSalesMetrics` call per bucket |
| Sales Breakdown card (`SalesBreakdownCard`) | same `metrics` object as a prop | — |
| Payment Methods donut | `tx.payment` revenue split for the period | `filtered` transactions, raw `payment` string, Cash/GCash/Card/Split colors |
| Top 5 / Least 5 Selling | toggle Qty ↔ Revenue (`topMetric`) | `filtered` transactions' items; Least-selling includes 0-sold products from `products` |
| Transaction History table | every transaction in period, paginated | Txn#, date, customer, item count, payment, subtotal, VAT, total |

Average Sale = Gross Sales ÷ transaction count (gross-based, matches Dashboard).

### Inventory tab
Now a merged superset of the old Inventory + Loss tabs.

| Item | Shows | Formula |
|---|---|---|
| 5 stat cards | Total Products, Stock Value at Cost, Stock Value at Retail, Low Stock, Out of Stock | Σ `costPrice×stock` / Σ `price×stock`, both **excluding Services** (`!p.isService`) |
| Top Sellers (30d) | top 8 by units sold in trailing 30 days | `demandMap` built from all transactions in `[now-29d, now]` |
| Restock Recommendations table | per-product avg/day, days-left, suggested reorder, status pill, filterable by status | see §3 below — paginated, status filter chips show live counts |
| Low Stock list | `stock>0 && stock<=3`, Services excluded | paginated simple list |
| Out of Stock list | `stock===0`, Services excluded | paginated simple list |
| Slow-Moving Products | in stock, Services excluded, never sold or `lastSoldAt` > 90 days ago | sorted by `tiedUp = stock×costPrice` descending |
| Products Selling Below Cost | `price < costPrice`, Services excluded | **Sold** = units sold **in the selected period** (`periodSoldMap`, not all-time); **Total loss** = `(costPrice−price)×soldInPeriod` |
| Low Margin Products | `costPrice` set, Services excluded, margin 0–15% | `margin = round((price−costPrice)/price×100)`, all-time (not period-dependent) |

Restock/below-cost/low-margin tables all live on this one tab now, each with its own pagination — no more separate "Loss" tab.

### Returns & Refunds tab
Merges what used to be a standalone "Refund" tab with a (previously nonexistent) dedicated Returns view.

| Item | Shows | Date field |
|---|---|---|
| 5 stat cards | Pending (returns+refunds submitted), Approved Returns (+ amount), Approved Refunds (+ amount), Total Money Back, Rejected | Pending/Rejected counted by **`createdAt`** (submission); Approved amounts by **`processedAt`** (approval), falling back to `createdAt` |
| Returned Units by Condition donut | Resellable vs Defective, tallied from `returnsApproved[].conditions` | — |
| Top Reasons | top 6 reasons across submitted refunds **and** returns combined | — |
| Defective Returns table | one row per defective unit/serial across approved returns, with cost value | paginated; subtitle shows unit count + total cost |
| History table | combined Returns+Refunds list, filterable by type (All/Returns/Refunds) and status (All/Pending/Approved/Rejected) | by `createdAt`, paginated |

`totalMoneyBack` = approved refund amounts + approved **money-back** returns only (`isMoneyBack(method)` — a "Replacement" return does not count, since no cash leaves the business).

### Customers tab
| Item | Shows |
|---|---|
| 4 stat cards | Total Customers, Total Points, Platinum Members, Gold Members — all all-time |
| Tier Distribution donut | Platinum/Gold/Silver/Bronze counts, all-time |
| Top Customers list | top 8 by amount spent **in the selected period** (`topCustsPeriod`, built from `filtered` transactions) — this is period-aware, unlike the stat cards above it |
| Loyalty Tier Criteria panel | static ranges (Bronze 0–499, Silver 500–1,499, Gold 1,500–2,999, Platinum 3,000+) + live counts + share-of-total bars |

No Gross/Net/Refund figures on this tab.

---

## 3. Inventory / Restock logic (`demandRows`, Inventory tab)

- **Demand window**: trailing 30 days from `now` (`last30Start = startOfDay(subDays(now,29))`), independent of the page's period selector.
- `sold30` = units sold per product in that window; `avgDaily = sold30/30`.
- `daysLeft = avgDaily>0 ? stock/avgDaily : Infinity`.
- `suggestedReorder = max(0, ceil(avgDaily*14) - stock)` — covers 14 days of projected sales.
- **Status**: `No demand` (sold30===0) → `Reorder now` (daysLeft≤7, or stock===0 with any demand) → `Reorder soon` (daysLeft≤14) → else `OK`.
- Sorted by status rank, then ascending `daysLeft` within a status.
- Services excluded from all of the above (`demandRows` filters `!p.isService`).
- **Slow-Moving** is a separate, simpler 90-day-no-sale cutoff (`!lastSoldAt || lastSoldAt < now-90d`), not tied to the 30-day demand window — a product can be "OK" by demand status (if it sold recently) while never appearing in Slow-Moving, or vice versa if it has old stock with no recent sales at all.

---

## 4. Sales math (`src/utils/salesMetrics.js`, `computeSalesMetrics`)

- **Gross Sales** = Σ `tx.total` for transactions with `createdAt` in `[from,to]`.
- **Gross Profit** = Σ over those transactions' items of `(price − costPrice) × qty` (VAT-excluded; missing `costPrice` reads as 0).
- **Approved refunds/returns** are filtered by **`processedAt`** (falls back to `createdAt` for legacy rows), not by sale date — a refund approved today counts against today's period even if the original sale was weeks ago.
- **Returns** only count toward `returnTotal`/`netSales` if `isMoneyBack(method)` is true (Cash refund / GCash refund) — a Replacement return doesn't reduce revenue.
- **refundedProfit**: refunds are money-only post-redesign and normally carry no `items`, so profit impact is approximated as `total / 1.12` (backing out VAT from the flat peso amount) for items-less rows; legacy rows that still have `items` use real per-line `(price−cost)×qty` instead.
- **returnedProfit**: returns always carry real `items`, so it's always exact per-line `(price−cost)×qty`.
- **Net Sales** = Gross Sales − (refundTotal + returnTotal).
- **Net Profit** = Gross Profit − refundedProfit − returnedProfit, rounded to cents.
- **Net VAT** = Gross VAT − refundedVat, where `refundedVat = deducted − deducted/1.12` (treats the deducted total as VAT-inclusive).
- **Refund Rate** = deducted / Gross Sales × 100.
- This function is shared verbatim with `Dashboard.jsx` (and `getDailySeries` for trend charts), so Reports and Dashboard numbers always agree when computed over the same window.

---

## 5. Export (`.xlsx`)

`exportXlsx()` builds one workbook per click, containing **only the active tab's sheets**:

- **Sales** → Summary (with Payment Methods sub-table), Transactions (incl. a computed `Status` column — Completed/Returned/Refunded/Partially Returned via `txnStatus()`, checked against **all-time** refunds/returns, not just the period), Items Sold, Returns & Refunds.
- **Inventory** → Restock, Low & Out of Stock, Slow-Moving, Pricing Issues (Below Cost + Low Margin sub-tables).
- **Returns & Refunds** → Summary, Defective Returns, Request History.
- **Customers** → Top Customers, Tier Summary.

Headers use real calendar dates (`exportPeriodLabel`, e.g. "Nov 7, 2026 – Nov 13, 2026") rather than the UI's relative label ("This Week"), plus a `Generated: <date/time> by <user>` line. Filename embeds the tab and date range.

`txnStatus()` is export-only (not shown on screen) and intentionally checks the transaction against the full, unfiltered refund/return history — a sale from today could still be returned next week, so period-scoping it would misclassify recent transactions.

---

## 6. Print / PDF

Not present in this file — no print button or PDF export path in `Reports.jsx`.

---

## 7. Notable design choices (not bugs, but worth knowing)

1. **Restock/below-cost "sold" figures use two different windows on the same tab.** Restock Recommendations uses a fixed trailing-30-day window regardless of the period selector; Below Cost's "Sold" column uses whatever period is currently selected. Low Margin uses neither (all-time). All three sit on the Inventory tab at once.
2. **Pending/Rejected counts vs Approved amounts use different date fields** on the Returns & Refunds tab (`createdAt` for counts, `processedAt` for approved amounts) — a request submitted in one period and approved in the next can shift which period's "Approved" total it lands in without affecting that period's "Pending" count.
3. **Top Customers (period) vs the stat cards above it (all-time)** on the Customers tab read different windows by design — easy to misread them as directly comparable at a glance.
4. **Slow-Moving (90-day) and the Restock demand window (30-day)** are independent cutoffs that can disagree on the same product.

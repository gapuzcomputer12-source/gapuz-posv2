# Reports Page — Codebase Report

A read-only audit of `src/pages/Reports.jsx` and everything it uses, written
from the source on 2026-11-13. No code was changed to produce this.

## 1. Structure

**Tabs** (`REPORT_TABS` in `Reports.jsx`): **Sales, Inventory, Loss, Customer, Refund** — 5 tabs, single-select, no sub-tabs.

**Filters:**
- **Period** (Today / This Week / This Month / This Year) — shown and applies **only to the Sales and Refund tabs** (`{(activeTab==='sales'||activeTab==='refund') && ...}`). Inventory, Loss, and Customer tabs show **all-time** data with no date control at all.
- Category filter: **not found**.
- Cashier filter: **not found**.
- One exception worth flagging: the Loss tab's "Loss from Transactions — {period}" table is period-dependent (reads the same `period` state), but the Loss tab itself renders no period selector — you can only change it by first switching to Sales or Refund.

**Who can see it:** Admin only. The route itself is wrapped in `<Guard adminOnly>` in `App.jsx`, and `/reports` isn't in the cashier's sidebar nav at all — no tab-level exceptions.

---

## 2. Each tab, top to bottom

### Sales tab
| Item | Shows | Source / range | Formula |
|---|---|---|---|
| 8 KPI cards (`.kpi-grid`) | Gross Sales, Refunds, Net Sales, Net VAT, Gross Profit, Net Profit, Transactions, Average Order | `transactions`+`refunds`+`returns`, via `computeSalesMetrics({from:periodStart, to:now})` | See below |
| Revenue Chart — Gross vs Net | Line chart, Gross (dashed) vs Net, bucketed by hour (Today) or day (else) | Same stores, one `computeSalesMetrics` call per bucket | gross/net per bucket |
| Sales Breakdown (`SalesBreakdownCard`) | Gross/Refunds/Returns/Net/Profit/Refund rate | Same `metrics` object, passed as a prop | same as KPIs, but **does** show Returns separately |
| Payment Methods pie | `tx.payment` revenue split for the period | `filtered` (period-filtered transactions) | sum of `tx.total` per raw `payment` string |
| Top Selling Products (top 5) | by qty sold | `filtered` transactions' `items` | sum `qty`/`qty*price` per product name |
| Least Selling Products (top 5) | lowest qty sold, 0 included for unsold products | `filtered` + all `products` | same aggregation, ascending |
| Transaction History table | every transaction in period | `filtered`, paginated | — |

**Formulas** (`src/utils/salesMetrics.js`, `computeSalesMetrics`):
- **Gross Sales** = Σ `tx.total` for transactions with `created_at` in `[periodStart, now]`.
- **Refunds** (KPI card) = Σ `total` of **refunds only** (`status='Approved'`), filtered by **`processed_at`** (falls back to `created_at` if null) in range. **Returns are not included in this card** even though they're deducted elsewhere (see Problems).
- **Net Sales** = Gross Sales − (refund total **+ return total**, both money-back only, by `processed_at`).
- **Gross Profit** = Σ over in-range transactions' items of `(item.price − item.costPrice) × qty` — VAT-excluded (item.price is pre-VAT).
- **Net Profit** = Gross Profit − refunded-profit − returned-profit (same per-item formula, from each refund's/return's own `items`).
- **Net VAT** = Gross VAT (Σ `tx.vat`) − "refunded VAT" (derived by treating the combined refund+return total as VAT-inclusive: `deducted − deducted/1.12`).
- **Average Order** = Gross Sales ÷ Transaction count (confirmed gross-based, consistent with the Dashboard fix).
- Returns included: **yes**, in Net Sales/Net VAT/Net Profit math and in `SalesBreakdownCard`'s own Returns row — but **not** in the Sales tab's "Refunds" KPI card, which only shows `refundTotal`.

### Inventory tab
| Item | Shows | Source/range | Formula |
|---|---|---|---|
| Total Products, Inventory Value, Low Stock, Out of Stock | stat cards | `products`, all-time | Inventory Value = Σ `price×stock` (no Services exclusion) |
| Old Stock Items / New Stock Items | stat cards | `products.created_at`/`last_sold_at` | see §3 |
| Products by Category pie | count per category | `products`, all products incl. Services | — |
| Old Stock — Needs Attention (list) | name, days added, days since last sold, stock, price | same as above | — |
| Low Stock (list) | name, category, stock | `stock>0 && stock<=3`, Services excluded | — |
| New Stock (list) | name, days ago, price | `created_at` ≤30 days ago | — |

### Loss tab
| Item | Shows | Formula |
|---|---|---|
| Products at Loss / Estimated Total Loss / Low Margin Products | stat cards | counts/sum, Services excluded |
| Products Selling at a Loss (table) | every product with `price < cost_price` | **Total Loss** = `(costPrice−price) × sold` (`sold` = all-time lifetime units, not period-filtered) |
| Low Margin Products (table) | `margin = round((price−costPrice)/price×100)`, 0–15% | all-time |
| Loss from Transactions — {period} | loss actually realized from sales **in the selected period** | per item: `(costPrice−price) × qty sold in period` |
| Returns included? | **No** — this entire tab only ever reads `products`/`transactions`, never `refunds` or `returns`. |

### Customer tab
| Item | Shows |
|---|---|
| Total Customers, Total Points, Platinum/Gold Members | stat cards, all-time |
| Loyalty Tier Criteria | static ranges (Bronze <500, Silver 500–1499, Gold 1500–2999, Platinum 3000+) + live counts |
| Tier Distribution pie | same tier counts |
| Top Customers by Spending (top 8) | sorted by `total_spent`, all-time, no period filter |

No Gross/Net/Refund figures on this tab at all.

### Refund tab
| Item | Shows | Date field used |
|---|---|---|
| Total Refunds / Pending / Approved / Total Refunded | stat cards | filtered by **`created_at`** (`refFiltered`), not `processed_at` |
| Refund Status Breakdown pie | Pending/Approved/Rejected counts | same `refFiltered` |
| Refund Policy Summary | static text (see Problems — says 15 days) | — |
| Refund History table | every refund in `refFiltered` | — |

**Returns on this tab: not found** — the Refund tab only ever reads `refunds`, never `returns`.

---

## 3. Inventory logic

- **Old Stock**: `created_at` more than **90 days** ago **AND** `last_sold_at` more than **90 days** ago (or never sold). Both conditions required.
- **New Stock**: `created_at` within the last **30 days** — `last_sold_at` not considered at all.
- Demand / days-of-stock-left / reorder suggestion: **not found**.
- Services excluded: **inconsistently**. Low Stock, Out of Stock, Products-at-Loss, and Low-Margin all exclude `category==='Services'`. **Old Stock, New Stock, Inventory Value, and the Products-by-Category pie do not** — a Services row can appear in the Old/New Stock lists.

---

## 4. Returns

No dedicated Returns report section anywhere on this page — **not found**: no approved-returns count, no Resellable-vs-Defective breakdown, no return reasons list. Returns are only visible here as:
1. Silently folded into Sales tab's Net Sales/Net VAT/Net Profit and the combined chart "refunds" series (labeled just "Refunds").
2. Listed separately (correctly) in `SalesBreakdownCard`'s own Returns row.
3. Exported as `RETURN` rows in the CSV.

---

## 5. CSV export

One `exportCSV()` function, **not tab-aware** — clicking "Export CSV" always produces the same "GAPUZ POS - SALES SUMMARY" file regardless of which tab (Inventory/Loss/Customer/Refund) is currently active.

Contents: Metric/Value summary (Gross Sales, Refunds, Returns, Net Sales, Gross/Net Profit, Gross VAT, Refunded VAT, Net VAT, Refund Rate) → full Transaction list (TXN#, Date, Customer, Items count, Payment, Subtotal, Discount, VAT, Total, Status) → Approved Refunds/Returns list (Type, #, Original TXN#, Approval Date, Amount).

Respects the date filter: **yes** — summary and transactions use `periodStart`; refunds/returns are filtered by **`processed_at`** in `[periodStart, now]` (unlike the Refund tab's own table, which filters by `created_at` — see Problems).

---

## 6. Print / PDF

**Not found.** No print button, no `react-to-print` usage, no PDF export anywhere in `Reports.jsx`. A plain browser print (Ctrl+P) would also come out **blank** — `index.css`'s global `@media print` rule hides `body *` except `#receipt-printable`, which only exists on the POS/Refund receipt components, not this page.

---

## 7. Problems

1. **"Refunds" KPI card omits Returns.** The Sales tab's KPI grid shows a card labeled "Refunds" = `refundTotal` only, while the "Net Sales" card right next to it subtracts `refundTotal + returnTotal`. The two numbers don't reconcile on screen whenever any returns exist in the period (`SalesBreakdownCard` further down the same tab shows the correct split).
2. **Refund tab filters by `created_at`; Sales tab/CSV deduct by `processed_at`.** A refund submitted in one period but approved in a later one will show on the Refund tab for the submission period (and count toward its "Total Refunded"), but the Sales tab's Net Sales and the CSV will instead count it in the approval period — the two tabs can report different numbers for "refunds this period."
3. **`refundedProfit` is always 0.** `computeSalesMetrics` computes it from `refund.items`, but since the money-only refund redesign, `create_refund` never writes an `items` array (or `subtotal`/`vat`) to the row at all — so Net Profit's refund deduction is silently a no-op for every refund going forward. Returns are unaffected (they still carry real `items`).
4. **Loss tab's "Loss from Transactions — {period}" has no visible period control** on that tab, even though it's period-dependent — the period can only be changed from the Sales or Refund tab.
5. **Average Order**: now gross-based on both Dashboard and this Reports page (consistent) — this was a previously-reported inconsistency and is **fixed**.
6. **Old Stock before the `last_sold_at` fix**: since `last_sold_at` was never written until the recent `deduct_stock`/backfill migration, every product read `lastSoldAt = null → daysSinceLastSold = 999`, which always satisfies `>90`. In practice this made "Old Stock" equivalent to just "added 90+ days ago" — the "not sold recently" half of the condition was vacuously always true. This is corrected only once that migration has actually been run against the live database.
7. **Export CSV is not tab-aware** (see §5) — mild but worth listing as a "wrong/confusing" behavior, not just a feature gap.
8. **Refund Policy Summary text says "15-Day Return Period"** — the actual enforced window (`SALE_ADJUSTMENT_DAYS` in `helpers.js`, used by `create_refund`/`create_return`) is **7 days**. This static copy block is stale.

---

## 8. Duplicates

**Within Reports:**
- "Pending" refund count appears twice on the same Refund tab (stat card + pie slice).
- "Low Stock" count appears twice on the same Inventory tab (stat card + full list card). "Out of Stock" has a stat card but **no** corresponding detail list anywhere on this page.

**Between Reports and the (redesigned, tab-less) Dashboard:**
- Gross/Net Sales + Avg Sale — Dashboard's "Sales Today" KPI vs Reports' Sales-tab KPIs (same `computeSalesMetrics`, different window: today vs selected period — overlap is by design, Dashboard explicitly links out to this tab).
- Payment Methods chart — Dashboard's 30-day donut vs Reports' period-filtered pie.
- Top Selling Products — Dashboard's 30-day Qty/Revenue toggle list vs Reports' period-filtered, qty-only list.
- Low Stock / Out of Stock — Dashboard's "Needs Attention" summary cards (names + link) vs Reports' full paginated lists.
- Slow-Moving Products (Dashboard, 30-day no-sale cutoff) vs Old Stock (Reports, 90-day-both-ways cutoff) — related but **not identical** criteria.
- Recent Transactions — Dashboard's last-5 vs Reports' full period-filtered table (Dashboard explicitly links "View all →" here).
- Pending returns/refunds count — Dashboard's KPI/alert card vs Reports' Refund tab stats.

Reports' **Inventory stock-value/old-new lists, Loss tab, and Customer tab have no Dashboard equivalent** since the Dashboard redesign removed those sections — no duplication there.

---

## Summary table

| Tab | Items inside | Uses period filter |
|---|---|---|
| Sales | 8 KPI cards, Gross/Net line chart, Sales Breakdown card, Payment Methods pie, Top/Least Selling lists, Transaction table | Yes |
| Inventory | 4+2 stat cards, Category pie, Old Stock list, Low Stock list, New Stock list | No |
| Loss | 3 stat cards, At-Loss table, Low-Margin table, Loss-from-Transactions table | Partial (last table only, via leftover `period` state) |
| Customer | 4 stat cards, Tier Criteria panel, Tier Distribution pie, Top Customers table | No |
| Refund | 4 stat cards, Status pie, Policy Summary, Refund History table | Yes (by `created_at`, inconsistent with Sales tab) |

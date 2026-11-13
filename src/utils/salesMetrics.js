import { isWithinInterval, startOfDay, endOfDay, subDays, format } from 'date-fns'

// A Return filed as 'Replacement' swaps merchandise for merchandise — no
// cash leaves the business, so it must not reduce revenue. Any other
// method ('Cash refund', 'GCash refund') does hand money back.
export const MONEY_BACK_METHODS = new Set(['Cash refund', 'GCash refund'])
export const isMoneyBack = (method) => method == null || MONEY_BACK_METHODS.has(method)

// Refunds/returns deduct revenue in the period they were APPROVED, not the
// period of the original sale — processed_at is stamped at approval time.
// Older rows approved before that column existed fall back to created_at.
const approvedDate = (record) => new Date(record.processedAt || record.createdAt)

const inRange = (date, from, to) => isWithinInterval(date, { start: from, end: to })

// Pure — no store/React imports — so Dashboard.jsx and Reports.jsx always
// compute gross/net the same way from the same records.
// Per-unit profit is (selling price − cost price) × qty — item.price is
// already VAT-exclusive (see useCartStore.getTotals), so no VAT stripping
// needed here. Missing costPrice (e.g. a product deleted since the sale,
// or a pre-migration row never backfilled) reads as 0 cost rather than
// throwing, same fallback the rest of the app uses for costPrice.
const lineProfit = (item) => (item.price - (item.costPrice || 0)) * (item.qty || 1)

export function computeSalesMetrics({ transactions = [], refunds = [], returns = [], from, to }) {
  const txnsInRange = transactions.filter(tx => inRange(new Date(tx.createdAt), from, to))
  const grossSales = txnsInRange.reduce((s, tx) => s + (tx.total || 0), 0)
  const grossVat    = txnsInRange.reduce((s, tx) => s + (tx.vat || 0), 0)
  const transactionCount = txnsInRange.length
  const grossProfit = txnsInRange.reduce((s, tx) => s + (tx.items || []).reduce((a, i) => a + lineProfit(i), 0), 0)

  const approvedRefunds = refunds.filter(r => r.status === 'Approved' && inRange(approvedDate(r), from, to))
  const refundTotal = approvedRefunds.reduce((s, r) => s + (r.total || 0), 0)
  const refundCount = approvedRefunds.length
  // Refunds are money-only post-redesign (no items/qty — see the refund
  // audit), so most rows have no per-line profit to subtract: a refund's
  // `total` is a flat VAT-inclusive peso amount, and backing out the VAT
  // portion (total / 1.12) gives the pre-VAT amount actually eating into
  // profit. A handful of legacy rows predate that redesign and still carry
  // `items` — for those, use the same per-item (price − cost) × qty basis
  // as returns instead, so a legacy refund's profit hit reflects what was
  // actually sold rather than its flat total.
  const refundedProfit = approvedRefunds.reduce((s, r) => {
    if (r.items?.length) return s + r.items.reduce((a, i) => a + lineProfit(i), 0)
    return s + (r.total || 0) / 1.12
  }, 0)

  // A Return's `items` are already exactly the quantities being returned
  // (no separate full-qty vs partial-qty split like Refunds), so lineProfit
  // reads item.qty directly. create_return also refuses any item that
  // already has a Pending/Approved Refund against it — see
  // add_returns_table.sql — so a sale's value is never deducted twice here.
  const approvedReturns = returns.filter(r => r.status === 'Approved' && isMoneyBack(r.method) && inRange(approvedDate(r), from, to))
  const returnTotal = approvedReturns.reduce((s, r) => s + (r.total || 0), 0)
  const returnCount = approvedReturns.length
  const returnedProfit = approvedReturns.reduce((s, r) => s + (r.items || []).reduce((a, i) => a + lineProfit(i), 0), 0)

  const deducted    = refundTotal + returnTotal
  const netSales     = grossSales - deducted
  const netProfit    = Math.round((grossProfit - refundedProfit - returnedProfit) * 100) / 100
  // Refund/return totals are VAT-inclusive (subtotal * 1.12), so the VAT
  // portion of the deducted amount is amount − amount / 1.12.
  const refundedVat = deducted - deducted / 1.12
  const netVat        = grossVat - refundedVat
  const refundRate   = grossSales > 0 ? (deducted / grossSales) * 100 : 0

  return { grossSales, refundTotal, refundCount, returnTotal, returnCount, netSales, grossVat, refundedVat, netVat, refundRate, transactionCount, grossProfit, netProfit }
}

// Day-by-day gross/net/refunds series for the last `days` days (inclusive of
// today), for the Dashboard's revenue trend chart.
export function getDailySeries({ transactions = [], refunds = [], returns = [], days = 14 }) {
  const today = startOfDay(new Date())
  return Array.from({ length: days }, (_, i) => {
    const day = subDays(today, days - 1 - i)
    const m = computeSalesMetrics({ transactions, refunds, returns, from: startOfDay(day), to: endOfDay(day) })
    return {
      date: format(day, 'MMM d'),
      gross: m.grossSales,
      net: m.netSales,
      refunds: m.refundTotal + m.returnTotal,
    }
  })
}

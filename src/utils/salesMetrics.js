import { isWithinInterval, startOfDay, endOfDay, subDays, format } from 'date-fns'

// Refunds deduct revenue in the period they were APPROVED, not the
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

export function computeSalesMetrics({ transactions = [], refunds = [], from, to }) {
  const txnsInRange = transactions.filter(tx => inRange(new Date(tx.createdAt), from, to))
  const grossSales = txnsInRange.reduce((s, tx) => s + (tx.total || 0), 0)
  const grossVat    = txnsInRange.reduce((s, tx) => s + (tx.vat || 0), 0)
  const transactionCount = txnsInRange.length
  const grossProfit = txnsInRange.reduce((s, tx) => s + (tx.items || []).reduce((a, i) => a + lineProfit(i), 0), 0)

  const approvedRefunds = refunds.filter(r => r.status === 'Approved' && inRange(approvedDate(r), from, to))
  const refundTotal = approvedRefunds.reduce((s, r) => s + (r.total || 0), 0)
  const refundCount = approvedRefunds.length
  // Refund items carry `refundQty` (a partial qty of the original line)
  // instead of `qty` — see Refunds.jsx.
  const refundedProfit = approvedRefunds.reduce((s, r) => s + (r.items || []).reduce((a, i) => a + lineProfit({ ...i, qty: i.refundQty ?? i.qty }), 0), 0)

  const netSales     = grossSales - refundTotal
  const netProfit    = grossProfit - refundedProfit
  // Refund totals are VAT-inclusive (subtotal * 1.12), so the VAT
  // portion of the refunded amount is amount − amount / 1.12.
  const refundedVat = refundTotal - refundTotal / 1.12
  const netVat        = grossVat - refundedVat
  const refundRate   = grossSales > 0 ? (refundTotal / grossSales) * 100 : 0

  return { grossSales, refundTotal, refundCount, netSales, grossVat, refundedVat, netVat, refundRate, transactionCount, grossProfit, netProfit }
}

// Day-by-day gross/net/refunds series for the last `days` days (inclusive of
// today), for the Dashboard's revenue trend chart.
export function getDailySeries({ transactions = [], refunds = [], days = 14 }) {
  const today = startOfDay(new Date())
  return Array.from({ length: days }, (_, i) => {
    const day = subDays(today, days - 1 - i)
    const m = computeSalesMetrics({ transactions, refunds, from: startOfDay(day), to: endOfDay(day) })
    return {
      date: format(day, 'MMM d'),
      gross: m.grossSales,
      net: m.netSales,
      refunds: m.refundTotal,
    }
  })
}

import { isWithinInterval, startOfDay, endOfDay, subDays, format } from 'date-fns'

// Methods that hand money (or a store-credit liability) back to the customer.
// A return filed as 'Exchange' swaps merchandise for merchandise — no cash
// leaves the business, so it must not reduce revenue. Any method not in this
// set (today just 'Exchange') is treated as non-money-back.
const MONEY_BACK_METHODS = new Set(['Cash', 'GCash', 'Store Credit'])
const isMoneyBack = (method) => method == null || MONEY_BACK_METHODS.has(method)

// Refunds/returns deduct revenue in the period they were APPROVED, not the
// period of the original sale — processed_at is stamped at approval time.
// Older rows approved before that column existed fall back to created_at.
const approvedDate = (record) => new Date(record.processedAt || record.createdAt)

const inRange = (date, from, to) => isWithinInterval(date, { start: from, end: to })

// Pure — no store/React imports — so Dashboard.jsx and Reports.jsx always
// compute gross/net the same way from the same records.
export function computeSalesMetrics({ transactions = [], refunds = [], returns = [], from, to }) {
  const txnsInRange = transactions.filter(tx => inRange(new Date(tx.createdAt), from, to))
  const grossSales = txnsInRange.reduce((s, tx) => s + (tx.total || 0), 0)
  const grossVat    = txnsInRange.reduce((s, tx) => s + (tx.vat || 0), 0)
  const transactionCount = txnsInRange.length

  const approvedRefunds = refunds.filter(r => r.status === 'Approved' && inRange(approvedDate(r), from, to))
  const refundTotal = approvedRefunds.reduce((s, r) => s + (r.total || 0), 0)
  const refundCount = approvedRefunds.length

  const approvedReturns = returns.filter(r => r.status === 'Approved' && isMoneyBack(r.method) && inRange(approvedDate(r), from, to))
  const returnTotal = approvedReturns.reduce((s, r) => s + (r.total || 0), 0)
  const returnCount = approvedReturns.length

  const deducted    = refundTotal + returnTotal
  const netSales     = grossSales - deducted
  // Refund/return totals are VAT-inclusive (subtotal * 1.12), so the VAT
  // portion of the deducted amount is amount − amount / 1.12.
  const refundedVat = deducted - deducted / 1.12
  const netVat        = grossVat - refundedVat
  const refundRate   = grossSales > 0 ? (deducted / grossSales) * 100 : 0

  return { grossSales, refundTotal, refundCount, returnTotal, returnCount, netSales, grossVat, refundedVat, netVat, refundRate, transactionCount }
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

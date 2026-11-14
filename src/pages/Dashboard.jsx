import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { Hand, Clock, ChevronRight, Trophy, Package, Receipt, ClipboardList, Wallet, Calculator, PauseCircle } from 'lucide-react'
import { useTransactionStore, useProductStore, useAuthStore, useRefundStore, useReturnStore, useHoldStore, useAppStore } from '../store'
import { useT, peso, pesoCompact, paymentDisplay, fmtDate } from '../utils/helpers'
import { computeSalesMetrics, getDailySeries } from '../utils/salesMetrics'
import { StatusBadge } from '../components/RefundDetailsModal'
import StatCard from '../components/StatCard'
import ChartCard from '../components/ChartCard'
import RankedList from '../components/RankedList'
import DonutCard from '../components/DonutCard'
import Modal from '../components/Modal'
import Pagination from '../components/Pagination'
import { usePagination } from '../hooks/usePagination'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// No blue anywhere — same payment palette as Reports.jsx.
const PAY_COLOR = { Cash: '#059669', GCash: '#8B5CF6', Card: '#D97706', Split: '#64748B' }
const paymentColor = (p) => PAY_COLOR[p] || PAY_COLOR.Split

// First 3 names + "+N more" — shown in a Needs Attention chip's tooltip.
function namesSummary(list) {
  const shown = list.slice(0, 3).map(p => p.name).join(', ')
  const rest = list.length - 3
  return rest > 0 ? `${shown}, +${rest} more` : shown
}

const CHIP_TONE = {
  red:   { bg: 'var(--rpt-red-light)',   fg: 'var(--rpt-red)' },
  amber: { bg: 'var(--rpt-amber-light)', fg: 'var(--rpt-amber)' },
  green: { bg: 'var(--rpt-green-light)', fg: 'var(--rpt-green)' },
}
// Small clickable pill — replaces the old big Needs Attention cards so the
// greeting row can surface the same alerts without pushing the charts
// below the fold. Native `title` gives the hover tooltip for free.
function Chip({ tone, label, title, onClick }) {
  const c = CHIP_TONE[tone]
  return (
    <button onClick={onClick} title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99,
      border: 'none', cursor: onClick ? 'pointer' : 'default', fontSize: 12, fontWeight: 700,
      fontFamily: 'inherit', background: c.bg, color: c.fg, whiteSpace: 'nowrap',
    }}>{label}</button>
  )
}

const SkeletonCard = () => <div className="rpt-card" style={{ padding: 20 }}><div className="skeleton" style={{ height: 90 }} /></div>

// "View all" for the cashier's own refund/return requests — a self-contained
// modal rather than a navigate() to /refunds or /returns, since those pages
// list every cashier's requests store-wide, not just the signed-in
// cashier's. Defined at module scope (not nested inside Dashboard) so its
// usePagination state isn't torn down every time Dashboard re-renders for
// an unrelated reason — a component declared inside another component's
// body is a new type every render, which would reset its own state.
// Rendered through Modal's portal, which lands OUTSIDE the .rpt-scope div
// Dashboard renders inside — so this uses the app's normal themeable
// tokens (var(--text3), .card-surface, etc.), never the --rpt-* variables,
// which only exist under .rpt-scope and would resolve to nothing here.
function MyRequestsModal({ open, onClose, requests, isLight }) {
  const pg = usePagination(requests, 8)
  if (!open) return null
  return (
    <Modal open onClose={onClose} contentStyle={{ width: 'min(440px,92vw)' }}>
      <div className="card animate-scale-in" style={{ padding: 24, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ClipboardList size={15} style={{ color: 'var(--accent)' }} />My Requests ({requests.length})
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {requests.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>
              <ClipboardList size={30} style={{ opacity: .2, marginBottom: 8 }} /><div>No requests yet.</div>
            </div>
          ) : pg.pageItems.map(r => (
            <div key={`${r.kind}-${r.id}`} className="card-surface" style={{ padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.kind} #{String(r.id).padStart(4, '0')}</span>
                <StatusBadge status={r.status} isLight={isLight} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4 }}>{fmtDate(r.createdAt)} · {peso(r.total)}</div>
              {r.status === 'Rejected' && r.rejectionReason && (
                <div style={{ fontSize: 11.5, color: 'var(--red)', fontStyle: 'italic', marginTop: 3 }}>Reason: {r.rejectionReason}</div>
              )}
            </div>
          ))}
        </div>
        <Pagination {...pg} />
      </div>
    </Modal>
  )
}

// "View all" for the cashier's own transactions — same reasoning as
// MyRequestsModal above (no store-wide page to link to that's still
// scoped to just this cashier, so a self-contained modal instead).
function MyTransactionsModal({ open, onClose, transactions }) {
  const pg = usePagination(transactions, 8)
  if (!open) return null
  return (
    <Modal open onClose={onClose} contentStyle={{ width: 'min(480px,92vw)' }}>
      <div className="card animate-scale-in" style={{ padding: 24, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Receipt size={15} style={{ color: 'var(--accent)' }} />My Transactions ({transactions.length})
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {transactions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>
              <Receipt size={30} style={{ opacity: .2, marginBottom: 8 }} /><div>No transactions yet.</div>
            </div>
          ) : pg.pageItems.map(tx => (
            <div key={tx.id} className="card-surface" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>#{String(tx.id).padStart(4, '0')}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{new Date(tx.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {tx.customerName || 'Walk-in'}</div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--text2)', marginTop: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: paymentColor(tx.payment) }} />{paymentDisplay(tx.payment).label}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{peso(tx.total)}</div>
            </div>
          ))}
        </div>
        <Pagination {...pg} />
      </div>
    </Modal>
  )
}

export default function Dashboard() {
  useDocumentTitle('Dashboard')
  const transactions = useTransactionStore(s => s.transactions)
  const txLoading    = useTransactionStore(s => s.loading)
  const products     = useProductStore(s => s.products)
  const prodLoading  = useProductStore(s => s.loading)
  const refunds      = useRefundStore(s => s.refunds)
  const returns      = useReturnStore(s => s.returns)
  const holds        = useHoldStore(s => s.holds)
  const { theme }    = useAppStore()
  const { user, role } = useAuthStore()
  const isAdmin = role === 'admin'
  const isLight = theme === 'light'
  const t = useT()
  const navigate = useNavigate()
  const [topMetric, setTopMetric] = useState('qty') // 'qty' | 'revenue'
  // Cashier-only UI state: the low/out-of-stock chips open a read-only
  // popover instead of navigating (cashiers can't reach /products, which
  // is admin-only), and My Requests/My Transactions "View all" open a
  // modal scoped to just this cashier (see MyRequestsModal/MyTransactionsModal).
  const [stockPopover, setStockPopover] = useState(null) // 'low' | 'out' | null
  const stockPopoverRef = useRef(null)
  const [viewAllRequests, setViewAllRequests] = useState(false)
  const [viewAllTxns, setViewAllTxns] = useState(false)

  useEffect(() => {
    if (!stockPopover) return
    const onClick = e => { if (stockPopoverRef.current && !stockPopoverRef.current.contains(e.target)) setStockPopover(null) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [stockPopover])

  const loading = txLoading || prodLoading
  const now   = new Date()
  const today = startOfDay(now)
  const yest  = subDays(today, 1)
  const thirtyAgo = startOfDay(subDays(now, 29))

  const myName = user?.user_metadata?.name || user?.email?.split('@')[0] || ''
  const hour     = now.getHours()
  const greeting = hour < 12 ? t('good_morning') : hour < 17 ? t('good_afternoon') : t('good_evening')

  // ── Shared (both roles) ───────────────────────────────────
  const isService = (productId) => !!products.find(p => p.id === productId)?.isService
  const todayTxns = useMemo(() => transactions.filter(tx => { const d = new Date(tx.createdAt); d.setHours(0, 0, 0, 0); return d.getTime() === today.getTime() }), [transactions, today])
  const itemsSoldToday = useMemo(() => todayTxns.reduce((s, tx) => s + (tx.items || []).reduce((a, i) => a + (isService(i.id) ? 0 : i.qty), 0), 0), [todayTxns, products])
  const lowStock = useMemo(() => products.filter(p => p.stock > 0 && p.stock <= 3 && !p.isService), [products])
  const outStock = useMemo(() => products.filter(p => p.stock === 0 && !p.isService), [products])

  // ── Admin-only ────────────────────────────────────────────
  const todayMetrics = useMemo(() => computeSalesMetrics({ transactions, refunds, returns, from: today, to: now }), [transactions, refunds, returns, today, now])
  const yestMetrics   = useMemo(() => computeSalesMetrics({ transactions, refunds, returns, from: yest, to: endOfDay(yest) }), [transactions, refunds, returns, yest])
  const grossChange = yestMetrics.grossSales > 0 ? Math.round(((todayMetrics.grossSales - yestMetrics.grossSales) / yestMetrics.grossSales) * 100) : null
  const avgSale = todayTxns.length ? Math.round(todayMetrics.grossSales / todayTxns.length) : 0

  const pendingReturns = useMemo(() => returns.filter(r => r.status === 'Pending').length, [returns])
  const pendingRefunds = useMemo(() => refunds.filter(r => r.status === 'Pending').length, [refunds])

  const areaData = useMemo(() => getDailySeries({ transactions, refunds, returns, days: 14 }), [transactions, refunds, returns])

  const payData30 = useMemo(() => {
    const map = {}
    transactions.forEach(tx => {
      if (new Date(tx.createdAt) < thirtyAgo) return
      const label = paymentDisplay(tx.payment).label
      map[label] = (map[label] || 0) + tx.total
    })
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter(d => d.value > 0)
  }, [transactions, thirtyAgo])

  const topProds30 = useMemo(() => {
    const map = {}
    transactions.forEach(tx => {
      if (new Date(tx.createdAt) < thirtyAgo) return
      ;(tx.items || []).forEach(i => {
        if (isService(i.id)) return
        if (!map[i.name]) map[i.name] = { name: i.name, sold: 0, revenue: 0 }
        map[i.name].sold += i.qty
        map[i.name].revenue += i.qty * i.price
      })
    })
    return Object.values(map).sort((a, b) => topMetric === 'qty' ? b.sold - a.sold : b.revenue - a.revenue).slice(0, 5)
  }, [transactions, thirtyAgo, topMetric, products])
  const topBasis = p => topMetric === 'qty' ? p.sold : p.revenue
  const topMax = topProds30[0] ? topBasis(topProds30[0]) : 1

  const slowMoving = useMemo(() => products
    .filter(p => !p.isService && p.stock > 0 && (!p.lastSoldAt || new Date(p.lastSoldAt) < thirtyAgo))
    .map(p => ({ ...p, tiedUp: (p.stock || 0) * (p.costPrice || 0) }))
    .sort((a, b) => b.tiedUp - a.tiedUp)
    .slice(0, 5), [products, thirtyAgo])

  const recentTxns = transactions.slice(0, 5)
  const txBadges = (tx) => ({
    refunded: refunds.some(r => r.transactionId === tx.id && r.status === 'Approved'),
    returned: returns.some(r => r.transactionId === tx.id && r.status === 'Approved'),
  })

  // ── Cashier-only ──────────────────────────────────────────
  const myTxns = useMemo(() => transactions.filter(tx => tx.cashierName === myName), [transactions, myName])
  const myTodayTxns = useMemo(() => myTxns.filter(tx => { const d = new Date(tx.createdAt); d.setHours(0, 0, 0, 0); return d.getTime() === today.getTime() }), [myTxns, today])
  const myTodayAmount = myTodayTxns.reduce((s, tx) => s + tx.total, 0)
  const myItemsSoldToday = useMemo(() => myTodayTxns.reduce((s, tx) => s + (tx.items || []).reduce((a, i) => a + (isService(i.id) ? 0 : i.qty), 0), 0), [myTodayTxns, products])
  const myRequestsAll = useMemo(() => {
    const mine = [
      ...refunds.filter(r => r.submittedBy === myName).map(r => ({ ...r, kind: 'Refund' })),
      ...returns.filter(r => r.submittedBy === myName).map(r => ({ ...r, kind: 'Return' })),
    ]
    return mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [refunds, returns, myName])
  const myRequests = useMemo(() => myRequestsAll.slice(0, 5), [myRequestsAll])

  // `to` navigates (the original/admin usage); `onClick` overrides that for
  // a caller that wants a local action instead (e.g. opening a modal).
  const LinkOut = ({ to, onClick, children }) => (
    <button onClick={onClick || (() => navigate(to))} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--rpt-green)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'inherit' }}>
      {children}<ChevronRight size={12} />
    </button>
  )

  const SalesTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{ background: '#059669' }} /><span className="chart-tooltip-name">Sales</span><span className="chart-tooltip-value">{peso(d.gross)}</span></div>
        <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{ background: '#DC2626' }} /><span className="chart-tooltip-name">Returns</span><span className="chart-tooltip-value" style={{ color: 'var(--rpt-red)' }}>−{peso(d.refunds)}</span></div>
        <div className="chart-tooltip-row" style={{ borderTop: '1px solid var(--rpt-divider)', marginTop: 4, paddingTop: 6 }}><span className="chart-tooltip-dot" style={{ background: 'var(--rpt-title)' }} /><span className="chart-tooltip-name" style={{ fontWeight: 700, color: 'var(--rpt-title)' }}>Net</span><span className="chart-tooltip-value">{peso(d.net)}</span></div>
      </div>
    )
  }

  const pendingTotal = pendingReturns + pendingRefunds
  const nothingToFlag = lowStock.length === 0 && outStock.length === 0 && !(isAdmin && pendingTotal > 0)

  return (
    <div className="rpt-scope" style={{ height: '100%', overflowY: 'auto', padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* HEADER — greeting + date on one line, Needs Attention chips on the right */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, color: 'var(--rpt-title)' }}>{greeting}, <span style={{ color: 'var(--rpt-green)' }}>{user?.user_metadata?.name || 'there'}</span><Hand size={18} style={{ color: 'var(--rpt-amber)' }} /></div>
          <span style={{ color: 'var(--rpt-muted)', fontSize: 12.5 }}>{now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
        {!loading && (
          <div ref={stockPopoverRef} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
            {/* Admins jump to the Products page (stock=low/out filter already
                wired there); cashiers can't reach that admin-only page, so
                the same chip instead opens a small read-only popover here. */}
            {lowStock.length > 0 && <Chip tone="amber" label={`⚠ ${lowStock.length} low stock`} title={namesSummary(lowStock)} onClick={() => isAdmin ? navigate('/products?stock=low') : setStockPopover(p => p === 'low' ? null : 'low')} />}
            {outStock.length > 0 && <Chip tone="red" label={`⛔ ${outStock.length} out of stock`} title={namesSummary(outStock)} onClick={() => isAdmin ? navigate('/products?stock=out') : setStockPopover(p => p === 'out' ? null : 'out')} />}
            {isAdmin && pendingTotal > 0 && <Chip tone="amber" label={`⏳ ${pendingTotal} pending approvals`} onClick={() => navigate(pendingRefunds >= pendingReturns ? '/refunds' : '/returns')} />}
            {nothingToFlag && <Chip tone="green" label="✓ All good" />}

            {!isAdmin && stockPopover && (
              <div className="rpt-card" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, padding: 14, zIndex: 20, width: 240, maxHeight: 280, overflowY: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rpt-title)', marginBottom: 8 }}>
                  {stockPopover === 'low' ? 'Low Stock' : 'Out of Stock'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(stockPopover === 'low' ? lowStock : outStock).map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                      <span style={{ color: 'var(--rpt-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ color: stockPopover === 'low' ? 'var(--rpt-amber)' : 'var(--rpt-red)', fontWeight: 700, flexShrink: 0 }}>{p.stock} left</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="rpt-kpi-row">
          {Array.from({ length: isAdmin ? 5 : 2 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isAdmin ? <>

        {/* ══════════ KPI ROW ══════════ */}
        <div className="rpt-kpi-row">
          <StatCard icon={Wallet} label="Sales Today" value={pesoCompact(todayMetrics.grossSales)}
            sub={`Net ${peso(todayMetrics.netSales)} · ${grossChange == null ? '—' : `${grossChange >= 0 ? '+' : ''}${grossChange}%`} vs yesterday`} />
          <StatCard icon={Receipt} label="Transactions" value={todayTxns.length} />
          <StatCard icon={Package} label="Items Sold" value={itemsSoldToday} />
          <StatCard icon={Calculator} label="Avg Sale" value={peso(avgSale)} />
          <StatCard icon={Clock} label="Pending Approvals" value={pendingTotal} tone={pendingTotal > 0 ? 'amber' : 'default'}
            sub={`${pendingReturns} returns · ${pendingRefunds} refunds`}
            onClick={() => navigate(pendingRefunds >= pendingReturns ? '/refunds' : '/returns')} />
        </div>

        {/* ══════════ SALES CHART + PAYMENT METHODS ══════════ */}
        <div className="rpt-grid-12">
          <div className="rpt-col-8">
            <ChartCard title="Sales — Last 14 Days" style={{ height: '100%' }}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={areaData}>
                  <defs>
                    <linearGradient id="dashGrossGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--rpt-grid-line)" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--rpt-tick)' }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--rpt-tick)' }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}`} />
                  <Tooltip content={<SalesTip />} />
                  <Area type="monotone" dataKey="gross" name="Sales" stroke="#059669" strokeWidth={2} fill="url(#dashGrossGradient)" />
                  <Line type="monotone" dataKey="refunds" name="Returns" stroke="#DC2626" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="rpt-col-4">
            <ChartCard title="Payment Methods — Last 30 Days" style={{ height: '100%' }} bodyStyle={{ display: 'flex', alignItems: 'center' }}>
              <DonutCard data={payData30.map(d => ({ name: d.name, value: d.value, color: paymentColor(d.name) }))} caption="total" formatValue={pesoCompact} emptyText="No payments in the last 30 days." />
            </ChartCard>
          </div>
        </div>

        {/* ══════════ TOP PRODUCTS + SLOW MOVING ══════════ */}
        <div className="rpt-grid-12">
          <div className="rpt-col-6">
            <ChartCard title={<><Trophy size={14} style={{ color: 'var(--rpt-amber)' }} />Top Products — Last 30 Days</>}
              actions={
                <div className="seg-track seg-sm">
                  {['qty', 'revenue'].map(v => (
                    <button key={v} type="button" onClick={() => setTopMetric(v)} className={`seg-btn${topMetric === v ? ' active' : ''}`}>{v === 'qty' ? 'Qty' : 'Revenue'}</button>
                  ))}
                </div>
              }>
              <RankedList
                items={topProds30.map(p => ({ key: p.name, label: p.name, value: topBasis(p), _p: p }))}
                max={topMax}
                renderValue={it => topMetric === 'qty' ? `${it._p.sold} sold` : peso(it._p.revenue)}
                emptyText="No sales in the last 30 days."
              />
            </ChartCard>
          </div>

          <div className="rpt-col-6">
            <ChartCard title={<><Package size={14} style={{ color: 'var(--rpt-muted)' }} />{t('slow_moving')}</>}
              actions={<LinkOut to="/reports?tab=inventory">See full report</LinkOut>}>
              <div className="rpt-simple-list">
                {slowMoving.length === 0 ? <div className="rpt-empty">Nothing slow-moving right now.</div> : slowMoving.map(p => (
                  <div key={p.id} className="rpt-simple-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="rpt-simple-name">{p.name}</div>
                      <div className="rpt-simple-sub">{t('last_sold')}: {p.lastSoldAt ? fmtDate(p.lastSoldAt) : t('never_sold')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rpt-title)' }}>{p.stock} in stock</div>
                      <div style={{ fontSize: 11.5, color: 'var(--rpt-red)' }}>{peso(p.tiedUp)} tied up</div>
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        </div>

        {/* ══════════ RECENT TRANSACTIONS ══════════ */}
        <ChartCard title={<><Receipt size={14} style={{ color: 'var(--rpt-green)' }} />{t('recent_txns')}</>} actions={<LinkOut to="/reports?tab=sales">View all</LinkOut>}>
          {recentTxns.length === 0 ? <div className="rpt-empty">{t('no_data')}</div> : (
            <div className="rpt-table-wrap"><div className="rpt-table-scroll">
              <table className="rpt-table">
                <thead><tr>{['Txn #', 'Time', 'Customer', 'Cashier', 'Payment'].map(h => <th key={h}>{h}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {recentTxns.map(tx => {
                    const { refunded, returned } = txBadges(tx)
                    return (
                      <tr key={tx.id}>
                        <td style={{ color: 'var(--rpt-green)', fontWeight: 600 }}>#{String(tx.id).padStart(4, '0')}</td>
                        <td style={{ color: 'var(--rpt-muted)' }}>{new Date(tx.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{tx.customerName || 'Walk-in'}</td>
                        <td style={{ color: 'var(--rpt-body)' }}>{tx.cashierName || '—'}</td>
                        <td><span className="rpt-pill rpt-pill-gray"><span className="dot" style={{ background: paymentColor(tx.payment) }} />{paymentDisplay(tx.payment).label}</span></td>
                        <td className="num">
                          <div style={{ fontWeight: 700, color: 'var(--rpt-title)' }}>{peso(tx.total)}</div>
                          {(refunded || returned) && (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                              {refunded && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--rpt-red-light)', color: 'var(--rpt-red)' }}>Refunded</span>}
                              {returned && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--rpt-green-light)', color: 'var(--rpt-green)' }}>Returned</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div></div>
          )}
        </ChartCard>

      </> : <>

        {/* ══════════ CASHIER DASHBOARD ══════════ */}
        <div className="rpt-kpi-row">
          <StatCard icon={Wallet} label="My Sales Today" value={pesoCompact(myTodayAmount)} sub={`${myTodayTxns.length} transaction${myTodayTxns.length === 1 ? '' : 's'}`} />
          <StatCard icon={Package} label="Items Sold" value={myItemsSoldToday} />
        </div>

        <div className="rpt-grid-12">
          <div className="rpt-col-6">
            <ChartCard title={<><ClipboardList size={14} style={{ color: 'var(--rpt-green)' }} />My Requests</>}
              actions={myRequestsAll.length > 5 && <LinkOut onClick={() => setViewAllRequests(true)}>View all</LinkOut>}>
              {myRequests.length === 0 ? <div className="rpt-empty">No requests yet.</div> : (
                <div className="rpt-simple-list">
                  {myRequests.map(r => (
                    <div key={`${r.kind}-${r.id}`} className="rpt-simple-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--rpt-title)' }}>{r.kind} #{String(r.id).padStart(4, '0')}</span>
                        <StatusBadge status={r.status} isLight={true} />
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--rpt-muted)' }}>{fmtDate(r.createdAt)} · {peso(r.total)}</div>
                      {r.status === 'Rejected' && r.rejectionReason && (
                        <div style={{ fontSize: 11.5, color: 'var(--rpt-red)', fontStyle: 'italic' }}>Reason: {r.rejectionReason}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>

          <div className="rpt-col-6">
            <ChartCard title={<><Receipt size={14} style={{ color: 'var(--rpt-green)' }} />My Recent Transactions</>}
              actions={myTxns.length > 5 && <LinkOut onClick={() => setViewAllTxns(true)}>View all</LinkOut>}>
              {myTxns.length === 0 ? <div className="rpt-empty">{t('no_data')}</div> : (
                <div className="rpt-simple-list">
                  {myTxns.slice(0, 5).map(tx => (
                    <div key={tx.id} className="rpt-simple-row">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--rpt-green)' }}>#{String(tx.id).padStart(4, '0')}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--rpt-muted)' }}>{new Date(tx.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} · {tx.customerName || 'Walk-in'}</div>
                        <span className="rpt-pill rpt-pill-gray" style={{ marginTop: 4 }}><span className="dot" style={{ background: paymentColor(tx.payment) }} />{paymentDisplay(tx.payment).label}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rpt-title)', flexShrink: 0 }}>{peso(tx.total)}</div>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>
        </div>

        {/* Held Orders — store-wide (holds carry no cashier/created-by
            column), hidden entirely when there are none. */}
        {holds.length > 0 && (
          <div className="rpt-kpi-row">
            <StatCard icon={PauseCircle} label="Held Orders" value={holds.length}
              sub={holds.slice(0, 3).map(h => h.label).join(', ') + (holds.length > 3 ? `, +${holds.length - 3} more` : '')}
              onClick={() => navigate('/pos?holds=1')} />
          </div>
        )}

        <MyRequestsModal open={viewAllRequests} onClose={() => setViewAllRequests(false)} requests={myRequestsAll} isLight={isLight} />
        <MyTransactionsModal open={viewAllTxns} onClose={() => setViewAllTxns(false)} transactions={myTxns} />

      </>}
    </div>
  )
}

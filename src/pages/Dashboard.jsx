import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { Hand, AlertTriangle, Ban, CheckCircle2, Clock, ChevronRight, Trophy, Package, Receipt, ClipboardList } from 'lucide-react'
import { useTransactionStore, useProductStore, useAuthStore, useRefundStore, useReturnStore, useAppStore } from '../store'
import { useT, peso, pesoCompact, paymentDisplay, fmtDate } from '../utils/helpers'
import { computeSalesMetrics, getDailySeries } from '../utils/salesMetrics'
import { ACCENT, ACCENT2, GREEN, RED, BLUE, YELLOW, PURPLE, SLATE } from '../utils/colors'
import { StatusBadge } from '../components/RefundDetailsModal'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const PAY_COLOR = { Cash: GREEN, GCash: BLUE, Card: YELLOW, Split: PURPLE }

// First 3 names + "+N more" — used by both Needs Attention cards.
function namesSummary(list) {
  const shown = list.slice(0, 3).map(p => p.name).join(', ')
  const rest = list.length - 3
  return rest > 0 ? `${shown}, +${rest} more` : shown
}

function KpiCard({ label, value, color, children, onClick }) {
  return (
    <div className="card" onClick={onClick} style={{
      padding: 18, borderTop: `2px solid ${color}`, cursor: onClick ? 'pointer' : 'default',
      transition: 'transform .12s', minWidth: 0,
    }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.transform = 'translateY(-1px)' } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.transform = 'none' } : undefined}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {children}
    </div>
  )
}

const SkeletonCard = ({ h = 90 }) => <div className="card" style={{ padding: 18 }}><div className="skeleton" style={{ height: h }} /></div>

export default function Dashboard() {
  useDocumentTitle('Dashboard')
  const transactions = useTransactionStore(s => s.transactions)
  const txLoading    = useTransactionStore(s => s.loading)
  const products     = useProductStore(s => s.products)
  const prodLoading  = useProductStore(s => s.loading)
  const refunds      = useRefundStore(s => s.refunds)
  const returns      = useReturnStore(s => s.returns)
  const { user, role } = useAuthStore()
  const { theme } = useAppStore()
  const isAdmin = role === 'admin'
  const isLight = theme === 'light'
  const t = useT()
  const navigate = useNavigate()
  const [topMetric, setTopMetric] = useState('qty') // 'qty' | 'revenue'

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
  const deductedToday = todayMetrics.refundTotal + todayMetrics.returnTotal
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
  const payTotal30 = payData30.reduce((s, d) => s + d.value, 0)

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
  const myRequests = useMemo(() => {
    const mine = [
      ...refunds.filter(r => r.submittedBy === myName).map(r => ({ ...r, kind: 'Refund' })),
      ...returns.filter(r => r.submittedBy === myName).map(r => ({ ...r, kind: 'Return' })),
    ]
    return mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5)
  }, [refunds, returns, myName])

  const Section = ({ title, icon: Icon, iconColor, action, children }) => (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>{Icon && <Icon size={13} style={{ color: iconColor }} />}{title}</div>
        {action}
      </div>
      {children}
    </div>
  )

  const LinkOut = ({ to, children }) => (
    <button onClick={() => navigate(to)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'inherit' }}>
      {children}<ChevronRight size={12} />
    </button>
  )

  const EmptyRow = ({ children }) => <div style={{ color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>{children}</div>

  const SalesTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="card" style={{ padding: '10px 12px', fontSize: 11.5 }}>
        <div style={{ color: 'var(--text3)', marginBottom: 5, fontWeight: 600 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><span>Sales</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{peso(d.gross)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: 'var(--red)' }}><span>Returns</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>−{peso(d.refunds)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 5, marginTop: 5 }}><span>Net</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{peso(d.net)}</span></div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, fontVariantNumeric: 'tabular-nums' }}>

      {/* HEADER */}
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>{greeting}, <span style={{ color: 'var(--accent)' }}>{user?.user_metadata?.name || 'there'}</span><Hand size={22} style={{ color: 'var(--yellow)' }} /></div>
        <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 3 }}>{now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
          {Array.from({ length: isAdmin ? 5 : 2 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isAdmin ? <>

        {/* ══════════ KPI ROW ══════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
          <KpiCard label="Sales Today" value={pesoCompact(todayMetrics.grossSales)} color="var(--accent)">
            {deductedToday > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>Returns/refunds: −{peso(deductedToday)}</div>}
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: deductedToday > 0 ? 1 : 4 }}>Net: {peso(todayMetrics.netSales)}</div>
            <div style={{ fontSize: 11, color: grossChange == null ? 'var(--text3)' : grossChange >= 0 ? 'var(--green)' : 'var(--text3)', marginTop: 4 }}>
              {grossChange == null ? '—' : `${grossChange >= 0 ? '▲ +' : '▼ '}${grossChange}%`} vs yesterday
            </div>
          </KpiCard>
          <KpiCard label="Transactions" value={todayTxns.length} color="var(--green)" />
          <KpiCard label="Items Sold" value={itemsSoldToday} color="var(--purple)" />
          <KpiCard label="Avg Sale" value={peso(avgSale)} color="var(--yellow)" />
          <KpiCard label="Pending Approvals" value={pendingReturns + pendingRefunds} color="var(--yellow)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              <LinkOut to="/returns">{pendingReturns} Returns</LinkOut>
              <LinkOut to="/refunds">{pendingRefunds} Refunds</LinkOut>
            </div>
          </KpiCard>
        </div>

        {/* ══════════ NEEDS ATTENTION ══════════ */}
        {(lowStock.length > 0 || outStock.length > 0 || (pendingReturns + pendingRefunds) > 0) ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {lowStock.length > 0 && (
              <div className="card" onClick={() => navigate('/products?stock=low')} style={{ padding: 16, borderTop: '2px solid var(--yellow)', cursor: 'pointer' }}>
                <AlertTriangle size={18} style={{ marginBottom: 7, color: 'var(--yellow)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--yellow)', marginBottom: 4 }}>{lowStock.length} running low</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{namesSummary(lowStock)}</div>
              </div>
            )}
            {outStock.length > 0 && (
              <div className="card" onClick={() => navigate('/products?stock=out')} style={{ padding: 16, borderTop: '2px solid var(--red)', cursor: 'pointer' }}>
                <Ban size={18} style={{ marginBottom: 7, color: 'var(--red)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--red)', marginBottom: 4 }}>{outStock.length} out of stock</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{namesSummary(outStock)}</div>
              </div>
            )}
            {(pendingReturns + pendingRefunds) > 0 && (
              <div className="card" onClick={() => navigate(pendingRefunds >= pendingReturns ? '/refunds' : '/returns')} style={{ padding: 16, borderTop: '2px solid var(--yellow)', cursor: 'pointer' }}>
                <Clock size={18} style={{ marginBottom: 7, color: 'var(--yellow)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--yellow)', marginBottom: 4 }}>Pending Requests</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{pendingReturns + pendingRefunds} returns/refunds waiting for approval</div>
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ padding: 16, borderTop: '2px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={18} style={{ color: 'var(--green)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--green)' }}>{t('all_good')} — nothing needs attention.</span>
          </div>
        )}

        {/* ══════════ SALES CHART + PAYMENT METHODS ══════════ */}
        <div className="dash-6040-grid">
          <Section title="Sales — Last 14 Days">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={areaData} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text3)' }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text3)' }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}`} />
                <Tooltip content={<SalesTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="gross" name="Sales" barSize={16} radius={[4, 4, 0, 0]}>
                  {areaData.map((d, i) => <Cell key={i} fill={i === areaData.length - 1 ? ACCENT2 : ACCENT} />)}
                </Bar>
                <Bar dataKey="refunds" name="Returns" barSize={7} radius={[3, 3, 0, 0]} fill={RED} />
              </BarChart>
            </ResponsiveContainer>
          </Section>

          <Section title="Payment Methods — Last 30 Days">
            {payData30.length === 0 ? <EmptyRow>No payments in the last 30 days.</EmptyRow> : <>
              <div style={{ position: 'relative' }}>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={payData30} cx="50%" cy="50%" innerRadius={48} outerRadius={70} dataKey="value" paddingAngle={3}>
                      {payData30.map((d, i) => <Cell key={i} fill={PAY_COLOR[d.name] || SLATE} />)}
                    </Pie>
                    <Tooltip formatter={v => peso(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>Total</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{pesoCompact(payTotal30)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
                {payData30.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: PAY_COLOR[d.name] || SLATE, flexShrink: 0 }} />{d.name}</span>
                    <span style={{ color: 'var(--text2)' }}>{peso(d.value)} · {payTotal30 ? Math.round(d.value / payTotal30 * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </>}
          </Section>
        </div>

        {/* ══════════ TOP PRODUCTS + SLOW MOVING ══════════ */}
        <div className="kpi-bottom-grid">
          <Section title="Top Products — Last 30 Days" icon={Trophy} iconColor="var(--yellow)"
            action={
              <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 99, padding: 2, gap: 2 }}>
                {['qty', 'revenue'].map(v => (
                  <button key={v} onClick={() => setTopMetric(v)} style={{
                    padding: '3px 10px', borderRadius: 99, border: 'none', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    background: topMetric === v ? 'var(--accent)' : 'transparent', color: topMetric === v ? '#0a0a0a' : 'var(--text3)',
                  }}>{v === 'qty' ? 'Qty' : 'Revenue'}</button>
                ))}
              </div>
            }>
            {topProds30.length === 0 ? <EmptyRow>No sales in the last 30 days.</EmptyRow> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topProds30.map((p, i) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)', width: 14 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ marginTop: 3, height: 3, background: 'var(--bg5)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 2, background: 'var(--accent)', width: `${Math.round((topBasis(p) / topMax) * 100)}%`, transition: 'width .4s' }} /></div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 11, color: 'var(--text2)' }}>{topMetric === 'qty' ? `${p.sold} sold` : peso(p.revenue)}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('slow_moving')} icon={Package} iconColor="var(--red)"
            action={<LinkOut to="/reports?tab=inventory">See full report</LinkOut>}>
            {slowMoving.length === 0 ? <EmptyRow>Nothing slow-moving right now.</EmptyRow> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {slowMoving.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{t('last_sold')}: {p.lastSoldAt ? fmtDate(p.lastSoldAt) : t('never_sold')}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{p.stock} in stock</div>
                      <div style={{ fontSize: 10.5, color: 'var(--red)' }}>{peso(p.tiedUp)} tied up</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ══════════ RECENT TRANSACTIONS ══════════ */}
        <Section title={t('recent_txns')} icon={Receipt} iconColor="var(--accent)" action={<LinkOut to="/reports?tab=sales">View all</LinkOut>}>
          {recentTxns.length === 0 ? <EmptyRow>{t('no_data')}</EmptyRow> : (
            <div className="tbl-wrap">
              <table>
                <thead><tr>{['Txn #', 'Time', 'Customer', 'Cashier', 'Payment', 'Total'].map(h => <th key={h} style={h === 'Total' ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {recentTxns.map(tx => {
                    const { refunded, returned } = txBadges(tx)
                    return (
                      <tr key={tx.id}>
                        <td style={{ fontSize: 11, color: 'var(--accent)' }}>#{String(tx.id).padStart(4, '0')}</td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(tx.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ fontSize: 12 }}>{tx.customerName || 'Walk-in'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text2)' }}>{tx.cashierName || '—'}</td>
                        <td><span className={`badge ${tx.payment === 'Cash' ? 'badge-green' : tx.payment === 'GCash' ? 'badge-blue' : 'badge-purple'}`} style={{ fontSize: 10 }}>{paymentDisplay(tx.payment).label}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>{peso(tx.total)}</div>
                          {(refunded || returned) && (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                              {refunded && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>Refunded</span>}
                              {returned && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'rgba(52,211,153,0.1)', color: 'var(--accent)' }}>Returned</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

      </> : <>

        {/* ══════════ CASHIER DASHBOARD ══════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
          <KpiCard label="My Sales Today" value={pesoCompact(myTodayAmount)} color="var(--accent)">
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{myTodayTxns.length} transaction{myTodayTxns.length === 1 ? '' : 's'}</div>
          </KpiCard>
          <KpiCard label="Items Sold" value={myItemsSoldToday} color="var(--purple)" />
        </div>

        {(lowStock.length > 0 || outStock.length > 0) ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            {lowStock.length > 0 && (
              <div className="card" style={{ padding: 16, borderTop: '2px solid var(--yellow)' }}>
                <AlertTriangle size={18} style={{ marginBottom: 7, color: 'var(--yellow)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--yellow)', marginBottom: 4 }}>{lowStock.length} running low</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{namesSummary(lowStock)}</div>
              </div>
            )}
            {outStock.length > 0 && (
              <div className="card" style={{ padding: 16, borderTop: '2px solid var(--red)' }}>
                <Ban size={18} style={{ marginBottom: 7, color: 'var(--red)' }} />
                <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--red)', marginBottom: 4 }}>{outStock.length} out of stock</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{namesSummary(outStock)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ padding: 16, borderTop: '2px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={18} style={{ color: 'var(--green)' }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--green)' }}>{t('all_good')} — nothing needs attention.</span>
          </div>
        )}

        <div className="kpi-bottom-grid">
          <Section title="My Requests" icon={ClipboardList} iconColor="var(--accent)">
            {myRequests.length === 0 ? <EmptyRow>No requests yet.</EmptyRow> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {myRequests.map(r => (
                  <div key={`${r.kind}-${r.id}`} style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{r.kind} #{String(r.id).padStart(4, '0')}</span>
                      <StatusBadge status={r.status} isLight={isLight} />
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{fmtDate(r.createdAt)} · {peso(r.total)}</div>
                    {r.status === 'Rejected' && r.rejectionReason && (
                      <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 3, fontStyle: 'italic' }}>Reason: {r.rejectionReason}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="My Recent Transactions" icon={Receipt} iconColor="var(--accent)">
            {myTxns.length === 0 ? <EmptyRow>{t('no_data')}</EmptyRow> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {myTxns.slice(0, 5).map(tx => (
                  <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)' }}>#{String(tx.id).padStart(4, '0')}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{new Date(tx.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} · {tx.customerName || 'Walk-in'}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>{peso(tx.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

      </>}
    </div>
  )
}

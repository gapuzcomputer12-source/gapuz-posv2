import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, eachDayOfInterval, eachMonthOfInterval, format, differenceInCalendarDays } from 'date-fns'
import { useTransactionStore, useProductStore, useCustomerStore, useRefundStore, useReturnStore, useAuthStore, useCategoryStore, useRewardStore } from '../store'
import { useT, peso, getTier, fmtDate, refundSettledAmount, getEffectiveLowStockLevel } from '../utils/helpers'
import { computeSalesMetrics, isMoneyBack, lineProfit, computeSlowMoving } from '../utils/salesMetrics'
import { addSheet, addMultiTableSheet, downloadWorkbook, createWorkbook } from '../utils/exportXlsx'
import { ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  Download, Trophy, TrendingDown, AlertTriangle, Archive, AlertOctagon, ClipboardList, Ban,
  TrendingUp, Undo2, Wallet, Coins, Receipt, Calculator, Package, Layers, Tag, Clock, RotateCcw,
  Banknote, XCircle, Users, Star, Gem, Award, Gift,
} from 'lucide-react'
import ProductThumb from '../components/ProductThumb'
import SalesBreakdownCard from '../components/SalesBreakdownCard'
import StatCard from '../components/StatCard'
import ChartCard from '../components/ChartCard'
import RankedList from '../components/RankedList'
import DonutCard from '../components/DonutCard'
import SegmentedControl from '../components/SegmentedControl'
import RefundDetailsModal, { StatusBadge } from '../components/RefundDetailsModal'
import ReturnDetailsModal from '../components/ReturnDetailsModal'
import TransactionDetailsModal from '../components/TransactionDetailsModal'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

// Payment-method colors — no blue anywhere per the design spec; Split
// covers any combo string ("Cash+GCash") that isn't an exact method name.
const PAY_COLOR = { Cash: '#059669', GCash: '#8B5CF6', Card: '#D97706', Split: '#64748B' }
const paymentColor = (p) => PAY_COLOR[p] || PAY_COLOR.Split

const REPORT_TABS = [
  { id: 'sales',     label: 'Sales',             icon: <TrendingUp size={14} /> },
  { id: 'inventory', label: 'Inventory',         icon: <Package size={14} /> },
  { id: 'returns',   label: 'Returns & Refunds', icon: <RotateCcw size={14} /> },
  { id: 'customer',  label: 'Customers',         icon: <Users size={14} /> },
]

// The 6 Sales-tab KPI cards, each a drill-down into the chart below —
// clicking one selects which field(s) of buildSalesBuckets' per-bucket
// output the chart/tooltip read, and which title it shows. `valueOf`
// mirrors exactly how each StatCard already renders its own number, so
// the selected card's big number always still matches what's on the card.
const SALES_CARDS = [
  { key: 'gross',        label: 'Gross Sales',        icon: TrendingUp, tone: 'default', valueOf: (m) => peso(m.grossSales) },
  { key: 'returns',      label: 'Returns & Refunds',  icon: Undo2,      tone: 'red',     valueOf: (m) => peso(-(m.refundTotal + m.returnTotal)) },
  { key: 'net',          label: 'Net Sales',          icon: Wallet,     tone: 'default', valueOf: (m) => peso(m.netSales) },
  { key: 'profit',       label: 'Net Profit',         icon: Coins,      tone: 'default', valueOf: (m) => peso(m.netProfit) },
  { key: 'transactions', label: 'Transactions',       icon: Receipt,    tone: 'default', valueOf: (m) => m.transactionCount },
  { key: 'avg',          label: 'Average Sale',       icon: Calculator, tone: 'default', valueOf: (m, avg) => peso(avg) },
]

// Which bucket field(s) each card's chart plots, and in what color — Bar
// (Today) or Area+Line (longer periods) below just maps over whichever of
// these arrays is active. Reds for returns/refunds, greens for everything
// sales/profit-shaped, per the existing chart's own palette.
const CHART_SERIES = {
  gross:        [{ key: 'gross',     name: 'Gross Sales',  color: '#059669' }],
  returns:      [{ key: 'returnAmt', name: 'Returns',      color: '#DC2626' }, { key: 'refundAmt', name: 'Refunds', color: '#F87171' }],
  net:          [{ key: 'gross',     name: 'Gross Sales',  color: '#6EE7B7' }, { key: 'net',       name: 'Net Sales', color: '#059669' }],
  profit:       [{ key: 'profit',    name: 'Net Profit',   color: '#059669' }],
  transactions: [{ key: 'count',     name: 'Transactions', color: '#059669' }],
  avg:          [{ key: 'avg',       name: 'Average Sale', color: '#059669' }],
}
const CARD_TITLE = Object.fromEntries(SALES_CARDS.map(c => [c.key, c.label]))
const PERIODS = ['Today', 'This Week', 'This Month', 'This Year', 'Custom']

const TAB_TITLE = {
  sales:     'Sales Report',
  inventory: 'Inventory Report',
  returns:   'Returns & Refunds Report',
  customer:  'Customer Report',
}

// Sales tab Top/Least Selling cards — count selector pills.
const COUNT_OPTIONS = [5, 10, 20, 'All'].map(v => ({ value: v, label: String(v) }))
// Least Selling: a product needs this many days in the system before it's
// eligible to be ranked, so a brand-new item isn't unfairly flagged as a
// worst seller just for not having sold anything yet.
const LEAST_SELLING_MIN_AGE_DAYS = 3
const LEAST_SELLING_EMPTY_TEXT = `No products to rank yet. Products need at least ${LEAST_SELLING_MIN_AGE_DAYS} days in the system.`

const STATUS_RANK = { 'Reorder now': 0, 'Reorder soon': 1, 'OK': 2, 'No demand': 3 }
const STATUS_PILL = { 'Reorder now': 'rpt-pill-red', 'Reorder soon': 'rpt-pill-amber', 'OK': 'rpt-pill-green', 'No demand': 'rpt-pill-gray' }

// Slow-Moving Products: a product qualifies without waiting the full 30
// days a brand-new store wouldn't have accumulated yet. Condition A (sells
// slowly) needs this many days of remaining stock at its current pace;
// Condition B (no sales yet) needs only this many days since it was added.
const SLOW_MOVING_DAYS_LEFT_MIN = 60
const SLOW_MOVING_NO_SALE_MIN_AGE_DAYS = 7

// Completed / Returned / Refunded / Partially Returned — for the Sales >
// Transactions export sheet only (not shown on-screen). Checks ALL-time
// refunds/returns against this transaction, not just ones approved within
// the currently selected report period, since a sale from today could be
// returned next week.
function txnStatus(tx, refunds, returns) {
  const refundedAmt = refundSettledAmount(tx.id, refunds)
  if (tx.total > 0 && refundedAmt >= tx.total) return 'Refunded'
  const approvedReturnsForTx = returns.filter(r => r.transactionId === tx.id && r.status === 'Approved')
  const totalQty = (tx.items || []).reduce((s, i) => s + (i.qty || 0), 0)
  const returnedQty = approvedReturnsForTx.reduce((s, r) => s + (r.items || []).reduce((a, i) => a + (i.qty || 0), 0), 0)
  if (totalQty > 0 && returnedQty >= totalQty) return 'Returned'
  if (returnedQty > 0 || refundedAmt > 0) return 'Partially Returned'
  return 'Completed'
}

// Builds the per-bucket series behind every KPI card's drill-down chart —
// hourly for a single day, daily for a 2-31 day span, monthly beyond that.
// Each bucket re-runs the shared computeSalesMetrics over a sub-window
// that exactly tiles [periodStart, periodEnd], so summing any one field
// across every bucket always reproduces that same field on the period's
// own KPI card — never a second, drifting calculation.
//
// Bug fixed here: the hourly view used to hard-code 8:00-20:00, so a sale
// outside store hours (e.g. a 21:00 test sale) was counted in the KPI
// total but fell into no bucket at all — the chart read all-zero while
// the card above it showed a real total. Buckets now start from whichever
// is earlier of 8:00 or the day's first (non-voided) sale, and end at
// whichever is later of 20:00 or its last — so the default view is still
// the normal business-hours window on a normal day, but nothing is ever
// silently dropped.
function buildSalesBuckets(period, periodStart, periodEnd, transactions, refunds, returns) {
  const bucketMetrics = (from, to, label) => {
    const m = computeSalesMetrics({ transactions, refunds, returns, from, to })
    return {
      label, gross: m.grossSales, returnAmt: m.returnTotal, refundAmt: m.refundTotal,
      net: m.netSales, profit: m.netProfit, count: m.transactionCount,
      avg: m.transactionCount > 0 ? m.grossSales / m.transactionCount : 0,
    }
  }

  if (period === 'Today') {
    let minHour = 8, maxHour = 20
    transactions.forEach(tx => {
      if (tx.status === 'Voided') return
      const d = new Date(tx.createdAt)
      if (d < periodStart || d > periodEnd) return
      const h = d.getHours()
      if (h < minHour) minHour = h
      if (h > maxHour) maxHour = h
    })
    const hours = []
    for (let h = minHour; h <= maxHour; h++) hours.push(h)
    return hours.map(h => {
      const from = new Date(periodStart); from.setHours(h, 0, 0, 0)
      const to = new Date(periodStart); to.setHours(h, 59, 59, 999)
      return bucketMetrics(from, to, `${h}:00`)
    })
  }

  const spanDays = differenceInCalendarDays(periodEnd, periodStart)
  if (spanDays > 31) {
    return eachMonthOfInterval({ start: periodStart, end: periodEnd }).map(d => {
      const from = startOfMonth(d), to = endOfMonth(d)
      return bucketMetrics(from, to, format(d, 'MMM'))
    })
  }
  return eachDayOfInterval({ start: periodStart, end: periodEnd }).map(d => {
    const from = startOfDay(d), to = endOfDay(d)
    return bucketMetrics(from, to, format(d, 'MMM d'))
  })
}

export default function Reports(){
  const transactions = useTransactionStore(s=>s.transactions)
  const products     = useProductStore(s=>s.products)
  const categories   = useCategoryStore(s=>s.categories)
  const customers    = useCustomerStore(s=>s.customers)
  const refunds      = useRefundStore(s=>s.refunds)
  const returns      = useReturnStore(s=>s.returns)
  const redemptions  = useRewardStore(s=>s.redemptions)
  const { user, role } = useAuthStore()
  const t            = useT()
  const [searchParams] = useSearchParams()
  const [activeTab,  setActiveTab]  = useState(() => searchParams.get('tab') || 'sales')
  const [viewTxnId,  setViewTxnId]  = useState(null)
  const [viewRequest, setViewRequest] = useState(null) // { kind:'return'|'refund', record } — Returns & Refunds card drill-down
  // Deliberately NOT reset by any period/tab effect below — "remember the
  // selected card while the date filter changes" means this survives
  // period/customFrom/customTo changes on its own just by being a plain
  // top-level state with nothing resetting it.
  const [selectedCard, setSelectedCard] = useState('gross')
  const txnHistoryRef = useRef(null)
  useDocumentTitle(TAB_TITLE[activeTab] || 'Sales Report')
  const [period,     setPeriod]     = useState('Today')
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(),6),'yyyy-MM-dd'))
  const [customTo,   setCustomTo]   = useState(() => format(new Date(),'yyyy-MM-dd'))
  const [draftFrom,  setDraftFrom]  = useState(customFrom)
  const [draftTo,    setDraftTo]    = useState(customTo)
  const [customPopoverOpen, setCustomPopoverOpen] = useState(false)
  const periodRef = useRef(null)
  const [topMetric,  setTopMetric]  = useState('qty') // 'qty' | 'revenue' — Sales tab Top/Least Selling
  const [topCount,   setTopCount]   = useState(10) // 5 | 10 | 20 | 'All'
  const [leastCount, setLeastCount] = useState(10) // 5 | 10 | 20 | 'All'
  const [demandStatusFilter, setDemandStatusFilter] = useState('All')
  const [historyType,   setHistoryType]   = useState('All') // All | Returns | Refunds
  const [historyStatus, setHistoryStatus] = useState('All') // All | Pending | Approved | Rejected
  const [exporting, setExporting] = useState(false)

  const now = new Date()

  useEffect(() => {
    if (!customPopoverOpen) return
    const onClick = e => { if (periodRef.current && !periodRef.current.contains(e.target)) setCustomPopoverOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [customPopoverOpen])

  const handlePeriodChange = (p) => {
    if (p === 'Custom') { setDraftFrom(customFrom); setDraftTo(customTo); setCustomPopoverOpen(o => !o); return }
    setCustomPopoverOpen(false)
    setPeriod(p)
  }
  const applyCustomRange = () => { setCustomFrom(draftFrom); setCustomTo(draftTo); setPeriod('Custom'); setCustomPopoverOpen(false) }

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (period === 'Custom') {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfDay(now)
      // Guards eachDayOfInterval/eachMonthOfInterval below against an
      // inverted range — the <input type="date"> min/max props stop this
      // in most browsers, but not all let the keyboard bypass them.
      let end = customTo ? new Date(`${customTo}T23:59:59.999`) : now
      if (end < start) end = endOfDay(start)
      const sameYear = start.getFullYear() === end.getFullYear()
      const label = sameYear ? `${format(start,'MMM d')} – ${format(end,'MMM d, yyyy')}` : `${format(start,'MMM d, yyyy')} – ${format(end,'MMM d, yyyy')}`
      return { periodStart:start, periodEnd:end, periodLabel:label }
    }
    const start = new Date()
    if(period==='Today'){ start.setHours(0,0,0,0) }
    else if(period==='This Week'){ start.setDate(start.getDate()-6); start.setHours(0,0,0,0) }
    else if(period==='This Month'){ start.setDate(1); start.setHours(0,0,0,0) }
    else { start.setMonth(0,1); start.setHours(0,0,0,0) }
    return { periodStart:start, periodEnd:now, periodLabel:period }
  }, [period, customFrom, customTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const fromStr = format(periodStart,'yyyy-MM-dd')
  const toStr   = format(periodEnd,'yyyy-MM-dd')

  // Request COUNTS (submitted, pending, rejected) use created_at; approved
  // refund/return AMOUNTS use processed_at — see "Reports Page - How It
  // Works.md" for why these two previously disagreed across tabs.
  const approvedDate = r => new Date(r.processedAt || r.createdAt)
  const inPeriod = d => d >= periodStart && d <= periodEnd

  const filtered = useMemo(()=>transactions.filter(tx=>inPeriod(new Date(tx.createdAt))),[transactions,periodStart,periodEnd])
  // `filtered` still shows voided rows (Transaction History must display
  // them, with a badge) — everything that SUMS/COUNTS sales reads the
  // activeFiltered copy below instead. txStatusFilter only narrows what
  // the TABLE shows, never the summary numbers above it.
  const [txStatusFilter, setTxStatusFilter] = useState('All')
  const txFiltered = useMemo(()=>filtered.filter(tx=>
    txStatusFilter==='All' ? true : txStatusFilter==='Voided' ? tx.status==='Voided' : tx.status!=='Voided'
  ),[filtered,txStatusFilter])
  const txPg = usePagination(txFiltered)
  useEffect(()=>{ txPg.setPage(1) }, [period,customFrom,customTo,txStatusFilter])
  const activeFiltered = useMemo(()=>filtered.filter(tx=>tx.status!=='Voided'),[filtered])

  const refundsSubmitted = useMemo(()=>refunds.filter(r=>inPeriod(new Date(r.createdAt))),[refunds,periodStart,periodEnd])
  const returnsSubmitted = useMemo(()=>returns.filter(r=>inPeriod(new Date(r.createdAt))),[returns,periodStart,periodEnd])
  const refundsApproved  = useMemo(()=>refunds.filter(r=>r.status==='Approved'&&inPeriod(approvedDate(r))),[refunds,periodStart,periodEnd])
  const returnsApproved  = useMemo(()=>returns.filter(r=>r.status==='Approved'&&inPeriod(approvedDate(r))),[returns,periodStart,periodEnd])

  // ── SALES ──────────────────────────────────────────────────
  const metrics   = useMemo(()=>computeSalesMetrics({ transactions, refunds, returns, from: periodStart, to: periodEnd }),[transactions,refunds,returns,periodStart,periodEnd])
  const salesAvg  = metrics.transactionCount?Math.round(metrics.grossSales/metrics.transactionCount):0
  const payData   = useMemo(()=>{ const map={}; activeFiltered.forEach(t=>{map[t.payment]=(map[t.payment]||0)+t.total}); return Object.entries(map).map(([name,value])=>({name,value})).filter(d=>d.value>0) },[activeFiltered])
  const salesChart= useMemo(()=>buildSalesBuckets(period, periodStart, periodEnd, transactions, refunds, returns),[period,periodStart,periodEnd,transactions,refunds,returns])
  // "No data for this period" instead of a flat empty chart — any of the 6
  // cards' underlying numbers being nonzero counts as data.
  const hasChartData = metrics.transactionCount>0 || metrics.refundCount>0 || metrics.returnCount>0
  const prodMap   = useMemo(()=>{ const m={}
    activeFiltered.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!m[i.name]) m[i.name]={name:i.name,sold:0,revenue:0}; m[i.name].sold+=i.qty; m[i.name].revenue+=i.qty*i.price }))
    return m
  },[activeFiltered])

  // ── KPI card drill-downs ─────────────────────────────────────
  // Net Profit card's "Top 5 products by profit" — same lineProfit formula
  // computeSalesMetrics itself uses for grossProfit, just broken out per
  // product instead of summed across the whole period.
  const profitByProduct = useMemo(()=>{
    const m = {}
    activeFiltered.forEach(tx=>(tx.items||[]).forEach(i=>{
      if(!m[i.name]) m[i.name]={name:i.name,sold:0,sales:0,profit:0}
      m[i.name].sold += i.qty; m[i.name].sales += i.qty*i.price; m[i.name].profit += lineProfit(i)
    }))
    return Object.values(m).sort((a,b)=>b.profit-a.profit)
  },[activeFiltered])
  // Returns & Refunds card's request list — the exact same Approved-only,
  // period-filtered, money-back-only set the KPI card's own amount is
  // summed from (computeSalesMetrics excludes Replacement returns from
  // returnTotal since no cash moves — returnsApproved itself doesn't, as
  // the Returns tab's own stats below legitimately want every approved
  // return regardless of method, so the isMoneyBack filter is applied
  // here only, not at that shared source).
  const requestsForCard = useMemo(()=>{
    const list = [
      ...returnsApproved.filter(r=>isMoneyBack(r.method)).map(r=>({ kind:'return', id:r.id, status:r.status, transactionId:r.transactionId, amount:r.total, date:approvedDate(r) })),
      ...refundsApproved.map(r=>({ kind:'refund', id:r.id, status:r.status, transactionId:r.transactionId, amount:r.total, date:approvedDate(r) })),
    ]
    return list.sort((a,b)=>b.date-a.date)
  },[returnsApproved,refundsApproved])
  const topBasis = p => topMetric==='qty' ? p.sold : p.revenue
  // Full ranked lists (not yet sliced to the selected count) — the count
  // selector and "All" pagination both read from these.
  const topProdsAll = useMemo(()=>Object.values(prodMap).sort((a,b)=>topBasis(b)-topBasis(a)),[prodMap,topMetric])
  // Least Selling: non-service products currently in stock that have been
  // in the system at least LEAST_SELLING_MIN_AGE_DAYS days (excluded from
  // THIS list only — a new/out-of-stock product still shows up everywhere
  // else). Ranked by Daily Sales Rate — units sold in the period divided by
  // the days the product actually existed within that period — so a
  // product added mid-period isn't penalized for days it couldn't have
  // sold on. Includes 0-sold eligible products so a never-sold item still
  // ranks first. Ties (commonly several products tied at 0 sold) break by
  // stock value (stock × cost price) descending, surfacing the biggest
  // tied-up inventory first.
  const leastProdsAll = useMemo(()=>{
    const ageCutoff = subDays(now,LEAST_SELLING_MIN_AGE_DAYS)
    const eligible = products.filter(p=>!p.isService && p.stock>0 && p.createdAt && new Date(p.createdAt)<=ageCutoff)
    return eligible
      .map(p=>{
        const createdAt = new Date(p.createdAt)
        const rangeStart = createdAt>periodStart ? createdAt : periodStart
        const rangeEnd = now<periodEnd ? now : periodEnd
        const daysAvailable = Math.max(1, differenceInCalendarDays(rangeEnd, rangeStart))
        const sold = prodMap[p.name]?.sold||0
        return { name:p.name, sold, revenue: prodMap[p.name]?.revenue||0, daysAvailable, rate: sold/daysAvailable, stockValue:(p.stock||0)*(p.costPrice||0) }
      })
      .sort((a,b)=>a.rate-b.rate || b.stockValue-a.stockValue)
  },[prodMap,products,periodStart,periodEnd,now]) // eslint-disable-line react-hooks/exhaustive-deps
  // Top Selling's bar scale follows whichever metric (Qty/Revenue) is
  // toggled. Least Selling always shows units, so it scales off the best
  // seller's unit count instead, independent of that toggle.
  const topMax = topProdsAll[0] ? Math.max(topBasis(topProdsAll[0]),1) : 1
  const topSoldMax = Math.max(...topProdsAll.map(p=>p.sold),1)

  const topPg   = usePagination(topProdsAll)
  const leastPg = usePagination(leastProdsAll)
  useEffect(()=>{ topPg.setPage(1) },[topCount,topMetric,period,customFrom,customTo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ leastPg.setPage(1) },[leastCount,topMetric,period,customFrom,customTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const topVisible   = topCount==='All'   ? topPg.pageItems   : topProdsAll.slice(0,topCount)
  const leastVisible = leastCount==='All' ? leastPg.pageItems : leastProdsAll.slice(0,leastCount)
  const topRankOffset   = topCount==='All'   ? (topPg.page-1)*8   : 0
  const leastRankOffset = leastCount==='All' ? (leastPg.page-1)*8 : 0

  // Export rows mirror whatever's currently selected on screen — the full
  // list when "All" is picked, otherwise exactly the visible count.
  const topExportRows   = useMemo(()=>(topCount==='All'?topProdsAll:topProdsAll.slice(0,topCount)).map((p,i)=>({rank:i+1,...p})),[topProdsAll,topCount])
  const leastExportRows = useMemo(()=>(leastCount==='All'?leastProdsAll:leastProdsAll.slice(0,leastCount)).map((p,i)=>({rank:i+1,...p})),[leastProdsAll,leastCount])

  // Export-only aggregates (not used by any on-screen chart/list).
  const payMethodStats = useMemo(()=>{
    const map={}
    filtered.forEach(t=>{ if(!map[t.payment]) map[t.payment]={name:t.payment,count:0,value:0}; map[t.payment].count+=1; map[t.payment].value+=t.total })
    const rows = Object.values(map).filter(d=>d.value>0)
    const total = rows.reduce((s,d)=>s+d.value,0)
    return rows.map(d=>({...d, pct: total?Math.round(d.value/total*1000)/10:0}))
  },[filtered])
  const itemsSoldRows = useMemo(()=>{
    const map={}
    filtered.forEach(tx=>(tx.items||[]).forEach(i=>{
      if(!map[i.name]) map[i.name]={name:i.name,qty:0,revenue:0,cost:0}
      map[i.name].qty+=i.qty; map[i.name].revenue+=i.qty*i.price; map[i.name].cost+=i.qty*(i.costPrice||0)
    }))
    return Object.values(map)
      .map(r=>({...r, profit:r.revenue-r.cost, category: products.find(p=>p.name===r.name)?.category || '—'}))
      .sort((a,b)=>b.revenue-a.revenue)
  },[filtered,products])
  const salesRetRefRows = useMemo(()=>[
    ...returnsApproved.map(r=>({type:'Return', id:r.id, txnId:r.transactionId, date:new Date(r.processedAt||r.createdAt), reason:r.reason, amount:r.total})),
    ...refundsApproved.map(r=>({type:'Refund', id:r.id, txnId:r.transactionId, date:new Date(r.processedAt||r.createdAt), reason:r.reason, amount:r.total})),
  ].sort((a,b)=>b.date-a.date),[returnsApproved,refundsApproved])

  // ── INVENTORY ────────────────────────────────────────────────
  const stockValueCost   = useMemo(()=>products.filter(p=>!p.isService).reduce((s,p)=>s+(p.costPrice||0)*p.stock,0),[products])
  const stockValueRetail = useMemo(()=>products.filter(p=>!p.isService).reduce((s,p)=>s+p.price*p.stock,0),[products])
  const lowStock  = useMemo(()=>products.filter(p=>p.stock>0&&!p.isService&&p.stock<=getEffectiveLowStockLevel(p,categories)),[products,categories])
  const outStock  = useMemo(()=>products.filter(p=>p.stock===0&&!p.isService),[products])

  const last30Start = startOfDay(subDays(now,29))
  const demandMap = useMemo(()=>{
    const map={}
    transactions.forEach(tx=>{ if(tx.status==='Voided') return
      const d=new Date(tx.createdAt); if(d<last30Start||d>now) return
      ;(tx.items||[]).forEach(i=>{ map[i.id]=(map[i.id]||0)+i.qty }) })
    return map
  },[transactions]) // eslint-disable-line react-hooks/exhaustive-deps

  const demandRows = useMemo(()=>products.filter(p=>!p.isService).map(p=>{
    const sold30 = demandMap[p.id]||0
    const avgDaily = sold30/30
    const daysLeft = avgDaily>0 ? p.stock/avgDaily : Infinity
    const suggestedReorder = Math.max(0, Math.ceil(avgDaily*14) - p.stock)
    let status
    if(sold30===0) status='No demand'
    else if(daysLeft<=7 || (p.stock===0&&sold30>0)) status='Reorder now'
    else if(daysLeft<=14) status='Reorder soon'
    else status='OK'
    return { ...p, sold30, avgDaily, daysLeft, suggestedReorder, status }
  }).sort((a,b)=> STATUS_RANK[a.status]-STATUS_RANK[b.status] || a.daysLeft-b.daysLeft),[products,demandMap])
  const demandFiltered = demandStatusFilter==='All' ? demandRows : demandRows.filter(r=>r.status===demandStatusFilter)
  const demandPg = usePagination(demandFiltered)
  useEffect(()=>{ demandPg.setPage(1) },[demandStatusFilter])
  const demandStatusCounts = useMemo(()=>({
    All: demandRows.length,
    'Reorder now': demandRows.filter(r=>r.status==='Reorder now').length,
    'Reorder soon': demandRows.filter(r=>r.status==='Reorder soon').length,
    OK: demandRows.filter(r=>r.status==='OK').length,
    'No demand': demandRows.filter(r=>r.status==='No demand').length,
  }),[demandRows])
  const top10ByUnits = useMemo(()=>[...demandRows].sort((a,b)=>b.sold30-a.sold30).slice(0,10).filter(p=>p.sold30>0),[demandRows])

  const lowStockRows = useMemo(()=>lowStock.map(p=>({...p, sold30:demandMap[p.id]||0})),[lowStock,demandMap])
  const outStockRows = useMemo(()=>outStock.map(p=>({...p, sold30:demandMap[p.id]||0})),[outStock,demandMap])
  const lowStockPg = usePagination(lowStockRows)
  const outStockPg = usePagination(outStockRows)
  // Export-only: Low + Out combined into one sheet with a Status column.
  const lowOutStockRows = useMemo(()=>[
    ...lowStockRows.map(p=>({...p, stockStatus:'Low Stock'})),
    ...outStockRows.map(p=>({...p, stockStatus:'Out of Stock'})),
  ],[lowStockRows,outStockRows])

  // Shared with Dashboard.jsx's widget (see computeSlowMoving in
  // salesMetrics.js) — one formula, not a second copy that can drift.
  const slowMoving = useMemo(()=>computeSlowMoving({products, transactions, now}),[products,transactions,now])
  const slowMovingPg = usePagination(slowMoving)

  const periodSoldMap = useMemo(()=>{ const m={}; filtered.forEach(tx=>(tx.items||[]).forEach(i=>{ m[i.id]=(m[i.id]||0)+i.qty })); return m },[filtered])
  const belowCost = useMemo(()=>products.filter(p=>p.costPrice&&p.price<p.costPrice&&!p.isService)
    .map(p=>{ const soldInPeriod=periodSoldMap[p.id]||0; return {...p, soldInPeriod, lossPerUnit:p.costPrice-p.price, totalLoss:(p.costPrice-p.price)*soldInPeriod} })
    .sort((a,b)=>b.totalLoss-a.totalLoss),[products,periodSoldMap])
  const belowCostPg = usePagination(belowCost)
  const lowMargin = useMemo(()=>products.filter(p=>p.costPrice&&!p.isService)
    .map(p=>({...p,margin:Math.round(((p.price-p.costPrice)/p.price)*100)}))
    .filter(p=>p.margin>=0&&p.margin<=15).sort((a,b)=>a.margin-b.margin),[products])
  const lowMarginPg = usePagination(lowMargin)

  // ── RETURNS & REFUNDS ─────────────────────────────────────────
  const pendingCount  = refundsSubmitted.filter(r=>r.status==='Pending').length + returnsSubmitted.filter(r=>r.status==='Pending').length
  const rejectedCount = refundsSubmitted.filter(r=>r.status==='Rejected').length + returnsSubmitted.filter(r=>r.status==='Rejected').length
  const approvedReturnsAmt = returnsApproved.reduce((s,r)=>s+r.total,0)
  const approvedRefundsAmt = refundsApproved.reduce((s,r)=>s+r.total,0)
  const totalMoneyBack = approvedRefundsAmt + returnsApproved.filter(r=>isMoneyBack(r.method)).reduce((s,r)=>s+r.total,0)

  const conditionTally = useMemo(()=>{
    let resellable=0, defective=0
    returnsApproved.forEach(r=>Object.values(r.conditions||{}).forEach(c=>{ if(c.status==='Defective') defective++; else if(c.status==='Resellable') resellable++ }))
    return [{name:'Resellable',value:resellable},{name:'Defective',value:defective}].filter(d=>d.value>0)
  },[returnsApproved])

  const topReasons = useMemo(()=>{
    const map={}
    ;[...refundsSubmitted,...returnsSubmitted].forEach(r=>{ if(!r.reason) return; map[r.reason]=(map[r.reason]||0)+1 })
    return Object.entries(map).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,6)
  },[refundsSubmitted,returnsSubmitted])
  const reasonMax = topReasons[0]?.count || 1

  const defectiveRows = useMemo(()=>{
    const rows=[]
    returnsApproved.forEach(r=>{
      Object.entries(r.conditions||{}).forEach(([key,c])=>{
        if(c.status!=='Defective') return
        let item=null, serial='—'
        if(key.startsWith('item:')){
          const itemId=key.split(':')[1]
          item=(r.items||[]).find(i=>String(i.item_id)===String(itemId))
        } else {
          serial=key
          item=(r.items||[]).find(i=>(i.serials||[]).includes(key))
        }
        rows.push({ rowId:`${r.id}-${key}`, date:r.processedAt||r.createdAt, returnId:r.id, product:item?.name||'—', serial, note:c.note||'—', costValue:item?.costPrice||0 })
      })
    })
    return rows.sort((a,b)=>new Date(b.date)-new Date(a.date))
  },[returnsApproved])
  const defectivePg = usePagination(defectiveRows)
  const defectiveTotal = defectiveRows.reduce((s,r)=>s+r.costValue,0)

  const historyRows = useMemo(()=>{
    const rs = returnsSubmitted.map(r=>({ id:r.id, kind:'Return', txnId:r.transactionId, createdAt:r.createdAt, customerName:r.customerName, total:r.total, status:r.status, processedBy:r.processedBy }))
    const fs = refundsSubmitted.map(r=>({ id:r.id, kind:'Refund', txnId:r.transactionId, createdAt:r.createdAt, customerName:r.customerName, total:r.total, status:r.status, processedBy:r.processedBy }))
    return [...rs,...fs].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
  },[returnsSubmitted,refundsSubmitted])
  const historyFiltered = historyRows
    .filter(r=>historyType==='All'||r.kind===`${historyType.slice(0,-1)}`)
    .filter(r=>historyStatus==='All'||r.status===historyStatus)
  const historyPg = usePagination(historyFiltered)
  useEffect(()=>{ historyPg.setPage(1) },[historyType,historyStatus,period,customFrom,customTo])

  // ── CUSTOMERS ──────────────────────────────────────────────
  const totalPoints = customers.reduce((s,c)=>s+c.points,0)
  const platinumCount = customers.filter(c=>c.points>=3000).length
  const goldCount     = customers.filter(c=>c.points>=1500&&c.points<3000).length
  const silverCount   = customers.filter(c=>c.points>=500&&c.points<1500).length
  const bronzeCount   = customers.filter(c=>c.points<500).length
  const tierCounts = [
    {name:'Platinum',value:platinumCount},
    {name:'Gold',    value:goldCount},
    {name:'Silver',  value:silverCount},
    {name:'Bronze',  value:bronzeCount},
  ].filter(tc=>tc.value>0)
  const topCustsPeriod = useMemo(()=>{
    const map={}
    filtered.forEach(tx=>{ if(!tx.customerId) return
      if(!map[tx.customerId]) map[tx.customerId]={id:tx.customerId,amount:0,purchases:0}
      map[tx.customerId].amount+=tx.total; map[tx.customerId].purchases+=1
    })
    return Object.values(map).map(m=>({...m, customer:customers.find(c=>c.id===m.id)}))
      .filter(m=>m.customer)
      .sort((a,b)=>b.amount-a.amount).slice(0,8)
  },[filtered,customers])
  // Export-only.
  const tierSummaryRows = [
    {tier:'Bronze',   range:'0 – 499 pts',       count:bronzeCount},
    {tier:'Silver',   range:'500 – 1,499 pts',   count:silverCount},
    {tier:'Gold',     range:'1,500 – 2,999 pts', count:goldCount},
    {tier:'Platinum', range:'3,000+ pts',        count:platinumCount},
  ].map(tc=>({...tc, pct: customers.length?Math.round(tc.count/customers.length*1000)/10:0}))

  // Tier Rewards Claimed — period-scoped like every other "submitted this
  // period" list on this page (refundsSubmitted/returnsSubmitted). Never
  // overlaps sales/VAT/top-selling/etc. — claim_tier_reward never writes a
  // transactions row, see add_tier_rewards.sql. Old points-exchange rows
  // (tier IS NULL) still show up here too, just with "—" in the Tier column.
  const redemptionsFiltered = useMemo(()=>redemptions.filter(r=>inPeriod(new Date(r.createdAt))),[redemptions,periodStart,periodEnd]) // eslint-disable-line react-hooks/exhaustive-deps
  const redemptionsSorted = useMemo(()=>[...redemptionsFiltered].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),[redemptionsFiltered])
  const redemptionsPg = usePagination(redemptionsSorted)
  useEffect(()=>{ redemptionsPg.setPage(1) },[period,customFrom,customTo]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalPointsUsed = redemptionsFiltered.reduce((s,r)=>s+(r.pointsUsed||0),0)
  const mostClaimedItems = useMemo(()=>{
    const map={}
    redemptionsFiltered.forEach(r=>{
      const key=r.productName||'Unknown item'
      if(!map[key]) map[key]={name:key,timesClaimed:0}
      map[key].timesClaimed+=1
    })
    return Object.values(map).sort((a,b)=>b.timesClaimed-a.timesClaimed)
  },[redemptionsFiltered])

  // ── EXPORT ─────────────────────────────────────────────────────
  // Real calendar dates for export headers — periodLabel is a UI shortcut
  // ("Today", "This Week") that doesn't belong in a downloaded file.
  const exportPeriodLabel = `${format(periodStart,'MMM d, yyyy')} – ${format(periodEnd,'MMM d, yyyy')}`
  const exportGeneratedLabel = `Generated: ${format(now,'MMM d, yyyy h:mm a')} by ${user?.user_metadata?.name || 'Admin'}`

  // Each builder adds the current tab's sheets to the workbook, using plain
  // sheet names (only one tab's sheets ever end up in the file, so there's
  // no collision to prefix against).
  const buildSalesSheets = (wb, opts) => {
    addMultiTableSheet(wb, { ...opts, name: 'Summary', tables: [
      { title: 'Summary', columns: [{header:'Metric',value:r=>r.k},{header:'Value',value:r=>r.v,money:r=>r.money,percent:r=>r.percent}], rows: [
        {k:'Gross Sales',v:metrics.grossSales,money:true},
        {k:'Returns & Refunds',v:-(metrics.refundTotal+metrics.returnTotal),money:true},
        {k:'Net Sales',v:metrics.netSales,money:true},
        {k:'Gross Profit',v:metrics.grossProfit,money:true},
        {k:'Net Profit',v:metrics.netProfit,money:true},
        {k:'Gross VAT',v:metrics.grossVat,money:true},
        {k:'Refunded VAT',v:-metrics.refundedVat,money:true},
        {k:'Net VAT',v:metrics.netVat,money:true},
        {k:'Transactions',v:metrics.transactionCount},
        {k:'Average Sale',v:salesAvg,money:true},
        {k:'Refund Rate',v:metrics.refundRate/100,percent:true},
      ] },
      { title: 'Payment Methods', columns: [
        {header:'Method',value:r=>r.name},
        {header:'Count',value:r=>r.count,total:true},
        {header:'Amount',value:r=>r.value,money:true,total:true},
        {header:'%',value:r=>r.pct/100,percent:true},
      ], rows: payMethodStats },
    ]})
    addSheet(wb, { ...opts, name: 'Transactions', columns: [
      {header:'Txn #',value:r=>`#${String(r.id).padStart(4,'0')}`},
      {header:'Date & Time',value:r=>new Date(r.createdAt),date:true},
      {header:'Customer',value:r=>r.customerName||'Walk-in'},
      {header:'Cashier',value:r=>r.cashierName||'—'},
      {header:'Items',value:r=>(r.items||[]).map(i=>`${i.name} ×${i.qty}`).join(', ')},
      {header:'Payment',value:r=>r.payment},
      {header:'GCash Ref. No.',value:r=>r.gcashReference||'—'},
      {header:'Subtotal',value:r=>r.subtotal||r.total,money:true,total:true},
      {header:'VAT',value:r=>r.vat||0,money:true,total:true},
      {header:'Total',value:r=>r.total,money:true,total:true},
      {header:'Status',value:r=>txnStatus(r,refunds,returns)},
    ], rows: filtered })
    addSheet(wb, { ...opts, name: 'Items Sold', columns: [
      {header:'Product',value:r=>r.name},
      {header:'Category',value:r=>r.category},
      {header:'Qty',value:r=>r.qty,total:true},
      {header:'Revenue',value:r=>r.revenue,money:true,total:true},
      {header:'Cost',value:r=>r.cost,money:true,total:true},
      {header:'Profit',value:r=>r.profit,money:true,total:true},
    ], rows: itemsSoldRows })
    addSheet(wb, { ...opts, name: 'Top Selling', columns: [
      {header:'Rank',value:r=>r.rank},
      {header:'Product',value:r=>r.name},
      {header:'Qty Sold',value:r=>r.sold,total:true},
      {header:'Revenue',value:r=>r.revenue,money:true,total:true},
    ], rows: topExportRows })
    addSheet(wb, { ...opts, name: 'Least Selling', columns: [
      {header:'Rank',value:r=>r.rank},
      {header:'Product',value:r=>r.name},
      {header:'Qty Sold',value:r=>r.sold,total:true},
      {header:'Revenue',value:r=>r.revenue,money:true,total:true},
      {header:'Daily Sales Rate',value:r=>Number(r.rate.toFixed(2)),numFmt:'0.00'},
    ], rows: leastExportRows })
    addSheet(wb, { ...opts, name: 'Returns & Refunds', columns: [
      {header:'Type',value:r=>r.type},
      {header:'#',value:r=>`#${String(r.id).padStart(4,'0')}`},
      {header:'Original Txn #',value:r=>`#${String(r.txnId).padStart(4,'0')}`},
      {header:'Approved Date',value:r=>r.date,date:true},
      {header:'Reason',value:r=>r.reason||'—'},
      {header:'Amount',value:r=>r.amount,money:true,total:true},
    ], rows: salesRetRefRows })
  }

  const buildInventorySheets = (wb, opts) => {
    addSheet(wb, { ...opts, name: 'Restock', columns: [
      {header:'Product',value:r=>r.name},
      {header:'Category',value:r=>r.category},
      {header:'Stock',value:r=>r.stock,total:true},
      {header:'Sold (30d)',value:r=>r.sold30,total:true},
      {header:'Avg/day',value:r=>Number(r.avgDaily.toFixed(2)),numFmt:'0.00'},
      {header:'Days Left',value:r=>r.daysLeft===Infinity?'∞':Math.round(r.daysLeft)},
      {header:'Suggested Reorder',value:r=>r.suggestedReorder,total:true},
      {header:'Status',value:r=>r.status},
    ], rows: demandRows })
    addSheet(wb, { ...opts, name: 'Low & Out of Stock', columns: [
      {header:'Product',value:r=>r.name},
      {header:'Category',value:r=>r.category},
      {header:'Stock',value:r=>r.stock,total:true},
      {header:'Sold (30d)',value:r=>r.sold30,total:true},
      {header:'Last Sold',value:r=>r.lastSoldAt?new Date(r.lastSoldAt):'Never',date:true},
      {header:'Status',value:r=>r.stockStatus},
    ], rows: lowOutStockRows })
    addSheet(wb, { ...opts, name: 'Slow-Moving', columns: [
      {header:'Product',value:r=>r.name},
      {header:'Category',value:r=>r.category},
      {header:'Stock',value:r=>r.stock,total:true},
      {header:'Last Sold',value:r=>r.lastSoldAt?new Date(r.lastSoldAt):'Never',date:true},
      {header:'Reason',value:r=>r.reason},
      {header:'Tied Up',value:r=>r.tiedUp,money:true,total:true},
    ], rows: slowMoving })
    addMultiTableSheet(wb, { ...opts, name: 'Pricing Issues', tables: [
      { title: 'Below Cost', columns: [
        {header:'Product',value:r=>r.name},
        {header:'Cost Price',value:r=>r.costPrice,money:true},
        {header:'Selling Price',value:r=>r.price,money:true},
        {header:'Loss/Unit',value:r=>r.lossPerUnit,money:true},
        {header:'Sold This Period',value:r=>r.soldInPeriod,total:true},
        {header:'Total Loss',value:r=>r.totalLoss,money:true,total:true},
      ], rows: belowCost },
      { title: 'Low Margin (0–15%)', columns: [
        {header:'Product',value:r=>r.name},
        {header:'Cost Price',value:r=>r.costPrice,money:true},
        {header:'Selling Price',value:r=>r.price,money:true},
        {header:'Margin %',value:r=>r.margin/100,percent:true},
        {header:'Stock',value:r=>r.stock,total:true},
      ], rows: lowMargin },
    ]})
  }

  const buildReturnsSheets = (wb, opts) => {
    addSheet(wb, { ...opts, name: 'Summary', columns: [
      {header:'Metric',value:r=>r.k},{header:'Value',value:r=>r.v,money:r=>r.money},
    ], rows: [
      {k:'Pending',v:pendingCount},
      {k:'Approved Returns',v:returnsApproved.length},
      {k:'Approved Returns Amount',v:approvedReturnsAmt,money:true},
      {k:'Approved Refunds',v:refundsApproved.length},
      {k:'Approved Refunds Amount',v:approvedRefundsAmt,money:true},
      {k:'Total Money Back',v:totalMoneyBack,money:true},
      {k:'Rejected',v:rejectedCount},
    ]})
    addSheet(wb, { ...opts, name: 'Defective Returns', columns: [
      {header:'Date',value:r=>new Date(r.date),date:true},
      {header:'Return #',value:r=>`#${String(r.returnId).padStart(4,'0')}`},
      {header:'Product',value:r=>r.product},
      {header:'Serial',value:r=>r.serial},
      {header:'Defect Note',value:r=>r.note},
      {header:'Cost Value',value:r=>r.costValue,money:true,total:true},
    ], rows: defectiveRows })
    addSheet(wb, { ...opts, name: 'Request History', columns: [
      {header:'Type',value:r=>r.kind},
      {header:'#',value:r=>`#${String(r.id).padStart(4,'0')}`},
      {header:'Txn #',value:r=>`#${String(r.txnId).padStart(4,'0')}`},
      {header:'Date',value:r=>new Date(r.createdAt),date:true},
      {header:'Customer',value:r=>r.customerName||'Walk-in'},
      {header:'Amount',value:r=>r.total,money:true,total:true},
      {header:'Status',value:r=>r.status},
      {header:'Processed By',value:r=>r.processedBy||'—'},
    ], rows: historyRows })
  }

  const buildCustomerSheets = (wb, opts) => {
    addSheet(wb, { ...opts, name: 'Top Customers', columns: [
      {header:'Customer',value:r=>r.customer.name},
      {header:'Tier',value:r=>getTier(r.customer.points).label},
      {header:'Purchases',value:r=>r.purchases,total:true},
      {header:'Amount',value:r=>r.amount,money:true,total:true},
    ], rows: topCustsPeriod })
    addSheet(wb, { ...opts, name: 'Tier Summary', columns: [
      {header:'Tier',value:r=>r.tier},
      {header:'Range',value:r=>r.range},
      {header:'Count',value:r=>r.count,total:true},
      {header:'% of Total',value:r=>r.pct/100,percent:true},
    ], rows: tierSummaryRows })
    addSheet(wb, { ...opts, name: 'Tier Rewards Claimed', columns: [
      {header:'Date',value:r=>new Date(r.createdAt),date:true},
      {header:'Redemption No.',value:r=>r.redemptionNo},
      {header:'Customer',value:r=>r.customerName||'—'},
      {header:'Item',value:r=>r.productName||'—'},
      {header:'Serial No.',value:r=>r.serialNumber||'—'},
      {header:'Tier',value:r=>r.tier?r.tier.charAt(0).toUpperCase()+r.tier.slice(1):'—'},
      {header:'Points Used',value:r=>r.pointsUsed||0,total:true},
      {header:'Staff',value:r=>r.redeemedByName||'—'},
    ], rows: redemptionsSorted })
    addSheet(wb, { ...opts, name: 'Most Claimed Items', columns: [
      {header:'Item',value:r=>r.name},
      {header:'Times Claimed',value:r=>r.timesClaimed,total:true},
    ], rows: mostClaimedItems })
  }

  // Exports just the open tab's sheets, scoped to whichever period the
  // admin currently has selected.
  const exportXlsx = async () => {
    setExporting(true)
    try {
      const wb = await createWorkbook({ creator: 'Gapuz POS', created: now })
      const opts = { periodLabel: exportPeriodLabel, generatedLabel: exportGeneratedLabel, reportName: TAB_TITLE[activeTab] }

      if (activeTab === 'sales') buildSalesSheets(wb, opts)
      else if (activeTab === 'inventory') buildInventorySheets(wb, opts)
      else if (activeTab === 'returns') buildReturnsSheets(wb, opts)
      else buildCustomerSheets(wb, opts)

      await downloadWorkbook(wb, `gapuz-pos-${activeTab}-${fromStr}-to-${toStr}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  // Generic across all 6 cards — reads whichever series CHART_SERIES[selectedCard]
  // says to show, so the tooltip always matches the chart under it exactly.
  // Transactions shows a plain count (no ₱, no 2-decimal formatting) since
  // it isn't money.
  const SalesTip = ({active,payload,label}) => {
    if(!active||!payload?.length) return null
    const d = payload[0].payload
    const series = CHART_SERIES[selectedCard]
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        {series.map(s=>(
          <div key={s.key} className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{background:s.color}}/><span className="chart-tooltip-name">{s.name}</span><span className="chart-tooltip-value">{selectedCard==='transactions' ? d[s.key] : peso(d[s.key])}</span></div>
        ))}
      </div>
    )
  }

  return(
    <div className="rpt-scope" style={{height:'100%',overflowY:'auto'}}>
      <div className="rpt-toolbar">
        <div className="rpt-toolbar-tabs">
          <SegmentedControl
            options={REPORT_TABS.map(tab=>({ value:tab.id, label:<>{tab.icon}{tab.label}</> }))}
            value={activeTab} onChange={setActiveTab}
          />
        </div>
        <div className="rpt-toolbar-right">
          {activeTab==='inventory' && <span style={{fontSize:12,color:'var(--rpt-muted)',fontStyle:'italic'}}>Stock as of today</span>}
          <div ref={periodRef} style={{position:'relative',display:'flex',alignItems:'center',gap:8}}>
            <SegmentedControl size="sm" options={PERIODS.map(p=>({value:p,label:p}))} value={period} onChange={handlePeriodChange}/>
            {period==='Custom' && <span style={{fontSize:12,color:'var(--rpt-muted)',whiteSpace:'nowrap'}}>{periodLabel}</span>}
            {customPopoverOpen && (
              <div className="rpt-card" style={{position:'absolute',top:'calc(100% + 8px)',right:0,padding:16,zIndex:20,width:250}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--rpt-title)',marginBottom:10}}>Custom range</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <input type="date" className="rpt-input" value={draftFrom} max={draftTo} onChange={e=>setDraftFrom(e.target.value)}/>
                  <input type="date" className="rpt-input" value={draftTo} min={draftFrom} onChange={e=>setDraftTo(e.target.value)}/>
                </div>
                <button onClick={applyCustomRange} className="rpt-btn-primary" style={{width:'100%',marginTop:12}}>Apply</button>
              </div>
            )}
          </div>
          <button onClick={exportXlsx} disabled={exporting} className="rpt-btn-outline" style={{opacity:exporting?0.6:1,cursor:exporting?'wait':'pointer'}}>
            <Download size={14}/>{exporting?'Exporting…':'Export (.xlsx)'}
          </button>
        </div>
      </div>

      <div style={{padding:'16px 24px 24px',display:'flex',flexDirection:'column',gap:20}}>
        <div key={activeTab} className="rpt-tab-fade" style={{display:'flex',flexDirection:'column',gap:20}}>

        {/* ══════════ SALES ══════════ */}
        {activeTab==='sales' && <>
          <div className="rpt-kpi-row">
            {SALES_CARDS.map(c=>{
              const selected = selectedCard===c.key
              const value = c.key==='avg' ? c.valueOf(metrics, salesAvg) : c.valueOf(metrics)
              const sub = c.key==='returns' ? `${metrics.returnCount} returns · ${metrics.refundCount} refunds`
                : c.key==='profit' ? `Gross profit ${peso(metrics.grossProfit)}`
                : c.key==='avg' ? 'Gross ÷ transactions'
                : 'Click to view in graph'
              const ringColor = c.tone==='red' ? 'var(--rpt-red)' : 'var(--rpt-green)'
              return (
                <button key={c.key} type="button" onClick={()=>setSelectedCard(c.key)} aria-pressed={selected}
                  className={`rpt-card stat-card rpt-clickable${selected?' rpt-kpi-selected':''}`}
                  style={{
                    textAlign:'left', cursor:'pointer', fontFamily:'inherit', width:'100%',
                    border: selected ? `1.5px solid ${ringColor}` : undefined,
                    boxShadow: selected ? `0 0 0 3px ${c.tone==='red'?'var(--rpt-red-light)':'var(--rpt-green-light)'}` : undefined,
                    background: selected ? (c.tone==='red'?'var(--rpt-red-light)':'var(--rpt-green-light)') : undefined,
                  }}>
                  <div className="stat-card-top">
                    <div className="stat-card-icon" style={{background: c.tone==='red'?'var(--rpt-red-light)':'#F3F4F6', color: c.tone==='red'?'var(--rpt-red)':'#6B7280'}}>
                      <c.icon size={15}/>
                    </div>
                    <div className="stat-card-label">{c.label}</div>
                  </div>
                  <div className={`stat-card-value${c.tone!=='default'?` v-${c.tone}`:''}`}>{value}</div>
                  <div className="stat-card-sub" style={{color: selected ? ringColor : undefined, fontWeight: selected?700:400}}>{sub}</div>
                </button>
              )
            })}
          </div>

          <div className="rpt-grid-12">
            <div className="rpt-col-8">
              <ChartCard title={`${CARD_TITLE[selectedCard]} – ${periodLabel}`} style={{height:'100%'}}>
                {!hasChartData ? (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:260,gap:8}}>
                    <div style={{fontSize:14,color:'var(--rpt-muted)'}}>No data for this period</div>
                  </div>
                ) : salesChart.length<2 ? (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:260,gap:8}}>
                    <div style={{fontSize:32,fontWeight:600,color:'var(--rpt-title)'}}>{SALES_CARDS.find(c=>c.key===selectedCard).key==='avg' ? peso(salesAvg) : SALES_CARDS.find(c=>c.key===selectedCard).valueOf(metrics)}</div>
                    <div style={{fontSize:13,color:'var(--rpt-muted)'}}>Not enough data for a trend yet</div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={salesChart}>
                      <defs>
                        <linearGradient id="rptGrossGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#059669" stopOpacity={0.22}/>
                          <stop offset="100%" stopColor="#059669" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--rpt-grid-line)" strokeDasharray="4 4" vertical={false}/>
                      <XAxis dataKey="label" tick={{fontSize:12,fill:'var(--rpt-tick)'}} tickLine={false} axisLine={false} interval={salesChart.length>20?Math.floor(salesChart.length/12):0}/>
                      <YAxis tick={{fontSize:12,fill:'var(--rpt-tick)'}} tickLine={false} axisLine={false}
                        tickFormatter={v=>selectedCard==='transactions' ? v : (v>=1000?`₱${Math.round(v/1000)}k`:`₱${v}`)}/>
                      <Tooltip content={<SalesTip/>}/>
                      {period==='Today' ? (
                        // Hourly bars instead of a curved line — a smooth curve
                        // between hour buckets implies slopes that don't exist.
                        CHART_SERIES[selectedCard].map((s,i)=>(
                          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4,4,0,0]} maxBarSize={i===0?22:12}/>
                        ))
                      ) : CHART_SERIES[selectedCard].length>1 ? (
                        <>
                          <Area type="monotone" dataKey={CHART_SERIES[selectedCard][0].key} name={CHART_SERIES[selectedCard][0].name} stroke={CHART_SERIES[selectedCard][0].color} strokeWidth={2} fill="url(#rptGrossGradient)"/>
                          <Line type="monotone" dataKey={CHART_SERIES[selectedCard][1].key} name={CHART_SERIES[selectedCard][1].name} stroke={CHART_SERIES[selectedCard][1].color} strokeWidth={2} dot={false}/>
                        </>
                      ) : (
                        <Area type="monotone" dataKey={CHART_SERIES[selectedCard][0].key} name={CHART_SERIES[selectedCard][0].name} stroke={CHART_SERIES[selectedCard][0].color} strokeWidth={2} fill="url(#rptGrossGradient)"/>
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
            <div className="rpt-col-4">
              <SalesBreakdownCard metrics={metrics}/>
            </div>
          </div>

          {/* ── KPI card drill-down lists — Transactions/Returns & Refunds/Net Profit only ── */}
          {selectedCard==='transactions' && (
            <ChartCard title={`Transactions (${activeFiltered.length})`}
              actions={activeFiltered.length>10 && <button className="rpt-btn-outline" style={{fontSize:11,padding:'5px 12px'}} onClick={()=>txnHistoryRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}>View all →</button>}>
              <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead><tr><th>Txn #</th><th>Time</th><th>Cashier</th><th>Customer</th><th>Payment</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {activeFiltered.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'var(--rpt-muted)'}}>No transactions for this period.</td></tr>
                    :activeFiltered.slice(0,10).map(tx=>(
                      <tr key={tx.id} onClick={()=>setViewTxnId(tx.id)} style={{cursor:'pointer'}}>
                        <td style={{color:'var(--rpt-green)',fontWeight:600}}>#{String(tx.id).padStart(4,'0')}</td>
                        <td style={{color:'var(--rpt-muted)'}}>{new Date(tx.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                        <td>{tx.cashierName||'—'}</td>
                        <td>{tx.customerName||'Walk-in'}</td>
                        <td><span className="rpt-pill rpt-pill-gray"><span className="dot" style={{background:paymentColor(tx.payment)}}/>{tx.payment}</span></td>
                        <td className="num" style={{fontWeight:700,color:'var(--rpt-title)'}}>{peso(tx.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </ChartCard>
          )}
          {selectedCard==='returns' && (
            <ChartCard title={`Returns & Refunds (${requestsForCard.length})`}>
              <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead><tr><th>Request #</th><th>Type</th><th>Status</th><th>Txn #</th><th className="num">Amount</th><th>Date</th></tr></thead>
                  <tbody>
                    {requestsForCard.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:30,color:'var(--rpt-muted)'}}>No approved returns or refunds for this period.</td></tr>
                    :requestsForCard.slice(0,10).map(r=>(
                      <tr key={`${r.kind}-${r.id}`} onClick={()=>setViewRequest({kind:r.kind, record:(r.kind==='return'?returns:refunds).find(x=>x.id===r.id)})} style={{cursor:'pointer'}}>
                        <td style={{color:'var(--rpt-green)',fontWeight:600}}>{r.kind==='return'?'RET':'REF'} #{String(r.id).padStart(4,'0')}</td>
                        <td style={{textTransform:'capitalize'}}>{r.kind}</td>
                        <td><StatusBadge status={r.status} isLight/></td>
                        <td style={{color:'var(--rpt-muted)'}}>#{String(r.transactionId).padStart(4,'0')}</td>
                        <td className="num" style={{fontWeight:700,color:'var(--rpt-red)'}}>−{peso(r.amount)}</td>
                        <td style={{color:'var(--rpt-muted)'}}>{fmtDate(r.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </ChartCard>
          )}
          {selectedCard==='profit' && (
            <ChartCard title="Top 5 Products by Profit">
              <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead><tr><th>Product</th><th className="num">Qty Sold</th><th className="num">Sales</th><th className="num">Profit</th></tr></thead>
                  <tbody>
                    {profitByProduct.length===0?<tr><td colSpan={4} style={{textAlign:'center',padding:30,color:'var(--rpt-muted)'}}>No sales for this period.</td></tr>
                    :profitByProduct.slice(0,5).map(p=>(
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{p.sold}</td>
                        <td className="num">{peso(p.sales)}</td>
                        <td className="num" style={{fontWeight:700,color:p.profit>=0?'var(--rpt-green)':'var(--rpt-red)'}}>{peso(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
            </ChartCard>
          )}

          <div className="rpt-grid-12">
            <div className="rpt-col-4">
              <ChartCard title="Payment Methods">
                <DonutCard data={payData.map(d=>({name:d.name,value:d.value,color:paymentColor(d.name)}))} caption="total" formatValue={peso} emptyText="No payments for this period."/>
              </ChartCard>
            </div>
            <div className="rpt-col-4">
              <ChartCard title={<><Trophy size={14} style={{color:'var(--rpt-amber)'}}/>Top Selling</>}
                style={{height:420}} bodyStyle={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}
                actions={<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <SegmentedControl size="sm" options={[{value:'qty',label:'Qty'},{value:'revenue',label:'Revenue'}]} value={topMetric} onChange={setTopMetric}/>
                  <SegmentedControl size="sm" options={COUNT_OPTIONS} value={topCount} onChange={setTopCount}/>
                </div>}>
                <div className="ranked-list-scroll">
                  <RankedList
                    items={topVisible.map(p=>({key:p.name,label:p.name,value:topBasis(p),_p:p}))}
                    max={topMax}
                    rankOffset={topRankOffset}
                    renderLeft={it=><ProductThumb {...(products.find(pr=>pr.name===it._p.name)||{})} size={24} radius={6}/>}
                    renderValue={it=>topMetric==='qty'?`${it._p.sold} sold`:peso(it._p.revenue)}
                    emptyText="No data."
                  />
                </div>
                {topCount==='All' && <Pagination {...topPg}/>}
              </ChartCard>
            </div>
            <div className="rpt-col-4">
              <ChartCard title={<><TrendingDown size={14} style={{color:'var(--rpt-red)'}}/>Least Selling</>}
                style={{height:420}} bodyStyle={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}
                actions={<SegmentedControl size="sm" options={COUNT_OPTIONS} value={leastCount} onChange={setLeastCount}/>}>
                <div className="ranked-list-scroll">
                  <RankedList
                    items={leastVisible.map(p=>({key:p.name,label:p.name,value:p.sold,_p:p}))}
                    max={topSoldMax}
                    rankOffset={leastRankOffset}
                    barColor="var(--rpt-red)"
                    renderLeft={it=><ProductThumb {...(products.find(pr=>pr.name===it._p.name)||{})} size={24} radius={6}/>}
                    renderValue={it=>`${it._p.sold} sold · ${it._p.rate.toFixed(2)}/day`}
                    emptyText={LEAST_SELLING_EMPTY_TEXT}
                  />
                </div>
                {leastCount==='All' && <Pagination {...leastPg}/>}
              </ChartCard>
            </div>
          </div>

          <div ref={txnHistoryRef} />
          <ChartCard title={`Transaction History (${txFiltered.length})`}
            actions={<SegmentedControl size="sm" options={['All','Completed','Voided'].map(s=>({value:s,label:s}))} value={txStatusFilter} onChange={setTxStatusFilter}/>}>
            <div className="rpt-table-wrap"><div className="rpt-table-scroll">
              <table className="rpt-table">
                <thead><tr>
                  <th>Txn #</th><th>Date & time</th><th>Customer</th><th>Items</th><th>Payment</th><th>GCash Ref. No.</th>
                  <th className="num">Subtotal</th><th className="num">VAT</th><th className="num">Total</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {txFiltered.length===0?<tr><td colSpan={10} style={{textAlign:'center',padding:40,color:'var(--rpt-muted)'}}>No transactions for this period.</td></tr>
                  :txPg.pageItems.map(tx=>(
                    <tr key={tx.id} onClick={()=>setViewTxnId(tx.id)} style={{cursor:'pointer'}}>
                      <td style={{color:'var(--rpt-green)',fontWeight:600}}>#{String(tx.id).padStart(4,'0')}</td>
                      <td style={{color:'var(--rpt-muted)'}}>{new Date(tx.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                      <td>{tx.customerName||'Walk-in'}</td>
                      <td style={{color:'var(--rpt-muted)'}}>{(tx.items||[]).length} item(s)</td>
                      <td><span className="rpt-pill rpt-pill-gray"><span className="dot" style={{background:paymentColor(tx.payment)}}/>{tx.payment}</span></td>
                      <td style={{color:'var(--rpt-muted)',fontFamily:"'JetBrains Mono',monospace",fontSize:11.5}}>{tx.gcashReference||'—'}</td>
                      <td className="num">{peso(tx.subtotal||tx.total)}</td>
                      <td className="num" style={{color:'var(--rpt-muted)'}}>{peso(tx.vat||0)}</td>
                      <td className="num" style={{fontWeight:700,color:'var(--rpt-title)',textDecoration:tx.status==='Voided'?'line-through':'none'}}>{peso(tx.total)}</td>
                      <td>{tx.status==='Voided'
                        ? <span style={{fontSize:9.5,fontWeight:700,padding:'2px 7px',borderRadius:99,background:'rgba(239,68,68,0.12)',color:'var(--rpt-red)'}}>VOIDED</span>
                        : <span style={{fontSize:9.5,fontWeight:700,padding:'2px 7px',borderRadius:99,background:'var(--rpt-green-light)',color:'var(--rpt-green)'}}>{tx.status||'Completed'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
            <Pagination {...txPg}/>
          </ChartCard>
        </>}

        {/* ══════════ INVENTORY ══════════ */}
        {activeTab==='inventory' && <>
          <div className="rpt-kpi-row">
            <StatCard icon={Package} label="Total Products" value={products.length}/>
            <StatCard icon={Layers} label="Stock Value at Cost" value={peso(stockValueCost)}/>
            <StatCard icon={Tag} label="Stock Value at Retail" value={peso(stockValueRetail)}/>
            <StatCard icon={AlertTriangle} label="Low Stock" value={lowStock.length} tone="amber"/>
            <StatCard icon={Ban} label="Out of Stock" value={outStock.length} tone="red"/>
          </div>

          <div className="rpt-demand-row">
            <div className="rpt-top-sellers-col">
              <ChartCard title={<><Star size={14} style={{color:'var(--rpt-amber)'}}/>Top Sellers (30d)</>}>
                <RankedList
                  items={top10ByUnits.slice(0,8).map(p=>({key:p.id,label:p.name,value:p.sold30,_p:p}))}
                  renderLeft={it=><ProductThumb image={it._p.image} icon={it._p.icon} category={it._p.category} size={24} radius={6}/>}
                  renderValue={it=>`${it.value} sold`}
                  emptyText="No sales in the last 30 days."
                />
              </ChartCard>
            </div>
            <div>
              <ChartCard title={<><Star size={14} style={{color:'var(--rpt-amber)'}}/>Restock Recommendations</>}
                subtitle="Suggested reorder covers 14 days of sales based on the last 30 days.">
                <div style={{marginBottom:12}}>
                  <SegmentedControl size="sm"
                    options={['All','Reorder now','Reorder soon','OK','No demand'].map(s=>({value:s,label:<>{s}<span className="rpt-filter-chip">{demandStatusCounts[s]}</span></>}))}
                    value={demandStatusFilter} onChange={setDemandStatusFilter}/>
                </div>
                <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                  <table className="rpt-table rpt-table-fixed8">
                    <thead><tr>
                      <th>Product</th><th>Category</th><th className="num">Stock</th><th className="num">Sold (30d)</th>
                      <th className="num" title="Units sold in the last 30 days ÷ 30">Avg/day</th><th className="num" title="Current stock ÷ average daily sales">Days left</th><th className="num">Suggested reorder</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {demandFiltered.length===0?<tr style={{height:416}}><td colSpan={8} style={{textAlign:'center',verticalAlign:'middle',color:'var(--rpt-muted)'}}>No products in this status</td></tr>
                      :demandPg.pageItems.map(p=>(
                        <tr key={p.id}>
                          <td><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                          <td style={{color:'var(--rpt-muted)'}}>{p.category}</td>
                          <td className="num">{p.stock}</td>
                          <td className="num">{p.sold30}</td>
                          <td className="num">{p.avgDaily.toFixed(2)}</td>
                          <td className="num">{p.daysLeft===Infinity?'∞':Math.floor(p.daysLeft)}</td>
                          <td className="num" style={{fontWeight:p.suggestedReorder>0?700:400,color:p.suggestedReorder>0?'var(--rpt-amber)':'var(--rpt-muted)'}}>{p.suggestedReorder}</td>
                          <td><span className={`rpt-pill ${STATUS_PILL[p.status]}`}><span className="dot"/>{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
                <Pagination {...demandPg}/>
              </ChartCard>
            </div>
          </div>

          <div className="rpt-grid-12">
            <div className="rpt-col-6">
              <ChartCard title={<><AlertTriangle size={14} style={{color:'var(--rpt-amber)'}}/>Low Stock</>}>
                <div className="rpt-simple-list">
                  {lowStockRows.length===0?<div className="rpt-empty">All good!</div>
                  :lowStockPg.pageItems.map(p=>(
                    <div key={p.id} className="rpt-simple-row">
                      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                        <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                        <div style={{minWidth:0}}>
                          <div className="rpt-simple-name">{p.name}</div>
                          <div className="rpt-simple-sub">{p.category} · {p.sold30} sold (30d) · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div>
                        </div>
                      </div>
                      <span style={{fontSize:13,fontWeight:700,color:'var(--rpt-amber)',flexShrink:0}}>{p.stock} left</span>
                    </div>
                  ))}
                </div>
                <Pagination {...lowStockPg}/>
              </ChartCard>
            </div>
            <div className="rpt-col-6">
              <ChartCard title={<><Ban size={14} style={{color:'var(--rpt-red)'}}/>Out of Stock</>}>
                <div className="rpt-simple-list">
                  {outStockRows.length===0?<div className="rpt-empty">No out of stock products!</div>
                  :outStockPg.pageItems.map(p=>(
                    <div key={p.id} className="rpt-simple-row">
                      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                        <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                        <div style={{minWidth:0}}>
                          <div className="rpt-simple-name">{p.name}</div>
                          <div className="rpt-simple-sub">{p.category} · {p.sold30} sold (30d) · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div>
                        </div>
                      </div>
                      <span style={{fontSize:12,fontWeight:700,color:'var(--rpt-red)',flexShrink:0}}>OUT</span>
                    </div>
                  ))}
                </div>
                <Pagination {...outStockPg}/>
              </ChartCard>
            </div>
          </div>

          <ChartCard title={<><Archive size={14} style={{color:'var(--rpt-muted)'}}/>Slow-Moving Products</>} subtitle={`In stock, selling slowly (${SLOW_MOVING_DAYS_LEFT_MIN}+ days of stock left) or never sold (${SLOW_MOVING_NO_SALE_MIN_AGE_DAYS}+ days since added).`}>
            <div className="rpt-simple-list">
              {slowMoving.length===0?<div className="rpt-empty">Nothing slow-moving right now.</div>
              :slowMovingPg.pageItems.map(p=>(
                <div key={p.id} className="rpt-simple-row">
                  <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                    <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                    <div style={{minWidth:0}}>
                      <div className="rpt-simple-name">{p.name}</div>
                      <div className="rpt-simple-sub">{p.stock} in stock · {p.reason}</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--rpt-red)',flexShrink:0}}>{peso(p.tiedUp)} stock value</div>
                </div>
              ))}
            </div>
            <Pagination {...slowMovingPg}/>
          </ChartCard>

          <div className="rpt-grid-12">
            <div className="rpt-col-6">
              <ChartCard title={<><AlertOctagon size={14} style={{color:'var(--rpt-red)'}}/>Products Selling Below Cost</>} subtitle={`Loss on units sold during ${periodLabel}.`}>
                {belowCost.length===0?<div className="rpt-empty">No products are selling at a loss!</div>
                :<>
                  <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                    <table className="rpt-table">
                      <thead><tr><th>Product</th><th className="num">Cost price</th><th className="num">Selling price</th><th className="num">Loss/unit</th><th className="num">Sold</th><th className="num">Total loss</th></tr></thead>
                      <tbody>
                        {belowCostPg.pageItems.map(p=>(
                          <tr key={p.id}>
                            <td><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                            <td className="num" style={{color:'var(--rpt-muted)'}}>{peso(p.costPrice)}</td>
                            <td className="num" style={{color:'var(--rpt-red)',fontWeight:700}}>{peso(p.price)}</td>
                            <td className="num" style={{color:'var(--rpt-red)'}}>{peso(p.lossPerUnit)}</td>
                            <td className="num">{p.soldInPeriod}</td>
                            <td className="num" style={{color:'var(--rpt-red)',fontWeight:700}}>{peso(p.totalLoss)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div></div>
                  <Pagination {...belowCostPg}/>
                </>}
              </ChartCard>
            </div>
            <div className="rpt-col-6">
              <ChartCard title={<><AlertTriangle size={14} style={{color:'var(--rpt-amber)'}}/>Low Margin Products</>} subtitle="Margin between 0–15%.">
                {lowMargin.length===0?<div className="rpt-empty">All products have healthy margins!</div>
                :<>
                  <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                    <table className="rpt-table">
                      <thead><tr><th>Product</th><th className="num">Cost price</th><th className="num">Selling price</th><th className="num">Margin %</th><th className="num">Stock</th></tr></thead>
                      <tbody>
                        {lowMarginPg.pageItems.map(p=>(
                          <tr key={p.id}>
                            <td><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                            <td className="num" style={{color:'var(--rpt-muted)'}}>{peso(p.costPrice)}</td>
                            <td className="num">{peso(p.price)}</td>
                            <td className="num" style={{fontWeight:700,color:p.margin<=5?'var(--rpt-red)':'var(--rpt-amber)'}}>{p.margin}%</td>
                            <td className="num">{p.stock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div></div>
                  <Pagination {...lowMarginPg}/>
                </>}
              </ChartCard>
            </div>
          </div>
        </>}

        {/* ══════════ RETURNS & REFUNDS ══════════ */}
        {activeTab==='returns' && <>
          <div className="rpt-kpi-row">
            <StatCard icon={Clock} label="Pending" value={pendingCount} tone="amber"/>
            <StatCard icon={RotateCcw} label="Approved Returns" value={returnsApproved.length} sub={peso(approvedReturnsAmt)}/>
            <StatCard icon={Undo2} label="Approved Refunds" value={refundsApproved.length} sub={peso(approvedRefundsAmt)}/>
            <StatCard icon={Banknote} label="Total Money Back" value={peso(totalMoneyBack)} tone="red"/>
            <StatCard icon={XCircle} label="Rejected" value={rejectedCount}/>
          </div>

          <div className="rpt-grid-12">
            <div className="rpt-col-6">
              <ChartCard title="Returned Units by Condition">
                <DonutCard data={conditionTally.map(d=>({name:d.name,value:d.value,color:d.name==='Defective'?'#DC2626':'#059669'}))} caption="units" emptyText="No approved returns with recorded conditions this period."/>
              </ChartCard>
            </div>
            <div className="rpt-col-6">
              <ChartCard title={<><ClipboardList size={14} style={{color:'var(--rpt-green)'}}/>Top Reasons</>}>
                <RankedList items={topReasons.map(r=>({key:r.name,label:r.name,value:r.count}))} max={reasonMax} emptyText="No requests this period."/>
              </ChartCard>
            </div>
          </div>

          <ChartCard title={<><AlertOctagon size={14} style={{color:'var(--rpt-red)'}}/>Defective Returns</>}
            subtitle={`${defectiveRows.length} defective unit${defectiveRows.length===1?'':'s'} · ${peso(defectiveTotal)}`}>
            {defectiveRows.length===0?<div className="rpt-empty">No defective units this period.</div>
            :<>
              <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead><tr><th>Date</th><th>Return #</th><th>Product</th><th>Serial</th><th>Defect note</th><th className="num">Cost value</th></tr></thead>
                  <tbody>
                    {defectivePg.pageItems.map(r=>(
                      <tr key={r.rowId}>
                        <td style={{color:'var(--rpt-muted)'}}>{fmtDate(r.date)}</td>
                        <td style={{color:'var(--rpt-green)'}}>#{String(r.returnId).padStart(4,'0')}</td>
                        <td>{r.product}</td>
                        <td>{r.serial}</td>
                        <td style={{color:'var(--rpt-body)'}}>{r.note}</td>
                        <td className="num" style={{color:'var(--rpt-red)',fontWeight:600}}>{peso(r.costValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
              <Pagination {...defectivePg}/>
            </>}
          </ChartCard>

          <ChartCard title={`History (${historyFiltered.length})`} actions={
            <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              <SegmentedControl size="sm" options={['All','Returns','Refunds'].map(s=>({value:s,label:s}))} value={historyType} onChange={setHistoryType}/>
              <SegmentedControl size="sm" options={['All','Pending','Approved','Rejected'].map(s=>({value:s,label:s}))} value={historyStatus} onChange={setHistoryStatus}/>
            </div>
          }>
            {historyFiltered.length===0?<div className="rpt-empty">No returns or refunds match this filter.</div>
            :<>
              <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                <table className="rpt-table">
                  <thead><tr><th>Type</th><th>#</th><th>Txn #</th><th>Date</th><th>Customer</th><th className="num">Amount</th><th>Status</th><th>Processed by</th></tr></thead>
                  <tbody>
                    {historyPg.pageItems.map(r=>(
                      <tr key={`${r.kind}-${r.id}`}>
                        <td><span className="rpt-pill rpt-pill-gray"><span className="dot" style={{background:r.kind==='Return'?'#059669':'#8B5CF6'}}/>{r.kind}</span></td>
                        <td style={{color:'var(--rpt-green)'}}>#{String(r.id).padStart(4,'0')}</td>
                        <td style={{color:'var(--rpt-muted)'}}>#{String(r.txnId).padStart(4,'0')}</td>
                        <td style={{color:'var(--rpt-muted)'}}>{fmtDate(r.createdAt)}</td>
                        <td>{r.customerName||'Walk-in'}</td>
                        <td className="num" style={{fontWeight:600}}>{peso(r.total)}</td>
                        <td><StatusBadge status={r.status} isLight={true}/></td>
                        <td style={{color:'var(--rpt-body)'}}>{r.processedBy||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></div>
              <Pagination {...historyPg}/>
            </>}
          </ChartCard>
        </>}

        {/* ══════════ CUSTOMERS ══════════ */}
        {activeTab==='customer' && <>
          <div className="rpt-kpi-row">
            <StatCard icon={Users} label="Total Customers" value={customers.length}/>
            <StatCard icon={Star} label="Total Points" value={totalPoints.toLocaleString()} sub="All-time"/>
            <StatCard icon={Gem} label="Platinum Members" value={platinumCount} sub="All-time"/>
            <StatCard icon={Award} label="Gold Members" value={goldCount} sub="All-time"/>
          </div>

          <div className="rpt-grid-12">
            <div className="rpt-col-5">
              <ChartCard title="Tier Distribution" subtitle="All-time">
                <DonutCard data={tierCounts.map(tc=>({name:tc.name,value:tc.value,color:tc.name==='Platinum'?'#8B5CF6':tc.name==='Gold'?'#D97706':tc.name==='Silver'?'#64748B':'#059669'}))} caption="customers" emptyText="No customers yet."/>
              </ChartCard>
            </div>
            <div className="rpt-col-7">
              <ChartCard title={<><Star size={14} style={{color:'var(--rpt-amber)'}}/>Top Customers</>} subtitle={`By amount spent during ${periodLabel}.`}>
                {topCustsPeriod.length===0?<div className="rpt-empty">No customer purchases this period.</div>:
                  <div className="rpt-simple-list">
                    {topCustsPeriod.map(m=>{
                      const tier=getTier(m.customer.points)
                      return(
                        <div key={m.id} className="rpt-simple-row">
                          <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                            <div style={{width:28,height:28,borderRadius:8,background:'var(--rpt-green)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff',flexShrink:0}}>{m.customer.name.charAt(0)}</div>
                            <div style={{minWidth:0}}>
                              <div className="rpt-simple-name">{m.customer.name}</div>
                              <div className="rpt-simple-sub">{tier.icon} {tier.label}</div>
                            </div>
                          </div>
                          <div style={{textAlign:'right',flexShrink:0}}>
                            <div style={{fontSize:13,color:'var(--rpt-title)',fontWeight:600}}>{peso(m.amount)}</div>
                            <div style={{fontSize:11.5,color:'var(--rpt-muted)'}}>{m.purchases} txns</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>}
              </ChartCard>
            </div>
          </div>

          <ChartCard title={<><Award size={14} style={{color:'#8B5CF6'}}/>Loyalty Tier Criteria</>} subtitle="10 pts/transaction + 1 pt per ₱100 spent">
            <div className="tier-row">
              {[
                {tier:'Bronze',   range:'0–499',       icon:'🥉', color:'#059669', count:bronzeCount},
                {tier:'Silver',   range:'500–1,499',   icon:'🥈', color:'#64748B', count:silverCount},
                {tier:'Gold',     range:'1,500–2,999', icon:'🥇', color:'#D97706', count:goldCount},
                {tier:'Platinum', range:'3,000+',      icon:'💎', color:'#8B5CF6', count:platinumCount},
              ].map(tc=>{
                const share = customers.length ? Math.round(tc.count/customers.length*100) : 0
                return (
                  <div key={tc.tier} className="tier-tile">
                    <div className="tier-tile-icon" style={{background:`${tc.color}1a`}}>{tc.icon}</div>
                    <div className="tier-tile-body">
                      <div className="tier-tile-top">
                        <span className="tier-tile-name">{tc.tier}</span>
                        <span className="tier-tile-count">{tc.count}</span>
                      </div>
                      <div className="tier-tile-range">{tc.range} pts</div>
                      <div className="tier-tile-track"><div className="tier-tile-fill" style={{width:`${share}%`,background:tc.color}}/></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ChartCard>

          <div className="rpt-grid-12">
            <div className="rpt-col-7">
              <ChartCard title={<><Gift size={14} style={{color:'#8B5CF6'}}/>Tier Rewards Claimed</>} subtitle={`Free items claimed by tier during ${periodLabel}.`}>
                <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead><tr>
                      <th>Date</th><th>Redemption No.</th><th>Customer</th><th>Item</th><th>Serial No.</th>
                      <th>Tier</th><th className="num">Points Used</th><th>Staff</th>
                    </tr></thead>
                    <tbody>
                      {redemptionsSorted.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--rpt-muted)'}}>No tier rewards claimed this period.</td></tr>
                      :redemptionsPg.pageItems.map(r=>(
                        <tr key={r.id}>
                          <td style={{color:'var(--rpt-muted)'}}>{new Date(r.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                          <td style={{color:'var(--rpt-green)',fontWeight:600}}>{r.redemptionNo}</td>
                          <td>{r.customerName||'—'}</td>
                          <td>{r.productName||'—'}</td>
                          <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11.5,color:'var(--rpt-muted)'}}>{r.serialNumber||'—'}</td>
                          <td style={{fontWeight:700,color:'var(--rpt-title)'}}>{r.tier?r.tier.charAt(0).toUpperCase()+r.tier.slice(1):'—'}</td>
                          <td className="num" style={{fontWeight:700,color:'var(--rpt-title)'}}>{(r.pointsUsed||0).toLocaleString()}</td>
                          <td style={{color:'var(--rpt-muted)'}}>{r.redeemedByName||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
                <Pagination {...redemptionsPg}/>
                <div style={{marginTop:10,fontSize:12.5,fontWeight:700,color:'var(--rpt-title)'}}>Total points used: {totalPointsUsed.toLocaleString()}</div>
              </ChartCard>
            </div>
            <div className="rpt-col-5">
              <ChartCard title="Most Claimed Items" subtitle={periodLabel}>
                <div className="ranked-list-scroll">
                  <RankedList
                    items={mostClaimedItems.map(it=>({key:it.name,label:it.name,value:it.timesClaimed,_it:it}))}
                    max={Math.max(...mostClaimedItems.map(it=>it.timesClaimed),1)}
                    renderLeft={it=><ProductThumb {...(products.find(pr=>pr.name===it._it.name)||{})} size={24} radius={6}/>}
                    renderValue={it=>`${it._it.timesClaimed}× claimed`}
                    emptyText="No tier rewards claimed this period."
                  />
                </div>
              </ChartCard>
            </div>
          </div>
        </>}

        </div>
      </div>

      <TransactionDetailsModal open={!!viewTxnId} onClose={()=>setViewTxnId(null)} transactionId={viewTxnId} />

      {/* Returns & Refunds card drill-down — every row here is already
          Approved, so neither modal ever actually renders an approve/
          reject action for it; the handlers are no-ops only because
          they're structurally required props, never because they're
          expected to fire. */}
      <ReturnDetailsModal
        open={viewRequest?.kind==='return'} onClose={()=>setViewRequest(null)}
        record={viewRequest?.kind==='return'?viewRequest.record:null} isAdmin={role==='admin'}
        onApprove={()=>{}} onReject={async()=>({})}
      />
      <RefundDetailsModal
        open={viewRequest?.kind==='refund'} onClose={()=>setViewRequest(null)}
        record={viewRequest?.kind==='refund'?viewRequest.record:null} isAdmin={role==='admin'}
        onApprove={()=>{}} onReject={async()=>({})}
      />
    </div>
  )
}

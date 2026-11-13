import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, eachDayOfInterval, eachMonthOfInterval, format, differenceInCalendarDays } from 'date-fns'
import { useTransactionStore, useProductStore, useCustomerStore, useRefundStore, useReturnStore, useAuthStore } from '../store'
import { useT, peso, getTier, fmtDate, refundSettledAmount } from '../utils/helpers'
import { computeSalesMetrics, isMoneyBack } from '../utils/salesMetrics'
import { addSheet, addMultiTableSheet, downloadWorkbook, createWorkbook } from '../utils/exportXlsx'
import { ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  Download, Trophy, TrendingDown, AlertTriangle, Archive, AlertOctagon, ClipboardList, Ban,
  TrendingUp, Undo2, Wallet, Coins, Receipt, Calculator, Package, Layers, Tag, Clock, RotateCcw,
  Banknote, XCircle, Users, Star, Gem, Award,
} from 'lucide-react'
import ProductThumb from '../components/ProductThumb'
import SalesBreakdownCard from '../components/SalesBreakdownCard'
import StatCard from '../components/StatCard'
import ChartCard from '../components/ChartCard'
import RankedList from '../components/RankedList'
import DonutCard from '../components/DonutCard'
import SegmentedControl from '../components/SegmentedControl'
import { StatusBadge } from '../components/RefundDetailsModal'
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
const PERIODS = ['Today', 'This Week', 'This Month', 'This Year', 'Custom']

const TAB_TITLE = {
  sales:     'Sales Report',
  inventory: 'Inventory Report',
  returns:   'Returns & Refunds Report',
  customer:  'Customer Report',
}

const STATUS_RANK = { 'Reorder now': 0, 'Reorder soon': 1, 'OK': 2, 'No demand': 3 }
const STATUS_PILL = { 'Reorder now': 'rpt-pill-red', 'Reorder soon': 'rpt-pill-amber', 'OK': 'rpt-pill-green', 'No demand': 'rpt-pill-gray' }

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

// Builds the "Sales vs Returns & Refunds" chart buckets for whichever
// granularity fits the selected period — hourly during store hours (Today),
// daily (Week/Month/short Custom ranges), or monthly (This Year/long Custom
// ranges). Each bucket re-runs the shared computeSalesMetrics so it always
// agrees with the period total's own math.
function buildBuckets(period, periodStart, periodEnd, transactions, refunds, returns) {
  if (period === 'Today') {
    return Array.from({length:13},(_,i)=>{
      const h=i+8
      const from=new Date(periodStart); from.setHours(h,0,0,0)
      const to=new Date(periodStart); to.setHours(h,59,59,999)
      const m=computeSalesMetrics({transactions,refunds,returns,from,to})
      return {label:`${h}:00`, gross:m.grossSales, returns:m.refundTotal+m.returnTotal, net:m.netSales}
    })
  }
  const spanDays = differenceInCalendarDays(periodEnd, periodStart)
  if (period === 'This Year' || spanDays > 60) {
    return eachMonthOfInterval({start:periodStart,end:periodEnd}).map(d=>{
      const from=startOfMonth(d), to=endOfMonth(d)
      const m=computeSalesMetrics({transactions,refunds,returns,from,to})
      return {label:format(d,'MMM'), gross:m.grossSales, returns:m.refundTotal+m.returnTotal, net:m.netSales}
    })
  }
  return eachDayOfInterval({start:periodStart,end:periodEnd}).map(d=>{
    const from=startOfDay(d), to=endOfDay(d)
    const m=computeSalesMetrics({transactions,refunds,returns,from,to})
    return {label:format(d,'MMM d'), gross:m.grossSales, returns:m.refundTotal+m.returnTotal, net:m.netSales}
  })
}

export default function Reports(){
  const transactions = useTransactionStore(s=>s.transactions)
  const products     = useProductStore(s=>s.products)
  const customers    = useCustomerStore(s=>s.customers)
  const refunds      = useRefundStore(s=>s.refunds)
  const returns      = useReturnStore(s=>s.returns)
  const { user }     = useAuthStore()
  const t            = useT()
  const [searchParams] = useSearchParams()
  const [activeTab,  setActiveTab]  = useState(() => searchParams.get('tab') || 'sales')
  useDocumentTitle(TAB_TITLE[activeTab] || 'Sales Report')
  const [period,     setPeriod]     = useState('Today')
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(),6),'yyyy-MM-dd'))
  const [customTo,   setCustomTo]   = useState(() => format(new Date(),'yyyy-MM-dd'))
  const [draftFrom,  setDraftFrom]  = useState(customFrom)
  const [draftTo,    setDraftTo]    = useState(customTo)
  const [customPopoverOpen, setCustomPopoverOpen] = useState(false)
  const periodRef = useRef(null)
  const [topMetric,  setTopMetric]  = useState('qty') // 'qty' | 'revenue' — Sales tab Top/Least Selling
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
  const txPg = usePagination(filtered)
  useEffect(()=>{ txPg.setPage(1) }, [period,customFrom,customTo])

  const refundsSubmitted = useMemo(()=>refunds.filter(r=>inPeriod(new Date(r.createdAt))),[refunds,periodStart,periodEnd])
  const returnsSubmitted = useMemo(()=>returns.filter(r=>inPeriod(new Date(r.createdAt))),[returns,periodStart,periodEnd])
  const refundsApproved  = useMemo(()=>refunds.filter(r=>r.status==='Approved'&&inPeriod(approvedDate(r))),[refunds,periodStart,periodEnd])
  const returnsApproved  = useMemo(()=>returns.filter(r=>r.status==='Approved'&&inPeriod(approvedDate(r))),[returns,periodStart,periodEnd])

  // ── SALES ──────────────────────────────────────────────────
  const metrics   = useMemo(()=>computeSalesMetrics({ transactions, refunds, returns, from: periodStart, to: periodEnd }),[transactions,refunds,returns,periodStart,periodEnd])
  const salesAvg  = metrics.transactionCount?Math.round(metrics.grossSales/metrics.transactionCount):0
  const payData   = useMemo(()=>{ const map={}; filtered.forEach(t=>{map[t.payment]=(map[t.payment]||0)+t.total}); return Object.entries(map).map(([name,value])=>({name,value})).filter(d=>d.value>0) },[filtered])
  const salesChart= useMemo(()=>buildBuckets(period, periodStart, periodEnd, transactions, refunds, returns),[period,periodStart,periodEnd,transactions,refunds,returns])
  const prodMap   = useMemo(()=>{ const m={}
    filtered.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!m[i.name]) m[i.name]={name:i.name,sold:0,revenue:0}; m[i.name].sold+=i.qty; m[i.name].revenue+=i.qty*i.price }))
    return m
  },[filtered])
  const topBasis = p => topMetric==='qty' ? p.sold : p.revenue
  const topProds  = useMemo(()=>Object.values(prodMap).sort((a,b)=>topBasis(b)-topBasis(a)).slice(0,5),[prodMap,topMetric])
  const leastProds= useMemo(()=>{
    const all = {...prodMap}
    products.forEach(p=>{ if(!all[p.name]) all[p.name]={name:p.name,sold:0,revenue:0} })
    return Object.values(all).sort((a,b)=>topBasis(a)-topBasis(b)).slice(0,5)
  },[prodMap,products,topMetric])
  const topMax = topProds[0] ? Math.max(topBasis(topProds[0]),1) : 1

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
  const lowStock  = useMemo(()=>products.filter(p=>p.stock>0&&p.stock<=3&&!p.isService),[products])
  const outStock  = useMemo(()=>products.filter(p=>p.stock===0&&!p.isService),[products])

  const last30Start = startOfDay(subDays(now,29))
  const demandMap = useMemo(()=>{
    const map={}
    transactions.forEach(tx=>{ const d=new Date(tx.createdAt); if(d<last30Start||d>now) return
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

  const slowMoving = useMemo(()=>products
    .filter(p=>!p.isService && p.stock>0 && (!p.lastSoldAt || new Date(p.lastSoldAt) < subDays(now,90)))
    .map(p=>({...p, tiedUp:(p.stock||0)*(p.costPrice||0)}))
    .sort((a,b)=>b.tiedUp-a.tiedUp),[products]) // eslint-disable-line react-hooks/exhaustive-deps
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
      {header:'Subtotal',value:r=>r.subtotal||r.total,money:true,total:true},
      {header:'Discount',value:r=>r.discAmt||0,money:true,total:true},
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
      {header:'Avg/day',value:r=>Number(r.avgDaily.toFixed(1))},
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

  const SalesTip = ({active,payload,label}) => {
    if(!active||!payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{background:'#059669'}}/><span className="chart-tooltip-name">Sales</span><span className="chart-tooltip-value">{peso(d.gross)}</span></div>
        <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{background:'#DC2626'}}/><span className="chart-tooltip-name">Returns</span><span className="chart-tooltip-value" style={{color:'var(--rpt-red)'}}>−{peso(d.returns)}</span></div>
        <div className="chart-tooltip-row" style={{borderTop:'1px solid var(--rpt-divider)',marginTop:4,paddingTop:6}}><span className="chart-tooltip-dot" style={{background:'var(--rpt-title)'}}/><span className="chart-tooltip-name" style={{fontWeight:700,color:'var(--rpt-title)'}}>Net</span><span className="chart-tooltip-value">{peso(d.net)}</span></div>
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
            <StatCard icon={TrendingUp} label="Gross Sales" value={peso(metrics.grossSales)}/>
            <StatCard icon={Undo2} label="Returns & Refunds" value={peso(-(metrics.refundTotal+metrics.returnTotal))} tone="red" sub={`${metrics.returnCount} returns · ${metrics.refundCount} refunds`}/>
            <StatCard icon={Wallet} label="Net Sales" value={peso(metrics.netSales)}/>
            <StatCard icon={Coins} label="Net Profit" value={peso(metrics.netProfit)} sub={`Gross profit ${peso(metrics.grossProfit)}`}/>
            <StatCard icon={Receipt} label="Transactions" value={metrics.transactionCount}/>
            <StatCard icon={Calculator} label="Average Sale" value={peso(salesAvg)} sub="Gross ÷ transactions"/>
          </div>

          <div className="rpt-grid-12">
            <div className="rpt-col-8">
              <ChartCard title="Sales vs Returns & Refunds" style={{height:'100%'}}>
                {salesChart.length<2 ? (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:260,gap:8}}>
                    <div style={{fontSize:32,fontWeight:600,color:'var(--rpt-title)'}}>{peso(metrics.grossSales)}</div>
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
                      <YAxis tick={{fontSize:12,fill:'var(--rpt-tick)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?`₱${Math.round(v/1000)}k`:`₱${v}`}/>
                      <Tooltip content={<SalesTip/>}/>
                      {period==='Today' ? (
                        <>
                          {/* Hourly bars instead of a curved line — a smooth curve
                              between hour buckets implies slopes that don't exist. */}
                          <Bar dataKey="gross" name="Sales" fill="#059669" radius={[4,4,0,0]} maxBarSize={22}/>
                          <Bar dataKey="returns" name="Returns" fill="#DC2626" radius={[4,4,0,0]} maxBarSize={12}/>
                        </>
                      ) : (
                        <>
                          <Area type="monotone" dataKey="gross" name="Sales" stroke="#059669" strokeWidth={2} fill="url(#rptGrossGradient)"/>
                          <Line type="monotone" dataKey="returns" name="Returns" stroke="#DC2626" strokeWidth={2} dot={false}/>
                        </>
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

          <div className="rpt-grid-12">
            <div className="rpt-col-4">
              <ChartCard title="Payment Methods">
                <DonutCard data={payData.map(d=>({name:d.name,value:d.value,color:paymentColor(d.name)}))} caption="total" formatValue={peso} emptyText="No payments for this period."/>
              </ChartCard>
            </div>
            <div className="rpt-col-4">
              <ChartCard title={<><Trophy size={14} style={{color:'var(--rpt-amber)'}}/>Top 5 Selling</>}
                actions={<SegmentedControl size="sm" options={[{value:'qty',label:'Qty'},{value:'revenue',label:'Revenue'}]} value={topMetric} onChange={setTopMetric}/>}>
                <RankedList
                  items={topProds.map(p=>({key:p.name,label:p.name,value:topBasis(p),_p:p}))}
                  max={topMax}
                  renderLeft={it=><ProductThumb {...(products.find(pr=>pr.name===it._p.name)||{})} size={24} radius={6}/>}
                  renderValue={it=>topMetric==='qty'?`${it._p.sold} sold`:peso(it._p.revenue)}
                  emptyText="No data."
                />
              </ChartCard>
            </div>
            <div className="rpt-col-4">
              <ChartCard title={<><TrendingDown size={14} style={{color:'var(--rpt-red)'}}/>Least 5 Selling</>}>
                <RankedList
                  items={leastProds.map(p=>({key:p.name,label:p.name,value:topBasis(p),_p:p}))}
                  max={topMax}
                  barColor="var(--rpt-red)"
                  renderLeft={it=><ProductThumb {...(products.find(pr=>pr.name===it._p.name)||{})} size={24} radius={6}/>}
                  renderValue={it=>topMetric==='qty'?`${it._p.sold} sold`:peso(it._p.revenue)}
                  emptyText="No data."
                />
              </ChartCard>
            </div>
          </div>

          <ChartCard title={`Transaction History (${filtered.length})`}>
            <div className="rpt-table-wrap"><div className="rpt-table-scroll">
              <table className="rpt-table">
                <thead><tr>
                  <th>Txn #</th><th>Date & time</th><th>Customer</th><th>Items</th><th>Payment</th>
                  <th className="num">Subtotal</th><th className="num">VAT</th><th className="num">Total</th>
                </tr></thead>
                <tbody>
                  {filtered.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--rpt-muted)'}}>No transactions for this period.</td></tr>
                  :txPg.pageItems.map(tx=>(
                    <tr key={tx.id}>
                      <td style={{color:'var(--rpt-green)',fontWeight:600}}>#{String(tx.id).padStart(4,'0')}</td>
                      <td style={{color:'var(--rpt-muted)'}}>{new Date(tx.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                      <td>{tx.customerName||'Walk-in'}</td>
                      <td style={{color:'var(--rpt-muted)'}}>{(tx.items||[]).length} item(s)</td>
                      <td><span className="rpt-pill rpt-pill-gray"><span className="dot" style={{background:paymentColor(tx.payment)}}/>{tx.payment}</span></td>
                      <td className="num">{peso(tx.subtotal||tx.total)}</td>
                      <td className="num" style={{color:'var(--rpt-muted)'}}>{peso(tx.vat||0)}</td>
                      <td className="num" style={{fontWeight:700,color:'var(--rpt-title)'}}>{peso(tx.total)}</td>
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

          <ChartCard title={<><Star size={14} style={{color:'var(--rpt-amber)'}}/>Product Demand &amp; Restock Recommendations</>}
            subtitle="Suggested reorder covers 14 days of sales based on the last 30 days.">
            <div className="rpt-demand-grid">
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'var(--rpt-title)',marginBottom:12}}>Top 10 by units sold (30d)</div>
                <RankedList
                  items={top10ByUnits.map(p=>({key:p.id,label:p.name,value:p.sold30}))}
                  renderValue={it=>`${it.value} sold`}
                  emptyText="No sales in the last 30 days."
                />
              </div>
              <div>
                <div style={{marginBottom:12}}>
                  <SegmentedControl size="sm"
                    options={['All','Reorder now','Reorder soon','OK','No demand'].map(s=>({value:s,label:<>{s}<span className="rpt-filter-chip">{demandStatusCounts[s]}</span></>}))}
                    value={demandStatusFilter} onChange={setDemandStatusFilter}/>
                </div>
                <div className="rpt-table-wrap"><div className="rpt-table-scroll">
                  <table className="rpt-table">
                    <thead><tr>
                      <th>Product</th><th>Category</th><th className="num">Stock</th><th className="num">Sold (30d)</th>
                      <th className="num">Avg/day</th><th className="num">Days left</th><th className="num">Suggested reorder</th><th>Status</th>
                    </tr></thead>
                    <tbody>
                      {demandFiltered.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:30,color:'var(--rpt-muted)'}}>No products match this filter.</td></tr>
                      :demandPg.pageItems.map(p=>(
                        <tr key={p.id}>
                          <td><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                          <td style={{color:'var(--rpt-muted)'}}>{p.category}</td>
                          <td className="num">{p.stock}</td>
                          <td className="num">{p.sold30}</td>
                          <td className="num">{p.avgDaily.toFixed(1)}</td>
                          <td className="num">{p.daysLeft===Infinity?'∞':Math.round(p.daysLeft)}</td>
                          <td className="num" style={{fontWeight:p.suggestedReorder>0?700:400,color:p.suggestedReorder>0?'var(--rpt-amber)':'var(--rpt-muted)'}}>{p.suggestedReorder}</td>
                          <td><span className={`rpt-pill ${STATUS_PILL[p.status]}`}><span className="dot"/>{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
                <Pagination {...demandPg}/>
              </div>
            </div>
          </ChartCard>

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

          <ChartCard title={<><Archive size={14} style={{color:'var(--rpt-muted)'}}/>Slow-Moving Products</>} subtitle="In stock, no sale in 90+ days.">
            <div className="rpt-simple-list">
              {slowMoving.length===0?<div className="rpt-empty">Nothing slow-moving right now.</div>
              :slowMovingPg.pageItems.map(p=>(
                <div key={p.id} className="rpt-simple-row">
                  <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                    <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                    <div style={{minWidth:0}}>
                      <div className="rpt-simple-name">{p.name}</div>
                      <div className="rpt-simple-sub">{p.stock} in stock · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--rpt-red)',flexShrink:0}}>{peso(p.tiedUp)} tied up</div>
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
        </>}

        </div>
      </div>
    </div>
  )
}

import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useReactToPrint } from 'react-to-print'
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, eachDayOfInterval, eachMonthOfInterval, format, differenceInCalendarDays } from 'date-fns'
import { useTransactionStore, useProductStore, useCustomerStore, useRefundStore, useReturnStore, useAppStore, useAuthStore } from '../store'
import { useT, peso, getTier, fmtDate } from '../utils/helpers'
import { computeSalesMetrics, isMoneyBack } from '../utils/salesMetrics'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts'
import { ACCENT, ACCENT2, GREEN, RED, BLUE, YELLOW, PURPLE, SLATE } from '../utils/colors'
import { Download, Printer, Trophy, TrendingDown, AlertTriangle, Archive, AlertOctagon, Award, Star, ClipboardList, Ban } from 'lucide-react'
import ProductThumb from '../components/ProductThumb'
import SalesBreakdownCard from '../components/SalesBreakdownCard'
import { StatusBadge } from '../components/RefundDetailsModal'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const PAY_COLOR = { Cash: GREEN, GCash: BLUE, Card: YELLOW, Split: PURPLE }

const TabIcon = ({ children }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    {children}
  </svg>
)

const REPORT_TABS = [
  { id:'sales',     label:'Sales',             icon:<TabIcon><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></TabIcon> },
  { id:'inventory', label:'Inventory',         icon:<TabIcon><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></TabIcon> },
  { id:'returns',   label:'Returns & Refunds', icon:<TabIcon><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></TabIcon> },
  { id:'customer',  label:'Customers',         icon:<TabIcon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></TabIcon> },
]
const PERIODS = ['Today','This Week','This Month','This Year','Custom']

const TAB_TITLE = {
  sales:     'Sales Report',
  inventory: 'Inventory Report',
  returns:   'Returns & Refunds Report',
  customer:  'Customer Report',
}

const STATUS_RANK = { 'Reorder now':0, 'Reorder soon':1, 'OK':2, 'No demand':3 }
const STATUS_BADGE = { 'Reorder now':'badge-red', 'Reorder soon':'badge-yellow', 'OK':'badge-green', 'No demand':'badge-gray' }

function StatCard({label,value,color,sub}){
  return(
    <div className="card" style={{padding:16,borderTop:`2px solid ${color}`}}>
      <div style={{fontSize:9.5,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>{sub}</div>}
    </div>
  )
}

function KpiCard({label,value,color,sub}){
  return(
    <div className="card kpi-card" style={{padding:16,borderTop:`2px solid ${color}`}}>
      <div style={{fontSize:9.5,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>{label}</div>
      <div className="kpi-card-value" style={{fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{value}</div>
      <div className="kpi-card-sub" style={{fontSize:10,color:'var(--text3)',marginTop:3}}>{sub}</div>
    </div>
  )
}

const EmptyRow = ({children}) => <div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:32}}>{children}</div>

// Builds the "Sales vs Returns & Refunds" chart buckets for whichever
// granularity fits the selected period — hourly (Today), daily (Week/Month/
// short Custom ranges), or monthly (This Year/long Custom ranges). Each
// bucket re-runs the shared computeSalesMetrics so it always agrees with
// the period total's own math.
function buildBuckets(period, periodStart, periodEnd, transactions, refunds, returns) {
  if (period === 'Today') {
    return Array.from({length:17},(_,i)=>{
      const h=i+6
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

// CSV helpers — escape per RFC 4180 so names/notes with commas or quotes
// can't shift columns when the file is opened in Excel.
const csvEsc = v => { const s=String(v??''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s }
const csvRow = (...cells) => cells.map(csvEsc).join(',')
const csvMoney = n => Number(n||0).toFixed(2)
function downloadCSV(filename, lines) {
  const csv = String.fromCharCode(0xFEFF) + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Reports(){
  const transactions = useTransactionStore(s=>s.transactions)
  const products     = useProductStore(s=>s.products)
  const customers    = useCustomerStore(s=>s.customers)
  const refunds      = useRefundStore(s=>s.refunds)
  const returns      = useReturnStore(s=>s.returns)
  const { theme }    = useAppStore()
  const { user }     = useAuthStore()
  const isLight      = theme === 'light'
  const t            = useT()
  const [searchParams] = useSearchParams()
  const [activeTab,  setActiveTab]  = useState(() => searchParams.get('tab') || 'sales')
  useDocumentTitle(TAB_TITLE[activeTab] || 'Sales Report')
  const [period,     setPeriod]     = useState('Today')
  const [customFrom, setCustomFrom] = useState(() => format(subDays(new Date(),6),'yyyy-MM-dd'))
  const [customTo,   setCustomTo]   = useState(() => format(new Date(),'yyyy-MM-dd'))
  const [topMetric,  setTopMetric]  = useState('qty') // 'qty' | 'revenue' — Sales tab Top/Least Selling
  const [demandStatusFilter, setDemandStatusFilter] = useState('All')
  const [historyType,   setHistoryType]   = useState('All') // All | Returns | Refunds
  const [historyStatus, setHistoryStatus] = useState('All') // All | Pending | Approved | Rejected
  const [isPrinting, setIsPrinting] = useState(false)
  const printRef = useRef(null)

  const now = new Date()

  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    if (period === 'Custom') {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfDay(now)
      // Guards eachDayOfInterval/eachMonthOfInterval below against an
      // inverted range — the <input type="date"> min/max props stop this
      // in most browsers, but not all let the keyboard bypass them.
      let end = customTo ? new Date(`${customTo}T23:59:59.999`) : now
      if (end < start) end = endOfDay(start)
      return { periodStart:start, periodEnd:end, periodLabel:`${format(start,'MMM d, yyyy')} – ${format(end,'MMM d, yyyy')}` }
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
  const payTotal  = payData.reduce((s,d)=>s+d.value,0)
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
    return [{name:'Resellable',value:resellable,color:GREEN},{name:'Defective',value:defective,color:RED}].filter(d=>d.value>0)
  },[returnsApproved])
  const conditionTotal = conditionTally.reduce((s,d)=>s+d.value,0)

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
    {name:'Platinum',value:platinumCount,color:PURPLE},
    {name:'Gold',    value:goldCount,    color:YELLOW},
    {name:'Silver',  value:silverCount,  color:SLATE},
    {name:'Bronze',  value:bronzeCount,  color:ACCENT},
  ].filter(t=>t.value>0)
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

  // ── PRINT ────────────────────────────────────────────────────
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `gapuz-pos-${activeTab}-${fromStr}-${toStr}`,
    onBeforeGetContent: () => new Promise(resolve => { setIsPrinting(true); setTimeout(resolve, 60) }),
    onAfterPrint: () => setIsPrinting(false),
  })

  // ── EXPORT CSV (tab-aware) ───────────────────────────────────
  const exportCSV = () => {
    const lines = []
    const head = (name) => { lines.push(csvRow(`GAPUZ POS - ${name.toUpperCase()}`)); lines.push(csvRow('Period', periodLabel)); lines.push(csvRow('Generated', new Date().toLocaleString('en-PH'))); lines.push('') }

    if (activeTab === 'sales') {
      head('Sales Report')
      lines.push(csvRow('Metric','Value'))
      lines.push(csvRow('Gross Sales', csvMoney(metrics.grossSales)))
      lines.push(csvRow('Returns & Refunds', csvMoney(metrics.refundTotal+metrics.returnTotal)))
      lines.push(csvRow('Net Sales', csvMoney(metrics.netSales)))
      lines.push(csvRow('Gross Profit', csvMoney(metrics.grossProfit)))
      lines.push(csvRow('Net Profit', csvMoney(metrics.netProfit)))
      lines.push(csvRow('Gross VAT', csvMoney(metrics.grossVat)))
      lines.push(csvRow('Refunded VAT', csvMoney(metrics.refundedVat)))
      lines.push(csvRow('Net VAT', csvMoney(metrics.netVat)))
      lines.push(csvRow('Transactions', metrics.transactionCount))
      lines.push(csvRow('Average Sale', csvMoney(salesAvg)))
      lines.push('', csvRow('TRANSACTIONS'))
      lines.push(csvRow('TXN#','Date & Time','Customer','Items','Payment','Subtotal','VAT','Total'))
      filtered.forEach(tx=>lines.push(csvRow(String(tx.id).padStart(4,'0'), new Date(tx.createdAt).toLocaleString('en-PH'), tx.customerName||'Walk-in', (tx.items||[]).length, tx.payment, csvMoney(tx.subtotal||tx.total), csvMoney(tx.vat||0), csvMoney(tx.total))))
    } else if (activeTab === 'inventory') {
      head('Inventory Report')
      lines.push(csvRow('Metric','Value'))
      lines.push(csvRow('Total Products', products.length))
      lines.push(csvRow('Stock Value at Cost', csvMoney(stockValueCost)))
      lines.push(csvRow('Stock Value at Retail', csvMoney(stockValueRetail)))
      lines.push(csvRow('Low Stock', lowStock.length))
      lines.push(csvRow('Out of Stock', outStock.length))
      lines.push('', csvRow('DEMAND & RESTOCK (last 30 days)'))
      lines.push(csvRow('Product','Category','Stock','Sold (30d)','Avg/day','Days Left','Suggested Reorder','Status'))
      demandRows.forEach(p=>lines.push(csvRow(p.name,p.category,p.stock,p.sold30,p.avgDaily.toFixed(1),p.daysLeft===Infinity?'∞':Math.round(p.daysLeft),p.suggestedReorder,p.status)))
      lines.push('', csvRow('SLOW-MOVING (no sale in 90+ days)'))
      lines.push(csvRow('Product','Category','Stock','Last Sold','Tied Up'))
      slowMoving.forEach(p=>lines.push(csvRow(p.name,p.category,p.stock,p.lastSoldAt?new Date(p.lastSoldAt).toLocaleDateString('en-PH'):'Never',csvMoney(p.tiedUp))))
      lines.push('', csvRow('PRICING ISSUES - BELOW COST'))
      lines.push(csvRow('Product','Cost Price','Selling Price','Loss/Unit','Sold This Period','Total Loss'))
      belowCost.forEach(p=>lines.push(csvRow(p.name,csvMoney(p.costPrice),csvMoney(p.price),csvMoney(p.lossPerUnit),p.soldInPeriod,csvMoney(p.totalLoss))))
      lines.push('', csvRow('LOW MARGIN (0-15%)'))
      lines.push(csvRow('Product','Cost Price','Selling Price','Margin %','Stock'))
      lowMargin.forEach(p=>lines.push(csvRow(p.name,csvMoney(p.costPrice),csvMoney(p.price),`${p.margin}%`,p.stock)))
    } else if (activeTab === 'returns') {
      head('Returns & Refunds Report')
      lines.push(csvRow('Metric','Value'))
      lines.push(csvRow('Pending', pendingCount))
      lines.push(csvRow('Approved Returns (count)', returnsApproved.length))
      lines.push(csvRow('Approved Returns (amount)', csvMoney(approvedReturnsAmt)))
      lines.push(csvRow('Approved Refunds (count)', refundsApproved.length))
      lines.push(csvRow('Approved Refunds (amount)', csvMoney(approvedRefundsAmt)))
      lines.push(csvRow('Total Money Back', csvMoney(totalMoneyBack)))
      lines.push(csvRow('Rejected', rejectedCount))
      lines.push('', csvRow('DEFECTIVE RETURNS'))
      lines.push(csvRow('Date','Return #','Product','Serial','Defect Note','Cost Value'))
      defectiveRows.forEach(r=>lines.push(csvRow(new Date(r.date).toLocaleDateString('en-PH'),`#${String(r.returnId).padStart(4,'0')}`,r.product,r.serial,r.note,csvMoney(r.costValue))))
      lines.push('', csvRow('HISTORY'))
      lines.push(csvRow('Type','#','Txn #','Date','Customer','Amount','Status','Processed By'))
      historyFiltered.forEach(r=>lines.push(csvRow(r.kind,`#${String(r.id).padStart(4,'0')}`,`#${String(r.txnId).padStart(4,'0')}`,new Date(r.createdAt).toLocaleString('en-PH'),r.customerName||'Walk-in',csvMoney(r.total),r.status,r.processedBy||'—')))
    } else {
      head('Customer Report')
      lines.push(csvRow('Metric','Value'))
      lines.push(csvRow('Total Customers', customers.length))
      lines.push(csvRow('Total Points', totalPoints))
      lines.push(csvRow('Platinum Members', platinumCount))
      lines.push(csvRow('Gold Members', goldCount))
      lines.push('', csvRow(`TOP CUSTOMERS — ${periodLabel}`))
      lines.push(csvRow('Customer','Purchases (period)','Amount (period)','Tier'))
      topCustsPeriod.forEach(m=>lines.push(csvRow(m.customer.name, m.purchases, csvMoney(m.amount), getTier(m.customer.points).label)))
    }

    downloadCSV(`gapuz-pos-${activeTab}-${fromStr}-${toStr}.csv`, lines)
  }

  const SalesTip = ({active,payload,label}) => {
    if(!active||!payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="card" style={{padding:'10px 12px',fontSize:11.5}}>
        <div style={{color:'var(--text3)',marginBottom:5,fontWeight:600}}>{label}</div>
        <div style={{display:'flex',justifyContent:'space-between',gap:16}}><span>Sales</span><span style={{fontVariantNumeric:'tabular-nums'}}>{peso(d.gross)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',gap:16,color:'var(--red)'}}><span>Returns</span><span style={{fontVariantNumeric:'tabular-nums'}}>−{peso(d.returns)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',gap:16,fontWeight:700,borderTop:'1px solid var(--border)',paddingTop:5,marginTop:5}}><span>Net</span><span style={{fontVariantNumeric:'tabular-nums'}}>{peso(d.net)}</span></div>
      </div>
    )
  }

  const printHeader = (
    <div className="print-only" style={{marginBottom:20,paddingBottom:14,borderBottom:'2px solid #000'}}>
      <div style={{fontSize:16,fontWeight:800}}>Gapuz Computer Services and Accessories</div>
      <div style={{fontSize:13,fontWeight:700,marginTop:4}}>{TAB_TITLE[activeTab]}</div>
      <div style={{fontSize:11,color:'#444',marginTop:4}}>Period: {periodLabel}</div>
      <div style={{fontSize:11,color:'#444'}}>Generated: {now.toLocaleString('en-PH')} · By: {user?.user_metadata?.name || 'Admin'}</div>
    </div>
  )

  return(
    <div style={{height:'100%',overflowY:'auto',padding:'12px 20px 20px',display:'flex',flexDirection:'column',gap:16,fontVariantNumeric:'tabular-nums'}}>
      <div className="no-print" style={{display:'flex',justifyContent:'flex-end',flexWrap:'wrap',gap:10}}>
        <button onClick={handlePrint} className="btn-secondary" style={{fontSize:11,padding:'7px 14px',display:'inline-flex',alignItems:'center',gap:6}}><Printer size={13}/>Print / Save PDF</button>
        <button onClick={exportCSV} className="btn-success" style={{fontSize:11,padding:'7px 14px',display:'inline-flex',alignItems:'center',gap:6}}><Download size={13}/>Export CSV</button>
      </div>

      {/* TABS + PERIOD FILTER (shown on every tab) */}
      <div className="no-print" style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',gap:6,borderBottom:'1px solid var(--border)',overflowX:'auto',flexShrink:0}}>
          {REPORT_TABS.map(tab=>(
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
              className={`tab-btn${activeTab===tab.id?' active':''}`}
              style={{ padding:'8px 16px', fontSize:11, marginBottom: activeTab===tab.id ? '-1px' : '0' }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          {activeTab==='inventory' && <span style={{fontSize:10.5,color:'var(--text3)',fontStyle:'italic'}}>Stock as of today</span>}
          <span style={{fontSize:11,color:'var(--text3)'}}>Period:</span>
          {PERIODS.map(p=>(
            <button key={p} onClick={()=>setPeriod(p)}
              style={{padding:'5px 12px',fontSize:11,fontWeight:600,border:`1px solid ${period===p?'var(--blue)':'var(--border)'}`,borderRadius:6,cursor:'pointer',background:period===p?'var(--blue)':'var(--bg2)',color:period===p?'#ffffff':'var(--text3)',transition:'all .15s'}}>
              {p}
            </button>
          ))}
          {period==='Custom' && (
            <>
              <input type="date" className="input-field" style={{width:140,padding:'5px 8px',fontSize:11}} value={customFrom} max={customTo} onChange={e=>setCustomFrom(e.target.value)}/>
              <span style={{color:'var(--text3)',fontSize:11}}>to</span>
              <input type="date" className="input-field" style={{width:140,padding:'5px 8px',fontSize:11}} value={customTo} min={customFrom} onChange={e=>setCustomTo(e.target.value)}/>
            </>
          )}
        </div>
      </div>

      <div id="report-printable" ref={printRef}>
        {printHeader}

        {/* ══════════ SALES ══════════ */}
        {activeTab==='sales' && <>
          <div className="kpi-grid-6">
            <KpiCard label="Gross Sales"          value={peso(metrics.grossSales)} color="var(--accent)"/>
            <KpiCard label="Returns & Refunds"     value={`−${peso(metrics.refundTotal+metrics.returnTotal)}`} color="var(--red)" sub={`${metrics.returnCount} returns · ${metrics.refundCount} refunds`}/>
            <KpiCard label="Net Sales"             value={peso(metrics.netSales)}   color="var(--accent)"/>
            <KpiCard label="Net Profit"            value={peso(metrics.netProfit)} color={metrics.netProfit>=0?"var(--green)":"var(--red)"} sub={`Gross profit ${peso(metrics.grossProfit)}`}/>
            <KpiCard label="Transactions"          value={metrics.transactionCount} color="var(--green)"/>
            <KpiCard label="Average Sale"          value={peso(salesAvg)}           color="var(--yellow)" sub="Gross ÷ transactions"/>
          </div>

          <div className="kpi-bottom-grid">
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Sales vs Returns & Refunds</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={salesChart} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                  <XAxis dataKey="label" tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false} interval={salesChart.length>20?Math.floor(salesChart.length/12):0}/>
                  <YAxis tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?`₱${Math.round(v/1000)}k`:`₱${v}`}/>
                  <Tooltip content={<SalesTip/>} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
                  <Bar dataKey="gross" name="Sales" barSize={salesChart.length>20?6:16} radius={[4,4,0,0]}>
                    {salesChart.map((d,i)=><Cell key={i} fill={i===salesChart.length-1?ACCENT2:ACCENT}/>)}
                  </Bar>
                  <Bar dataKey="returns" name="Returns" barSize={salesChart.length>20?3:7} radius={[3,3,0,0]} fill={RED}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SalesBreakdownCard metrics={metrics} isLight={isLight}/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:14}}>
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Payment Methods</div>
              {payData.length===0 ? <EmptyRow>No payments for this period.</EmptyRow> : <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart><Pie data={payData} cx="50%" cy="50%" innerRadius={42} outerRadius={65} dataKey="value" paddingAngle={3}>{payData.map((d,i)=><Cell key={i} fill={PAY_COLOR[d.name]||SLATE}/>)}</Pie><Tooltip formatter={v=>peso(v)}/></PieChart>
                </ResponsiveContainer>
                <div style={{display:'flex',flexDirection:'column',gap:7,marginTop:8}}>
                  {payData.map(d=>(
                    <div key={d.name} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:11.5}}>
                      <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:99,background:PAY_COLOR[d.name]||SLATE,flexShrink:0}}/>{d.name}</span>
                      <span style={{color:'var(--text2)'}}>{peso(d.value)} · {payTotal?Math.round(d.value/payTotal*100):0}%</span>
                    </div>
                  ))}
                </div>
              </>}
            </div>
          </div>

          <div className="kpi-bottom-grid">
            <div className="card" style={{padding:20}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,gap:8,flexWrap:'wrap'}}>
                <div style={{fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:6}}><Trophy size={13} style={{color:'var(--yellow)'}}/>Top 5 Selling</div>
                <div className="no-print" style={{display:'flex',background:'var(--bg3)',borderRadius:99,padding:2,gap:2}}>
                  {['qty','revenue'].map(v=>(
                    <button key={v} onClick={()=>setTopMetric(v)} style={{padding:'3px 10px',borderRadius:99,border:'none',fontSize:10.5,fontWeight:700,cursor:'pointer',fontFamily:'inherit',background:topMetric===v?'var(--accent)':'transparent',color:topMetric===v?'#0a0a0a':'var(--text3)'}}>{v==='qty'?'Qty':'Revenue'}</button>
                  ))}
                </div>
              </div>
              {topProds.length===0?<EmptyRow>No data.</EmptyRow>:
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {topProds.map((p,i)=>(
                    <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:11,color:'var(--text3)',width:14}}>{i+1}</span>
                      <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                        <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--accent)',width:`${Math.round((topBasis(p)/topMax)*100)}%`}}/></div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0,fontSize:11,color:'var(--green)'}}>{topMetric==='qty'?`${p.sold} sold`:peso(p.revenue)}</div>
                    </div>
                  ))}
                </div>}
            </div>
            <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><TrendingDown size={13} style={{color:'var(--red)'}}/>Least 5 Selling</div>
              {leastProds.length===0?<EmptyRow>No data.</EmptyRow>:
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {leastProds.map((p,i)=>(
                    <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:11,color:'var(--red)',width:14}}>{i+1}</span>
                      <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                        <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--red)',width:topBasis(p)===0?'4%':`${Math.min(100,Math.round((topBasis(p)/topMax)*100))}%`}}/></div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0,fontSize:11,color:'var(--red)'}}>{topMetric==='qty'?`${p.sold} sold`:peso(p.revenue)}</div>
                    </div>
                  ))}
                </div>}
            </div>
          </div>

          <div>
            <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>Transaction History ({filtered.length})</div>
            <div className="tbl-wrap">
              <table>
                <thead><tr>{['TXN #','Date & Time','Customer','Items','Payment','Subtotal','VAT','Total'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>No transactions for this period.</td></tr>
                  :(isPrinting?filtered:txPg.pageItems).map(tx=>(
                    <tr key={tx.id}>
                      <td style={{fontSize:11,color:'var(--accent)'}}>#{String(tx.id).padStart(4,'0')}</td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{new Date(tx.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                      <td style={{fontSize:12}}>{tx.customerName||'Walk-in'}</td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{(tx.items||[]).length} item(s)</td>
                      <td><span className={`badge ${tx.payment==='Cash'?'badge-green':tx.payment==='GCash'?'badge-blue':'badge-purple'}`} style={{fontSize:10}}>{tx.payment}</span></td>
                      <td style={{fontSize:11}}>{peso(tx.subtotal||tx.total)}</td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{peso(tx.vat||0)}</td>
                      <td style={{fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(tx.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="no-print"><Pagination {...txPg}/></div>
          </div>
        </>}

        {/* ══════════ INVENTORY ══════════ */}
        {activeTab==='inventory' && <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
            <StatCard label="Total Products"        value={products.length}            color="var(--accent)"/>
            <StatCard label="Stock Value at Cost"   value={peso(stockValueCost)}       color="var(--purple)"/>
            <StatCard label="Stock Value at Retail" value={peso(stockValueRetail)}     color="var(--green)"/>
            <StatCard label="Low Stock"              value={lowStock.length}            color="var(--yellow)"/>
            <StatCard label="Out of Stock"           value={outStock.length}            color="var(--red)"/>
          </div>

          <div className="card" style={{padding:20,borderTop:'2px solid var(--accent)'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}>⭐ Product Demand &amp; Restock Recommendations</div>
            <div style={{fontSize:10.5,color:'var(--text3)',marginBottom:14}}>Suggested reorder covers 14 days of sales based on the last 30 days.</div>

            {top10ByUnits.length>0 && (
              <div style={{marginBottom:18}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',marginBottom:8}}>Top 10 Products by Units Sold (30d)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={top10ByUnits} layout="vertical" barSize={12}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false}/>
                    <XAxis type="number" tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false}/>
                    <YAxis type="category" dataKey="name" tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false} width={110}/>
                    <Tooltip formatter={v=>`${v} sold`}/>
                    <Bar dataKey="sold30" fill={ACCENT} radius={[0,4,4,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="no-print" style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
              {['All','Reorder now','Reorder soon','OK','No demand'].map(s=>(
                <button key={s} onClick={()=>setDemandStatusFilter(s)} style={{padding:'4px 12px',borderRadius:99,border:'1px solid',fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                  ...(demandStatusFilter===s?{background:'var(--accent)',borderColor:'var(--accent)',color:'#0a0a0a'}:{background:'transparent',borderColor:'var(--border)',color:'var(--text2)'})}}>
                  {s} {demandStatusCounts[s]}
                </button>
              ))}
            </div>

            <div className="tbl-wrap">
              <table>
                <thead><tr>{['Product','Category','Stock','Sold (30d)','Avg/day','Days Left','Suggested Reorder','Status'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {demandFiltered.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:30,color:'var(--text3)'}}>No products match this filter.</td></tr>
                  :(isPrinting?demandFiltered:demandPg.pageItems).map(p=>(
                    <tr key={p.id}>
                      <td style={{fontSize:12,fontWeight:500}}><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                      <td><span className="badge badge-accent" style={{fontSize:10}}>{p.category}</span></td>
                      <td style={{fontSize:11}}>{p.stock}</td>
                      <td style={{fontSize:11}}>{p.sold30}</td>
                      <td style={{fontSize:11}}>{p.avgDaily.toFixed(1)}</td>
                      <td style={{fontSize:11}}>{p.daysLeft===Infinity?'∞':Math.round(p.daysLeft)}</td>
                      <td style={{fontSize:11,fontWeight:p.suggestedReorder>0?700:400,color:p.suggestedReorder>0?'var(--yellow)':'var(--text3)'}}>{p.suggestedReorder}</td>
                      <td><span className={`badge ${STATUS_BADGE[p.status]}`} style={{fontSize:10}}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="no-print"><Pagination {...demandPg}/></div>
          </div>

          <div className="kpi-bottom-grid">
            <div className="card" style={{padding:20,borderTop:'2px solid var(--yellow)',display:'flex',flexDirection:'column'}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><AlertTriangle size={13} style={{color:'var(--yellow)'}}/>Low Stock</div>
              <div style={{flex:1}}>
                {lowStockRows.length===0?<EmptyRow>All good!</EmptyRow>
                :(isPrinting?lowStockRows:lowStockPg.pageItems).map(p=>(
                  <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                      <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                      <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div><div style={{fontSize:10,color:'var(--text3)'}}>{p.category} · {p.sold30} sold (30d) · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div></div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:'var(--yellow)',flexShrink:0}}>{p.stock} left</span>
                  </div>
                ))}
              </div>
              <div className="no-print"><Pagination {...lowStockPg}/></div>
            </div>
            <div className="card" style={{padding:20,borderTop:'2px solid var(--red)',display:'flex',flexDirection:'column'}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Ban size={13} style={{color:'var(--red)'}}/>Out of Stock</div>
              <div style={{flex:1}}>
                {outStockRows.length===0?<EmptyRow>No out of stock products!</EmptyRow>
                :(isPrinting?outStockRows:outStockPg.pageItems).map(p=>(
                  <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                      <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                      <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div><div style={{fontSize:10,color:'var(--text3)'}}>{p.category} · {p.sold30} sold (30d) · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div></div>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--red)',flexShrink:0}}>OUT</span>
                  </div>
                ))}
              </div>
              <div className="no-print"><Pagination {...outStockPg}/></div>
            </div>
          </div>

          <div className="card" style={{padding:20,borderTop:'2px solid var(--orange)',display:'flex',flexDirection:'column'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Archive size={13} style={{color:'var(--orange)'}}/>Slow-Moving Products</div>
            <div style={{fontSize:10.5,color:'var(--text3)',marginBottom:12}}>In stock, no sale in 90+ days.</div>
            {slowMoving.length===0?<EmptyRow>Nothing slow-moving right now.</EmptyRow>
            :(isPrinting?slowMoving:slowMovingPg.pageItems).map(p=>(
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                  <ProductThumb image={p.image} icon={p.icon} category={p.category} size={26} radius={6}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.stock} in stock · Last sold {p.lastSoldAt?fmtDate(p.lastSoldAt):'Never'}</div>
                  </div>
                </div>
                <div style={{fontSize:11,fontWeight:700,color:'var(--red)',flexShrink:0}}>{peso(p.tiedUp)} tied up</div>
              </div>
            ))}
            <div className="no-print"><Pagination {...slowMovingPg}/></div>
          </div>

          <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:14}}>Pricing Issues</div>
            <div style={{fontWeight:600,fontSize:12.5,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><AlertOctagon size={13} style={{color:'var(--red)'}}/>Products Selling Below Cost</div>
            <div style={{fontSize:11,color:'var(--text3)',marginBottom:12}}>Loss on units sold during {periodLabel}.</div>
            {belowCost.length===0?<EmptyRow>No products are selling at a loss!</EmptyRow>
            :<div className="tbl-wrap">
              <table>
                <thead><tr>{['Product','Cost Price','Selling Price','Loss/Unit','Sold This Period','Total Loss'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {(isPrinting?belowCost:belowCostPg.pageItems).map(p=>(
                    <tr key={p.id}>
                      <td style={{fontSize:12,fontWeight:500}}><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{peso(p.costPrice)}</td>
                      <td style={{fontSize:11,color:'var(--red)',fontWeight:700}}>{peso(p.price)}</td>
                      <td style={{fontSize:11,color:'var(--red)'}}>{peso(p.lossPerUnit)}</td>
                      <td style={{fontSize:11}}>{p.soldInPeriod}</td>
                      <td style={{fontSize:11,color:'var(--red)',fontWeight:700}}>{peso(p.totalLoss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            <div className="no-print"><Pagination {...belowCostPg}/></div>

            <div style={{fontWeight:600,fontSize:12.5,marginTop:20,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><AlertTriangle size={13} style={{color:'var(--yellow)'}}/>Low Margin Products (0–15%)</div>
            {lowMargin.length===0?<EmptyRow>All products have healthy margins!</EmptyRow>
            :<div className="tbl-wrap">
              <table>
                <thead><tr>{['Product','Cost Price','Selling Price','Margin %','Stock'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {(isPrinting?lowMargin:lowMarginPg.pageItems).map(p=>(
                    <tr key={p.id}>
                      <td style={{fontSize:12,fontWeight:500}}><div style={{display:'flex',alignItems:'center',gap:8}}><ProductThumb image={p.image} icon={p.icon} category={p.category} size={22} radius={5}/>{p.name}</div></td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{peso(p.costPrice)}</td>
                      <td style={{fontSize:11}}>{peso(p.price)}</td>
                      <td style={{fontSize:11,fontWeight:700,color:p.margin<=5?'var(--red)':'var(--yellow)'}}>{p.margin}%</td>
                      <td style={{fontSize:11}}>{p.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            <div className="no-print"><Pagination {...lowMarginPg}/></div>
          </div>
        </>}

        {/* ══════════ RETURNS & REFUNDS ══════════ */}
        {activeTab==='returns' && <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
            <StatCard label="Pending"          value={pendingCount}                    color="var(--yellow)"/>
            <StatCard label="Approved Returns" value={returnsApproved.length}          color="var(--accent)" sub={peso(approvedReturnsAmt)}/>
            <StatCard label="Approved Refunds" value={refundsApproved.length}          color="var(--accent)" sub={peso(approvedRefundsAmt)}/>
            <StatCard label="Total Money Back" value={peso(totalMoneyBack)}            color="var(--red)"/>
            <StatCard label="Rejected"         value={rejectedCount}                   color="var(--text3)"/>
          </div>

          <div className="kpi-bottom-grid">
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Returned Units by Condition</div>
              {conditionTally.length===0?<EmptyRow>No approved returns with recorded conditions this period.</EmptyRow>:<>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart><Pie data={conditionTally} cx="50%" cy="50%" innerRadius={42} outerRadius={65} dataKey="value" paddingAngle={3}>{conditionTally.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip/></PieChart>
                </ResponsiveContainer>
                <div style={{display:'flex',flexDirection:'column',gap:7,marginTop:8}}>
                  {conditionTally.map(d=>(
                    <div key={d.name} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:11.5}}>
                      <span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/>{d.name}</span>
                      <span style={{color:'var(--text2)'}}>{d.value} units · {conditionTotal?Math.round(d.value/conditionTotal*100):0}%</span>
                    </div>
                  ))}
                </div>
              </>}
            </div>
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><ClipboardList size={13} style={{color:'var(--accent)'}}/>Top Reasons</div>
              {topReasons.length===0?<EmptyRow>No requests this period.</EmptyRow>:
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {topReasons.map(r=>(
                    <div key={r.name}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11.5,marginBottom:3}}><span style={{color:'var(--text2)'}}>{r.name}</span><span style={{fontWeight:700}}>{r.count}</span></div>
                      <div style={{height:5,background:'var(--bg5)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',background:'var(--accent)',width:`${Math.round(r.count/reasonMax*100)}%`}}/></div>
                    </div>
                  ))}
                </div>}
            </div>
          </div>

          <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><AlertOctagon size={13} style={{color:'var(--red)'}}/>Defective Returns</div>
            <div style={{fontSize:11,color:'var(--text3)',marginBottom:12}}>{defectiveRows.length} defective unit{defectiveRows.length===1?'':'s'} · {peso(defectiveTotal)}</div>
            {defectiveRows.length===0?<EmptyRow>No defective units this period.</EmptyRow>
            :<div className="tbl-wrap">
              <table>
                <thead><tr>{['Date','Return #','Product','Serial','Defect Note','Cost Value'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {(isPrinting?defectiveRows:defectivePg.pageItems).map(r=>(
                    <tr key={r.rowId}>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{fmtDate(r.date)}</td>
                      <td style={{fontSize:11,color:'var(--accent)'}}>#{String(r.returnId).padStart(4,'0')}</td>
                      <td style={{fontSize:12}}>{r.product}</td>
                      <td style={{fontSize:11,fontFamily:"monospace"}}>{r.serial}</td>
                      <td style={{fontSize:11,color:'var(--text2)'}}>{r.note}</td>
                      <td style={{fontSize:11,color:'var(--red)',fontWeight:600}}>{peso(r.costValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            <div className="no-print"><Pagination {...defectivePg}/></div>
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:13}}>History ({historyFiltered.length})</div>
              <div className="no-print" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                <div style={{display:'flex',gap:6}}>
                  {['All','Returns','Refunds'].map(s=>(
                    <button key={s} onClick={()=>setHistoryType(s)} style={{padding:'4px 10px',borderRadius:99,border:'1px solid',fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      ...(historyType===s?{background:'var(--blue)',borderColor:'var(--blue)',color:'#fff'}:{background:'transparent',borderColor:'var(--border)',color:'var(--text2)'})}}>{s}</button>
                  ))}
                </div>
                <div style={{display:'flex',gap:6}}>
                  {['All','Pending','Approved','Rejected'].map(s=>(
                    <button key={s} onClick={()=>setHistoryStatus(s)} style={{padding:'4px 10px',borderRadius:99,border:'1px solid',fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      ...(historyStatus===s?{background:'var(--accent)',borderColor:'var(--accent)',color:'#0a0a0a'}:{background:'transparent',borderColor:'var(--border)',color:'var(--text2)'})}}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
            {historyFiltered.length===0?<EmptyRow>No returns or refunds match this filter.</EmptyRow>
            :<div className="tbl-wrap">
              <table>
                <thead><tr>{['Type','#','Txn #','Date','Customer','Amount','Status','Processed By'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {(isPrinting?historyFiltered:historyPg.pageItems).map(r=>(
                    <tr key={`${r.kind}-${r.id}`}>
                      <td><span className={`badge ${r.kind==='Return'?'badge-accent':'badge-blue'}`} style={{fontSize:10}}>{r.kind}</span></td>
                      <td style={{fontSize:11,color:'var(--accent)'}}>#{String(r.id).padStart(4,'0')}</td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>#{String(r.txnId).padStart(4,'0')}</td>
                      <td style={{fontSize:11,color:'var(--text3)'}}>{fmtDate(r.createdAt)}</td>
                      <td style={{fontSize:12}}>{r.customerName||'Walk-in'}</td>
                      <td style={{fontSize:11,fontWeight:600}}>{peso(r.total)}</td>
                      <td><StatusBadge status={r.status} isLight={isLight}/></td>
                      <td style={{fontSize:11,color:'var(--text2)'}}>{r.processedBy||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
            <div className="no-print"><Pagination {...historyPg}/></div>
          </div>
        </>}

        {/* ══════════ CUSTOMERS ══════════ */}
        {activeTab==='customer' && <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
            <StatCard label="Total Customers"  value={customers.length}           color="var(--accent)"/>
            <StatCard label="Total Points"     value={totalPoints.toLocaleString()} color="var(--yellow)" sub="All-time"/>
            <StatCard label="Platinum Members" value={platinumCount}               color="var(--purple)" sub="All-time"/>
            <StatCard label="Gold Members"      value={goldCount}                   color="var(--yellow)" sub="All-time"/>
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Award size={13} style={{color:'var(--purple)'}}/>Loyalty Tier Criteria</div>
            <div style={{fontSize:11,color:'var(--text3)',marginBottom:14}}>Points earned: 10 pts per transaction + 1 pt per ₱100 spent</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
              {[
                {tier:'Bronze',   range:'0 – 499 pts',       color:'var(--accent)', icon:'🥉', count:bronzeCount,   next:'Need 500 pts for Silver'},
                {tier:'Silver',   range:'500 – 1,499 pts',   color:SLATE,           icon:'🥈', count:silverCount,   next:'Need 1,500 pts for Gold'},
                {tier:'Gold',     range:'1,500 – 2,999 pts', color:'var(--yellow)', icon:'🥇', count:goldCount,     next:'Need 3,000 pts for Platinum'},
                {tier:'Platinum', range:'3,000+ pts',        color:'var(--purple)', icon:'💎', count:platinumCount, next:'Highest tier!'},
              ].map(t=>(
                <div key={t.tier} style={{padding:16,background:'var(--bg2)',borderRadius:10,borderTop:`3px solid ${t.color}`,textAlign:'center'}}>
                  <div style={{fontSize:30,marginBottom:6}}>{t.icon}</div>
                  <div style={{fontSize:13,fontWeight:700,color:t.color,marginBottom:4}}>{t.tier}</div>
                  <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>{t.count}</div>
                  <div style={{fontSize:10,color:'var(--text3)',marginBottom:6}}>{t.range}</div>
                  <div style={{fontSize:9,color:'var(--text3)',lineHeight:1.4}}>{t.next}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Tier Distribution <span style={{fontWeight:500,color:'var(--text3)',fontSize:10.5}}>(All-time)</span></div>
              {tierCounts.length===0?<EmptyRow>No customers yet.</EmptyRow>
              :<ResponsiveContainer width="100%" height={200}>
                <PieChart><Pie data={tierCounts} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>{tierCounts.map((t,i)=><Cell key={i} fill={t.color}/>)}</Pie><Tooltip/></PieChart>
              </ResponsiveContainer>}
            </div>
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Star size={13} style={{color:'var(--yellow)'}}/>Top Customers</div>
              <div style={{fontSize:10.5,color:'var(--text3)',marginBottom:12}}>By amount spent during {periodLabel}.</div>
              {topCustsPeriod.length===0?<EmptyRow>No customer purchases this period.</EmptyRow>:
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {topCustsPeriod.map(m=>{
                    const tier=getTier(m.customer.points)
                    return(
                      <div key={m.id} style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:26,height:26,borderRadius:6,background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#0a0a0a',flexShrink:0}}>{m.customer.name.charAt(0)}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.customer.name}</div>
                          <div style={{fontSize:10,color:tier.color}}>{tier.icon} {tier.label}</div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(m.amount)}</div>
                          <div style={{fontSize:10,color:'var(--text3)'}}>{m.purchases} txns</div>
                        </div>
                      </div>
                    )
                  })}
                </div>}
            </div>
          </div>
        </>}
      </div>
    </div>
  )
}

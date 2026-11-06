import { useMemo, useState, useEffect } from 'react'
import { ComposedChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { startOfDay, endOfDay, subDays, startOfMonth, startOfYear } from 'date-fns'
import { Trophy, TrendingDown, AlertTriangle, Ban, CheckCircle2, Package, Wallet, Award, Star, RefreshCw, ClipboardList, Hand } from 'lucide-react'
import { useTransactionStore, useProductStore, useAuthStore, useCustomerStore, useRefundStore, useAppStore } from '../store'
import { useReturnStore } from '../store/useReturnStore'
import { useT, peso, pesoCompact, getTier } from '../utils/helpers'
import { computeSalesMetrics, getDailySeries } from '../utils/salesMetrics'
import { CHART_COLORS, ACCENT, RED, YELLOW, PURPLE, SLATE } from '../utils/colors'
import ProductThumb from '../components/ProductThumb'
import SalesBreakdownCard from '../components/SalesBreakdownCard'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const COLORS = CHART_COLORS

const TabIcon = ({ children }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
    {children}
  </svg>
)

const ALL_TABS = [
  { id:'overview',  label:'Overview',  icon: <TabIcon><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></TabIcon> },
  { id:'inventory', label:'Inventory', icon: <TabIcon><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></TabIcon> },
  { id:'customers', label:'Customers', icon: <TabIcon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></TabIcon>, adminOnly:true },
  { id:'refunds',   label:'Refunds',   icon: <TabIcon><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></TabIcon>, adminOnly:true },
  { id:'reports',   label:'Reports',   icon: <TabIcon><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></TabIcon>, adminOnly:true },
]

function MetricCard({ label, value, sub, subUp, color }) {
  return (
    <div className="card" style={{padding:20,borderTop:`2px solid ${color}`}}>
      <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>{label}</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:24,fontWeight:700,marginBottom:5,color}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:subUp?'var(--green)':'var(--text3)'}}>{sub}</div>}
    </div>
  )
}

// Revenue metric card with an admin-only Net/Gross toggle. Cashiers always
// see Net (the money actually kept) with no breakdown line — admins can
// flip to Gross and see what was deducted underneath.
function RevenueCard({ label, isAdmin, revenueView, setRevenueView, value, grossSales, deducted, revChange }) {
  const t = useT()
  return (
    <div className="card" style={{padding:20,borderTop:'2px solid var(--accent)'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8}}>
        <div style={{fontSize:10,color:'var(--text3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</div>
        {isAdmin && (
          <div style={{display:'flex',background:'var(--bg3)',borderRadius:99,padding:2,gap:2,flexShrink:0}}>
            {['net','gross'].map(v=>(
              <button key={v} onClick={()=>setRevenueView(v)} style={{
                padding:'2px 9px',borderRadius:99,border:'none',fontSize:9.5,fontWeight:700,cursor:'pointer',fontFamily:'inherit',
                background: revenueView===v ? 'var(--accent)' : 'transparent',
                color: revenueView===v ? '#0a0a0a' : 'var(--text3)',
                transition:'all .15s',
              }}>{v==='net'?t('net'):t('gross')}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:24,fontWeight:700,marginBottom:5,color:'var(--accent)'}}>{pesoCompact(value)}</div>
      <div style={{fontSize:11,color:revChange>=0?'var(--green)':'var(--text3)',marginBottom:isAdmin?4:0}}>{revChange>=0?'▲ +':'▼ '}{revChange}% {t('vs_yesterday')}</div>
      {isAdmin && (
        <div style={{fontSize:10.5,color:'var(--text3)'}}>
          {deducted>0
            ? <>{t('gross')} {peso(grossSales)} · <span style={{color:'var(--red)'}}>{t('refunds')} −{peso(deducted)}</span></>
            : t('no_refunds_today')}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{padding:16,borderTop:`2px solid ${color}`}}>
      <div style={{fontSize:9.5,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:5}}>{label}</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color}}>{value}</div>
    </div>
  )
}

export default function Dashboard() {
  useDocumentTitle('Dashboard')
  const transactions = useTransactionStore(s=>s.transactions)
  const products     = useProductStore(s=>s.products)
  const customers    = useCustomerStore(s=>s.customers)
  const refunds      = useRefundStore(s=>s.refunds)
  const returns      = useReturnStore(s=>s.returns)
  const { user, role } = useAuthStore()
  const { revenueView, setRevenueView, theme } = useAppStore()
  const isAdmin      = role === 'admin'
  const isLight      = theme === 'light'
  const TABS         = useMemo(()=>ALL_TABS.filter(tab=>!tab.adminOnly||isAdmin),[isAdmin])
  const t            = useT()
  const [activeTab,  setActiveTab] = useState('overview')
  const [repPeriod,  setRepPeriod] = useState('today')

  const now   = new Date()
  const today = startOfDay(now)

  // ── TODAY METRICS ─────────────────────────────────────────
  const todayTxns = useMemo(()=>transactions.filter(tx=>{ const d=new Date(tx.createdAt); d.setHours(0,0,0,0); return d.getTime()===today.getTime() }),[transactions])
  const itemsSold = todayTxns.reduce((s,t)=>s+(t.items||[]).reduce((a,i)=>a+i.qty,0),0)
  const todayMetrics = useMemo(()=>computeSalesMetrics({ transactions, refunds, returns, from: today, to: now }),[transactions,refunds,returns,today,now])
  const yest      = subDays(today,1)
  const yestMetrics = useMemo(()=>computeSalesMetrics({ transactions, refunds, returns, from: yest, to: endOfDay(yest) }),[transactions,refunds,returns,yest])
  const effectiveView = isAdmin ? revenueView : 'net'
  const revenueValue = effectiveView==='gross' ? todayMetrics.grossSales : todayMetrics.netSales
  const yesterdayValue = effectiveView==='gross' ? yestMetrics.grossSales : yestMetrics.netSales
  const aov       = todayTxns.length?Math.round(todayMetrics.netSales/todayTxns.length):0
  const revChange = yesterdayValue?Math.round(((revenueValue-yesterdayValue)/yesterdayValue)*100):0

  // ── CHARTS ────────────────────────────────────────────────
  const weekData  = useMemo(()=>{ const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); d.setHours(0,0,0,0); const dt=transactions.filter(tx=>{ const td=new Date(tx.createdAt); td.setHours(0,0,0,0); return td.getTime()===d.getTime() }); return {label:days[d.getDay()],value:dt.reduce((s,t)=>s+t.total,0)} }) },[transactions])
  const areaData  = useMemo(()=>getDailySeries({ transactions, refunds, returns, days: 14 }),[transactions,refunds,returns])
  const payBreak  = useMemo(()=>{ const map={}; transactions.forEach(t=>{map[t.payment]=(map[t.payment]||0)+t.total}); return Object.entries(map).map(([name,value])=>({name,value})) },[transactions])
  const topProds  = useMemo(()=>{ const map={}; transactions.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!map[i.name]) map[i.name]={name:i.name,sold:0,revenue:0}; map[i.name].sold+=i.qty; map[i.name].revenue+=i.qty*i.price })); return Object.values(map).sort((a,b)=>b.sold-a.sold).slice(0,5) },[transactions])
  const leastProds= useMemo(()=>{ const map={}; transactions.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!map[i.name]) map[i.name]={name:i.name,sold:0,revenue:0}; map[i.name].sold+=i.qty; map[i.name].revenue+=i.qty*i.price })); products.forEach(p=>{ if(!map[p.name]) map[p.name]={name:p.name,sold:0,revenue:0} }); return Object.values(map).sort((a,b)=>a.sold-b.sold) },[transactions,products])
  const leastPg = usePagination(leastProds)
  const txPg    = usePagination(transactions)

  // ── INVENTORY ANALYTICS ───────────────────────────────────
  const totalValue = products.reduce((s,p)=>s+p.price*p.stock,0)
  const lowStock   = products.filter(p=>p.stock>0&&p.stock<=3&&p.category!=='Services')
  const outStock   = products.filter(p=>p.stock===0&&p.category!=='Services')
  const lowStockPg  = usePagination(lowStock)
  const outStockPg  = usePagination(outStock)
  const catData    = useMemo(()=>{ const map={}; products.forEach(p=>{ map[p.category]=(map[p.category]||0)+1 }); return Object.entries(map).map(([name,value])=>({name,value})) },[products])
  const catRevenue = useMemo(()=>{ const map={}; transactions.forEach(tx=>(tx.items||[]).forEach(i=>{ const prod=products.find(p=>p.name===i.name); const cat=prod?.category||'Other'; map[cat]=(map[cat]||0)+i.qty*i.price })); return Object.entries(map).map(([name,value])=>({name,value:Math.round(value)})).sort((a,b)=>b.value-a.value) },[transactions,products])

  // ── CUSTOMER ANALYTICS ────────────────────────────────────
  const totalPoints    = customers.reduce((s,c)=>s+c.points,0)
  const platinumCount  = customers.filter(c=>c.points>=3000).length
  const goldCount      = customers.filter(c=>c.points>=1500&&c.points<3000).length
  const silverCount    = customers.filter(c=>c.points>=500&&c.points<1500).length
  const bronzeCount    = customers.filter(c=>c.points<500).length
  const tierData       = [
    {name:'Platinum',value:platinumCount,color:PURPLE},
    {name:'Gold',    value:goldCount,    color:YELLOW},
    {name:'Silver',  value:silverCount,  color:SLATE},
    {name:'Bronze',  value:bronzeCount,  color:ACCENT},
  ].filter(t=>t.value>0)
  const topCustomers   = useMemo(()=>[...customers].sort((a,b)=>b.totalSpent-a.totalSpent).slice(0,5),[customers])

  // ── REFUNDS ANALYTICS ─────────────────────────────────────
  const pendingRef  = refunds.filter(r=>r.status==='Pending').length
  const approvedRef = refunds.filter(r=>r.status==='Approved').length
  const rejectedRef = refunds.filter(r=>r.status==='Rejected').length
  const totalRef    = refunds.filter(r=>r.status==='Approved').reduce((s,r)=>s+r.total,0)
  const refStatusData = [
    {name:'Pending', value:pendingRef,  color:YELLOW},
    {name:'Approved',value:approvedRef, color:ACCENT},
    {name:'Rejected',value:rejectedRef, color:RED},
  ].filter(r=>r.value>0)

  // ── REPORTS ANALYTICS ─────────────────────────────────────
  const repStart = useMemo(()=>{
    if(repPeriod==='today') return startOfDay(now)
    if(repPeriod==='this_week') return startOfDay(subDays(now,6))
    if(repPeriod==='this_year') return startOfYear(now)
    return startOfMonth(now)
  },[repPeriod,now])
  const repFiltered = useMemo(()=>transactions.filter(tx=>new Date(tx.createdAt)>=repStart),[transactions,repStart])
  const repFilteredPg = usePagination(repFiltered)
  useEffect(()=>{ repFilteredPg.setPage(1) },[repPeriod])
  const repMetrics  = useMemo(()=>computeSalesMetrics({ transactions, refunds, returns, from: repStart, to: now }),[transactions,refunds,returns,repStart,now])
  const repAvg      = repMetrics.transactionCount?Math.round(repMetrics.netSales/repMetrics.transactionCount):0
  const repChartData = useMemo(()=>{
    if(repPeriod==='today') return Array.from({length:17},(_,i)=>{ const h=i+6; const hrs=repFiltered.filter(tx=>new Date(tx.createdAt).getHours()===h); return {label:`${h}:00`,value:hrs.reduce((s,t)=>s+t.total,0)} })
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); d.setHours(0,0,0,0); const dt=repFiltered.filter(tx=>{const td=new Date(tx.createdAt);td.setHours(0,0,0,0);return td.getTime()===d.getTime()}); return {label:days[d.getDay()],value:dt.reduce((s,t)=>s+t.total,0)} })
  },[repFiltered,repPeriod])
  const repLeast = useMemo(()=>{ const map={}; repFiltered.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!map[i.name]) map[i.name]={name:i.name,sold:0,revenue:0}; map[i.name].sold+=i.qty; map[i.name].revenue+=i.qty*i.price })); products.forEach(p=>{ if(!map[p.name]) map[p.name]={name:p.name,sold:0,revenue:0} }); return Object.values(map).sort((a,b)=>a.sold-b.sold).slice(0,5) },[repFiltered,products])
  const repTop   = useMemo(()=>{ const map={}; repFiltered.forEach(tx=>(tx.items||[]).forEach(i=>{ if(!map[i.name]) map[i.name]={name:i.name,sold:0,revenue:0}; map[i.name].sold+=i.qty; map[i.name].revenue+=i.qty*i.price })); return Object.values(map).sort((a,b)=>b.sold-a.sold).slice(0,5) },[repFiltered])

  const hour     = now.getHours()
  const greeting = hour<12?t('good_morning'):hour<17?t('good_afternoon'):t('good_evening')
  const Tip      = ({active,payload,label})=>{ if(!active||!payload?.length) return null; return <div className="card" style={{padding:'8px 12px',fontSize:12}}><div style={{color:'var(--text3)',marginBottom:3}}>{label}</div><div style={{fontFamily:"'JetBrains Mono',monospace",color:'var(--accent)'}}>{peso(payload[0].value)}</div></div> }
  const GrossNetTip = ({active,payload,label})=>{
    if(!active||!payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="card" style={{padding:'8px 12px',fontSize:11.5}}>
        <div style={{color:'var(--text3)',marginBottom:4}}>{label}</div>
        {isAdmin && <div style={{display:'flex',justifyContent:'space-between',gap:10,color:'var(--text3)'}}><span>Gross</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(d.gross)}</span></div>}
        {isAdmin && <div style={{display:'flex',justifyContent:'space-between',gap:10,color:'var(--red)'}}><span>Refunds</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>−{peso(d.refunds)}</span></div>}
        <div style={{display:'flex',justifyContent:'space-between',gap:10,color:'var(--accent)',fontWeight:700}}><span>Net</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{peso(d.net)}</span></div>
      </div>
    )
  }

  return (
    <div style={{height:'100%',overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:20}}>

      {/* HEADER */}
      <div>
        <div style={{fontSize:24,fontWeight:700,display:'flex',alignItems:'center',gap:8}}>{greeting}, <span style={{color:'var(--accent)'}}>{user?.user_metadata?.name||'Admin'}</span><Hand size={22} style={{color:'var(--yellow)'}}/></div>
        <div style={{color:'var(--text2)',fontSize:13,marginTop:3}}>{now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      </div>

      {/* TABS */}
      <div style={{display:'flex',gap:6,borderBottom:'1px solid var(--border)',paddingBottom:0,overflowX:'auto',flexShrink:0}}>
        {TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
            className={`tab-btn${activeTab===tab.id?' active':''}`}
            style={{ marginBottom: activeTab===tab.id ? '-1px' : '0' }}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ══════════ OVERVIEW TAB ══════════ */}
      {activeTab==='overview' && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>
          <RevenueCard label={t('today_revenue')} isAdmin={isAdmin} revenueView={effectiveView} setRevenueView={setRevenueView}
            value={revenueValue} grossSales={todayMetrics.grossSales} deducted={todayMetrics.refundTotal+todayMetrics.returnTotal} revChange={revChange}/>
          <MetricCard label={t('transactions')} value={todayTxns.length} sub="Today" subUp color="var(--green)"/>
          <MetricCard label={t('items_sold')} value={itemsSold} sub="Today" subUp color="var(--purple)"/>
          {isAdmin && <MetricCard label={t('avg_order')} value={pesoCompact(aov)} sub="Today · net" subUp color="var(--yellow)"/>}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Revenue — Last 14 Days</div>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={areaData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="date" tick={{fontSize:10,fill:'var(--text3)'}} tickLine={false} axisLine={false} interval={1}/>
                <YAxis tick={{fontSize:10,fill:'var(--text3)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?Math.round(v/1000)+'k':v}/>
                <Tooltip content={<GrossNetTip/>}/>
                {isAdmin && <Legend iconSize={8} wrapperStyle={{fontSize:11}}/>}
                {isAdmin && <Line type="monotone" dataKey="gross" name="Gross" stroke={SLATE} strokeWidth={1.5} strokeDasharray="4 3" dot={false}/>}
                <Line type="monotone" dataKey="net" name="Net" stroke={ACCENT} strokeWidth={2} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {isAdmin && (
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Payment Methods</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={payBreak} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>{payBreak.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={v=>peso(v)}/><Legend iconSize={8} wrapperStyle={{fontSize:11}}/></PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          {isAdmin && (
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>{t('weekly_sales')}</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={weekData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                  <XAxis dataKey="label" tick={{fontSize:11,fill:'var(--text3)'}} tickLine={false} axisLine={false}/>
                  <YAxis tick={{fontSize:10,fill:'var(--text3)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?Math.round(v/1000)+'k':v}/>
                  <Tooltip formatter={v=>peso(v)} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
                  <Bar dataKey="value" radius={[5,5,0,0]}>{weekData.map((_,i)=><Cell key={i} fill={i===weekData.length-1?ACCENT:'var(--bg5)'}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><Trophy size={13} style={{color:'var(--yellow)'}}/>{t('top_products')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {topProds.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:'20px 0'}}>{t('no_data')}</div>
              :topProds.map((p,i)=>(
                <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'var(--text3)',fontFamily:"'JetBrains Mono',monospace",width:14}}>{i+1}</span>
                  <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:COLORS[i],width:`${Math.round((p.sold/(topProds[0]?.sold||1))*100)}%`,transition:'width .5s'}}/></div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {isAdmin && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)'}}>{peso(p.revenue)}</div>}
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* LEAST SELLING */}
        <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><TrendingDown size={13} style={{color:'var(--red)'}}/>Least Selling Products</div>
          <div style={{fontSize:11,color:'var(--text3)',marginBottom:14}}>Products with the lowest sales — consider promotions or restocking decisions</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {leastProds.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:'20px 0'}}>No sales data yet.</div>
            :leastPg.pageItems.map((p,i)=>(
              <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:11,color:'var(--red)',fontFamily:"'JetBrains Mono',monospace",width:18}}>{leastPg.start+i}</span>
                <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--red)',width:p.sold===0?'4%':`${Math.min(100,Math.round((p.sold/(topProds[0]?.sold||1))*100))}%`,transition:'width .5s'}}/></div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  {isAdmin && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--red)'}}>{peso(p.revenue)}</div>}
                  <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                </div>
              </div>
            ))}
          </div>
          <Pagination {...leastPg}/>
        </div>

        {/* ALERTS */}
        <div>
          <div className="section-title">{t('ai_insights')}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:14}}>
            <div className="card" style={{padding:16,borderTop:'2px solid var(--yellow)'}}>
              <AlertTriangle size={20} style={{marginBottom:8,color:'var(--yellow)'}}/>
              <div style={{fontWeight:600,fontSize:12,color:'var(--yellow)',marginBottom:4}}>{t('low_stock_alert')}</div>
              <div style={{fontSize:11,color:'var(--text2)',lineHeight:1.5}}>{lowStock.length===0?'All products have healthy stock.':`${lowStock.length} product(s) running low: ${lowStock.map(p=>p.name).slice(0,2).join(', ')}${lowStock.length>2?'...':''}`}</div>
            </div>
            <div className="card" style={{padding:16,borderTop:`2px solid ${outStock.length?'var(--red)':'var(--green)'}`}}>
              {outStock.length?<Ban size={20} style={{marginBottom:8,color:'var(--red)'}}/>:<CheckCircle2 size={20} style={{marginBottom:8,color:'var(--green)'}}/>}
              <div style={{fontWeight:600,fontSize:12,color:outStock.length?'var(--red)':'var(--green)',marginBottom:4}}>{t('out_of_stock_alert')}</div>
              <div style={{fontSize:11,color:'var(--text2)',lineHeight:1.5}}>{outStock.length===0?'No products are out of stock.':`${outStock.length} item(s) need restocking.`}</div>
            </div>
            <div className="card" style={{padding:16,borderTop:'2px solid var(--red)'}}>
              <TrendingDown size={20} style={{marginBottom:8,color:'var(--red)'}}/>
              <div style={{fontWeight:600,fontSize:12,color:'var(--red)',marginBottom:4}}>Least Selling</div>
              <div style={{fontSize:11,color:'var(--text2)',lineHeight:1.5}}>{leastProds[0]?`${leastProds[0].name} — only ${leastProds[0].sold} unit(s) sold`:'No sales data yet.'}</div>
            </div>
          </div>
        </div>

        {/* RECENT TRANSACTIONS */}
        <div>
          <div className="section-title">{t('recent_txns')}</div>
          <div className="tbl-wrap">
            <table>
              <thead><tr>{['TXN #','Time','Customer','Items','Payment','Total'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {transactions.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>{t('no_data')}</td></tr>
                :txPg.pageItems.map(tx=>(
                  <tr key={tx.id}>
                    <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--accent)'}}>#{String(tx.id).padStart(4,'0')}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{new Date(tx.createdAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{fontSize:12}}>{tx.customerName||'Walk-in'}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{(tx.items||[]).length} item(s)</td>
                    <td><span className={`badge ${tx.payment==='Cash'?'badge-green':tx.payment==='GCash'?'badge-blue':'badge-purple'}`} style={{fontSize:10}}>{tx.payment}</span></td>
                    <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(tx.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...txPg}/>
        </div>
      </>}

      {/* ══════════ INVENTORY TAB ══════════ */}
      {activeTab==='inventory' && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>
          <StatCard label="Total Products"   value={products.length}      color="var(--accent)"/>
          {isAdmin && <StatCard label="Inventory Value"  value={peso(totalValue)}     color="var(--green)"/>}
          <StatCard label="Low Stock Items"  value={lowStock.length}      color="var(--yellow)"/>
          <StatCard label="Out of Stock"     value={outStock.length}      color="var(--red)"/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><Package size={13} style={{color:'var(--blue)'}}/>Products by Category</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={catData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>{catData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip/><Legend iconSize={8} wrapperStyle={{fontSize:11}}/></PieChart>
            </ResponsiveContainer>
          </div>
          {isAdmin && (
            <div className="card" style={{padding:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><Wallet size={13} style={{color:'var(--green)'}}/>Revenue by Category</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={catRevenue} layout="vertical" barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false}/>
                  <XAxis type="number" tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?Math.round(v/1000)+'k':v}/>
                  <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:'var(--text3)'}} tickLine={false} axisLine={false} width={80}/>
                  <Tooltip formatter={v=>peso(v)}/>
                  <Bar dataKey="value" fill={ACCENT} radius={[0,4,4,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20,borderTop:'2px solid var(--yellow)',display:'flex',flexDirection:'column'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><AlertTriangle size={13} style={{color:'var(--yellow)'}}/>Low Stock Products</div>
            <div style={{flex:1}}>
              {lowStock.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>All products have healthy stock!</div>
              :lowStockPg.pageItems.map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{p.name}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.category}</div>
                  </div>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:'var(--yellow)'}}>{p.stock} left</span>
                </div>
              ))}
            </div>
            <Pagination {...lowStockPg}/>
          </div>
          <div className="card" style={{padding:20,borderTop:'2px solid var(--red)',display:'flex',flexDirection:'column'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Ban size={13} style={{color:'var(--red)'}}/>Out of Stock Products</div>
            <div style={{flex:1}}>
              {outStock.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No out of stock products!</div>
              :outStockPg.pageItems.map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:500}}>{p.name}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.category}</div>
                  </div>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:700,color:'var(--red)'}}>OUT</span>
                </div>
              ))}
            </div>
            <Pagination {...outStockPg}/>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20,borderTop:'2px solid var(--accent)'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Trophy size={13} style={{color:'var(--yellow)'}}/>Top Selling Products</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {topProds.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No sales data yet.</div>
              :topProds.map((p,i)=>(
                <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'var(--text3)',fontFamily:"'JetBrains Mono',monospace",width:14}}>{i+1}</span>
                  <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--accent)',width:`${Math.round((p.sold/(topProds[0]?.sold||1))*100)}%`}}/></div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {isAdmin && <div style={{fontSize:11,color:'var(--green)',fontFamily:"'JetBrains Mono',monospace"}}>{peso(p.revenue)}</div>}
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><TrendingDown size={13} style={{color:'var(--red)'}}/>Least Selling Products</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {leastProds.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No sales data yet.</div>
              :leastPg.pageItems.map((p,i)=>(
                <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'var(--red)',fontFamily:"'JetBrains Mono',monospace",width:18}}>{leastPg.start+i}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--red)',width:p.sold===0?'4%':`${Math.min(100,Math.round((p.sold/(topProds[0]?.sold||1))*100))}%`}}/></div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {isAdmin && <div style={{fontSize:11,color:'var(--red)',fontFamily:"'JetBrains Mono',monospace"}}>{peso(p.revenue)}</div>}
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
            <Pagination {...leastPg}/>
          </div>
        </div>
      </>}

      {/* ══════════ CUSTOMERS TAB ══════════ */}
      {activeTab==='customers' && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>
          <StatCard label="Total Customers"  value={customers.length}             color="var(--accent)"/>
          <StatCard label="Total Points"     value={totalPoints.toLocaleString()} color="var(--yellow)"/>
          <StatCard label="Platinum Members" value={platinumCount}                color="var(--blue)"/>
          <StatCard label="Gold Members"     value={goldCount}                    color="var(--yellow)"/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Award size={13} style={{color:'var(--purple)'}}/>Customer Loyalty Tiers</div>
            <div style={{fontSize:11,color:'var(--text3)',marginBottom:14}}>Every 1 transaction = 10 loyalty points</div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={tierData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
                  {tierData.map((t,i)=><Cell key={i} fill={t.color}/>)}
                </Pie>
                <Tooltip/>
                <Legend iconSize={8} wrapperStyle={{fontSize:11}}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginTop:8}}>
              {[{label:'🏅 Bronze',  count:bronzeCount,   pts:'0–499 pts',    color:'var(--accent)'},
                {label:'🥈 Silver',  count:silverCount,   pts:'500–1499 pts', color:SLATE},
                {label:'🥇 Gold',    count:goldCount,     pts:'1500–2999 pts',color:'var(--yellow)'},
                {label:'💎 Platinum',count:platinumCount, pts:'3000+ pts',    color:'var(--purple)'}].map(t=>(
                <div key={t.label} style={{padding:10,background:'var(--bg2)',borderRadius:8,borderLeft:`3px solid ${t.color}`}}>
                  <div style={{fontSize:11,fontWeight:600,color:t.color}}>{t.label}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,margin:'3px 0'}}>{t.count}</div>
                  <div style={{fontSize:9.5,color:'var(--text3)'}}>{t.pts}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><Star size={13} style={{color:'var(--yellow)'}}/>Top Customers by Spending</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {topCustomers.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No customers yet.</div>
              :topCustomers.map((c,i)=>{
                const tier = getTier(c.points)
                return (
                  <div key={c.id} style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:28,height:28,borderRadius:8,background:'var(--accent)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#0a0a0a',flexShrink:0}}>{c.name.charAt(0)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                      <div style={{fontSize:10,color:tier.color}}>{tier.icon} {tier.label} · {c.points} pts</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(c.totalSpent||0)}</div>
                      <div style={{fontSize:10,color:'var(--text3)'}}>{c.purchases} txns</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </>}

      {/* ══════════ REFUNDS TAB ══════════ */}
      {activeTab==='refunds' && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>
          <StatCard label="Total Refunds"  value={refunds.length}   color="var(--blue)"/>
          <StatCard label="Pending"        value={pendingRef}       color="var(--yellow)"/>
          <StatCard label="Approved"       value={approvedRef}      color="var(--accent)"/>
          <StatCard label="Total Refunded" value={peso(totalRef)}   color="var(--red)"/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><RefreshCw size={13} style={{color:'var(--blue)'}}/>Refund Status Breakdown</div>
            {refStatusData.length===0
              ? <div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:40}}>No refunds yet.</div>
              : <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={refStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                      {refStatusData.map((r,i)=><Cell key={i} fill={r.color}/>)}
                    </Pie>
                    <Tooltip/>
                    <Legend iconSize={8} wrapperStyle={{fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
            }
          </div>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14,display:'flex',alignItems:'center',gap:6}}><ClipboardList size={13} style={{color:'var(--accent)'}}/>Recent Refund Requests</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {refunds.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No refunds yet.</div>
              :refunds.slice(0,6).map(r=>(
                <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:'var(--accent)'}}>#{String(r.id).padStart(4,'0')}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{r.customerName||'Walk-in'} · {r.reason}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--red)',fontWeight:600}}>{peso(r.total)}</div>
                    <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99,background:r.status==='Approved'?'rgba(52,211,153,0.1)':r.status==='Rejected'?'rgba(239,68,68,0.1)':'rgba(245,158,11,0.1)',color:r.status==='Approved'?'var(--accent)':r.status==='Rejected'?'var(--red)':'var(--yellow)'}}>{r.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>}

      {/* ══════════ REPORTS TAB ══════════ */}
      {activeTab==='reports' && <>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'var(--text3)'}}>Period:</span>
          {['today','this_week','this_month','this_year'].map(p=>(
            <button key={p} onClick={()=>setRepPeriod(p)}
              style={{padding:'6px 14px',fontSize:11,fontWeight:600,border:`1px solid ${repPeriod===p?'var(--blue)':'var(--border)'}`,borderRadius:6,cursor:'pointer',background:repPeriod===p?'var(--blue)':'var(--bg2)',color:repPeriod===p?'#ffffff':'var(--text3)',transition:'all .15s'}}>
              {p==='today'?'Today':p==='this_week'?'This Week':p==='this_month'?'This Month':'This Year'}
            </button>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14}}>
          <StatCard label={t('net_sales')}  value={peso(repMetrics.netSales)}        color="var(--accent)"/>
          <StatCard label={t('transactions')} value={repMetrics.transactionCount}    color="var(--green)"/>
          <StatCard label={t('net_vat')}    value={peso(repMetrics.netVat)}          color="var(--purple)"/>
          <StatCard label={t('avg_order')}  value={peso(repAvg)}                     color="var(--yellow)"/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:14}}>Revenue Chart</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={repChartData} barSize={repPeriod==='today'?14:28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                <XAxis dataKey="label" tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:'var(--text3)'}} tickLine={false} axisLine={false} tickFormatter={v=>v>=1000?Math.round(v/1000)+'k':v}/>
                <Tooltip content={<Tip/>} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
                <Bar dataKey="value" fill={ACCENT} radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SalesBreakdownCard metrics={repMetrics} isLight={isLight}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Trophy size={13} style={{color:'var(--yellow)'}}/>Top Selling — This Period</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {repTop.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No data for this period.</div>
              :repTop.map((p,i)=>(
                <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'var(--text3)',fontFamily:"'JetBrains Mono',monospace",width:14}}>{i+1}</span>
                  <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--accent)',width:`${Math.round((p.sold/(repTop[0]?.sold||1))*100)}%`}}/></div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:11,color:'var(--green)',fontFamily:"'JetBrains Mono',monospace"}}>{peso(p.revenue)}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{padding:20,borderTop:'2px solid var(--red)'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:12,display:'flex',alignItems:'center',gap:6}}><TrendingDown size={13} style={{color:'var(--red)'}}/>Least Selling — This Period</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {repLeast.length===0?<div style={{color:'var(--text3)',fontSize:12,textAlign:'center',padding:20}}>No data for this period.</div>
              :repLeast.map((p,i)=>(
                <div key={p.name} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'var(--red)',fontFamily:"'JetBrains Mono',monospace",width:14}}>{i+1}</span>
                  <ProductThumb {...(products.find(pr=>pr.name===p.name)||{})} size={24} radius={6}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{marginTop:3,height:3,background:'var(--bg5)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',borderRadius:2,background:'var(--red)',width:p.sold===0?'4%':`${Math.min(100,Math.round((p.sold/(repTop[0]?.sold||1))*100))}%`}}/></div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:11,color:'var(--red)',fontFamily:"'JetBrains Mono',monospace"}}>{peso(p.revenue)}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{p.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* TRANSACTION TABLE */}
        <div>
          <div className="section-title" style={{marginBottom:10}}>Transaction History ({repFiltered.length})</div>
          <div className="tbl-wrap">
            <table>
              <thead><tr>{['TXN #','Date & Time','Customer','Items','Payment','Total'].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {repFiltered.length===0?<tr><td colSpan={6} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>No transactions for this period.</td></tr>
                :repFilteredPg.pageItems.map(tx=>(
                  <tr key={tx.id}>
                    <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--accent)'}}>#{String(tx.id).padStart(4,'0')}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{new Date(tx.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                    <td style={{fontSize:12}}>{tx.customerName||'Walk-in'}</td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>{(tx.items||[]).length} item(s)</td>
                    <td><span className={`badge ${tx.payment==='Cash'?'badge-green':tx.payment==='GCash'?'badge-blue':'badge-purple'}`} style={{fontSize:10}}>{tx.payment}</span></td>
                    <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(tx.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...repFilteredPg}/>
        </div>
      </>}

    </div>
  )
}

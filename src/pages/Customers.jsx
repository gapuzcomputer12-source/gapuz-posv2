import { useState, useEffect } from 'react'
import { Pencil, Gift } from 'lucide-react'
import { useCustomerStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, fmtDate } from '../utils/helpers'
import { getTier } from '../utils/loyalty'
import CustomerHistoryModal from '../components/CustomerHistoryModal'
import RedeemRewardModal from '../components/RedeemRewardModal'
import AddCustomerModal from '../components/AddCustomerModal'
import Modal from '../components/Modal'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const EMPTY = { name:'', email:'', phone:'+63', address:'' }

const GMAIL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@gmail\.com$/
const PH_PHONE_RE = /^\+63\d{10}$/

const toPHPhone = (raw) => {
  let digits = String(raw||'').replace(/\D/g,'')
  if(digits.startsWith('63')) digits = digits.slice(2)
  else if(digits.startsWith('0')) digits = digits.slice(1)
  return '+63'+digits.slice(0,10)
}

const AVATAR_COLORS = [
  { bg: 'var(--accent)', fg: '#0a0a0a' },
  { bg: 'var(--blue)',   fg: '#ffffff' },
  { bg: 'var(--purple)', fg: '#ffffff' },
  { bg: 'var(--yellow)', fg: '#0a0a0a' },
  { bg: 'var(--red)',    fg: '#ffffff' },
  { bg: 'var(--green)',  fg: '#ffffff' },
  { bg: 'var(--orange)', fg: '#ffffff' },
]
const avatarColor = (seed) => {
  let hash = 0
  const s = String(seed)
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export default function Customers() {
  useDocumentTitle('Customers')
  const { customers, loading, updateCustomer, deleteCustomer } = useCustomerStore()
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)
  const [form,     setForm]     = useState(EMPTY)
  const [selected, setSelected] = useState(null)
  const [sortBy,   setSortBy]   = useState('name')
  const [addOpen,  setAddOpen]  = useState(false)
  const toast = useToast()
  const t     = useT()

  const openAdd  = () => setAddOpen(true)
  const openEdit = c => { setForm({name:c.name,email:c.email||'',phone:toPHPhone(c.phone||''),address:c.address||''}); setSelected(c); setModal('edit') }
  const openHistory = c => { setSelected(c); setModal('history') }
  const openRedeem  = c => { setSelected(c); setModal('redeem') }

  const handlePhoneChange = e => setForm(f=>({...f, phone: toPHPhone(e.target.value)}))

  const handleSave = () => {
    if(!form.name.trim()) return toast('Name is required','error')
    const email = form.email.trim()
    if(email && !GMAIL_RE.test(email)) return toast('Email must be a valid Gmail address (e.g. juan@gmail.com)','error')
    const phone = form.phone.trim()
    const hasPhoneDigits = phone.replace('+63','').length>0
    if(hasPhoneDigits && !PH_PHONE_RE.test(phone)) return toast('Phone must be a valid PH number: +63 followed by 10 digits','error')
    const payload = {...form, email, phone: hasPhoneDigits?phone:''}
    updateCustomer(selected.id,payload); toast(t('customer_updated'),'success')
    setModal(null)
  }

  const handleDelete = c => {
    if(!window.confirm(t('confirm_delete_cust'))) return
    deleteCustomer(c.id)
    toast('Customer deleted','info')
  }

  const filtered = customers
    .filter(c=>!search||c.name.toLowerCase().includes(search.toLowerCase())||(c.phone||'').includes(search)||(c.email||'').toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>{ if(sortBy==='name') return a.name.localeCompare(b.name); if(sortBy==='points') return b.points-a.points; if(sortBy==='spent') return b.totalSpent-a.totalSpent; if(sortBy==='purchases') return b.purchases-a.purchases; return 0 })

  const pg = usePagination(filtered)
  useEffect(()=>{ pg.setPage(1) }, [search, sortBy])

  return (
    <div style={{height:'100%',overflow:'hidden',display:'flex',flexDirection:'column',padding:'12px 20px 20px',gap:16}}>
      <div className="page-header" style={{justifyContent:'flex-end'}}>
        <button onClick={openAdd} className="btn-primary">+ {t('add_customer')}</button>
      </div>

      <div style={{display:'flex',gap:8,flexShrink:0,flexWrap:'wrap'}}>
        <input className="input-field" style={{maxWidth:280,minWidth:180,flex:1}} placeholder="Search customers..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className="select-field" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="name">Name A–Z</option>
          <option value="points">Most Points</option>
          <option value="spent">Most Spent</option>
          <option value="purchases">Most Purchases</option>
        </select>
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        <div className="tbl-wrap">
          <table>
            <thead><tr>{['Customer','Contact','Tier','Points','Purchases','Total Spent','Joined','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading?<tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-9-9"/>
                  </svg>
                  Loading customers…
                </div>
              </td></tr>
              :filtered.length===0?<tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>{t('no_data')}</td></tr>
              :pg.pageItems.map(c=>{ const tier=getTier(c.points); return (
                <tr key={c.id}>
                  <td><div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:8,background:avatarColor(c.id).bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:avatarColor(c.id).fg,flexShrink:0}}>{c.name.charAt(0).toUpperCase()}</div>
                    <div><div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{c.name}</div><div style={{fontSize:11.5,color:'var(--text2)',marginTop:2}}>{c.email||'No email'}</div></div>
                  </div></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{c.phone||'—'}</td>
                  <td><span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,fontWeight:700,padding:'3px 9px',borderRadius:99,background:tier.bg,color:tier.color}}><tier.icon size={11}/>{tier.label}</span></td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--yellow)',fontWeight:600}}>{(c.points||0).toLocaleString()}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{c.purchases||0}</td>
                  <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--green)',fontWeight:600}}>{peso(c.totalSpent||0)}</td>
                  <td style={{fontSize:11,color:'var(--text3)'}}>{c.createdAt?fmtDate(c.createdAt):'—'}</td>
                  <td><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    <button onClick={()=>openRedeem(c)} className="btn-primary" style={{fontSize:10,padding:'4px 8px',display:'inline-flex',alignItems:'center',gap:4}}><Gift size={11}/>Claim Reward</button>
                    <button onClick={()=>openHistory(c)} className="btn-success" style={{fontSize:10,padding:'4px 8px'}}>History</button>
                    <button onClick={()=>openEdit(c)} className="btn-secondary" style={{fontSize:10,padding:'4px 8px'}}>{t('edit')}</button>
                    <button onClick={()=>handleDelete(c)} className="btn-danger" style={{fontSize:10,padding:'4px 8px'}}>{t('delete')}</button>
                  </div></td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...pg}/>

      {/* Edit Modal (add is handled by the shared AddCustomerModal below) */}
      {modal==='edit'&&(
        <Modal open onClose={()=>setModal(null)} contentStyle={{width:'min(420px,92vw)'}}>
          <div className="card animate-scale-in" style={{padding:28}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:20,display:'flex',alignItems:'center',gap:6}}><Pencil size={14} style={{color:'var(--blue)'}}/>{t('edit_customer')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {[['name',t('full_name'),'Juan dela Cruz','text'],['email',t('email_addr'),'juan@gmail.com','email']].map(([key,label,ph,type])=>(
                <div key={key}><label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</label><input className="input-field" type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph}/></div>
              ))}
              <div><label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('phone')}</label><input className="input-field" type="tel" inputMode="numeric" value={form.phone} onChange={handlePhoneChange} placeholder="+639171234567" maxLength={13}/></div>
              <div><label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('address')}</label><input className="input-field" type="text" value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Cagayan de Oro City"/></div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'flex-end'}}><button onClick={()=>setModal(null)} className="btn-secondary">{t('cancel')}</button><button onClick={handleSave} className="btn-primary">{t('save')}</button></div>
          </div>
        </Modal>
      )}

      <CustomerHistoryModal open={modal==='history'} onClose={()=>setModal(null)} customer={selected}/>
      <RedeemRewardModal open={modal==='redeem'} onClose={()=>setModal(null)} customer={selected&&(customers.find(c=>c.id===selected.id)||selected)}/>
      <AddCustomerModal open={addOpen} onClose={()=>setAddOpen(false)}/>
    </div>
  )
}

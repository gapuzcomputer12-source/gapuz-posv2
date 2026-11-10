import { useState, useEffect } from 'react'
import { UserPlus, Pencil, X, User, Mail, Lock, Eye, EyeOff, UserX, UserCheck, AlertTriangle, Trash2, Search, ShieldAlert } from 'lucide-react'
import { useStaffStore, useAuthStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, fmtDate, passwordError } from '../utils/helpers'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const EMPTY = { name:'', email:'', password:'', confirmPassword:'', role:'cashier' }

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

const FIELD_LABEL = { display:'block', fontSize:10, fontWeight:700, color:'var(--text3)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.6px' }

function IconInput({ icon:Icon, style, ...rest }) {
  return (
    <div style={{ position:'relative' }}>
      <div style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', display:'flex', color:'var(--text3)' }}>
        <Icon size={14}/>
      </div>
      <input className="input-field" style={{ paddingLeft:34, ...style }} {...rest}/>
    </div>
  )
}

function PasswordField({ value, onChange, placeholder, onEnter }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position:'relative' }}>
      <IconInput icon={Lock} type={show?'text':'password'} value={value}
                 onChange={onChange} placeholder={placeholder}
                 style={{ paddingRight:36 }}
                 onKeyDown={e=>e.key==='Enter'&&onEnter?.()}/>
      <button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'Hide password':'Show password'}
              style={{ position:'absolute', right:4, top:'50%', transform:'translateY(-50%)', width:28, height:28, border:'none', background:'transparent', color:'var(--text3)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
        {show ? <EyeOff size={15}/> : <Eye size={15}/>}
      </button>
    </div>
  )
}

function Spinner({ size=14, color='currentColor' }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-9-9"/>
    </svg>
  )
}

export default function Staff() {
  useDocumentTitle('Staff')
  const { staff, loading, addCashier, updateStaff, toggleStaffStatus, deleteStaff } = useStaffStore()
  const myId = useAuthStore(s=>s.user?.id)
  const [modal,          setModal]          = useState(null) // 'add' | 'edit' | null
  const [form,           setForm]           = useState(EMPTY)
  const [selected,       setSelected]       = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [search,         setSearch]         = useState('')
  const [statusConfirm,  setStatusConfirm]  = useState(null) // staff member pending suspend/reactivate confirmation
  const [togglingId,     setTogglingId]     = useState(null) // id currently being suspended/reactivated
  const [deleteConfirm,  setDeleteConfirm]  = useState(null) // staff member pending delete confirmation
  const [deletingId,     setDeletingId]     = useState(null) // id currently being deleted
  const toast = useToast()
  const t     = useT()

  const openAdd    = () => { setForm(EMPTY); setModal('add') }
  const openEdit   = (s) => { setForm({ name:s.name, email:s.email||'', password:'', confirmPassword:'', role:s.role }); setSelected(s); setModal('edit') }
  const closeModal = () => setModal(null)
  const isAdd = modal === 'add'

  const filtered = staff.filter(s=>{
    const q = search.trim().toLowerCase()
    return !q || s.name.toLowerCase().includes(q) || (s.email||'').toLowerCase().includes(q)
  })
  const pg = usePagination(filtered)
  useEffect(()=>{ pg.setPage(1) }, [search])

  const handleSave = async () => {
    if (!form.name.trim())  return toast('Name is required', 'error')
    if (!form.email.trim()) return toast('Email is required', 'error')
    if (isAdd && !form.password) return toast('Password is required', 'error')
    if (form.password) {
      const pwErr = passwordError(form.password)
      if (pwErr) return toast(pwErr, 'error')
    }
    if (form.password !== form.confirmPassword) return toast('Passwords do not match', 'error')

    setSaving(true)
    const { error } = isAdd
      ? await addCashier(form)
      : await updateStaff({ id: selected.id, name: form.name, email: form.email, password: form.password, role: form.role })
    setSaving(false)
    if (error) return toast(error.message || 'Could not save account', 'error')
    toast(isAdd ? t('cashier_added') : t('staff_updated'), 'success')
    closeModal()
  }

  const runToggle = async (s, makeActive) => {
    setTogglingId(s.id)
    const { error } = await toggleStaffStatus({ id: s.id, active: makeActive })
    setTogglingId(null)
    if (error) return toast(error.message || 'Could not update account status', 'error')
    toast(makeActive ? t('staff_reactivated') : t('staff_suspended'), 'success')
  }

  const handleToggleStatus = (s) => setStatusConfirm(s)

  const runDelete = async (s) => {
    setDeletingId(s.id)
    const { error } = await deleteStaff(s.id)
    setDeletingId(null)
    if (error) return toast(error.message || 'Could not delete account', 'error')
    toast(t('staff_deleted'), 'success')
  }

  return (
    <div style={{height:'100%',overflow:'hidden',display:'flex',flexDirection:'column',padding:20,gap:16}}>
      <div className="page-header">
        <div className="page-title" style={{display:'flex',alignItems:'center',gap:8}}>
          <UserPlus size={18} style={{color:'var(--accent)'}}/>{t('staff_accounts')}
        </div>
        <button onClick={openAdd} className="btn-primary">+ {t('add_cashier')}</button>
      </div>

      <div style={{position:'relative', maxWidth:280, flexShrink:0}}>
        <div style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',pointerEvents:'none',display:'flex',alignItems:'center',opacity:0.6}}>
          <Search size={15}/>
        </div>
        <input className="input-field" style={{paddingLeft:40, width:'100%'}} placeholder={t('search_staff')} value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      <div style={{flex:1,overflowY:'auto'}}>
        <div className="tbl-wrap">
          <table>
            <thead><tr>{['Name','Email','Role','Status','Joined',''].map(h=><th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
                  <Spinner size={18} color="var(--accent)"/>
                  {t('loading')}
                </div>
              </td></tr>
              : filtered.length===0 ? <tr><td colSpan={6} style={{textAlign:'center',padding:40,color:'var(--text3)'}}>{t('no_data')}</td></tr>
              : pg.pageItems.map(s=>{
                const ac = avatarColor(s.id)
                const isSuspended = s.active === false
                return (
                <tr key={s.id} style={{opacity:isSuspended?0.55:1}}>
                  <td><div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:30,height:30,borderRadius:8,background:ac.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:ac.fg,flexShrink:0}}>{s.name.charAt(0).toUpperCase()}</div>
                    <span style={{fontWeight:600,fontSize:13,color:'var(--text)'}}>{s.name}</span>
                  </div></td>
                  <td style={{fontSize:12.5,color:'var(--text2)'}}>{s.email || '—'}</td>
                  <td><span className={`badge ${s.role==='admin'?'badge-purple':'badge-accent'}`} style={{fontSize:10}}>{s.role==='admin'?'Admin':'Cashier'}</span></td>
                  <td><span className={`badge ${isSuspended?'badge-red':'badge-green'}`} style={{fontSize:10}}>{isSuspended?t('suspended'):t('active')}</span></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{fmtDate(s.createdAt)}</td>
                  <td style={{textAlign:'right'}}>
                    <div style={{display:'inline-flex',gap:5}}>
                      <button onClick={()=>openEdit(s)} className="btn-secondary" style={{fontSize:10,padding:'4px 10px',display:'inline-flex',alignItems:'center',gap:4}}>
                        <Pencil size={11}/>{t('edit')}
                      </button>
                      {s.role==='cashier' && (
                        <button onClick={()=>handleToggleStatus(s)} disabled={togglingId===s.id} className={isSuspended?'btn-success':'btn-danger'} style={{fontSize:10,padding:'4px 10px',display:'inline-flex',alignItems:'center',gap:4,opacity:togglingId===s.id?0.7:1}}>
                          {togglingId===s.id ? <Spinner size={11}/> : isSuspended ? <UserCheck size={11}/> : <UserX size={11}/>}
                          {isSuspended?t('reactivate'):t('suspend')}
                        </button>
                      )}
                      {s.id!==myId && (
                        <button onClick={()=>setDeleteConfirm(s)} disabled={deletingId===s.id} className="btn-danger" style={{fontSize:10,padding:'4px 10px',display:'inline-flex',alignItems:'center',gap:4,opacity:deletingId===s.id?0.7:1}}>
                          {deletingId===s.id ? <Spinner size={11}/> : <Trash2 size={11}/>}
                          {t('delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination {...pg}/>

      {(modal==='add'||modal==='edit') && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.9)'}} onClick={e=>e.target===e.currentTarget&&closeModal()}>
          <div className="card animate-scale-in" style={{width:'min(420px,92vw)',padding:0,overflow:'hidden'}}>

            {/* Header */}
            <div style={{padding:'22px 26px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:38,height:38,borderRadius:10,background: isAdd ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {isAdd ? <UserPlus size={17} style={{color:'var(--green)'}}/> : <Pencil size={16} style={{color:'var(--blue)'}}/>}
                </div>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{isAdd ? t('add_cashier') : t('edit_staff')}</div>
                  <div style={{fontSize:11.5,color:'var(--text3)',marginTop:1}}>{isAdd ? 'Create a new cashier login' : selected?.name}</div>
                </div>
              </div>
              <button onClick={closeModal} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',padding:4,display:'flex',borderRadius:6}}><X size={18}/></button>
            </div>

            {/* Body */}
            <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16}}>
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <div>
                  <label style={FIELD_LABEL}>{t('full_name')} *</label>
                  <IconInput icon={User} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Juan dela Cruz"/>
                </div>
                <div>
                  <label style={FIELD_LABEL}>{t('email_addr')} *</label>
                  <IconInput icon={Mail} type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="cashier@email.com"/>
                </div>
                {!isAdd && (
                  <div>
                    <label style={FIELD_LABEL}>{t('role')}</label>
                    <select className="select-field" style={{width:'100%'}} value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                      <option value="cashier">Cashier</option>
                      <option value="admin">Admin</option>
                    </select>
                    {form.role !== selected?.role && (
                      <div style={{display:'flex',alignItems:'flex-start',gap:6,marginTop:7,fontSize:11,color:'var(--yellow)'}}>
                        <ShieldAlert size={13} style={{flexShrink:0,marginTop:1}}/>
                        <span>{t('role_change_warning')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{flex:1,height:1,background:'var(--border)'}}/>
                <span style={{fontSize:10,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'.6px'}}>Security</span>
                <div style={{flex:1,height:1,background:'var(--border)'}}/>
              </div>

              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <div>
                  <label style={FIELD_LABEL}>{isAdd ? `${t('password')} *` : t('new_password_optional')}</label>
                  <PasswordField value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}
                                 placeholder={isAdd ? 'Create a strong password' : t('leave_blank_pw')} onEnter={handleSave}/>
                  {form.password && <div style={{fontSize:10,color:'var(--text3)',marginTop:5}}>Min 8 characters, with uppercase, lowercase, a number, and a special character.</div>}
                </div>
                <div>
                  <label style={FIELD_LABEL}>{t('confirm_password')}{isAdd ? ' *' : ''}</label>
                  <PasswordField value={form.confirmPassword} onChange={e=>setForm(f=>({...f,confirmPassword:e.target.value}))}
                                 placeholder="Re-enter password" onEnter={handleSave}/>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{display:'flex',gap:10,padding:'16px 26px',borderTop:'1px solid var(--border)',justifyContent:'flex-end'}}>
              <button onClick={closeModal} disabled={saving} className="btn-secondary">{t('cancel')}</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary" style={{display:'inline-flex',alignItems:'center',gap:6}}>
                {saving && <Spinner size={13}/>}
                {saving ? 'Saving...' : (isAdd ? t('create_account') : t('save_changes'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend / Reactivate confirmation */}
      {statusConfirm && (() => {
        const willReactivate = statusConfirm.active === false
        const color = willReactivate ? 'var(--green)' : 'var(--red)'
        const actionLabel = willReactivate ? t('reactivate') : t('suspend')
        const busy = togglingId === statusConfirm.id
        return (
          <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)'}} onClick={e=>e.target===e.currentTarget&&!busy&&setStatusConfirm(null)}>
            <div className="card animate-scale-in" style={{width:'min(360px,92vw)',padding:28,textAlign:'center'}}>
              <div style={{width:44,height:44,borderRadius:'50%',background:willReactivate?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',color}}>
                {willReactivate ? <UserCheck size={22}/> : <AlertTriangle size={22}/>}
              </div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>{actionLabel} {statusConfirm.name}?</div>
              <div style={{fontSize:12.5,color:'var(--text2)',lineHeight:1.5}}>
                {willReactivate ? `They'll be able to log in again once reactivated.` : t('confirm_suspend')}
              </div>
              <div style={{display:'flex',gap:10,marginTop:20}}>
                <button onClick={()=>setStatusConfirm(null)} disabled={busy} className="btn-secondary" style={{flex:1}}>{t('cancel')}</button>
                <button onClick={async ()=>{ await runToggle(statusConfirm, willReactivate); setStatusConfirm(null) }}
                        disabled={busy} className="btn-primary"
                        style={{flex:1,background:color,borderColor:color,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  {busy && <Spinner size={13}/>}{actionLabel}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delete confirmation */}
      {deleteConfirm && (() => {
        const busy = deletingId === deleteConfirm.id
        return (
          <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)'}} onClick={e=>e.target===e.currentTarget&&!busy&&setDeleteConfirm(null)}>
            <div className="card animate-scale-in" style={{width:'min(360px,92vw)',padding:28,textAlign:'center'}}>
              <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(239,68,68,0.12)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',color:'var(--red)'}}>
                <Trash2 size={20}/>
              </div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>{t('delete')} {deleteConfirm.name}?</div>
              <div style={{fontSize:12.5,color:'var(--text2)',lineHeight:1.5}}>{t('confirm_delete_staff')}</div>
              <div style={{display:'flex',gap:10,marginTop:20}}>
                <button onClick={()=>setDeleteConfirm(null)} disabled={busy} className="btn-secondary" style={{flex:1}}>{t('cancel')}</button>
                <button onClick={async ()=>{ await runDelete(deleteConfirm); setDeleteConfirm(null) }}
                        disabled={busy} className="btn-primary"
                        style={{flex:1,background:'var(--red)',borderColor:'var(--red)',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  {busy && <Spinner size={13}/>}{t('delete')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

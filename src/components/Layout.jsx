import { useState, useEffect, useRef } from 'react'
import { Pencil } from 'lucide-react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useAppStore, useProductStore, useCustomerStore, useTransactionStore, useRefundStore, useHoldStore, useCategoryStore, useStaffStore, useActivityLogStore } from '../store'
import { useReturnStore } from '../store/useReturnStore'
import { useT, useBreakpoint } from '../utils/helpers'
import { useToast } from '../utils/toast'

const SidebarIcon = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
)

const NAV = [
  { section: '', items:[
    { to:'/pos',       key:'pos',       icon: <SidebarIcon><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></SidebarIcon> },
    { to:'/dashboard', key:'dashboard', icon: <SidebarIcon><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></SidebarIcon> },
  ]},
  { section: 'Management', items:[
    { to:'/products',  key:'products',  icon: <SidebarIcon><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></SidebarIcon>, adminOnly:true },
    { to:'/customers', key:'customers', icon: <SidebarIcon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></SidebarIcon> },
    { to:'/staff',     key:'staff_accounts', icon: <SidebarIcon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></SidebarIcon>, adminOnly:true },
    { to:'/activity-log', key:'activity_log', icon: <SidebarIcon><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></SidebarIcon>, adminOnly:true },
  ]},
  { section: 'Finance', items:[
    { to:'/reports',   key:'reports',   icon: <SidebarIcon><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></SidebarIcon>, adminOnly:true },
    { to:'/refunds',   key:'refunds',   icon: <SidebarIcon><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></SidebarIcon> },
  ]},
]

export default function Layout() {
  const { user, role, logout, updateProfile }           = useAuthStore()
  const { theme, toggleTheme, refundsLastSeenAt } = useAppStore()
  const refunds = useRefundStore(s=>s.refunds)
  const pendingUnseenRefunds = refunds.filter(r => r.status==='Pending' && (!refundsLastSeenAt || new Date(r.createdAt) > new Date(refundsLastSeenAt))).length
  const navigate  = useNavigate()
  const isLight   = theme === 'light'
  const location  = useLocation()
  const t         = useT()
  const toast     = useToast()
  const { isMobile } = useBreakpoint()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileModal, setProfileModal] = useState(false)
  const [profileForm, setProfileForm] = useState({ name:'', currentPassword:'', password:'', confirmPassword:'' })
  const [profileSaving, setProfileSaving] = useState(false)
  const profileRef = useRef(null)

  useEffect(()=>{ setMobileNavOpen(false) },[location.pathname])
  useEffect(()=>{
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  },[])
  useEffect(()=>{
    const onClick = (e) => { if(profileRef.current && !profileRef.current.contains(e.target)) setProfileMenuOpen(false) }
    const onKey = (e) => { if(e.key === 'Escape') setProfileMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  },[])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen()
    else document.exitFullscreen()
  }

  const openProfileModal = () => {
    setProfileForm({ name: userName, currentPassword:'', password:'', confirmPassword:'' })
    setProfileModal(true)
    setProfileMenuOpen(false)
  }

  const handleProfileSave = async () => {
    const { currentPassword, password, confirmPassword } = profileForm
    if (currentPassword || password || confirmPassword) {
      if (!currentPassword) return toast('Please enter your current password', 'error')
      if (!password) return toast('Please enter a new password', 'error')
      if (password.length < 6) return toast('New password must be at least 6 characters', 'error')
      if (password !== confirmPassword) return toast('New passwords do not match', 'error')
    }
    setProfileSaving(true)
    const { error } = await updateProfile(profileForm)
    setProfileSaving(false)
    if (error) return toast(error.message||'Update failed','error')
    toast(t('profile_updated'),'success')
    setProfileModal(false)
  }
  useEffect(()=>{
    useProductStore.getState().fetchProducts()
    useCustomerStore.getState().fetchCustomers()
    useTransactionStore.getState().fetchTransactions()
    useRefundStore.getState().fetchRefunds()
    useReturnStore.getState().fetchReturns()
    useHoldStore.getState().fetchHolds()
    useCategoryStore.getState().fetchCategories()
    useStaffStore.getState().fetchStaff()
    useActivityLogStore.getState().fetchLogs()
  },[])

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'
  const initials = userName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
  const sW = isMobile ? '240px' : '220px'

  const currentItem = NAV.flatMap(s=>s.items).find(i=>location.pathname.startsWith(i.to))

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:'var(--bg)' }}>

      {/* Mobile drawer backdrop */}
      {isMobile && mobileNavOpen && (
        <div onClick={()=>setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:100 }}/>
      )}

      {/* ── SIDEBAR ───────────────────────────────────── */}
      <aside style={{
        width:sW, flexShrink:0, height:'100vh',
        display:'flex', flexDirection:'column',
        background:'var(--bg2)',
        borderRight:'1px solid var(--border)',
        transition: isMobile ? 'transform .22s cubic-bezier(.4,0,.2,1)' : 'width .22s cubic-bezier(.4,0,.2,1)',
        overflow:'hidden', zIndex:110,
        ...(isMobile
          ? { position:'fixed', top:0, left:0, transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)', boxShadow: mobileNavOpen?'0 0 40px rgba(0,0,0,0.4)':'none' }
          : { position:'relative' }),
      }}>

        {/* Brand */}
        <div style={{
          display:'flex', alignItems:'center', gap:10,
          justifyContent:'center',
          padding:'16px 14px', borderBottom:'1px solid var(--border)',
          minHeight:64, flexShrink:0,
        }}>
          <img src="/logo.jpg" alt="Logo" style={{ width:34, height:34, borderRadius:'50%', objectFit:'cover', flexShrink:0 }}/>
          <div style={{ overflow:'hidden', flex:1 }}>
            <div style={{ fontSize:13, fontWeight:800, color:'var(--accent)', letterSpacing:'-.2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              GAPUZ POS
            </div>
            <div style={{ fontSize:10.5, color:'var(--text2)', marginTop:1 }}>Cagayan de Oro City</div>
          </div>
          {isMobile && (
            <button onClick={()=>setMobileNavOpen(false)} aria-label="Close menu" style={{
              marginLeft:'auto', width:22, height:22, borderRadius:6, flexShrink:0,
              border:'1px solid var(--border2)', background:'var(--bg3)',
              color:'var(--text)', cursor:'pointer', display:'flex',
              alignItems:'center', justifyContent:'center', fontSize:11, transition:'all .15s',
            }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border2)';e.currentTarget.style.color='var(--text)'}}>
              ×
            </button>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'10px 8px', display:'flex', flexDirection:'column', gap:2 }}>
          {NAV.map(section=>{
            const items = section.items.filter(i=>!i.adminOnly||role==='admin')
            if(!items.length) return null
            const sectionLabel = section.section
            return (
              <div key={sectionLabel||section.items[0].to}>
                {sectionLabel && (
                  <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.2px', textTransform:'uppercase', color:'var(--text2)', padding:'10px 8px 4px' }}>
                    {sectionLabel}
                  </div>
                )}
                {items.map(item=>(
                  <NavLink key={item.to} to={item.to}
                    onClick={()=>{ if(isMobile) setMobileNavOpen(false) }}
                    style={({ isActive }) => ({
                      display:'flex', alignItems:'center', gap:10,
                      padding:'9px 10px', borderRadius:8, textDecoration:'none',
                      whiteSpace:'nowrap', overflow:'hidden', transition:'all .15s',
                      cursor:'pointer', border: '1px solid transparent',
                      fontSize:14, fontWeight:isActive?700:500, position:'relative',
                      background: isActive ? 'var(--accent)' : 'transparent',
                      boxShadow: isActive ? '0 2px 8px rgba(52,211,153,0.35)' : 'none',
                      color: isActive ? 'var(--accent-dark)' : 'var(--text2)'
                    })}
                    onMouseEnter={e => { if (e.currentTarget.getAttribute('aria-current') !== 'page') { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--text)' } }}
                    onMouseLeave={e => { if (e.currentTarget.getAttribute('aria-current') !== 'page') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)' } }}>
                    {({ isActive }) => (
                      <>
                        <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0, color: 'inherit', opacity: isActive ? 1 : 0.55, transition: 'all .2s' }}>
                          {item.icon}
                        </span>
                        <span style={{ flex:1 }}>{t(item.key)}</span>
                        {item.key==='refunds' && pendingUnseenRefunds>0 && (
                          <span style={{
                            minWidth:18, height:18, borderRadius:99, padding:'0 5px',
                            background: isActive ? 'var(--accent-dark)' : 'var(--red)',
                            color: isActive ? 'var(--accent)' : '#fff',
                            fontSize:10.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center',
                            flexShrink:0, fontFamily:"'JetBrains Mono',monospace",
                          }}>{pendingUnseenRefunds>99?'99+':pendingUnseenRefunds}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* ── MAIN ─────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        {/* Topbar */}
        <header style={{
          height:52, flexShrink:0, display:'flex', alignItems:'center',
          gap:12, padding: isMobile ? '0 12px' : '0 20px', background:'var(--bg2)',
          borderBottom:'1px solid var(--border)',
        }}>
          {isMobile && (
            <button onClick={()=>setMobileNavOpen(true)} aria-label="Open menu" style={{
              width:32, height:32, flexShrink:0, borderRadius:8, border:'1px solid var(--border2)',
              background:'var(--bg3)', color:'var(--text)', cursor:'pointer', display:'flex',
              alignItems:'center', justifyContent:'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          )}
          <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, minWidth:0, overflow:'hidden' }}>
            {currentItem && <span style={{ fontSize:16, flexShrink:0 }}>{currentItem.icon}</span>}
            <span style={{ fontSize:16, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {t(currentItem?.key||'pos')}
            </span>
            {role==='admin' && !isMobile && (
              <span className="badge badge-accent" style={{ fontSize:10 }}>Admin</span>
            )}
          </div>
          <button onClick={toggleFullscreen} aria-label="Toggle fullscreen" style={{
            width:30, height:30, flexShrink:0, borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg3)',
            color:'var(--text2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border2)';e.currentTarget.style.color='var(--text2)'}}>
            {isFullscreen ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3"/></svg>
            )}
          </button>

          {/* Profile menu */}
          <div ref={profileRef} style={{ position:'relative', flexShrink:0 }}>
            <button onClick={()=>setProfileMenuOpen(o=>!o)} aria-label="Account menu" style={{
              display:'flex', alignItems:'center', gap:9, padding:'5px 10px 5px 5px', borderRadius:22,
              border: profileMenuOpen ? '1px solid var(--border2)' : '1px solid transparent',
              background: profileMenuOpen ? 'var(--bg3)' : 'transparent',
              boxShadow: profileMenuOpen ? '0 4px 14px rgba(0,0,0,0.18)' : 'none',
              color:'var(--text2)', cursor:'pointer', transition:'all .15s',
            }}>
              <div style={{ width:30, height:30, borderRadius:9, background:'linear-gradient(140deg, var(--accent), var(--accent2))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12.5, fontWeight:800, color:'var(--accent-dark)', flexShrink:0 }}>
                {initials}
              </div>
              {!isMobile && <span style={{ fontSize:14.5, fontWeight:600, color:'var(--text)', maxWidth:110, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userName}</span>}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: profileMenuOpen?'rotate(180deg)':'none', transition:'transform .15s', flexShrink:0 }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {profileMenuOpen && (
              <div className="card animate-scale-in" style={{
                position:'absolute', top:'calc(100% + 8px)', right:0, width:225, padding:10, zIndex:150,
                border:'1px solid var(--border2)', boxShadow:'0 12px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)',
              }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--border)', marginBottom:8 }}>
                  <div style={{ overflow:'hidden' }}>
                    <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{userName}</div>
                    <div style={{ fontSize:12.5, color:'var(--text2)', marginTop:2 }}>{role==='admin' ? 'Admin' : 'Cashier'}</div>
                  </div>
                  <button onClick={toggleTheme} aria-label="Toggle theme" style={{
                    width:28, height:28, borderRadius:8, flexShrink:0, border:'1px solid var(--border2)', background:'var(--bg3)',
                    color:'var(--text2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border2)';e.currentTarget.style.color='var(--text2)'}}>
                    {theme==='dark' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
                    )}
                  </button>
                </div>
                <button onClick={openProfileModal} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8,
                  border:'none', background:'transparent', color:'var(--text)', cursor:'pointer', fontSize:14.5, fontWeight:500, textAlign:'left',
                }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
                  {t('edit_profile')}
                </button>
                <button onClick={async ()=>{ setProfileMenuOpen(false); await logout(); navigate('/login') }} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8,
                  border:'none', background:'transparent', color:'var(--red)', cursor:'pointer', fontSize:14.5, fontWeight:500, textAlign:'left',
                }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.1)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  {t('logout')}
                </button>
              </div>
            )}
          </div>
        </header>

        <div style={{ flex:1, overflow:'hidden' }}>
          <Outlet/>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {profileModal && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.9)'}} onClick={e=>e.target===e.currentTarget&&setProfileModal(false)}>
          <div className="card animate-scale-in" style={{width:'min(420px,92vw)',padding:28}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:20,display:'flex',alignItems:'center',gap:6}}><Pencil size={14} style={{color:'var(--blue)'}}/>{t('edit_profile')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('full_name')}</label>
                <input className="input-field" type="text" value={profileForm.name} onChange={e=>setProfileForm(f=>({...f,name:e.target.value}))} placeholder="Juan dela Cruz"/>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('current_password')}</label>
                <input className="input-field" type="password" value={profileForm.currentPassword} onChange={e=>setProfileForm(f=>({...f,currentPassword:e.target.value}))} placeholder="••••••••"/>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('new_password')}</label>
                <input className="input-field" type="password" value={profileForm.password} onChange={e=>setProfileForm(f=>({...f,password:e.target.value}))} placeholder="••••••••"/>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text3)',display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:'.5px'}}>{t('confirm_new_password')}</label>
                <input className="input-field" type="password" value={profileForm.confirmPassword} onChange={e=>setProfileForm(f=>({...f,confirmPassword:e.target.value}))} placeholder="••••••••"/>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'flex-end'}}>
              <button onClick={()=>setProfileModal(false)} disabled={profileSaving} className="btn-secondary">{t('cancel')}</button>
              <button onClick={handleProfileSave} disabled={profileSaving} className="btn-primary" style={{display:'flex',alignItems:'center',gap:8}}>
                {profileSaving && (
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-9-9"/>
                  </svg>
                )}
                {profileSaving ? 'Saving...' : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useAppStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, useLoginMobile } from '../utils/helpers'
import LoginSkeleton from '../components/LoginSkeleton'
import Modal from '../components/Modal'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const BRAND_GREEN = '#0A8F63'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReduced(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

const DecorIcon = ({ children, size, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="rgba(6,41,30,0.2)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
       className="decor-drift" style={{ position:'absolute', pointerEvents:'none', ...style }}>
    {children}
  </svg>
)

// Spread around the panel edges — left column, right column, plus top/bottom bands —
// so the icons read as a visible tech-texture without ever crossing the centered mascot/text.
const DECOR_ICONS = [
  { // monitor — top-left
    size:130, style:{ top:70, left:'7%', transform:'rotate(-8deg)', '--drift-x':'6px', '--drift-y':'-8px', '--drift-dur':'9s', '--drift-delay':'0s' },
    paths: <><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  },
  { // cpu chip — mid-left
    size:80, style:{ top:'44%', left:'6%', transform:'rotate(-8deg)', '--drift-x':'-5px', '--drift-y':'7px', '--drift-dur':'11s', '--drift-delay':'1.2s' },
    paths: <><rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="10" y="10" width="4" height="4"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/></>,
  },
  { // laptop — bottom-left
    size:88, style:{ bottom:85, left:'8%', transform:'rotate(-10deg)', '--drift-x':'-7px', '--drift-y':'-5px', '--drift-dur':'9.5s', '--drift-delay':'1.6s' },
    paths: <><path d="M18 5a2 2 0 0 1 2 2v9H4V7a2 2 0 0 1 2-2h12z"/><path d="M20.5 16H3.5a1 1 0 0 0-1 1.2l.4 2a1 1 0 0 0 1 .8h16.2a1 1 0 0 0 1-.8l.4-2a1 1 0 0 0-1-1.2z"/></>,
  },
  { // keyboard — bottom band, left-of-center
    size:92, style:{ bottom:35, left:'22%', transform:'rotate(-4deg)', '--drift-x':'-5px', '--drift-y':'6px', '--drift-dur':'10.5s', '--drift-delay':'0.4s' },
    paths: <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></>,
  },
  { // padlock — top band, left-of-center
    size:76, style:{ top:35, left:'27%', transform:'rotate(-5deg)', '--drift-x':'5px', '--drift-y':'-6px', '--drift-dur':'9.8s', '--drift-delay':'1.8s' },
    paths: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  },
  { // headphones — top-right
    size:112, style:{ top:60, right:'9%', transform:'rotate(10deg)', '--drift-x':'-6px', '--drift-y':'-6px', '--drift-dur':'10s', '--drift-delay':'2s' },
    paths: <><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></>,
  },
  { // printer — mid-right
    size:88, style:{ top:'40%', right:'8%', transform:'rotate(10deg)', '--drift-x':'5px', '--drift-y':'8px', '--drift-dur':'12s', '--drift-delay':'0.9s' },
    paths: <><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
  },
  { // mouse — bottom-right
    size:96, style:{ bottom:75, right:'11%', transform:'rotate(16deg)', '--drift-x':'7px', '--drift-y':'6px', '--drift-dur':'8.5s', '--drift-delay':'0.6s' },
    paths: <><rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 6v4"/></>,
  },
  { // webcam — top band, right-of-center
    size:72, style:{ top:35, right:'27%', transform:'rotate(6deg)', '--drift-x':'-5px', '--drift-y':'-7px', '--drift-dur':'11.2s', '--drift-delay':'1.1s' },
    paths: <><circle cx="12" cy="10" r="8"/><circle cx="12" cy="10" r="3"/><path d="M7 22h10M12 16v6"/></>,
  },
]

// Mascot screen-face geometry, measured as % of the mascot image's own box (424x589 source),
// so it lines up regardless of the rendered size (desktop hero vs. the small mobile logo).
const EYE_L_X = 44.6, EYE_R_X = 55.4, EYE_Y = 34.6
const EYE_INK = '#bfeaf7'
const SCREEN_MASK = '#3b4d51'
const MASCOT_RATIO = 424 / 589

function MascotEye({ xPercent, shape, offset }) {
  return (
    <>
      <div style={{
        position:'absolute', left:`${xPercent}%`, top:`${EYE_Y}%`, width:'5.8%', height:'3.8%',
        transform:'translate(-50%,-50%)', background:SCREEN_MASK, borderRadius:'50%',
      }}/>
      {shape === 'closed' ? (
        <div style={{
          position:'absolute', left:`${xPercent}%`, top:`${EYE_Y}%`, width:'5.2%', height:'0.9%',
          transform:'translate(-50%,-50%)', background:EYE_INK, borderRadius:99,
        }}/>
      ) : (
        <div style={{
          position:'absolute', left:`${xPercent}%`, top:`${EYE_Y}%`, width:'3.6%', height:'2.6%', borderRadius:'50%',
          background:EYE_INK, transform:`translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          transition:'transform .12s ease-out',
        }}/>
      )}
    </>
  )
}

function Mascot({ size, trackCursor, passwordFocused, peeking, shake, hop, reducedMotion, showGlow }) {
  const wrapRef = useRef(null)
  const [offset, setOffset] = useState({ x:0, y:0 })

  useEffect(() => {
    if (!trackCursor || reducedMotion) return
    let raf = null
    const onMove = (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = null
        const el = wrapRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width * 0.5
        const cy = rect.top + rect.height * (EYE_Y / 100)
        const dx = e.clientX - cx, dy = e.clientY - cy
        const dist = Math.hypot(dx, dy) || 1
        const maxOffset = 2.6
        const k = Math.min(1, dist / 260) * (maxOffset / dist)
        setOffset({ x: dx * k, y: dy * k })
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [trackCursor, reducedMotion])

  const eyeState = peeking ? 'peek' : passwordFocused ? 'closed' : 'open'
  const leftShape  = eyeState === 'open' ? 'open' : 'closed'
  const rightShape = eyeState === 'closed' ? 'closed' : 'open'
  const activeOffset = (trackCursor && eyeState !== 'closed') ? offset : { x:0, y:0 }
  const wrapW = size * MASCOT_RATIO

  return (
    <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
      {showGlow && (
        <div className={reducedMotion ? '' : 'glow-pulse'}
             style={{ position:'absolute', width:size, height:size, borderRadius:'50%', background:'rgba(255,255,255,0.22)', filter:`blur(${Math.round(size*0.19)}px)`, pointerEvents:'none' }}/>
      )}
      <div ref={wrapRef}
           className={[reducedMotion ? '' : 'mascot-float', shake ? 'mascot-shake' : '', hop ? 'mascot-hop' : ''].filter(Boolean).join(' ')}
           style={{ position:'relative', width:wrapW, height:size }}>
        <img src="/roboticon.png" alt="Gapuz Logo" style={{ width:'100%', height:'100%', objectFit:'contain', display:'block',
             filter: size > 150 ? 'drop-shadow(0 20px 34px rgba(0,0,0,0.28))' : 'drop-shadow(0 6px 10px rgba(0,0,0,0.2))' }}/>
        <MascotEye xPercent={EYE_L_X} shape={leftShape} offset={activeOffset}/>
        <MascotEye xPercent={EYE_R_X} shape={rightShape} offset={activeOffset}/>
      </div>
    </div>
  )
}

export default function Login() {
  useDocumentTitle()
  const [username, setUsername]         = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading,  setLoading]          = useState(false)
  const [forgotOpen, setForgotOpen]     = useState(false)
  const [resetEmail, setResetEmail]     = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [pageLoading, setPageLoading]   = useState(true)
  const [loginError, setLoginError]     = useState('')
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [peeking, setPeeking]           = useState(false)
  const [mascotShake, setMascotShake]   = useState(false)
  const [mascotHop, setMascotHop]       = useState(false)
  const [formShake, setFormShake]       = useState(false)
  const { login, requestPasswordReset } = useAuthStore()
  const { theme } = useAppStore()
  const isLight = theme === 'light'
  const navigate = useNavigate()
  const toast    = useToast()
  const t        = useT()
  const isMobile = useLoginMobile()
  const reducedMotion = usePrefersReducedMotion()
  const peekTimerRef = useRef(null)

  useEffect(()=>{ const timer = setTimeout(()=>setPageLoading(false), 300); return ()=>clearTimeout(timer) },[])

  // Quick shake reaction whenever a new login error appears.
  useEffect(() => {
    if (!loginError) return
    setMascotShake(true)
    setFormShake(true)
    const timer = setTimeout(() => { setMascotShake(false); setFormShake(false) }, 500)
    return () => clearTimeout(timer)
  }, [loginError])

  useEffect(() => () => clearTimeout(peekTimerRef.current), [])

  if (pageLoading) return <LoginSkeleton/>

  const handleLogin = async (u = username, p = password) => {
    if (!u || !p) return toast('Please enter your email and password', 'error')
    setLoginError('')
    setLoading(true)
    const { ok, error } = await login(u, p)
    if (ok) {
      setMascotHop(true)
      toast('Welcome back!', 'success')
      setTimeout(() => navigate('/pos'), 480)
      return
    }
    else if (error?.message?.toLowerCase().includes('banned')) {
      setLoginError('This account has been suspended. Contact your administrator.')
    } else {
      setLoginError('Invalid email or password')
    }
    setLoading(false)
  }

  const handleTogglePassword = () => {
    setShowPassword(s => !s)
    setPeeking(true)
    clearTimeout(peekTimerRef.current)
    peekTimerRef.current = setTimeout(() => setPeeking(false), 900)
  }

  const openForgot = () => { setResetEmail(''); setForgotOpen(true) }

  const handleForgotSubmit = async () => {
    if (!resetEmail.trim()) return toast('Please enter your email', 'error')
    setResetLoading(true)

    // Always proceed the same way whether or not the email is registered —
    // Supabase silently no-ops resetPasswordForEmail for unknown emails rather
    // than erroring, so this never reveals which emails have accounts.
    const { error } = await requestPasswordReset(resetEmail)
    setResetLoading(false)
    if (error) return toast(error.message || 'Could not send reset email', 'error')
    toast('Password reset link sent — check your email', 'success')
    setForgotOpen(false)
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:isMobile?'column':'row', background:'var(--bg)', overflow:isMobile?'visible':'hidden' }}>

      {/* Left panel — branding (hidden entirely below 768px) */}
      {!isMobile && (
        <div style={{
          flex:'7', display:'flex', flexDirection:'column',
          background:'linear-gradient(155deg, var(--accent) 0%, var(--accent2) 100%)',
          position:'relative', overflow:'hidden', padding:48,
        }}>
          {/* Decorative glows */}
          <div style={{ position:'absolute', width:380, height:380, borderRadius:'50%', background:'rgba(255,255,255,0.14)', filter:'blur(80px)', top:-140, right:-120, pointerEvents:'none' }}/>
          <div style={{ position:'absolute', width:320, height:320, borderRadius:'50%', background:'rgba(0,0,0,0.12)', filter:'blur(90px)', bottom:-140, left:-100, pointerEvents:'none' }}/>
          {/* Dot-grid texture */}
          <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1.5px)', backgroundSize:'22px 22px', pointerEvents:'none' }}/>

          {/* Decorative tech icons */}
          {DECOR_ICONS.map((d, i) => (
            <DecorIcon key={i} size={d.size} style={d.style}>{d.paths}</DecorIcon>
          ))}

          {/* Content */}
          <div style={{ position:'relative', flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:26 }}>
            <Mascot size={320} trackCursor showGlow
                    passwordFocused={passwordFocused} peeking={peeking}
                    shake={mascotShake} hop={mascotHop} reducedMotion={reducedMotion}/>

            <div style={{ textAlign:'center' }}>
              <div className="login-stagger" style={{ animationDelay:'.05s' }}>
                <div style={{ fontSize:32, fontWeight:900, color:'#0a0a0a', letterSpacing:'-.2px', lineHeight:1.3 }}>GAPUZ COMPUTER</div>
                <div style={{ fontSize:32, fontWeight:900, color:'#0a0a0a', letterSpacing:'-.2px', lineHeight:1.3 }}>SERVICES</div>
              </div>
              <div className="login-stagger" style={{ fontSize:13.5, color:'var(--accent-dark)', opacity:0.88, marginTop:9, fontWeight:700, letterSpacing:'1px', animationDelay:'.18s' }}>& ACCESSORIES</div>
            </div>
          </div>
        </div>
      )}

      {/* Right panel — login form */}
      <div style={{
        width: isMobile ? '100%' : undefined, flex: isMobile ? 1 : '3',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        background:'var(--bg2)', padding: isMobile ? '32px 16px' : 48,
        position:'relative',
      }}>

        {/* Curved seam between the green and white panels, for a softer, modern divide */}
        {!isMobile && (
          <svg viewBox="0 0 140 100" preserveAspectRatio="none" aria-hidden="true"
               style={{ position:'absolute', top:0, left:-139, width:140, height:'100%', pointerEvents:'none' }}>
            <path d="M60,0 C92,25 28,75 60,100 L140,100 L140,0 Z" style={{ fill:'var(--bg2)' }}/>
          </svg>
        )}


        <div style={{ width:'100%', maxWidth:360 }}>

          {/* Mascot logo, left-aligned above the heading */}
          <div className="login-stagger" style={{ marginBottom:6 }}>
            <img src="/roboticon2-cropped.png" alt="Gapuz Logo" className={reducedMotion ? '' : 'mascot-float'}
                 style={{ height:42, width:'auto', display:'block', objectFit:'contain' }}/>
          </div>

          {/* Heading */}
          <div className="login-stagger" style={{ marginBottom:28, textAlign:'left' }}>
            <div style={{ fontSize:25, fontWeight:900, color:'var(--text)', letterSpacing:'-.5px', marginBottom:6 }}>
              {getGreeting()}
            </div>
            <div className="login-stagger" style={{ fontSize:13, color:'var(--text2)', animationDelay:'.08s' }}>Sign in to access the POS system</div>
          </div>

          {/* Fields */}
          <div className="login-stagger" style={{ animationDelay:'.16s' }}>
            <div className={formShake ? 'form-shake' : ''} style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:20 }}>
              <div className="login-field">
                <label htmlFor="login-email" className="login-label" style={{ display:'block', fontSize:11.5, fontWeight:700, marginBottom:8, textTransform:'uppercase', letterSpacing:'.7px' }}>Email</label>
                <input id="login-email" className="input-field login-input" type="email" value={username}
                       onChange={e=>{ setUsername(e.target.value); if (loginError) setLoginError('') }}
                       placeholder="Enter your email"
                       onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
              </div>
              <div className="login-field">
                <label htmlFor="login-password" className="login-label" style={{ display:'block', fontSize:11.5, fontWeight:700, marginBottom:8, textTransform:'uppercase', letterSpacing:'.7px' }}>Password</label>
                <div style={{ position:'relative' }}>
                  <input id="login-password" className="input-field login-input" type={showPassword?'text':'password'} value={password}
                         onChange={e=>{ setPassword(e.target.value); if (loginError) setLoginError('') }}
                         onFocus={()=>setPasswordFocused(true)}
                         onBlur={()=>setPasswordFocused(false)}
                         placeholder="Enter your password"
                         style={{ paddingRight:38 }}
                         onKeyDown={e=>e.key==='Enter'&&handleLogin()}/>
                  <button type="button" onClick={handleTogglePassword} aria-label={showPassword?'Hide password':'Show password'}
                          style={{ position:'absolute', right:4, top:'50%', transform:'translateY(-50%)', width:28, height:28, border:'none', background:'transparent', color:'var(--text3)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {showPassword ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                        <line x1="2" y1="2" x2="22" y2="22"/>
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                <div style={{ textAlign:'right', marginTop:10 }}>
                  <button type="button" onClick={openForgot} style={{ background:'none', border:'none', color:BRAND_GREEN, fontSize:12, fontWeight:600, cursor:'pointer', padding:0 }}>
                    Forgot password?
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button onClick={()=>handleLogin()} disabled={loading} className="btn-primary login-submit login-stagger" style={{ width:'100%', height:44, padding:'0 16px', fontSize:14, animationDelay:'.24s' }}>
            {loading ? (
              <>
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-9-9"/>
                </svg>
                Signing in...
              </>
            ) : (
              <>
                Sign In
                <span className="login-arrow">→</span>
              </>
            )}
          </button>

          {/* Reserved-height error slot so a failed login never shifts the layout */}
          <div style={{ minHeight:20, marginTop:12 }}>
            {loginError && (
              <div role="alert" className="error-fade-in" style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, fontWeight:600, color: isLight ? '#dc2626' : 'var(--red)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12.5"/>
                  <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"/>
                </svg>
                {loginError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Forgot password modal */}
      {forgotOpen&&(
        <Modal open onClose={()=>setForgotOpen(false)} contentStyle={{ width:'min(360px,92vw)' }}>
          <div className="card animate-scale-in" style={{ padding:28 }}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>Reset your password</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:18, lineHeight:1.5 }}>Enter your account email and we'll send you a link to set a new password.</div>
            <label htmlFor="reset-email" style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--text3)', marginBottom:7, textTransform:'uppercase', letterSpacing:'.6px' }}>Email</label>
            <input id="reset-email" className="input-field" type="email" value={resetEmail}
                   onChange={e=>setResetEmail(e.target.value)}
                   placeholder="you@example.com"
                   onKeyDown={e=>e.key==='Enter'&&handleForgotSubmit()}/>
            <div style={{ display:'flex', gap:10, marginTop:20 }}>
              <button onClick={()=>setForgotOpen(false)} className="btn-secondary" style={{ flex:1 }}>{t('cancel')}</button>
              <button onClick={handleForgotSubmit} disabled={resetLoading} className="btn-primary" style={{ flex:1 }}>
                {resetLoading ? 'Sending...' : 'Send Link'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

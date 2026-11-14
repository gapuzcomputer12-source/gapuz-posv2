import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react'
const ToastCtx = createContext(null)
const ToastListCtx = createContext(null)
let _id = 0

// Per-type default duration (ms) when a call site doesn't pass one
// explicitly — e.g. toast('X added', 'success', 1500) for an "added to
// cart" toast, which needs to clear fast since cart adds happen rapidly.
const DEFAULT_DURATION = { success: 3000, error: 5000, info: 3000, warning: 3000 }

// Toasts need to render centered over different regions depending on the
// page: the POS page excludes its cart panel, every other page excludes
// the sidebar, and the two pre-login pages have no sidebar at all. A
// single globally-fixed div can't do that without measuring layout in JS,
// so this provider only holds STATE (the toast queue) — the actual
// visible stack is <ToastViewport/> below, which callers place as a child
// of whichever box they want it centered within (see Layout.jsx, POS.jsx,
// Login.jsx, ResetPassword.jsx). Exactly one ToastViewport should be
// mounted at a time, matching whichever page is currently showing.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const addToast = useCallback((message, type='info', duration) => {
    const id = ++_id
    const resolved = duration ?? DEFAULT_DURATION[type] ?? 3000
    setToasts(t => {
      // Same message+type firing again (e.g. adding the same product to
      // the cart several times in a row) replaces the existing toast
      // instead of stacking a duplicate — the old one's pending removal
      // timeout below just no-ops once its id is no longer in the array.
      const deduped = t.filter(x => !(x.message === message && x.type === type))
      // Max 3 visible at once — a 4th drops the oldest.
      return [...deduped, { id, message, type }].slice(-3)
    })
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), resolved)
  },[])
  const dismiss = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), [])
  return (
    <ToastCtx.Provider value={addToast}>
      <ToastListCtx.Provider value={{ toasts, dismiss }}>
        {children}
      </ToastListCtx.Provider>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

const ICONS = {success:CheckCircle2,error:XCircle,info:Info,warning:AlertTriangle}
const COLORS = {
  success:{border:'rgba(34,197,94,0.3)', color:'var(--green)'},
  error:  {border:'rgba(239,68,68,0.3)',color:'var(--red)'},
  info:   {border:'rgba(52,211,153,0.3)', color:'var(--accent)'},
  warning:{border:'rgba(245,158,11,0.3)', color:'var(--yellow)'},
}

// Bottom-center toast stack. Must be rendered inside a position:relative
// (or position:absolute) ancestor — it centers itself within THAT box via
// position:absolute, not the viewport, so wherever it's placed defines
// what it's centered over. Stacks upward from `bottomOffset` as more
// toasts arrive (its own box only grows as tall as its content, anchored
// at the bottom, same as the array's insertion order: oldest at the top
// of the stack, newest nearest the bottom anchor). The box itself ignores
// pointer events — only the individual toast pills (which opt back in)
// can block or receive clicks, so nothing outside a toast is ever blocked.
export function ToastViewport({ bottomOffset = 24 }) {
  const { toasts, dismiss } = useContext(ToastListCtx)
  return (
    <div style={{
      position:'absolute', bottom:bottomOffset, left:'50%', transform:'translateX(-50%)',
      display:'flex', flexDirection:'column', alignItems:'stretch', gap:8, zIndex:9999,
      width:'min(380px, calc(100vw - 32px))', pointerEvents:'none',
    }}>
      {toasts.map(t=>{
        const Icon = ICONS[t.type]
        return (
          <div key={t.id} onClick={()=>dismiss(t.id)} title="Dismiss" className="animate-slide-in" style={{
            display:'flex',alignItems:'center',gap:10,padding:'11px 16px',
            borderRadius:6,fontSize:13,boxShadow:'0 2px 8px rgba(0,0,0,0.25)',
            background:'var(--bg2)',border:`1px solid ${COLORS[t.type]?.border}`,
            cursor:'pointer', pointerEvents:'auto',
          }}>
            <Icon size={16} style={{color:COLORS[t.type]?.color,flexShrink:0}}/>
            <span style={{color:'var(--text)',fontWeight:400}}>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

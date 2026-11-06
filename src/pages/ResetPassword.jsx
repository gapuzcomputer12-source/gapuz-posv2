import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import { useToast } from '../utils/toast'
import { supabase } from '../lib/supabaseClient'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Module-scoped so the verification survives React StrictMode's dev-only double
// effect invocation (mount → cleanup → remount) — without this, the second
// invocation re-sends the same one-time token, which Supabase has already
// consumed, and reports the link as invalid even though it was never actually bad.
let verifyInFlight = null

export default function ResetPassword() {
  useDocumentTitle('Reset Password')
  const [password, setPassword]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading]                 = useState(false)
  const [status, setStatus]                   = useState('verifying') // 'verifying' | 'ready' | 'invalid'
  const { updatePassword } = useAuthStore()
  const navigate = useNavigate()
  const toast    = useToast()

  // The email link carries a one-time token_hash — supabase-js has to verify
  // that for an actual session before updateUser() will work. Without this, submitting
  // the form fails with "Auth session missing!" even though the link itself was valid.
  // Uses verifyOtp (not the PKCE exchangeCodeForSession) specifically so the link also
  // works when opened on a different device/browser than the one that requested it —
  // PKCE requires a secret stored on the requesting device, which checking email on
  // your phone (say) won't have.
  useEffect(() => {
    let settled = false
    const finish = (ok) => { if (!settled) { settled = true; setStatus(ok ? 'ready' : 'invalid') } }

    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const type = params.get('type')
    if (tokenHash && type) {
      if (!verifyInFlight || verifyInFlight.tokenHash !== tokenHash) {
        verifyInFlight = { tokenHash, promise: supabase.auth.verifyOtp({ token_hash: tokenHash, type }) }
      }
      verifyInFlight.promise.then(({ error }) => finish(!error))
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) finish(true)
    })
    const timeout = setTimeout(() => finish(false), 5000)

    return () => { settled = true; sub.subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  const handleSubmit = async () => {
    if (!password || !confirmPassword) return toast('Please fill in both fields', 'error')
    if (password.length < 6) return toast('Password must be at least 6 characters', 'error')
    if (password !== confirmPassword) return toast('Passwords do not match', 'error')
    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)
    if (error) return toast(error.message || 'Could not update password — the reset link may have expired', 'error')
    toast('Password updated — please sign in again', 'success')
    navigate('/login')
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', padding:16 }}>
      <div className="card animate-scale-in" style={{ width:'min(380px,92vw)', padding:32 }}>

        {status==='verifying' && (
          <>
            <div style={{ fontSize:20, fontWeight:900, color:'var(--text)', letterSpacing:'-.5px', marginBottom:6 }}>Verifying your link…</div>
            <div style={{ fontSize:12.5, color:'var(--text2)' }}>Hang on while we confirm your password reset link.</div>
          </>
        )}

        {status==='invalid' && (
          <>
            <div style={{ fontSize:20, fontWeight:900, color:'var(--red)', letterSpacing:'-.5px', marginBottom:6 }}>This link is invalid or expired</div>
            <div style={{ fontSize:12.5, color:'var(--text2)', marginBottom:24 }}>Password reset links only work once and expire after a while. Go back to the login page and request a new one.</div>
            <button onClick={()=>navigate('/login')} className="btn-primary" style={{ width:'100%', padding:13, fontSize:14 }}>Back to Login</button>
          </>
        )}

        {status==='ready' && <>
          <div style={{ fontSize:20, fontWeight:900, color:'var(--text)', letterSpacing:'-.5px', marginBottom:6 }}>Set a new password</div>
          <div style={{ fontSize:12.5, color:'var(--text2)', marginBottom:24 }}>Choose a new password for your account.</div>

          <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:24 }}>
            <div>
              <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--text3)', marginBottom:7, textTransform:'uppercase', letterSpacing:'.6px' }}>New Password</label>
              <input className="input-field" type="password" value={password}
                     onChange={e=>setPassword(e.target.value)}
                     placeholder="At least 6 characters"
                     onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>
            </div>
            <div>
              <label style={{ display:'block', fontSize:10, fontWeight:700, color:'var(--text3)', marginBottom:7, textTransform:'uppercase', letterSpacing:'.6px' }}>Confirm Password</label>
              <input className="input-field" type="password" value={confirmPassword}
                     onChange={e=>setConfirmPassword(e.target.value)}
                     placeholder="Re-enter password"
                     onKeyDown={e=>e.key==='Enter'&&handleSubmit()}/>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={loading} className="btn-primary" style={{ width:'100%', padding:13, fontSize:14 }}>
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </>}
      </div>
    </div>
  )
}

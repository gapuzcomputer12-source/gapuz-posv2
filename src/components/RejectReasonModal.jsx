import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// Shared "why is this being rejected" modal — same quick-pick chips + reason
// textarea for both Refunds (RefundDetailsModal) and Returns
// (ReturnDetailsModal), since an admin may be rejecting remotely and the
// cashier needs to see exactly why either way. Owns its own saving/error
// state: onConfirm(reason) does the actual network call and returns
// {error} on failure (or nothing on success) — the modal stays open and
// shows the error inline on failure, closes itself on success.
const QUICK_REASONS = [
  'Past the 7-day limit',
  'Item damaged by customer',
  "Serial number doesn't match our records",
  'Missing parts, box or accessories',
  'No valid reason / not covered by policy',
  'Service already completed',
]

const MIN_LEN = 5
const MAX_LEN = 300

export default function RejectReasonModal({ open, onClose, onConfirm, idLabel }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  // Ref guard, not just `saving` state — two rapid clicks on Confirm
  // Reject can both pass a state check before React re-renders the
  // disabled button; the ref is checked and set synchronously so only the
  // first click's request ever fires.
  const submittingRef = useRef(false)

  useEffect(() => { if (open) { setReason(''); setSaving(false); setErrorMsg(''); submittingRef.current = false } }, [open])

  if (!open) return null

  const trimmed = reason.trim()
  const valid = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN

  const handleConfirm = async () => {
    if (!valid || submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setErrorMsg('')
    try {
      const result = await onConfirm(trimmed)
      if (result?.error) { setErrorMsg(result.error.message || 'Failed to reject — please try again'); return }
      onClose()
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} closeOnBackdrop={!saving} closeOnEsc={!saving} contentStyle={{ width: 'min(460px,94vw)', maxHeight: '90vh' }}>
      <div className="card animate-scale-in" style={{ maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--red)' }}>Reject Request #{idLabel}</div>
          <button onClick={() => !saving && onClose()} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg3)', color: 'var(--text3)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Quick reasons</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_REASONS.map(q => (
                <button key={q} type="button" disabled={saving} onClick={() => setReason(q)} style={{
                  padding: '6px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: saving ? 'default' : 'pointer', textAlign: 'left',
                  border: `1px solid ${reason === q ? 'var(--red)' : 'var(--border2)'}`,
                  background: reason === q ? 'rgba(239,68,68,0.1)' : 'var(--bg3)',
                  color: reason === q ? 'var(--red)' : 'var(--text2)',
                }}>{q}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Reason for rejection *
            </label>
            <textarea className="input-field" rows={4} maxLength={MAX_LEN} disabled={saving} style={{ resize: 'none' }}
              placeholder="Explain why this request is being rejected…"
              value={reason} onChange={e => setReason(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: 'var(--text3)' }}>
              <span>{trimmed.length < MIN_LEN ? `At least ${MIN_LEN} characters` : ''}</span>
              <span>{reason.length}/{MAX_LEN}</span>
            </div>
          </div>

          {errorMsg && (
            <div style={{ fontSize: 11.5, color: 'var(--red)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 10px' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={() => !saving && onClose()} disabled={saving} className="btn-secondary">Cancel</button>
          <button onClick={handleConfirm} disabled={!valid || saving} className="btn-danger" style={{ opacity: (!valid || saving) ? 0.5 : 1, cursor: (!valid || saving) ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Rejecting…' : 'Confirm Reject'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

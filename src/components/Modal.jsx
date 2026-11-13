import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Every modal in the app renders through here, via a portal straight onto
// document.body — escaping whatever stacking context its page markup
// happens to sit in. This matters because `position:sticky` (e.g. the
// Refunds/Returns left form panel, .form-panel in index.css) always
// creates its own stacking context per spec, even with z-index:auto — so a
// modal rendered as a descendant of a sticky panel had its backdrop and
// z-index trapped inside that panel's local stacking order, letting later
// DOM siblings (a table's Pagination controls) and the sidebar (its own
// explicit z-index) paint on top of what looked like a full-screen overlay.
// Rendering outside the whole page tree sidesteps that entirely.
export const MODAL_Z = 1000

// Shared body-scroll lock with a counter, not a plain boolean — so closing
// an inner modal (e.g. the image viewer opened from inside a return/refund
// details modal, or the reject-reason modal opened from inside one) never
// releases the lock early while an outer modal is still open.
let lockCount = 0
let savedOverflow = ''
function lockScroll() {
  if (lockCount === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  lockCount++
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) document.body.style.overflow = savedOverflow
}

export default function Modal({
  open, onClose, children,
  closeOnBackdrop = true, closeOnEsc = true,
  backdropStyle, contentStyle,
}) {
  useEffect(() => {
    if (!open) return
    lockScroll()
    return unlockScroll
  }, [open])

  useEffect(() => {
    if (!open || !closeOnEsc) return
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEsc, onClose])

  if (!open) return null

  return createPortal(
    <div
      onClick={e => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: MODAL_Z,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        ...backdropStyle,
      }}
    >
      <div style={{ position: 'relative', zIndex: MODAL_Z + 1, ...contentStyle }}>
        {children}
      </div>
    </div>,
    document.body
  )
}

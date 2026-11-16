import { useEffect, useRef, useState } from 'react'
import { X, Check, Search } from 'lucide-react'
import { useBreakpoint } from '../utils/helpers'

// Border-flash color per result tone — richFeedback mode only (see submit()
// below). 'duplicate' covers an "already in cart" style result; anything
// else falls back to the plain ok/!ok green/red a caller not using tones
// still gets.
const FLASH_COLOR = { success: 'var(--green)', duplicate: 'var(--yellow)', error: 'var(--red)' }

// Reusable everywhere a serial number or barcode is entered. A USB barcode
// scanner just types the code and sends Enter, so a plain autofocused input
// that submits on Enter works with it directly.
//
// onScan(trimmedValue) may return a result ({ok, message}, optionally with
// a `tone` of 'success'/'duplicate'/'error') synchronously or as a
// Promise; if it does, that result is shown as brief inline feedback under
// the input. Returning nothing just submits silently.
//
// richFeedback opts into a different contract for one caller (POS's main
// search/scan input) that wants its own richer result pill instead of this
// component's plain text line: when true, the text feedback below is
// suppressed entirely, the result is instead handed to onResult(result),
// and the input's border still gets a brief 600ms flash in the result's
// tone color. Every other ScanInput usage leaves richFeedback/onResult
// unset and is completely unaffected by any of this.
export default function ScanInput({
  onScan, onChange, value: controlledValue, placeholder = 'Scan or type a code, then Enter…',
  autoFocus = true, clearOnScan = true, disabled = false, style, inputRef: externalRef,
  submitLabel = 'Search', submitIcon: SubmitIcon = Search,
  richFeedback = false, onResult,
}) {
  const isControlled = controlledValue !== undefined
  const [internalValue, setInternalValue] = useState('')
  const value = isControlled ? controlledValue : internalValue
  const setValue = (v) => { if (!isControlled) setInternalValue(v); onChange?.(v) }
  const [feedback, setFeedback] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [borderFlash, setBorderFlash] = useState(null)
  const ownRef = useRef()
  const inputRef = externalRef || ownRef
  const feedbackTimer = useRef()
  const flashTimer = useRef()
  const { isMobile } = useBreakpoint()

  useEffect(() => () => { clearTimeout(feedbackTimer.current); clearTimeout(flashTimer.current) }, [])

  // Shared by the Enter key and the submit button — one lookup/validate path.
  const submit = async (raw) => {
    if (submitting) return
    const trimmed = (raw || '').trim()
    if (!trimmed) return
    if (clearOnScan) setValue('')
    setSubmitting(true)
    const result = await onScan?.(trimmed)
    setSubmitting(false)
    if (result) {
      if (richFeedback) {
        const tone = result.tone || (result.ok ? 'success' : 'error')
        clearTimeout(flashTimer.current)
        setBorderFlash(tone)
        flashTimer.current = setTimeout(() => setBorderFlash(null), 600)
        onResult?.(result)
      } else {
        setFeedback(result)
        clearTimeout(feedbackTimer.current)
        feedbackTimer.current = setTimeout(() => setFeedback(null), 2500)
      }
    }
    inputRef.current?.focus()
  }

  const handleChange = (e) => setValue(e.target.value)
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(value) } }
  const submitDisabled = disabled || submitting || !value.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center', opacity: 0.6 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <input
            ref={inputRef} autoFocus={autoFocus} disabled={disabled} className="input-field"
            style={{ width: '100%', paddingLeft: 40, ...(borderFlash ? { borderColor: FLASH_COLOR[borderFlash] } : {}) }}
            placeholder={placeholder} value={value}
            onChange={handleChange} onKeyDown={handleKeyDown}
          />
        </div>
        <button type="button" onClick={() => submit(value)} disabled={submitDisabled}
          title={submitLabel}
          className="btn-primary"
          style={{ padding: isMobile ? '0 12px' : '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
          {submitting
            ? <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
            : <SubmitIcon size={14} />}
          {!isMobile && submitLabel}
        </button>
      </div>
      {!richFeedback && feedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: feedback.ok ? 'var(--green)' : 'var(--red)' }}>
          {feedback.ok ? <Check size={13} /> : <X size={13} />}{feedback.message}
        </div>
      )}
    </div>
  )
}

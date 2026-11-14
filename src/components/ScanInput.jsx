import { useEffect, useRef, useState } from 'react'
import { Camera, X, Check, AlertTriangle, Search } from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { acquireCamera, releaseCamera } from '../utils/cameraLock'
import { useBreakpoint } from '../utils/helpers'
import Modal from './Modal'

const READER_ID = 'scan-input-camera-reader'

// Border-flash color per result tone — richFeedback mode only (see submit()
// below). 'duplicate' covers an "already in cart" style result; anything
// else falls back to the plain ok/!ok green/red a caller not using tones
// still gets.
const FLASH_COLOR = { success: 'var(--green)', duplicate: 'var(--yellow)', error: 'var(--red)' }

// Full-screen camera scanner used by ScanInput's "Scan with camera" button.
// Tuned for the EMEET 4K AF USB webcam this app is used with, but any
// getUserMedia camera works — videoConstraints just ask for the best feed
// available and the browser falls back silently if a camera can't deliver it.
function CameraScanner({ onResult, onCancel }) {
  const [error, setError] = useState(null)

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(READER_ID)
    let stopped = false
    let lastCode = null
    let matchCount = 0
    // A single blurry/glare-y frame can decode to a plausible-looking but
    // wrong string — the first hit was being accepted immediately, which is
    // exactly how a one-off misread slips through as a "scanned" serial.
    // Requiring the same text twice in a row (two consecutive ~15fps
    // frames, ~130ms) filters that out: a genuine steady scan repeats the
    // same correct result frame after frame, but a fluke misread almost
    // never produces the identical wrong string twice back to back.
    const REQUIRED_MATCHES = 2

    // React.StrictMode double-invokes this effect in dev (mount → cleanup →
    // mount) to surface non-idempotent effects. Calling .stop() while
    // .start() is still opening the camera throws and skips .clear(),
    // leaving a dead <video> element stuck in the reader div — which is
    // exactly the "white screen" this was producing. Cleanup now always
    // waits for the start attempt to settle (success OR failure) before it
    // ever calls stop/clear, so there's never a stale element left behind.
    const startPromise = html5QrCode.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        qrbox: { width: 360, height: 140 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'environment',
          advanced: [{ focusMode: 'continuous' }],
        },
      },
      (decodedText) => {
        if (stopped) return
        if (decodedText === lastCode) {
          matchCount += 1
        } else {
          lastCode = decodedText
          matchCount = 1
        }
        if (matchCount < REQUIRED_MATCHES) return
        stopped = true
        releaseCamera(stopSelf)
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {}).finally(() => onResult(decodedText))
      },
      () => { /* per-frame "no code found" — not an error, ignore */ }
    )

    // If the evidence-photo camera modal (or anything else sharing the
    // camera lock) takes over while this is open, it calls stopSelf() —
    // this both releases the hardware AND closes this scanner's own UI
    // (onCancel), rather than leaving a frozen preview on screen.
    const stopSelf = () => {
      if (stopped) return
      stopped = true
      startPromise.then(() => html5QrCode.stop().then(() => html5QrCode.clear())).catch(() => {})
      onCancel()
    }
    acquireCamera(stopSelf)

    startPromise.catch((err) => setError(err?.message || 'Could not start the camera'))

    return () => {
      releaseCamera(stopSelf)
      if (stopped) return
      stopped = true
      startPromise
        .then(() => html5QrCode.stop().then(() => html5QrCode.clear()))
        .catch(() => {})
    }
  }, [onResult, onCancel])

  return (
    <Modal open onClose={onCancel} closeOnBackdrop={false} contentStyle={{ width: 'min(480px,94vw)' }}>
      <div className="card animate-scale-in" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Camera size={15} style={{ color: 'var(--accent)' }} />Scan with camera</div>
          <button onClick={onCancel} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div id={READER_ID} style={{ width: '100%', minHeight: 240, borderRadius: 10, overflow: 'hidden', background: '#000' }} />
        {error ? (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} />{error}</div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text3)', textAlign: 'center' }}>Point the camera at a barcode or serial label</div>
        )}
        <button onClick={onCancel} className="btn-secondary" style={{ width: '100%', marginTop: 14, padding: 10 }}>Cancel</button>
      </div>
    </Modal>
  )
}

// Reusable everywhere a serial number or barcode is entered. A USB barcode
// scanner just types the code and sends Enter, so a plain autofocused input
// that submits on Enter already works with it for free — the camera button
// is the fallback for devices without a USB scanner attached.
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
  const [cameraOpen, setCameraOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [borderFlash, setBorderFlash] = useState(null)
  const ownRef = useRef()
  const inputRef = externalRef || ownRef
  const feedbackTimer = useRef()
  const flashTimer = useRef()
  const { isMobile } = useBreakpoint()

  useEffect(() => () => { clearTimeout(feedbackTimer.current); clearTimeout(flashTimer.current) }, [])

  // Shared by the Enter key, the camera result, and the submit button below
  // — one lookup/validate path no matter how the code got into the input.
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
  const handleCameraResult = (code) => { setCameraOpen(false); submit(code) }
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
        <button type="button" onClick={() => setCameraOpen(true)} disabled={disabled}
          title="Scan with camera"
          style={{ padding: '0 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
          <Camera size={14} />
        </button>
      </div>
      {!richFeedback && feedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: feedback.ok ? 'var(--green)' : 'var(--red)' }}>
          {feedback.ok ? <Check size={13} /> : <X size={13} />}{feedback.message}
        </div>
      )}
      {cameraOpen && <CameraScanner onResult={handleCameraResult} onCancel={() => setCameraOpen(false)} />}
    </div>
  )
}

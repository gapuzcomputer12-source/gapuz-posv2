import { useEffect, useRef, useState } from 'react'
import { Camera, X, Check, AlertTriangle } from 'lucide-react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { acquireCamera, releaseCamera } from '../utils/cameraLock'
import Modal from './Modal'

const READER_ID = 'scan-input-camera-reader'

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
        // Ignore repeat reads of the same code while the camera keeps scanning
        // the same label (would otherwise fire dozens of times per second).
        if (stopped || decodedText === lastCode) return
        lastCode = decodedText
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
// onScan(trimmedValue) may return a result ({ok, message}) synchronously or
// as a Promise; if it does, that result is shown as brief inline feedback
// under the input. Returning nothing just submits silently.
export default function ScanInput({
  onScan, onChange, value: controlledValue, placeholder = 'Scan or type a code, then Enter…',
  autoFocus = true, clearOnScan = true, disabled = false, style, inputRef: externalRef,
}) {
  const isControlled = controlledValue !== undefined
  const [internalValue, setInternalValue] = useState('')
  const value = isControlled ? controlledValue : internalValue
  const setValue = (v) => { if (!isControlled) setInternalValue(v); onChange?.(v) }
  const [feedback, setFeedback] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const ownRef = useRef()
  const inputRef = externalRef || ownRef
  const feedbackTimer = useRef()

  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  const submit = async (raw) => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return
    if (clearOnScan) setValue('')
    const result = await onScan?.(trimmed)
    if (result) {
      setFeedback(result)
      clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setFeedback(null), 2500)
    }
    inputRef.current?.focus()
  }

  const handleChange = (e) => setValue(e.target.value)
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(value) } }
  const handleCameraResult = (code) => { setCameraOpen(false); submit(code) }

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
            style={{ width: '100%', paddingLeft: 40 }} placeholder={placeholder} value={value}
            onChange={handleChange} onKeyDown={handleKeyDown}
          />
        </div>
        <button type="button" onClick={() => setCameraOpen(true)} disabled={disabled}
          title="Scan with camera"
          style={{ padding: '0 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
          <Camera size={14} />
        </button>
      </div>
      {feedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: feedback.ok ? 'var(--green)' : 'var(--red)' }}>
          {feedback.ok ? <Check size={13} /> : <X size={13} />}{feedback.message}
        </div>
      )}
      {cameraOpen && <CameraScanner onResult={handleCameraResult} onCancel={() => setCameraOpen(false)} />}
    </div>
  )
}

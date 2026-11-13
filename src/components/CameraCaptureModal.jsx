import { useEffect, useRef, useState } from 'react'
import { X, Camera, RotateCcw, Check, AlertTriangle } from 'lucide-react'
import { canvasToBlob } from '../utils/compressImage'
import { acquireCamera, releaseCamera } from '../utils/cameraLock'
import Modal from './Modal'

const STORAGE_KEY = 'gapuz-evidence-camera-device'
const getSavedDeviceId = () => { try { return localStorage.getItem(STORAGE_KEY) || null } catch { return null } }
const saveDeviceId = (id) => { try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode etc. — just skip remembering it */ } }

function requestStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment',
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  })
}

function friendlyCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError': return 'Camera permission blocked. Click the camera icon in the address bar and allow access.'
    case 'NotFoundError': return 'No camera found. Plug in a webcam or use Upload from Files.'
    case 'NotReadableError': return 'Camera is being used by another app (Zoom, Messenger, etc.). Close it and try again.'
    default: return err?.message || 'Could not start the camera.'
  }
}

// Live in-page camera (getUserMedia — same mechanism as the barcode
// scanner, see ScanInput.jsx) for evidence photos, so it works on desktop
// webcams too, not just phones (unlike <input capture>, which only phones
// honor). onCapture(blob) is called once per "Use Photo" — the caller
// (EvidencePhotoPicker) runs that blob through the exact same
// compressImage -> upload pipeline a file-picker photo goes through; this
// component only ever produces a raw captured-frame Blob, nothing more.
export default function CameraCaptureModal({ open, onClose, onCapture, maxCaptures = 3 }) {
  const [phase, setPhase] = useState('starting') // starting | live | review | error
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [capturedCount, setCapturedCount] = useState(0)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  const stopStream = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }
  const stopEverything = () => { stopStream(); onCloseRef.current() }

  const applyStream = async (stream) => {
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream
    setPhase('live')
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter(d => d.kind === 'videoinput'))
      const activeId = stream.getVideoTracks()[0]?.getSettings?.().deviceId
      if (activeId) { setSelectedDeviceId(activeId); saveDeviceId(activeId) }
    } catch { /* device listing is a nice-to-have, not required to use the camera */ }
  }

  const startCamera = async (deviceId) => {
    setPhase('starting'); setError(null); stopStream()
    try {
      const stream = await requestStream(deviceId)
      await applyStream(stream)
    } catch (err) {
      // A remembered device that's since been unplugged shouldn't dead-end
      // the whole feature — fall back to the default camera once.
      if (deviceId) {
        try { await applyStream(await requestStream(null)); return } catch (err2) { setPhase('error'); setError(friendlyCameraError(err2)); return }
      }
      setPhase('error'); setError(friendlyCameraError(err))
    }
  }

  useEffect(() => {
    if (!open) return
    acquireCamera(stopEverything)
    setCapturedCount(0)
    startCamera(getSavedDeviceId() || undefined)
    return () => { releaseCamera(stopEverything); stopStream() }
  }, [open])

  if (!open) return null

  const handleDeviceChange = (e) => {
    const id = e.target.value
    setSelectedDeviceId(id)
    saveDeviceId(id)
    startCamera(id)
  }

  const handleCaptureClick = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    setPhase('review')
  }

  const handleUsePhoto = async () => {
    const blob = await canvasToBlob(canvasRef.current, 0.92)
    onCapture(blob)
    const next = capturedCount + 1
    setCapturedCount(next)
    if (next >= maxCaptures) stopEverything()
    else setPhase('live')
  }

  const iconBtn = { width: 34, height: 34, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

  return (
    <Modal open={open} onClose={stopEverything} closeOnBackdrop={false} contentStyle={{ width: 'min(480px,94vw)', maxHeight: '90vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg2)', borderRadius: 14, overflow: 'hidden', maxHeight: '90vh' }}>

        {/* Header — close button always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Camera size={15} style={{ color: 'var(--accent)' }} />Take Photo
            {maxCaptures > 1 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace" }}>{capturedCount} / {maxCaptures}</span>}
          </div>
          <button onClick={stopEverything} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
        </div>

        {/* Camera / review area */}
        <div style={{ position: 'relative', width: '100%', height: 'min(50vh, 360px)', background: '#000', flexShrink: 0 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: phase === 'review' ? 'none' : 'block' }} />
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', display: phase === 'review' ? 'block' : 'none' }} />

          {phase === 'starting' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg className="animate-spin" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
            </div>
          )}

          {phase === 'error' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
              <AlertTriangle size={26} color="#f87171" />
              <div style={{ color: '#fff', fontSize: 12.5, lineHeight: 1.5 }}>{error}</div>
              <button onClick={() => startCamera(selectedDeviceId)} className="btn-secondary" style={{ padding: '6px 16px' }}>Try Again</button>
            </div>
          )}
        </div>

        {/* Device selector */}
        {phase !== 'error' && devices.length > 1 && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <select value={selectedDeviceId || ''} onChange={handleDeviceChange} className="select-field" style={{ width: '100%', fontSize: 12 }}>
              {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
            </select>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ padding: 16, display: 'flex', gap: 10, justifyContent: 'center', flexShrink: 0 }}>
          {phase === 'live' && (
            <button onClick={handleCaptureClick} className="btn-primary" style={{ padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Camera size={15} />Capture
            </button>
          )}
          {phase === 'review' && (
            <>
              <button onClick={() => setPhase('live')} className="btn-secondary" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 6 }}><RotateCcw size={14} />Retake</button>
              <button onClick={handleUsePhoto} className="btn-primary" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 6 }}><Check size={14} />Use Photo</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

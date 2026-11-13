import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react'
import Modal from './Modal'

// Full-screen image viewer shared by the cashier (local blob: previews,
// before upload — see EvidencePhotoPicker) and the admin (remote signed
// https: URLs, after upload — see ReturnDetailsModal). It doesn't care
// which kind of URL it's given, just that `images` is an array of plain
// url strings.
//
// Interactions, kept deliberately simple (no gesture library):
//   - click/tap the image: toggle 2x zoom
//   - drag (mouse or touch) while zoomed: pan
//   - swipe left/right while NOT zoomed (touch only): prev/next
//   - arrow keys / on-screen chevrons: prev/next · Esc: close
function fmtCounter(index, total) { return `${index + 1} / ${total}` }

export default function ImagePreviewModal({ open, onClose, images = [], startIndex = 0 }) {
  const [index, setIndex] = useState(startIndex)
  const [zoomed, setZoomed] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const dragRef = useRef(null)
  const touchRef = useRef(null)

  useEffect(() => { if (open) setIndex(Math.min(startIndex, Math.max(0, images.length - 1))) }, [open, startIndex])
  useEffect(() => { setZoomed(false); setPan({ x: 0, y: 0 }); setLoading(true); setLoadError(false) }, [index, open])

  const goPrev = () => setIndex(i => (i - 1 + images.length) % images.length)
  const goNext = () => setIndex(i => (i + 1) % images.length)

  // Escape-to-close and the body-scroll lock are handled by the shared
  // Modal wrapper below — this only needs the arrow-key navigation.
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, images.length])

  if (!open || images.length === 0) return null

  const url = images[index]
  const toggleZoom = () => { setZoomed(z => !z); setPan({ x: 0, y: 0 }) }

  const onPointerDown = e => { if (zoomed) dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y } }
  const onPointerMove = e => { if (zoomed && dragRef.current) setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }) }
  const onPointerUp = () => { dragRef.current = null }

  const onTouchStart = e => { touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = e => {
    const start = touchRef.current
    touchRef.current = null
    if (!start || zoomed || images.length < 2) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx > 0) goPrev(); else goNext() }
  }

  const iconBtn = { width: 36, height: 36, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

  return (
    <Modal open={open} onClose={onClose} closeOnBackdrop={false} backdropStyle={{ padding: 0 }} contentStyle={{ width: '100%', height: '100%' }}>
    <div
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {/* Header — close button always visible */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', flexShrink: 0 }}>
        <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{fmtCounter(index, images.length)}</div>
        <button onClick={onClose} aria-label="Close" style={iconBtn}><X size={18} /></button>
      </div>

      {/* Image area */}
      <div
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: zoomed ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onClick={toggleZoom}
      >
        {loading && !loadError && (
          <svg className="animate-spin" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ position: 'absolute' }}>
            <path d="M21 12a9 9 0 1 1-9-9" />
          </svg>
        )}

        {loadError ? (
          <div style={{ color: '#fff', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={28} style={{ opacity: 0.8 }} />
            <div style={{ fontSize: 13 }}>Image failed to load</div>
            <button
              onClick={e => { e.stopPropagation(); setLoadError(false); setLoading(true); setRetryKey(k => k + 1) }}
              className="btn-secondary" style={{ padding: '6px 16px' }}
            >Retry</button>
          </div>
        ) : (
          <img
            key={`${url}-${retryKey}`} src={url} alt="" draggable={false}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setLoadError(true) }}
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none',
              opacity: loading ? 0 : 1,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomed ? 2 : 1})`,
              transition: dragRef.current ? 'none' : 'transform .2s, opacity .15s',
              cursor: zoomed ? 'grab' : 'zoom-in',
            }}
          />
        )}

        {images.length > 1 && (
          <>
            <button onClick={e => { e.stopPropagation(); goPrev() }} aria-label="Previous" style={{ ...iconBtn, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}><ChevronLeft size={20} /></button>
            <button onClick={e => { e.stopPropagation(); goNext() }} aria-label="Next" style={{ ...iconBtn, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}><ChevronRight size={20} /></button>
          </>
        )}
      </div>
    </div>
    </Modal>
  )
}

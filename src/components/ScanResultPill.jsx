import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { peso } from '../utils/helpers'

// Solid, literal colors on purpose — this floats over the category chips
// like a dropdown, so it needs to read clearly regardless of the app's
// dark/light theme underneath it (no rgba/var(--*) backgrounds, which is
// what made the previous version see-through and hard to read against
// whatever was behind it).
const TONE = {
  success:   { bg: '#ecfdf5', border: '#10b981', iconColor: '#10b981', Icon: CheckCircle2 },
  duplicate: { bg: '#fffbeb', border: '#f59e0b', iconColor: '#f59e0b', Icon: Info },
  error:     { bg: '#fef2f2', border: '#ef4444', iconColor: '#ef4444', Icon: XCircle },
}
const TEXT_COLOR = '#111827'
const PRICE_COLOR = '#059669'

// Replaces the old plain "✓ Added" text under the POS search/scan input —
// and the toast that used to fire alongside a scan-add. Rendered by the
// parent as position:absolute, z-index above the category chips/product
// grid, directly under the search input — a dropdown-style overlay, not
// part of the normal page flow, so it never pushes anything down and
// never blocks clicks outside its own small box.
export default function ScanResultPill({ result, onDismiss }) {
  if (!result) return null
  const tone = TONE[result.tone] || TONE.error
  const { Icon } = tone

  return (
    <div role="status" aria-live="polite" className="scan-pill-enter" style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
      height: 40, borderRadius: 10, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px',
      background: tone.bg, border: `1px solid ${tone.border}`,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <Icon size={16} style={{ color: tone.iconColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 15, color: TEXT_COLOR }}>
        {result.tone === 'success' ? (
          <>
            Added: <strong>{result.product?.name}</strong>
            {result.serial && <> · SN: <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{result.serial}</span></>}
          </>
        ) : result.message}
      </div>
      {result.tone === 'success' && result.price != null && (
        <div style={{ flexShrink: 0, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", fontSize: 15, color: PRICE_COLOR }}>
          {peso(result.price)}
        </div>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" style={{
        background: 'none', border: 'none', color: TEXT_COLOR, cursor: 'pointer',
        display: 'flex', alignItems: 'center', flexShrink: 0, padding: 4, opacity: 0.6,
      }}><X size={16} /></button>
    </div>
  )
}

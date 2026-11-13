import Modal from './Modal'

// Shared "read this before you proceed" popup — same certificate-style
// design regardless of theme (always white/light, like a printed notice),
// used by both the Refund Policy (Refunds.jsx) and Return Policy
// (Returns.jsx) popups. Content is fully parameterized; only the layout
// and styling are shared. Deliberately not dismissable via backdrop click
// or Esc — accepting the policy requires the explicit button below.
export default function PolicyModal({ open, onClose, title, rules, buttonLabel, footerText }) {
  return (
    <Modal open={open} onClose={onClose} closeOnBackdrop={false} closeOnEsc={false}
      backdropStyle={{ overflowY: 'auto' }} contentStyle={{ width: '100%', maxWidth: 460 }}>
      <div className="policy-modal-panel flex flex-col overflow-hidden" style={{
        background: '#ffffff',
        borderRadius: 8,
        maxWidth: 460, width: '100%',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}>

        {/* ── Top header (always visible) ── */}
        <div className="policy-modal-header shrink-0" style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          textAlign: 'center',
        }}>
          <div className="policy-modal-header-icon" style={{ lineHeight: 1 }}>📋</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
            {title}
          </div>
          <div style={{
            display: 'inline-block', marginTop: 6,
            fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
            color: '#64748b', background: '#f1f5f9',
            padding: '3px 10px', borderRadius: 99,
          }}>
            Gapuz Computer Services
          </div>
        </div>

        {/* ── Policy list — the only part that scrolls ── */}
        <div className="policy-modal-rules flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ background: '#ffffff' }}>
          {rules.map((p, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
            }}>
              <div className="policy-modal-rule-icon" style={{
                borderRadius: 10,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>
                {p.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{p.title}</div>
                <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Footer button (always visible) — top border marks the scroll boundary ── */}
        <div className="shrink-0" style={{ padding: '0 20px 20px', paddingTop: 14, background: '#ffffff', borderTop: '1px solid #e2e8f0' }}>
          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '13px 0',
              fontSize: 13,
              fontWeight: 800,
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              background: '#0f172a',
              color: '#ffffff',
              letterSpacing: '0.3px',
              transition: 'opacity .15s',
            }}
            onMouseEnter={e => e.target.style.opacity = '.85'}
            onMouseLeave={e => e.target.style.opacity = '1'}
          >
            {buttonLabel}
          </button>
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: '#94a3b8' }}>
            {footerText}
          </div>
        </div>

      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { Search } from 'lucide-react'
import { useSerialStore } from '../store'
import { fmtDateTime, fmtTxnId } from '../utils/helpers'
import ScanInput from './ScanInput'
import Modal from './Modal'

const STATUS_STYLE = {
  'In Stock': { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: 'var(--green)' },
  'Sold':     { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)', color: 'var(--blue)' },
  'Defective':{ bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)', color: 'var(--red)' },
}

export default function FindSerialModal({ onClose }) {
  const findSerial = useSerialStore(s => s.findSerial)
  const [result, setResult] = useState(undefined) // undefined = no search yet, null = not found

  const handleSearch = async (code) => {
    const row = await findSerial(code)
    setResult(row || null)
    return row ? { ok: true, message: 'Found' } : { ok: false, message: 'Serial not found' }
  }

  const st = result ? (STATUS_STYLE[result.status] || STATUS_STYLE['In Stock']) : null

  return (
    <Modal open onClose={onClose} contentStyle={{ width: 'min(420px,92vw)' }}>
      <div className="card animate-scale-in" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Search size={15} style={{ color: 'var(--accent)' }} />Find Serial</div>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <ScanInput placeholder="Scan or type a serial number…" onScan={handleSearch} clearOnScan={false} />

        {result === null && (
          <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 12.5, padding: 16 }}>No product or serial found for that number.</div>
        )}

        {result && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{result.product?.name || 'Unknown product'}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{result.serialNumber}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, border: `1px solid ${st.border}`, color: st.color, flexShrink: 0 }}>{result.status}</span>
            </div>
            {result.status === 'Sold' && result.transaction && (
              <div style={{ fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div>Transaction: <strong>{fmtTxnId(result.transaction.id)}</strong></div>
                <div>Sold: {result.soldAt ? fmtDateTime(result.soldAt) : fmtDateTime(result.transaction.createdAt)}</div>
                <div>Customer: {result.transaction.customerName || 'Walk-in'}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

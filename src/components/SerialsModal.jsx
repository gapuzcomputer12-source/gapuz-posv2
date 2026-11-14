import { useEffect, useState } from 'react'
import { Barcode, Plus, X, Trash2 } from 'lucide-react'
import { useSerialStore } from '../store'
import { useToast } from '../utils/toast'
import { fmtDateTime, fmtTxnId } from '../utils/helpers'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'
import ScanInput from './ScanInput'
import Modal from './Modal'

const STATUS_STYLE = {
  'In Stock': { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: 'var(--green)' },
  'Sold':     { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)', color: 'var(--blue)' },
  'Defective':{ bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)', color: 'var(--red)' },
}

function StatusBadge({ status }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE['In Stock']
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>{status}</span>
}

export default function SerialsModal({ product, onClose }) {
  const { serials, loading, fetchSerials, addSerials, deleteSerial } = useSerialStore()
  const [pending, setPending] = useState([])
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const border = '1px solid var(--border)'

  useEffect(() => { fetchSerials(product.id) }, [product.id])

  const pg = usePagination(serials)

  const handleScanToAdd = (code) => {
    if (serials.some(s => s.serialNumber === code)) return { ok: false, message: 'Already registered to this product' }
    if (pending.includes(code)) return { ok: false, message: 'Already in the pending list' }
    setPending(p => [...p, code])
    return { ok: true, message: 'Added to pending list' }
  }

  const removePending = (code) => setPending(p => p.filter(c => c !== code))

  const handleSave = async () => {
    if (!pending.length) return
    setSaving(true)
    const { count, error } = await addSerials(product.id, product.name, pending)
    setSaving(false)
    if (error) return toast(error.message?.includes('duplicate') || error.message?.includes('unique') ? 'One of these serials is already registered' : error.message, 'error')
    toast(`${count} serial${count===1?'':'s'} added`, 'success')
    setPending([])
  }

  const handleDelete = async (serial) => {
    if (!window.confirm(`Remove serial ${serial.serialNumber}? This reduces stock by 1.`)) return
    const { error } = await deleteSerial(serial, product.id, product.name)
    if (error) return toast(error.message, 'error')
    toast('Serial removed', 'info')
  }

  return (
    <Modal open onClose={onClose} contentStyle={{ width: 'min(560px,94vw)', maxHeight: '88vh' }}>
      <div className="card animate-scale-in" style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: border, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Barcode size={15} style={{ color: 'var(--accent)' }} />Serial Numbers</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{product.name}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg3)', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>Add Serials</div>
            <ScanInput placeholder="Scan or type a serial, then Enter…" onScan={handleScanToAdd} clearOnScan submitLabel="Add" submitIcon={Plus} />
            {pending.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {pending.map(code => (
                    <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, padding: '4px 6px 4px 10px', borderRadius: 99, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' }}>
                      {code}
                      <button onClick={() => removePending(code)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2 }}><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: '8px 16px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: saving ? 0.6 : 1 }}>
                  <Plus size={14} />{saving ? 'Saving…' : `Save ${pending.length} Serial${pending.length===1?'':'s'}`}
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>Registered Serials ({serials.length})</div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
            ) : serials.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 12 }}>No serials registered yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pg.pageItems.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.serialNumber}</span>
                    <StatusBadge status={s.status} />
                    {s.status === 'Sold' && (
                      <span style={{ fontSize: 10.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {s.transactionId ? fmtTxnId(s.transactionId) : ''} · {s.soldAt ? fmtDateTime(s.soldAt) : ''}
                      </span>
                    )}
                    {s.status === 'In Stock' && (
                      <button onClick={() => handleDelete(s)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2 }} onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <Pagination {...pg} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

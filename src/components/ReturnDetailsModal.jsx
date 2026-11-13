import { useEffect, useState } from 'react'
import { Package, Barcode, FileText, Image as ImageIcon, Check, X as XIcon } from 'lucide-react'
import { useActivityLogStore, useAppStore, getEvidencePhotoUrls } from '../store'
import { StatusBadge } from './RefundDetailsModal'
import RejectReasonModal from './RejectReasonModal'
import ImagePreviewModal from './ImagePreviewModal'
import Modal from './Modal'
import { peso, fmtDate, fmtDateTime } from '../utils/helpers'
import { isMoneyBack } from '../utils/salesMetrics'
import { useToast } from '../utils/toast'

const MetaCard = ({ label, children }) => (
  <div className="card-surface" style={{ padding: 10 }}>
    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{children}</div>
  </div>
)

// One unit's Resellable/Defective picker — starts neutral (status
// undefined), not defaulted to Resellable. Clicking the already-selected
// option unselects it (onChange(null)); clicking the other one switches
// directly.
function UnitConditionToggle({ status, onChange, disabled }) {
  const OPTIONS = [
    { key: 'Resellable', Icon: Check, color: 'var(--green)' },
    { key: 'Defective',  Icon: XIcon, color: 'var(--red)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {OPTIONS.map(o => {
        const selected = status === o.key
        return (
          <button key={o.key} type="button" disabled={disabled}
            onClick={() => onChange(selected ? null : o.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
              border: `1px solid ${selected ? o.color : 'var(--border2)'}`,
              background: selected ? o.color : 'var(--bg4)',
              color: selected ? '#fff' : 'var(--text3)',
            }}>
            <o.Icon size={11} />{o.key}
          </button>
        )
      })}
    </div>
  )
}

// Read-only version shown once a return is no longer Pending — the final
// condition a unit was actually approved with (or "—" if this return
// predates the conditions column, or was never approved).
function ConditionBadge({ status }) {
  if (!status) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>—</span>
  const isDefective = status === 'Defective'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
      padding: '3px 9px', borderRadius: 99, flexShrink: 0,
      background: isDefective ? 'rgba(239,68,68,0.12)' : 'rgba(52,211,153,0.12)',
      color: isDefective ? 'var(--red)' : 'var(--accent)',
      border: `1px solid ${isDefective ? 'rgba(239,68,68,0.3)' : 'rgba(52,211,153,0.3)'}`,
    }}>{status}</span>
  )
}

export default function ReturnDetailsModal({ open, onClose, record, isAdmin, onApprove, onReject }) {
  const { theme } = useAppStore()
  const isLight = theme === 'light'
  const { logs } = useActivityLogStore()
  const toast = useToast()
  const [processing, setProcessing] = useState('')
  const [conditions, setConditions] = useState({})
  const [replacements, setReplacements] = useState({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [photoUrls, setPhotoUrls] = useState([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(null)

  useEffect(() => { if (open) { setConditions({}); setReplacements({}); setConfirmOpen(false) } }, [open, record?.id])

  // Signed URLs are fetched ONLY here, when this one return's detail modal
  // is actually opened — never for the whole Return History list, which
  // would mean one storage round-trip per row just to render a table.
  useEffect(() => {
    if (!open || !record?.evidencePhotos?.length) { setPhotoUrls([]); return }
    setPhotosLoading(true)
    getEvidencePhotoUrls(record.evidencePhotos).then(urls => { setPhotoUrls(urls); setPhotosLoading(false) })
  }, [open, record?.id])

  if (!open || !record) return null

  const idLabel = `#${String(record.id).padStart(4, '0')}`
  const items = record.items || []
  const entityType = 'return'
  const entityLabel = idLabel
  const decisionLog = logs.find(l => l.entityType === entityType && l.entityLabel === entityLabel && (l.action === 'approved' || l.action === 'rejected'))
  const canDecide = record.status === 'Pending' && isAdmin

  const isReplacement = record?.method === 'Replacement'
  const allSerials = items.flatMap(item => item.serials || [])

  // One row per physical unit — a serial IS a unit; a non-serialized line
  // of qty N is split into N synthetic units keyed "item:<item_id>:<n>"
  // (0-based) so each can carry its own condition. Mirrors exactly what
  // approve_return now requires server-side (add_return_unit_conditions.sql).
  const unitsFor = (item) => (item.serials?.length > 0)
    ? item.serials.map((s, i) => ({ key: s, label: s, isSerial: true }))
    : Array.from({ length: item.qty }, (_, i) => ({ key: `item:${item.item_id}:${i}`, label: `Unit ${i + 1} of ${item.qty}`, isSerial: false }))
  const allUnits = items.flatMap(unitsFor)
  const totalUnits = allUnits.length
  const checkedCount = allUnits.filter(u => conditions[u.key]?.status).length
  const allChecked = totalUnits > 0 && checkedCount === totalUnits
  const resellableCount = allUnits.filter(u => conditions[u.key]?.status === 'Resellable').length
  const defectiveCount = allUnits.filter(u => conditions[u.key]?.status === 'Defective').length

  const setUnitStatus = (key, status) => setConditions(c => {
    if (!status) { const { [key]: _omit, ...rest } = c; return rest }
    return { ...c, [key]: status === 'Defective' ? { status, note: c[key]?.note || '' } : { status } }
  })
  const setUnitNote = (key, note) => setConditions(c => ({ ...c, [key]: { ...c[key], note } }))
  const markAll = (status) => setConditions(() => {
    const next = {}
    allUnits.forEach(u => { next[u.key] = status === 'Defective' ? { status, note: '' } : { status } })
    return next
  })
  const setReplacementSerial = (serial, value) => setReplacements(r => ({ ...r, [serial]: value }))

  // Clicking "Approve" only opens the confirm dialog — the actual RPC call
  // happens from there, so a double-click can't double-submit.
  const handleApproveClick = () => {
    if (isReplacement) {
      const missing = allSerials.find(s => !replacements[s]?.trim())
      if (missing) return toast(`Scan or enter the replacement unit's serial for ${missing}`, 'error')
    }
    setConfirmOpen(true)
  }
  const handleConfirmApprove = async () => {
    setProcessing('approve')
    await onApprove(record, conditions, replacements)
    useActivityLogStore.getState().fetchLogs()
    setProcessing('')
    setConfirmOpen(false)
    onClose()
  }
  // The actual reject call + validation live in RejectReasonModal; this
  // just forwards the reason and reports success/failure back to it so it
  // knows whether to close itself or show the error and stay open.
  const handleRejectConfirm = async (reason) => {
    const result = await onReject(record, reason)
    if (!result?.error) { useActivityLogStore.getState().fetchLogs(); onClose() }
    return result
  }

  const unitSummary = [
    resellableCount > 0 && `${resellableCount} Resellable → back to stock`,
    defectiveCount > 0 && `${defectiveCount} Defective → not restocked`,
  ].filter(Boolean).join(', ')
  const moneyPart = isMoneyBack(record.method)
    ? `Refund ${peso(record.total)} via ${record.method}.`
    : record.method === 'Replacement' ? 'Replacement unit(s) will be issued.' : ''

  return (
    <Modal open={open} onClose={onClose} contentStyle={{ width: 'min(720px,94vw)', maxHeight: '90vh' }}>
      <div className="card animate-scale-in" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: 'var(--accent)' }}>Return {idLabel}</div>
              <StatusBadge status={record.status} isLight={isLight} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Requested {fmtDateTime(record.createdAt)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <MetaCard label="Original Transaction"><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>#{String(record.transactionId).padStart(4, '0')}</span></MetaCard>
            <MetaCard label="Customer">{record.customerName || 'Walk-in'}</MetaCard>
            <MetaCard label="Return Method">{record.method}</MetaCard>
            <MetaCard label="Decision">
              {decisionLog
                ? <>{decisionLog.actorName} <span style={{ fontWeight: 500, color: 'var(--text3)' }}>· {fmtDate(decisionLog.createdAt)}</span></>
                : <span style={{ color: 'var(--text3)', fontWeight: 500 }}>{record.status === 'Pending' ? 'Awaiting admin' : record.processedBy || '—'}</span>}
            </MetaCard>
          </div>

          {/* Rejection box — the whole point of this feature: a cashier (or
              an admin reviewing remotely) sees exactly why, right away. */}
          {record.status === 'Rejected' && (
            <div style={{ background: isLight ? '#fee2e2' : 'rgba(239,68,68,0.08)', border: `1px solid ${isLight ? '#fecaca' : 'rgba(239,68,68,0.25)'}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>Reason: {record.rejectionReason || '—'}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>Rejected by {record.processedBy || '—'} on {fmtDateTime(record.processedAt || record.createdAt)}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <div className="card-surface" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Reason</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{record.reason || '—'}</div>
            </div>
            <div className="card-surface" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <FileText size={10} style={{ color: 'var(--accent)' }} />Notes
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{record.notes || 'No notes'}</div>
            </div>
          </div>

          {record.evidencePhotos?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ImageIcon size={11} style={{ color: 'var(--accent)' }} />Evidence Photos ({record.evidencePhotos.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {photosLoading ? (
                  record.evidencePhotos.map((_, i) => <div key={i} className="skeleton" style={{ width: 72, height: 72, borderRadius: 8 }} />)
                ) : photoUrls.map((url, i) => (
                  <div key={i} onClick={() => setViewerIndex(i)} style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)', cursor: 'pointer', flexShrink: 0 }}>
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              Items ({items.length}){canDecide && isReplacement && (
                <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}> — enter the replacement unit's serial for each serialized unit</span>
              )}
            </div>

            {canDecide && (
              <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                <button type="button" onClick={() => markAll('Resellable')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Mark all Resellable</button>
                <button type="button" onClick={() => markAll('Defective')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--red)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Mark all Defective</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(item => {
                const hasSerials = item.serials?.length > 0
                const units = unitsFor(item)
                return (
                  <div key={item.item_id} className="card-surface" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text3)' }}>
                        {hasSerials ? <Barcode size={16} /> : <Package size={16} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{item.qty} unit{item.qty === 1 ? '' : 's'} · {peso(item.price)} each</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{peso(item.price * item.qty)}</div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingLeft: 48 }}>
                      {units.map(u => {
                        const cond = conditions[u.key]
                        const missing = canDecide && !cond?.status
                        const savedCond = record.conditions?.[u.key]
                        return (
                          <div key={u.key} style={{
                            padding: '8px 10px', borderRadius: 8,
                            border: `1px solid ${missing ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
                            background: missing ? 'rgba(245,158,11,0.07)' : 'var(--bg4)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                              <span style={{ fontSize: 11, fontFamily: u.isSerial ? "'JetBrains Mono',monospace" : 'inherit', color: 'var(--text2)' }}>{u.label}</span>
                              {canDecide
                                ? <UnitConditionToggle status={cond?.status} onChange={st => setUnitStatus(u.key, st)} />
                                : <ConditionBadge status={savedCond?.status} />}
                            </div>

                            {missing && <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 5, fontWeight: 600 }}>Check this unit</div>}

                            {canDecide && cond?.status === 'Defective' && (
                              <input className="input-field" style={{ fontSize: 11, padding: '5px 8px', marginTop: 6 }}
                                placeholder="What's wrong? (e.g. no display, dead on arrival)"
                                value={cond.note || ''} onChange={e => setUnitNote(u.key, e.target.value)} />
                            )}
                            {!canDecide && savedCond?.status === 'Defective' && savedCond?.note && (
                              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 5, fontStyle: 'italic' }}>{savedCond.note}</div>
                            )}

                            {canDecide && isReplacement && u.isSerial && (
                              <input className="input-field" style={{ fontSize: 11, padding: '5px 8px', fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}
                                placeholder="Scan or type the replacement unit's serial…"
                                value={replacements[u.key] || ''} onChange={e => setReplacementSerial(u.key, e.target.value)} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {(record.subtotal > 0 || record.vat > 0) && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}><span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.subtotal)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}><span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.vat)}</span></div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}><span>Total</span><span style={{ color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.total)}</span></div>
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexShrink: 0, flexWrap: 'wrap' }}>
          {canDecide ? (
            <>
              {!allChecked && (
                <span style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 600, marginRight: 'auto' }}>
                  Set the condition of all items ({checkedCount} of {totalUnits} checked)
                </span>
              )}
              <button onClick={() => setRejectOpen(true)} disabled={!!processing} className="btn-danger" style={{ opacity: processing ? .6 : 1 }}>Reject</button>
              <button onClick={handleApproveClick} disabled={!!processing || !allChecked} className="btn-success"
                style={{
                  opacity: processing ? .6 : (allChecked ? 1 : .5),
                  cursor: allChecked ? 'pointer' : 'not-allowed',
                  ...(allChecked ? { background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' } : {}),
                }}>
                Approve
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn-secondary">Close</button>
          )}
        </div>
      </div>

      {/* Approve confirmation — summarizes the restock split + payout before
          the RPC actually runs. */}
      {confirmOpen && (
        <Modal open onClose={() => !processing && setConfirmOpen(false)} closeOnBackdrop={!processing} closeOnEsc={!processing} contentStyle={{ width: 'min(420px,92vw)' }}>
          <div className="card animate-scale-in" style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Approve Return {idLabel}?</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 22 }}>
              {unitSummary}{unitSummary && '. '}{moneyPart}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={!!processing} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleConfirmApprove} disabled={!!processing} className="btn-primary"
                style={{ flex: 1, background: 'var(--green)', borderColor: 'var(--green)', opacity: processing ? .7 : 1 }}>
                {processing === 'approve' ? 'Approving…' : 'Confirm Approve'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <RejectReasonModal open={rejectOpen} onClose={() => setRejectOpen(false)} onConfirm={handleRejectConfirm} idLabel={String(record.id).padStart(4, '0')} />
      <ImagePreviewModal open={viewerIndex != null} onClose={() => setViewerIndex(null)} startIndex={viewerIndex || 0} images={photoUrls} />
    </Modal>
  )
}

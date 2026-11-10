import { useEffect, useRef, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { FileText, Printer, Package, Banknote, Smartphone, Tag, AlertTriangle } from 'lucide-react'
import { useAppStore, useTransactionStore, useProductStore, useCustomerStore, useCategoryStore, useActivityLogStore, useRefundStore } from '../store'
import ProductThumb from './ProductThumb'
import { peso, fmtDate, fmtDateTime } from '../utils/helpers'

const REFUND_WINDOW_DAYS = 15
export const METHOD_ICON = { Cash: Banknote, GCash: Smartphone, 'Store Credit': Tag, Card: Banknote }

export const StatusBadge = ({ status, isLight }) => {
  const styles = isLight ? {
    Pending:  { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
    Approved: { bg: '#d1fae5', color: '#047857', border: '#a7f3d0' },
    Rejected: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  } : {
    Pending:  { bg: 'rgba(245,158,11,0.10)',  color: '#f59e0b', border: 'rgba(245,158,11,0.25)'  },
    Approved: { bg: 'rgba(52,211,153,0.10)',  color: '#34d399', border: 'rgba(52,211,153,0.25)'  },
    Rejected: { bg: 'rgba(239,68,68,0.10)', color: '#ef4444', border: 'rgba(239,68,68,0.25)' },
  }
  const s = styles[status] || styles.Pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 99,
      fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {status === 'Approved' ? '✓' : status === 'Rejected' ? '✗' : '●'} {status}
    </span>
  )
}

const MetaCard = ({ label, children }) => (
  <div className="card-surface" style={{ padding: 10 }}>
    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{children}</div>
  </div>
)

export default function RefundDetailsModal({ open, onClose, record, isAdmin, onApprove, onReject }) {
  const { theme } = useAppStore()
  const isLight = theme === 'light'
  const { transactions } = useTransactionStore()
  const { products } = useProductStore()
  const { customers } = useCustomerStore()
  const { categories } = useCategoryStore()
  const { logs } = useActivityLogStore()
  const { refunds } = useRefundStore()
  const [processing, setProcessing] = useState('')
  const printRef = useRef(null)
  const handlePrint = useReactToPrint({ content: () => printRef.current })

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
  }, [open, onClose])

  if (!open || !record) return null

  const idLabel   = `#${String(record.id).padStart(4, '0')}`
  const title     = `Refund ${idLabel}`
  const txnId     = record.transactionId
  const method    = record.refundMethod
  const entityType = 'refund'
  const entityLabel = `#${String(record.id).padStart(4, '0')}`

  const txn = transactions.find(t => t.id === txnId)
  const customer = txn?.customerId ? customers.find(c => c.id === txn.customerId) : null
  const daysSince = txn ? Math.floor((new Date(record.createdAt) - new Date(txn.createdAt)) / 86400000) : null
  const overPolicy = daysSince != null && daysSince > REFUND_WINDOW_DAYS

  const decisionLog = logs.find(l => l.entityType === entityType && l.entityLabel === entityLabel && (l.action === 'approved' || l.action === 'rejected'))

  const siblings = refunds.filter(x => x.transactionId === txnId && x.id !== record.id)

  const items = record.items || []
  const hasBreakdown = (record.subtotal || 0) > 0 || (record.vat || 0) > 0
  const MethodIcon = METHOD_ICON[method] || Tag

  const handleApproveClick = async () => {
    setProcessing('approve')
    await onApprove(record)
    useActivityLogStore.getState().fetchLogs()
    setProcessing('')
    onClose()
  }
  const handleRejectClick = async () => {
    setProcessing('reject')
    await onReject(record)
    useActivityLogStore.getState().fetchLogs()
    setProcessing('')
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 16 }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card animate-scale-in" style={{ width: 'min(720px,94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Sticky header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{title}</div>
              <StatusBadge status={record.status} isLight={isLight} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Requested {fmtDateTime(record.createdAt)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <MetaCard label="Original Transaction">
              <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>#{String(txnId).padStart(4, '0')}</span>
              {txn?.discAmt > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, marginTop: 2 }}>Sale discount: {peso(txn.discAmt)}</div>}
            </MetaCard>
            <MetaCard label="Purchase Date">
              {txn ? fmtDate(txn.createdAt) : '—'}
              {daysSince != null && (
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, color: overPolicy ? 'var(--red)' : 'var(--text3)' }}>
                  {overPolicy && <AlertTriangle size={11} />}
                  {daysSince}d since purchase{overPolicy ? ' · past 15-day policy' : ''}
                </div>
              )}
            </MetaCard>
            <MetaCard label="Customer">
              {record.customerName || 'Walk-in'}
              {(customer?.email || customer?.phone) && (
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, marginTop: 2 }}>
                  {[customer.email, customer.phone].filter(Boolean).join(' · ')}
                </div>
              )}
            </MetaCard>
            <MetaCard label="Refund Method">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MethodIcon size={12} />{method}</span>
              {txn?.payment && <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, marginTop: 2 }}>Originally paid via {txn.payment}</div>}
            </MetaCard>
            <MetaCard label="Requested By">{record.processedBy || '—'}</MetaCard>
            <MetaCard label="Decision">
              {decisionLog
                ? <>{decisionLog.actorName} <span style={{ fontWeight: 500, color: 'var(--text3)' }}>· {fmtDate(decisionLog.createdAt)}</span></>
                : <span style={{ color: 'var(--text3)', fontWeight: 500 }}>{record.status === 'Pending' ? 'Awaiting admin' : '—'}</span>}
            </MetaCard>
          </div>

          {/* Reason + notes */}
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

          {/* Items */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
              Items ({items.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(item => {
                const qtyRequested = item.refundQty ?? item.qty ?? 1
                const qtyOriginal = item.qty ?? qtyRequested
                const product = products.find(p => p.id === item.id)
                const catObj = categories.find(c => c.name === product?.category)
                return (
                  <div key={item.id} className="card-surface" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    {product
                      ? <ProductThumb image={product.image} icon={product.icon} category={product.category} size={44} radius={9} />
                      : <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0 }}><Package size={18} /></div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.name}</span>
                        {product
                          ? <span className={`badge ${catObj?.badgeColor || 'badge-accent'}`} style={{ fontSize: 9 }}>{product.category}</span>
                          : <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>no longer in inventory</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {product?.barcode && <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{product.barcode}</span>}
                        <span>{qtyRequested} of {qtyOriginal} purchased</span>
                        <span>{peso(item.price)} each</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{peso(item.price * qtyRequested)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Totals */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {hasBreakdown && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
                  <span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>
                  <span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.vat)}</span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
              <span>Total</span><span style={{ color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace" }}>{peso(record.total)}</span>
            </div>
          </div>

          {/* Other requests on the same transaction */}
          {siblings.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                Other requests for this transaction
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {siblings.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg3)', borderRadius: 7, fontSize: 11 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>
                      #{String(s.id).padStart(4, '0')}
                    </span>
                    <StatusBadge status={s.status} isLight={isLight} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={handlePrint} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
            <Printer size={13} />Print
          </button>
          {record.status === 'Pending' && isAdmin ? (
            <>
              <button onClick={handleRejectClick} disabled={!!processing} className="btn-danger" style={{ opacity: processing ? .6 : 1 }}>
                {processing === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
              <button onClick={handleApproveClick} disabled={!!processing} className="btn-success" style={{ opacity: processing ? .6 : 1 }}>
                {processing === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn-secondary">Close</button>
          )}
        </div>
      </div>

      {/* Printable slip — hidden on screen, shown via the global #receipt-printable print rule (index.css) */}
      <div style={{ display: 'none' }}>
        <div id="receipt-printable" ref={printRef} style={{ background: '#fff', color: '#000', fontFamily: "'Courier New',monospace", fontSize: 11, padding: 20, width: 300, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', paddingBottom: 10, borderBottom: '1px dashed #ccc', marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>GAPUZ COMPUTER SERVICES</div>
            <div style={{ fontSize: 10, color: '#555' }}>Refund Slip — {idLabel}</div>
          </div>
          <div style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>
            TXN #{String(txnId).padStart(4, '0')} · {fmtDateTime(record.createdAt)}<br />
            Customer: {record.customerName || 'Walk-in'} · Method: {method}<br />
            Reason: {record.reason}
          </div>
          <div style={{ borderTop: '1px dashed #ccc', borderBottom: '1px dashed #ccc', padding: '8px 0', marginBottom: 8 }}>
            {items.map((item, i) => {
              const qty = item.refundQty ?? item.qty ?? 1
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                  <span style={{ flex: 1 }}>{item.name}</span><span style={{ margin: '0 8px' }}>x{qty}</span><span>{peso(item.price * qty)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>TOTAL</span><span>{peso(record.total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

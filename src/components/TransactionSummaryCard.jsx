import { useMemo } from 'react'
import { CheckCircle, AlertTriangle, Banknote, Smartphone, Tag, Package } from 'lucide-react'
import ProductThumb from './ProductThumb'
import { StatusBadge } from './RefundDetailsModal'
import { peso, fmtDate, fmtDateTime, SALE_ADJUSTMENT_DAYS, settlementStatusLabel } from '../utils/helpers'
import { getTier } from '../utils/loyalty'

const METHOD_ICON = { Cash: Banknote, GCash: Smartphone }

const SALE_STATUS_STYLE = {
  Completed:           { color: 'var(--text2)', bg: 'var(--bg4)',               border: 'var(--border2)' },
  'Partially Returned': { color: '#d97706',      bg: 'rgba(245,158,11,0.1)',    border: 'rgba(245,158,11,0.3)' },
  'Partially Refunded': { color: '#d97706',      bg: 'rgba(245,158,11,0.1)',    border: 'rgba(245,158,11,0.3)' },
  Returned:             { color: 'var(--red)',   bg: 'rgba(239,68,68,0.1)',     border: 'rgba(239,68,68,0.3)' },
  Refunded:             { color: 'var(--red)',   bg: 'rgba(239,68,68,0.1)',     border: 'rgba(239,68,68,0.3)' },
}

// Exported so TransactionDetailsModal.jsx renders the identical badge for
// the identical label — one definition, not a second copy.
export function SaleStatusBadge({ label }) {
  const s = SALE_STATUS_STYLE[label] || SALE_STATUS_STYLE.Completed
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {label}
    </span>
  )
}

function TierBadge({ points }) {
  const tier = getTier(points)
  const Icon = tier.icon
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 99, fontSize: 9.5, fontWeight: 700, color: tier.color, background: tier.bg }}>
      <Icon size={10} />{tier.label}
    </span>
  )
}

const UNIT_STATUS_STYLE = {
  Available:        { color: 'var(--green)', bg: 'rgba(52,211,153,0.12)' },
  'Pending return':  { color: 'var(--yellow)', bg: 'rgba(245,158,11,0.12)' },
  Returned:          { color: 'var(--text3)', bg: 'var(--bg4)' },
}

function UnitChip({ label, status }) {
  const s = UNIT_STATUS_STYLE[status] || UNIT_STATUS_STYLE.Available
  return (
    <span style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>
      {label} · {status}
    </span>
  )
}

// Read entirely off get_transaction_settlement's serialStatuses/
// itemQtyClaimed — no local re-filtering of the raw returns list, so this
// always agrees with exactly what the server itself used to decide
// whether a NEW return/refund against this unit would be accepted.
function unitBreakdown(item, settlement) {
  if (item.serials?.length > 0) {
    const statuses = settlement?.serialStatuses || []
    return item.serials.map(s => {
      const hit = statuses.find(x => x.serial === s.serialNumber)
      const status = hit?.status === 'returned' ? 'Returned' : hit?.status === 'pending' ? 'Pending return' : 'Available'
      return { key: s.serialNumber, label: s.serialNumber, status }
    })
  }
  const claimed = (settlement?.itemQtyClaimed || []).find(x => (item.itemId != null ? x.itemId === item.itemId : x.productId === item.productId))
  const qty = item.qty || 0
  const returnedQty = Math.min(qty, claimed?.returnedQty || 0)
  const pendingQty = Math.min(qty - returnedQty, claimed?.pendingQty || 0)
  const availableQty = qty - returnedQty - pendingQty
  return [
    availableQty > 0 && { key: 'avail', label: `${availableQty}`, status: 'Available' },
    pendingQty > 0 && { key: 'pend', label: `${pendingQty}`, status: 'Pending return' },
    returnedQty > 0 && { key: 'ret', label: `${returnedQty}`, status: 'Returned' },
  ].filter(Boolean)
}

// The rich "what am I looking at" card shown at the top of the Details step
// on both Returns.jsx and Refunds.jsx — everything an admin/cashier needs
// to judge a request without flipping between tabs: the sale itself, its
// items and their current availability, how much of it is already spoken
// for, and any other request already filed against it.
export default function TransactionSummaryCard({ txn, items, products, customer, returns, refunds, settlement, daysSince, expired, isLight }) {
  const statusLabel = settlementStatusLabel(settlement)
  const alreadyReturned = settlement?.approvedReturned || 0
  const alreadyRefunded = settlement?.approvedRefunded || 0
  const remaining = settlement ? settlement.remainingRefundable : (txn.total || 0)

  const previousRequests = useMemo(() => {
    const list = [
      ...returns.filter(r => r.transactionId === txn.id).map(r => ({ id: r.id, kind: 'Return', amount: r.total, status: r.status, createdAt: r.createdAt })),
      ...refunds.filter(r => r.transactionId === txn.id).map(r => ({ id: r.id, kind: 'Refund', amount: r.total, status: r.status, createdAt: r.createdAt })),
    ]
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [returns, refunds, txn.id])

  const isSplit = (txn.payment || '').includes('+')
  const PayIcon = isSplit ? Tag : (METHOD_ICON[txn.payment] || Tag)

  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: isLight ? '#059669' : 'var(--accent)' }}>
            #{String(txn.id).padStart(4, '0')}
          </span>
          <SaleStatusBadge label={statusLabel} />
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDateTime(txn.createdAt)}</div>
        {expired ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>
            <AlertTriangle size={13} />Window expired (purchased {fmtDate(txn.createdAt)})
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
            <CheckCircle size={13} />{SALE_ADJUSTMENT_DAYS - daysSince} day{SALE_ADJUSTMENT_DAYS - daysSince === 1 ? '' : 's'} left
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, fontSize: 11, color: 'var(--text2)' }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Customer</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{txn.customerName || 'Walk-in'}</span>
              {customer && <TierBadge points={customer.points} />}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Cashier</div>
            <div style={{ fontWeight: 600 }}>{txn.cashierName || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Payment</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
              <PayIcon size={11} />{isSplit ? `Split (${txn.payment.replace('+', ' + ')})` : (txn.payment || '—')}
            </div>
            {txn.gcashReference && <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 1 }}>Ref. No.: {txn.gcashReference}</div>}
          </div>
        </div>
      </div>

      {/* Items purchased */}
      {items?.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Items Purchased ({items.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((item, i) => {
              const product = products?.find(p => p.id === item.productId)
              const units = unitBreakdown(item, settlement)
              return (
                <div key={item.itemId ?? item.productId ?? i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 9px' }}>
                  {product
                    ? <ProductThumb image={product.image} icon={product.icon} category={product.category} size={30} radius={7} />
                    : <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexShrink: 0 }}><Package size={13} /></div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{item.name}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{peso(item.price * item.qty)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{item.qty} × {peso(item.price)}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                      {units.map(u => <UnitChip key={u.key} label={u.label} status={u.status} />)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Amount breakdown */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 11.5, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {txn.subtotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(txn.subtotal)}</span></div>}
        {txn.vat > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(txn.vat)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total Paid</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(txn.total)}</span></div>
        {alreadyReturned > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--yellow)' }}><span>Already returned</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>−{peso(alreadyReturned)}</span></div>}
        {alreadyRefunded > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--yellow)' }}><span>Already refunded</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>−{peso(alreadyRefunded)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13, borderTop: '1px solid var(--border2)', paddingTop: 6, marginTop: 2 }}>
          <span>Remaining Refundable</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(remaining)}</span>
        </div>
      </div>

      {/* Previous requests */}
      {previousRequests.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Previous Requests ({previousRequests.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {previousRequests.map(r => (
              <div key={`${r.kind}-${r.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 10.5, padding: '5px 8px', background: 'var(--bg2)', borderRadius: 6 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)' }}>{r.kind === 'Return' ? 'RET' : 'REF'} #{String(r.id).padStart(4, '0')}</span>
                <span style={{ color: 'var(--text3)' }}>{fmtDate(r.createdAt)}</span>
                <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{peso(r.amount)}</span>
                <StatusBadge status={r.status} isLight={isLight} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

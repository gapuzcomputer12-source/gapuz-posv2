import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReactToPrint } from 'react-to-print'
import { differenceInCalendarDays } from 'date-fns'
import {
  X, User, Mail, Phone, Printer, Send, RefreshCw, Undo2, Clock, CheckCircle, AlertTriangle,
  ChevronRight, Star, Ban,
} from 'lucide-react'
import {
  useAuthStore, useAppStore, useReturnStore, useRefundStore, useProductStore,
  fetchTransactionDetails, emailReceipt, syncRefundToTransaction, voidTransaction,
} from '../store'
import { peso, fmtDate, fmtDateTime, paymentDisplay, isValidEmail, SALE_ADJUSTMENT_DAYS, settlementStatusLabel } from '../utils/helpers'
import { getTier } from '../utils/loyalty'
import { useToast } from '../utils/toast'
import Modal from './Modal'
import ProductThumb from './ProductThumb'
import Receipt from './Receipt'
import RefundDetailsModal, { StatusBadge } from './RefundDetailsModal'
import ReturnDetailsModal from './ReturnDetailsModal'
import { SaleStatusBadge } from './TransactionSummaryCard'

const VOID_REASONS = ['Wrong item', 'Wrong quantity', 'Duplicate sale', 'Customer cancelled', 'Test sale', 'Other']
const VOID_WINDOW_MS = 15 * 60 * 1000

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
  Sold:             { color: 'var(--green)', bg: 'rgba(52,211,153,0.12)' },
  'Pending return':  { color: 'var(--yellow)', bg: 'rgba(245,158,11,0.12)' },
  Returned:          { color: 'var(--text3)', bg: 'var(--bg4)' },
}
function UnitChip({ label, status, onClick }) {
  const s = UNIT_STATUS_STYLE[status] || UNIT_STATUS_STYLE.Sold
  return (
    <span onClick={onClick} style={{
      fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, color: s.color, background: s.bg,
      whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', textDecoration: onClick ? 'underline' : 'none',
    }}>
      {label} · {status}
    </span>
  )
}

const Section = ({ title, children }) => (
  <div>
    <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>{title}</div>
    {children}
  </div>
)
const Field = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{children ?? '—'}</div>
  </div>
)

// The ONE place "clicking a transaction" lands, from every list in the app
// (Admin/Cashier Dashboard, Reports, Customers' Purchases, SaleLookup's
// "View details"). Self-fetches via the gated get_transaction_details RPC
// (see add_transaction_details.sql) — admin gets any transaction; a
// cashier only their own, enforced server-side, not just by which lists
// happen to show it. Nothing here needs role-based hiding beyond that
// access gate: the fields shown (never cost/profit) are the same for both.
export default function TransactionDetailsModal({ open, onClose, transactionId }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { role, user } = useAuthStore()
  const { theme } = useAppStore()
  const isAdmin = role === 'admin'
  const isLight = theme === 'light'
  const myName = user?.user_metadata?.name || user?.email?.split('@')[0] || ''
  const { returns, approveReturn, rejectReturn } = useReturnStore()
  const { refunds, updateRefund, rejectRefund } = useRefundStore()
  const fetchProducts = useProductStore(s => s.fetchProducts)

  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [viewRequest, setViewRequest] = useState(null) // { kind: 'return'|'refund', record }
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailAddr, setEmailAddr] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false)
  const [voidReason, setVoidReason] = useState(VOID_REASONS[0])
  const [voidNote, setVoidNote] = useState('')
  const [voiding, setVoiding] = useState(false)
  // Live-ticks once a second while open so a cashier's "N more minutes"
  // countdown (and the button's own enabled state) count down in real
  // time instead of freezing at whatever it read when the modal opened —
  // the actual 15-minute cutoff is still enforced server-side regardless.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const printRef = useRef(null)
  const handlePrint = useReactToPrint({ content: () => printRef.current })

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  const load = () => {
    if (!transactionId) return
    setLoading(true); setErrorMsg('')
    fetchTransactionDetails(transactionId).then(d => {
      setLoading(false)
      if (!d) { setErrorMsg("Couldn't load this transaction — you may not have access to it, or it no longer exists."); setDetails(null); return }
      setDetails(d)
    })
  }

  useEffect(() => {
    if (!open) return
    setDetails(null); setErrorMsg(''); setViewRequest(null)
    setEmailOpen(false); setEmailSent(false); setEmailTouched(false)
    setVoidConfirmOpen(false); setVoidReason(VOID_REASONS[0]); setVoidNote('')
    load()
  }, [open, transactionId])

  useEffect(() => { if (details) setEmailAddr(details.customer?.email || '') }, [details])

  if (!open) return null

  const daysSince = details ? differenceInCalendarDays(new Date(), new Date(details.createdAt)) : null
  const daysLeft = details ? SALE_ADJUSTMENT_DAYS - daysSince : null
  const expired = details ? daysLeft < 0 : false
  const settlement = details?.settlement
  const canStartNew = details && !expired && settlement?.status !== 'settled' && settlement?.status !== 'pending'
  const statusLabel = details ? settlementStatusLabel(settlement) : ''
  const pay = details ? paymentDisplay(details.payment) : null
  const isVoided = details?.status === 'Voided'

  // Void eligibility — a CLIENT-SIDE PREVIEW only, for showing/disabling
  // the button and its tooltip. void_transaction re-checks every one of
  // these same conditions itself server-side on submit, so a stale or
  // spoofed client state here can only ever show the wrong button state,
  // never actually let an unauthorized void through.
  const isOwnSale = details && (details.cashierId ? details.cashierId === user?.id : details.cashierName === myName)
  const hasAnyRequest = settlement && settlement.status !== 'available'
  const voidDeadline = details ? new Date(details.createdAt).getTime() + VOID_WINDOW_MS : null
  const msUntilVoidDeadline = voidDeadline ? voidDeadline - nowTick : 0
  const minutesLeftToVoid = Math.max(0, Math.ceil(msUntilVoidDeadline / 60000))
  const cashierWindowOpen = msUntilVoidDeadline > 0
  const showVoidButton = details && !isVoided && ((isAdmin && details.isSameDayManila) || (!isAdmin && isOwnSale))
  let voidDisabledReason = ''
  if (hasAnyRequest) voidDisabledReason = 'This sale has a return/refund — void is not allowed.'
  else if (!isAdmin && !cashierWindowOpen) voidDisabledReason = 'Void time limit passed – ask the admin'
  const canVoid = showVoidButton && !voidDisabledReason

  const effectiveEmail = emailAddr.trim()
  const emailValid = isValidEmail(effectiveEmail)

  // Shape expected by Receipt.jsx / send-receipt — items.serials must be
  // plain strings there, unlike this modal's own item.serials (objects
  // with status/requestId), so it's remapped here rather than changing
  // Receipt.jsx's long-established contract.
  const receiptTxn = details && {
    id: details.id, createdAt: details.createdAt, cashierName: details.cashierName, customerName: details.customerName,
    items: (details.items || []).map(i => ({ name: i.name, qty: i.qty, price: i.price, serials: (i.serials || []).map(s => s.serialNumber) })),
    subtotal: details.subtotal, vat: details.vat, total: details.total,
    payment: details.payment, cashGiven: details.cashGiven, gcashReference: details.gcashReference,
  }

  const openRequest = (kind, id) => {
    const record = kind === 'return' ? returns.find(r => r.id === id) : refunds.find(r => r.id === id)
    if (record) setViewRequest({ kind, record })
  }

  const handleApproveReturn = async (r, conditions, replacements) => {
    const { error } = await approveReturn(r.id, conditions, replacements)
    if (error) { toast(error.message || 'Failed to approve return', 'error'); return }
    await fetchProducts()
    toast('Return approved', 'success')
  }
  const handleRejectReturn = async (r, reason) => {
    const { error } = await rejectReturn(r.id, reason)
    if (error) return { error }
    toast('Return rejected', 'info')
  }
  const handleApproveRefund = async (r) => {
    await updateRefund(r.id, { status: 'Approved' })
    await syncRefundToTransaction(r)
    toast('Refund approved', 'success')
  }
  const handleRejectRefund = async (r, reason) => {
    const { error } = await rejectRefund(r.id, reason)
    if (error) return { error }
    toast('Refund rejected', 'info')
  }

  const handleSendEmail = async () => {
    if (!emailValid) { setEmailTouched(true); return }
    setEmailSending(true)
    const { error } = await emailReceipt(effectiveEmail.toLowerCase(), receiptTxn)
    setEmailSending(false)
    if (error) return toast(error.message || 'Failed to send receipt', 'error')
    setEmailSent(true)
    toast('Receipt emailed', 'success')
  }

  const voidNoteRequired = voidReason === 'Other'
  const voidReasonValid = !voidNoteRequired || voidNote.trim().length > 0
  const handleVoidConfirm = async () => {
    if (!voidReasonValid) return
    setVoiding(true)
    const finalReason = voidNoteRequired ? voidNote.trim() : voidReason
    const { error } = await voidTransaction(details.id, finalReason)
    setVoiding(false)
    if (error) return toast(error.message || 'Failed to void transaction', 'error')
    setVoidConfirmOpen(false)
    toast('Transaction voided', 'success')
    load()
  }

  const startRequest = (kind) => {
    onClose()
    navigate(`/${kind === 'return' ? 'returns' : 'refunds'}?txn=${details.id}`)
  }

  const unitStatusFor = (item) => {
    if (item.returnedQty >= item.qty && item.qty > 0) return { label: item.qty > 1 ? `Fully returned (${item.returnedQty})` : 'Returned', status: 'Returned', requestId: item.approvedRequestId }
    if (item.pendingQty > 0) return { label: `Pending return (${item.pendingQty})`, status: 'Pending return', requestId: item.pendingRequestId }
    if (item.returnedQty > 0) return { label: `Partially returned (${item.returnedQty}/${item.qty})`, status: 'Returned', requestId: item.approvedRequestId }
    return { label: 'Sold', status: 'Sold', requestId: null }
  }

  return (
    <Modal open={open} onClose={onClose} contentStyle={{ width: 'min(760px,94vw)', maxHeight: '90vh' }}>
      <div className="card animate-scale-in" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>
                {details ? `#${String(details.id).padStart(4, '0')}` : (transactionId ? `#${String(transactionId).padStart(4, '0')}` : '')}
              </div>
              {details && <SaleStatusBadge label={statusLabel} />}
            </div>
            {details && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDateTime(details.createdAt)}</div>
                {expired ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--red)' }}><AlertTriangle size={12} />Return period ended</span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--green)' }}><CheckCircle size={12} />{daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 2 }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: 'var(--text3)' }}>
              <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
              Loading transaction…
            </div>
          ) : errorMsg ? (
            <div style={{ textAlign: 'center', padding: 50, color: 'var(--text3)' }}>
              <AlertTriangle size={28} style={{ opacity: .3, marginBottom: 10 }} />
              <div>{errorMsg}</div>
            </div>
          ) : details && <>

            {isVoided && (
              <div style={{ background: isLight ? '#fee2e2' : 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: 'var(--red)' }}>
                  <Ban size={17} />VOIDED
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>By {details.voidedByName || '—'} on {fmtDateTime(details.voidedAt)}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>Reason: {details.voidReason || '—'}</div>
              </div>
            )}

            {/* B. Customer + staff */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
              <Section title="Customer">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: details.customer ? 6 : 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{details.customerName || 'Walk-in Customer'}</span>
                  {details.customer && <TierBadge points={details.customer.points} />}
                </div>
                {details.customer && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: 'var(--text2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Mail size={11} />{details.customer.email || '—'}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Phone size={11} />{details.customer.phone || '—'}</span>
                    <button onClick={() => { onClose(); navigate(`/customers?view=${details.customerId}`) }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, marginTop: 2, color: isLight ? '#059669' : 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      View customer<ChevronRight size={11} />
                    </button>
                  </div>
                )}
              </Section>
              <Field label="Processed by"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><User size={12} />{details.cashierName || '—'}</span></Field>
            </div>

            {/* C. Items purchased */}
            <Section title={`Items Purchased (${(details.items || []).length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(details.items || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>—</div>
                ) : details.items.map((item, i) => {
                  const unit = !item.hasSerial ? unitStatusFor(item) : null
                  return (
                    <div key={item.itemId ?? i} className="card-surface" style={{ padding: 10, display: 'flex', gap: 10 }}>
                      <ProductThumb image={item.image} icon={item.icon} category={item.category} size={38} radius={9} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{item.category || '—'} · {item.qty} × {peso(item.price)}</div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{peso(item.price * item.qty)}</div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                          {item.hasSerial
                            ? (item.serials || []).map(s => (
                              <UnitChip key={s.serialNumber} label={s.serialNumber} status={s.status}
                                onClick={s.requestId ? () => openRequest('return', s.requestId) : undefined} />
                            ))
                            : <UnitChip label={unit.label} status={unit.status} onClick={unit.requestId ? () => openRequest('return', unit.requestId) : undefined} />}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* D. Payment */}
            <Section title="Payment">
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}><span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(details.subtotal)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}><span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(details.vat)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, borderTop: '1px solid var(--border2)', paddingTop: 6, marginTop: 1 }}>
                  <span>Total</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(details.total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text2)' }}><pay.Icon size={13} />{pay.label}</span>
                </div>
                {details.payment === 'Cash' && details.cashGiven > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text3)', fontSize: 11.5 }}><span>Cash tendered</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(details.cashGiven)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text3)', fontSize: 11.5 }}><span>Change</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(details.cashGiven - details.total)}</span></div>
                  </>
                )}
                {(details.payment || '').includes('GCash') && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text3)', fontSize: 11.5 }}><span>GCash Ref. No.</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{details.gcashReference || '—'}</span></div>
                )}
              </div>
            </Section>

            {/* E. Loyalty points */}
            <Section title="Loyalty Points">
              {details.customerId ? (
                <div style={{ fontSize: 12.5, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--green)', fontWeight: 700 }}><Star size={12} />+{details.pointsEarned} pts earned</span>
                  {details.pointsReversed > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}>−{details.pointsReversed} pts reversed (return/refund)</span>}
                </div>
              ) : <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>—</div>}
            </Section>

            {/* F. Returns and refunds */}
            <Section title="Returns & Refunds">
              <div style={{ background: isLight ? '#f9fafb' : 'rgba(52,211,153,0.04)', border: isLight ? '1px solid #e5e7eb' : '1px solid rgba(52,211,153,0.15)', borderRadius: 10, padding: 12, marginBottom: (details.requests || []).length > 0 ? 10 : 0, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Total paid</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{peso(details.total)}</span></div>
                {settlement.approvedReturned > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--yellow)' }}><span>Returned</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>−{peso(settlement.approvedReturned)}</span></div>}
                {settlement.approvedRefunded > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--yellow)' }}><span>Refunded</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>−{peso(settlement.approvedRefunded)}</span></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, borderTop: '1px solid var(--border2)', paddingTop: 5, marginTop: 1 }}><span>Remaining refundable</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(settlement.remainingRefundable)}</span></div>
              </div>
              {(details.requests || []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {details.requests.map(r => (
                    <button key={`${r.kind}-${r.id}`} onClick={() => openRequest(r.kind, r.id)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left',
                      fontSize: 11.5, padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                    }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text2)', fontWeight: 600 }}>{r.kind === 'return' ? 'RET' : 'REF'} #{String(r.id).padStart(4, '0')}</span>
                      <span style={{ color: 'var(--text3)' }}>{fmtDate(r.createdAt)}</span>
                      <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{peso(r.amount)}</span>
                      <StatusBadge status={r.status} isLight={isLight} />
                      {r.status === 'Rejected' && r.rejectionReason && <span style={{ color: 'var(--text3)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{r.rejectionReason}</span>}
                      <ChevronRight size={13} style={{ color: 'var(--text3)', flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* G. Timeline */}
            {(details.activity || []).length > 0 && (
              <Section title="Timeline">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {details.activity.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < details.activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <Clock size={13} style={{ color: 'var(--text3)', marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{a.actorName || 'System'}</span> {a.action} {a.entityType} <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{a.entityLabel}</span>
                          {a.details?.emailStatus && <span style={{ color: 'var(--text3)' }}> · email {a.details.emailStatus}</span>}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 1 }}>{fmtDateTime(a.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* H. Email Receipt inline form */}
            {emailOpen && (
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>Email receipt to</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="email" className="form-field" placeholder="juan@gmail.com" style={{ flex: 1 }}
                    value={emailAddr} onChange={e => { setEmailAddr(e.target.value); setEmailSent(false) }} onBlur={() => setEmailTouched(true)} />
                  <button onClick={handleSendEmail} disabled={emailSending} className="btn-primary" style={{ flexShrink: 0, opacity: emailSending ? .7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {emailSending ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg> : <Send size={13} />}
                    {emailSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {emailTouched && !emailValid && <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 5 }}>Enter a valid email address</div>}
                {emailSent && <div style={{ fontSize: 10.5, color: 'var(--green)', fontWeight: 600, marginTop: 5 }}>Receipt sent.</div>}
              </div>
            )}
          </>}
        </div>

        {/* Footer actions */}
        {!loading && !errorMsg && details && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={handlePrint} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Printer size={13} />Reprint Receipt</button>
              {!isVoided && (
                <button onClick={() => setEmailOpen(o => !o)} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Mail size={13} />Email Receipt</button>
              )}
              <div style={{ flex: 1 }} />
              {canStartNew && (
                <>
                  <button onClick={() => startRequest('return')} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Undo2 size={13} />Start Return</button>
                  <button onClick={() => startRequest('refund')} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={13} />Start Refund</button>
                </>
              )}
              {showVoidButton && (
                <button onClick={() => setVoidConfirmOpen(true)} disabled={!canVoid} title={voidDisabledReason || undefined}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 16px', height: 38, borderRadius: 8, fontSize: 13, fontWeight: 700,
                    border: '1px solid var(--red)', background: canVoid ? 'var(--red)' : 'transparent', color: canVoid ? '#fff' : 'var(--red)',
                    cursor: canVoid ? 'pointer' : 'not-allowed', opacity: canVoid ? 1 : 0.6, fontFamily: 'inherit',
                  }}>
                  <Ban size={13} />Void Transaction
                </button>
              )}
              <button onClick={onClose} className="btn-primary">Close</button>
            </div>
            {showVoidButton && !isAdmin && canVoid && (
              <div style={{ fontSize: 10.5, color: 'var(--yellow)', fontWeight: 600, textAlign: 'right' }}>
                Void available for {minutesLeftToVoid} more minute{minutesLeftToVoid === 1 ? '' : 's'}
              </div>
            )}
          </div>
        )}
        {(loading || errorMsg) && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
            <button onClick={onClose} className="btn-primary">Close</button>
          </div>
        )}
      </div>

      {/* Hidden printable receipt — same pattern as Cart.jsx's checkout receipt */}
      {receiptTxn && (
        <div style={{ display: 'none' }}>
          <Receipt ref={printRef} txn={receiptTxn} role={role} reprint voided={isVoided} />
        </div>
      )}

      {/* Clicking a return/refund row opens the exact same modal those
          pages use — same approve/reject side effects (fetchProducts for
          returns, syncRefundToTransaction for refunds), then refreshes
          this modal's own numbers so they don't go stale underneath it. */}
      <ReturnDetailsModal
        open={viewRequest?.kind === 'return'} onClose={() => { setViewRequest(null); load() }}
        record={viewRequest?.kind === 'return' ? viewRequest.record : null} isAdmin={isAdmin}
        onApprove={handleApproveReturn} onReject={handleRejectReturn}
      />
      <RefundDetailsModal
        open={viewRequest?.kind === 'refund'} onClose={() => { setViewRequest(null); load() }}
        record={viewRequest?.kind === 'refund' ? viewRequest.record : null} isAdmin={isAdmin}
        onApprove={handleApproveRefund} onReject={handleRejectRefund}
      />

      {/* Void confirmation — deliberately its own modal, same pattern as
          ReturnDetailsModal's Approve confirmation, so a stray click on
          "Void Transaction" itself can never submit anything. */}
      {voidConfirmOpen && details && (
        <Modal open onClose={() => !voiding && setVoidConfirmOpen(false)} closeOnBackdrop={!voiding} closeOnEsc={!voiding} contentStyle={{ width: 'min(460px,92vw)', maxHeight: '90vh' }}>
          <div className="card animate-scale-in" style={{ padding: 24, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 7 }}><Ban size={17} />Void Transaction #{String(details.id).padStart(4, '0')}?</div>

            <div style={{ fontSize: 11.5, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Date & time</span><span>{fmtDateTime(details.createdAt)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Cashier</span><span>{details.cashierName || '—'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Customer</span><span>{details.customerName || 'Walk-in Customer'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Total</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{peso(details.total)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text3)' }}>Payment</span>
                <span>{details.payment || '—'}{(details.payment || '').includes('GCash') && details.gcashReference ? ` · ${details.gcashReference}` : ''}</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Items returning to stock</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: 'var(--text2)' }}>
                {(details.items || []).map((it, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{it.name}</span><span>+{it.qty}</span></div>)}
              </div>
            </div>

            {details.customerId && (
              <div style={{ fontSize: 11.5, color: 'var(--red)', fontWeight: 600 }}>
                −{10 + Math.floor((details.total || 0) / 100)} pts will be removed from {details.customerName}
              </div>
            )}

            <div>
              <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>Reason *</label>
              <select className="form-field" value={voidReason} onChange={e => setVoidReason(e.target.value)}>
                {VOID_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
              {voidNoteRequired && (
                <input type="text" className="form-field" style={{ marginTop: 8 }} placeholder="Describe the reason…"
                  value={voidNote} onChange={e => setVoidNote(e.target.value)} />
              )}
            </div>

            <div style={{ background: isLight ? '#fee2e2' : 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: 10, fontSize: 11.5, color: 'var(--red)', fontWeight: 600, display: 'flex', gap: 6 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>This cannot be undone.</span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setVoidConfirmOpen(false)} disabled={voiding} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleVoidConfirm} disabled={voiding || !voidReasonValid} style={{
                flex: 1, height: 42, borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                background: 'var(--red)', color: '#fff', cursor: (voiding || !voidReasonValid) ? 'not-allowed' : 'pointer', opacity: (voiding || !voidReasonValid) ? 0.6 : 1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {voiding && <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>}
                {voiding ? 'Voiding…' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

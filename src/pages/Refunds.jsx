import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { RefreshCw, ClipboardList, Clock, CheckCircle2, Eye, Tag, AlertTriangle, Check, Info } from 'lucide-react'
import { useRefundStore, useTransactionStore, useAuthStore, useCustomerStore, useAppStore, useReturnStore, resolveLookupId } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, fmtDate, SALE_ADJUSTMENT_DAYS, REFUND_REASONS, REFUND_REASON_OTHER, refundSettledAmount, moneyBackReturnSettledAmount, totalSettledAmount } from '../utils/helpers'
import RefundDetailsModal, { StatusBadge, METHOD_ICON } from '../components/RefundDetailsModal'
import PolicyModal from '../components/PolicyModal'
import SaleLookup from '../components/SaleLookup'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const REFUND_METHODS = ['Cash', 'GCash']

const STEPS = [
  { num: 1, label: 'Look up' },
  { num: 2, label: 'Details' },
  { num: 3, label: 'Confirm' },
]

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected']

export default function Refunds() {
  useDocumentTitle('Refunds')
  const t = useT()
  const toast = useToast()
  const { role } = useAuthStore()
  const { theme, markRefundsSeen } = useAppStore()
  const { transactions, updateTransaction } = useTransactionStore()
  const { refunds, addRefund, updateRefund, rejectRefund } = useRefundStore()
  const { returns } = useReturnStore()
  const { revertPurchase } = useCustomerStore()
  const [searchParams] = useSearchParams()

  const isAdmin = role === 'admin'
  const [showPolicy, setShowPolicy] = useState(true)
  const isLight = theme === 'light'

  // ── Wizard state ─────────────────────────────────────────
  const [step,          setStep]         = useState(1)
  const [selectedTxn,   setSelectedTxn]  = useState(null)
  // Lets the Dashboard/Reports "Sales breakdown" card deep-link here already
  // filtered (e.g. /refunds?status=Approved).
  const [filterStatus,  setFilterStatus] = useState(() => searchParams.get('status') || 'All')
  const [viewRefund,    setViewRefund]   = useState(null)
  const [details, setDetails] = useState({
    reason: REFUND_REASONS[0],
    amount: '',
    method: 'Cash',
    notes: '',
  })

  // ── Stats ─────────────────────────────────────────────────
  const pendingCount = useMemo(() => refunds.filter(r => r.status === 'Pending').length, [refunds])
  const stats = useMemo(() => {
    const approved = refunds.filter(r => r.status === 'Approved').length
    const totalRefunded = refunds
      .filter(r => r.status === 'Approved')
      .reduce((s, r) => s + r.total, 0)
    return [
      { label: 'Total Refunds',  value: refunds.length, borderColor: isLight ? '#2563eb' : 'var(--blue)',   valueColor: 'var(--text)', icon: ClipboardList },
      { label: 'Pending',        value: pendingCount,    borderColor: isLight ? '#d97706' : 'var(--yellow)', valueColor: isLight ? '#d97706' : 'var(--yellow)', icon: Clock },
      { label: 'Approved',       value: approved,        borderColor: isLight ? '#059669' : 'var(--accent)', valueColor: isLight ? '#059669' : 'var(--accent)', icon: CheckCircle2 },
      { label: 'Total Refunded', value: peso(totalRefunded), borderColor: isLight ? '#dc2626' : 'var(--red)', valueColor: 'var(--text)', icon: RefreshCw },
    ]
  }, [refunds, pendingCount, isLight])

  // Admin reviews/approves requests here, so the tab shows how many are
  // waiting — cashiers just see the page they submit requests from.
  useDocumentTitle(isAdmin ? (pendingCount > 0 ? `(${pendingCount}) Refund Approval` : 'Refund Approval') : 'Refunds')

  const statusCounts = useMemo(() => ({
    All: refunds.length,
    Pending: refunds.filter(r => r.status === 'Pending').length,
    Approved: refunds.filter(r => r.status === 'Approved').length,
    Rejected: refunds.filter(r => r.status === 'Rejected').length,
  }), [refunds])

  // ── Filtered refunds table ────────────────────────────────
  const filteredRefunds = useMemo(() =>
    refunds
      .filter(r => filterStatus === 'All' || r.status === filterStatus)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [refunds, filterStatus]
  )
  const refundsPg = usePagination(filteredRefunds)
  useEffect(() => { refundsPg.setPage(1) }, [filterStatus])

  // How much of this transaction is still refundable: its total minus
  // every Pending/Approved refund already filed AND every Pending/Approved
  // money-back return (a Replacement return pays nothing back, so it's
  // excluded — see isMoneyBack in salesMetrics.js). Mirrors the cap
  // create_refund itself enforces server-side (add_create_refund_rpc.sql).
  const remaining = selectedTxn ? Math.max(0, selectedTxn.total - totalSettledAmount(selectedTxn.id, refunds, returns)) : 0

  const daysSince = selectedTxn ? differenceInCalendarDays(new Date(), new Date(selectedTxn.createdAt)) : null
  const expired = daysSince != null && daysSince > SALE_ADJUSTMENT_DAYS

  // Clears the sidebar's pending-request badge the moment this page is opened.
  useEffect(() => { markRefundsSeen() }, [])

  // Keeps every transaction's status (Refunded/Partially Refunded) fresh,
  // recomputed from its currently-APPROVED refunds every time the list
  // changes. Refunds-only on purpose (not returns) — a sale that was only
  // ever *returned* must never show "Partially Refunded" here just because
  // a return also pays money back; "Returned" (SaleLookup.jsx) covers that
  // case. Pure and safe to redo unconditionally, unlike the points
  // reversal below.
  useEffect(() => {
    if (!transactions.length) return
    const touchedIds = new Set(refunds.filter(r => r.status === 'Approved').map(r => r.transactionId))
    touchedIds.forEach(txnId => {
      const txn = transactions.find(tx => tx.id === txnId)
      if (!txn) return
      const settled = refundSettledAmount(txnId, refunds)
      const correctStatus = settled >= txn.total ? 'Refunded' : 'Partially Refunded'
      if (txn.status !== correctStatus) updateTransaction(txn.id, { status: correctStatus })
    })
  }, [transactions, refunds])

  // One-time reconciliation for refunds that were approved before this sync
  // existed — a historical, points-only backfill (status is handled by the
  // effect above now), so each transaction is touched here at most once,
  // ever. Any refund approved *after* this point is instead handled live,
  // exactly once, by handleApprove -> syncRefundToTransaction below.
  const reconciled = useRef(false)
  useEffect(() => {
    if (reconciled.current || !transactions.length || !refunds.length) return
    reconciled.current = true
    const byTxn = new Map()
    refunds.filter(r => r.status === 'Approved').forEach(r => {
      if (!byTxn.has(r.transactionId)) byTxn.set(r.transactionId, [])
      byTxn.get(r.transactionId).push(r)
    })
    byTxn.forEach(async (txnRefunds, txnId) => {
      const txn = transactions.find(tx => tx.id === txnId)
      if (!txn || txn.status === 'Refunded' || txn.status === 'Partially Refunded' || !txn.customerId) return
      const refundTotal = txnRefunds.reduce((s, r) => s + (r.total || 0), 0)
      await revertPurchase(txn.customerId, { refundTotal, fullRefund: refundTotal >= txn.total })
    })
  }, [transactions, refunds])

  // ── Handlers ─────────────────────────────────────────────
  const handleLookup = async (rawQuery) => {
    const trimmed = (rawQuery || '').trim()
    if (!trimmed) return { ok: false, message: 'Enter a transaction ID or scan a serial' }
    const txnId = await resolveLookupId(trimmed)
    const txn = txnId != null ? transactions.find(tx => tx.id === txnId) : null
    if (!txn) return { ok: false, message: t('txn_not_found') }
    if (refunds.some(r => r.transactionId === txn.id && r.status === 'Pending')) return { ok: false, message: 'This transaction already has a pending refund request' }
    const daysSinceTxn = differenceInCalendarDays(new Date(), new Date(txn.createdAt))
    if (daysSinceTxn > SALE_ADJUSTMENT_DAYS) return { ok: false, message: `Refund period expired: refunds can only be requested within ${SALE_ADJUSTMENT_DAYS} days of purchase` }
    if (totalSettledAmount(txn.id, refunds, returns) >= txn.total) return { ok: false, message: 'This transaction has already been fully refunded' }
    setSelectedTxn(txn)
    setDetails({ reason: REFUND_REASONS[0], amount: '', method: 'Cash', notes: '' })
    setStep(2)
    return { ok: true, message: `Found #${String(txn.id).padStart(4, '0')}` }
  }

  const goToStep3 = () => {
    if (!details.reason) return toast('Please select a reason', 'error')
    const amt = parseFloat(details.amount)
    if (!amt || amt <= 0) return toast('Enter a refund amount', 'error')
    if (amt > remaining) return toast(`Refund amount can't exceed ${peso(remaining)} remaining on this transaction`, 'error')
    if (details.reason === REFUND_REASON_OTHER && !details.notes.trim()) return toast('Please explain the reason in the notes.', 'error')
    setStep(3)
  }

  const handleSubmit = async () => {
    const { error } = await addRefund({
      transactionId: selectedTxn.id,
      amount: parseFloat(details.amount),
      reason: details.reason,
      refundMethod: details.method,
      notes: details.notes,
    })
    if (error) return toast(error.message || 'Failed to submit refund — please try again', 'error')
    toast(t('refund_processed'), 'success')
    resetWizard()
  }

  const handleApprove = async (r) => {
    await updateRefund(r.id, { status: 'Approved' })
    // Refunds never restock or touch inventory — they're money-only now
    // (an item physically coming back is always a Return; see Returns.jsx).
    await syncRefundToTransaction(r)
    toast('Refund approved', 'success')
  }

  const handleReject = async (r, reason) => {
    const { error } = await rejectRefund(r.id, reason)
    if (error) return { error }
    toast('Refund rejected', 'info')
  }

  const resetWizard = () => {
    setStep(1); setSelectedTxn(null)
    setDetails({ reason: REFUND_REASONS[0], amount: '', method: 'Cash', notes: '' })
  }

  // Reverses this refund's loyalty-points impact on the customer (points,
  // purchase count, total spent) — same formula revertPurchase uses
  // elsewhere, and the one approve_return applies server-side for
  // money-back returns. "Fully settled" is checked across BOTH refunds and
  // money-back returns (the flat +10/purchase-count bonus should only flip
  // once the whole transaction is actually paid back, through whichever
  // mix of the two channels got it there), but the transaction's own
  // status field (above) stays refunds-only by design.
  const syncRefundToTransaction = async (r) => {
    const txn = transactions.find(tx => tx.id === r.transactionId)
    if (!txn || !txn.customerId) return
    const settledBefore = refundSettledAmount(txn.id, refunds, { excludeIds: [r.id] }) + moneyBackReturnSettledAmount(txn.id, returns)
    const settledAfter = settledBefore + r.total
    const wasFullBefore = settledBefore >= txn.total
    const isFullAfter = settledAfter >= txn.total
    await revertPurchase(txn.customerId, { refundTotal: r.total, fullRefund: !wasFullBefore && isFullAfter })
  }

  // ── Shared styles ─────────────────────────────────────────
  const card = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10 }
  const navBtn = { height: 48 }

  const POLICY_ITEMS = [
    { icon: '🕒', title: `${SALE_ADJUSTMENT_DAYS}-Day Refund Window`, desc: `Refunds can only be requested within ${SALE_ADJUSTMENT_DAYS} days of the original purchase date.` },
    { icon: '🧾', title: 'Valid Reasons',           desc: 'Only for services not done or cancelled, and cashier mistakes like wrong quantity charged. To return an item, use Returns.' },
    { icon: '📄', title: 'Proof of Purchase',       desc: 'The original transaction receipt or ID must be provided for verification.' },
    { icon: '🛡️', title: 'Administrator Review',   desc: 'Each request is evaluated by the Admin for eligibility before approval.' },
    { icon: '💰', title: 'Refund Amount',           desc: 'Never more than what was actually paid on the transaction.' },
    { icon: '💳', title: 'Refund Method',           desc: 'Released as Cash or GCash.' },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── HEADER ── */}
      <div style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>
        Money-only billing corrections · Admin approval required
      </div>

      {/* ── STATS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, flexShrink: 0 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card, padding: 18, borderTop: `2px solid ${s.borderColor}`, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 15, right: 15, opacity: 0.15, color: s.borderColor }}>
              <s.icon size={24}/>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6, fontWeight: 700 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.valueColor, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <PolicyModal
        open={showPolicy}
        onClose={() => setShowPolicy(false)}
        title="Refund Policy"
        rules={POLICY_ITEMS}
        buttonLabel="I Understand — Proceed to Refund"
        footerText={<>By proceeding you confirm that you have read and understood the refund policy.<br/>Defective items are covered by the store and manufacturer warranty, even after {SALE_ADJUSTMENT_DAYS} days.</>}
      />

      {/* ── MAIN GRID ── */}
      <div className="dual-panel-grid">

        {/* LEFT: Wizard */}
        <div className="form-panel" style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 300px', maxWidth: 360 }}>

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {STEPS.map((s, i) => (
              <Fragment key={s.num}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: step === s.num ? (isLight ? '#059669' : 'var(--accent)') : step > s.num ? (isLight ? '#d1fae5' : 'rgba(52,211,153,0.15)') : 'var(--bg3)',
                    color: step === s.num ? (isLight ? '#fff' : '#0a0a0a') : step > s.num ? (isLight ? '#047857' : 'var(--accent)') : 'var(--text3)',
                    border: step > s.num ? (isLight ? '1px solid #6ee7b7' : '1px solid rgba(52,211,153,0.3)') : '1px solid var(--border2)',
                    transition: 'all .2s',
                  }}>
                    {step > s.num ? '✓' : s.num}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: step >= s.num ? 'var(--text2)' : 'var(--text3)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, marginTop: 11, borderRadius: 99, background: step > s.num ? (isLight ? '#059669' : 'var(--accent)') : 'var(--bg3)', transition: 'background .3s' }} />
                )}
              </Fragment>
            ))}
          </div>

          {/* ── STEP 1: Lookup ── */}
          {step === 1 && <SaleLookup mode="refund" onSaleFound={handleLookup} />}

          {/* ── STEP 2: Refund details ── */}
          {step === 2 && selectedTxn && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* TXN info */}
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700 }}>
                    #{String(selectedTxn.id).padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDate(selectedTxn.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>
                  {selectedTxn.customerName || 'Walk-in'} · {peso(selectedTxn.total)}
                </div>
                {expired ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>
                    <AlertTriangle size={13} />Refund period expired (purchased {fmtDate(selectedTxn.createdAt)})
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Remaining refundable: <strong style={{ color: 'var(--text)' }}>{peso(remaining)}</strong></div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('reason')} *
                </label>
                <select className="form-field"
                  value={details.reason} onChange={e => setDetails(d => ({ ...d, reason: e.target.value }))}>
                  {REFUND_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  Amount (₱) *
                </label>
                <input type="number" min="0" max={remaining} step="0.01" className="form-field" style={{ fontVariantNumeric: 'tabular-nums' }}
                  placeholder={`Up to ${peso(remaining)}`} value={details.amount} onChange={e => setDetails(d => ({ ...d, amount: e.target.value }))}/>
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('refund_method')}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {REFUND_METHODS.map(m => {
                    const MIcon = METHOD_ICON[m] || Tag
                    const active = details.method === m
                    return (
                    <button key={m} onClick={() => setDetails(d => ({ ...d, method: m }))} style={{
                      padding: '10px 4px', minHeight: 42, borderRadius: 8, border: active ? '2px solid' : '1px solid', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      ...(active
                        ? { borderColor: isLight ? '#059669' : 'var(--accent)', background: isLight ? 'rgba(4,120,87,0.1)' : 'rgba(52,211,153,0.12)', color: isLight ? '#047857' : 'var(--accent)' }
                        : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text2)' })
                    }}>
                      {active ? <Check size={13}/> : <MIcon size={13}/>}{m}
                    </button>
                  )})}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('notes')} {details.reason === REFUND_REASON_OTHER ? '*' : '(optional)'}
                </label>
                <textarea className="form-field form-field-textarea" rows={3}
                  placeholder="Additional notes about this refund..."
                  value={details.notes} onChange={e => setDetails(d => ({ ...d, notes: e.target.value }))}/>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetWizard} className="btn-secondary" style={{ flex: 1, ...navBtn }}>← Back</button>
                <button onClick={goToStep3} disabled={expired} className="btn-primary" style={{ flex: 2, ...navBtn, opacity: expired ? 0.5 : 1, cursor: expired ? 'not-allowed' : 'pointer' }}>Review →</button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: isLight ? '#f9fafb' : 'rgba(52,211,153,0.04)', border: isLight ? '1px solid #e5e7eb' : '1px solid rgba(52,211,153,0.15)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17 }}>
                  <span>Refund Amount</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(parseFloat(details.amount) || 0)}</span>
                </div>
              </div>

              {/* Details summary */}
              <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)' }}>Transaction</span><span>#{String(selectedTxn.id).padStart(4, '0')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)' }}>Reason</span><span>{details.reason}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)' }}>Method</span><span>{details.method}</span>
                </div>
                {details.notes && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: 'var(--text3)', flexShrink: 0 }}>Notes</span><span style={{ textAlign: 'right' }}>{details.notes}</span>
                  </div>
                )}
              </div>

              {/* Cashier note */}
              {!isAdmin && (
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--yellow)', lineHeight: 1.6, display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/><span>Refund will be submitted as <strong>Pending</strong>. Admin must approve before it's finalized.</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(2)} className="btn-secondary" style={{ flex: 1, ...navBtn }}>← Back</button>
                <button onClick={handleSubmit} className="btn-primary" style={{ flex: 2, ...navBtn, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <RefreshCw size={14}/>Submit Refund
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Refund history table */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '2 1 420px' }}>
          {/* Table header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><ClipboardList size={14} style={{color:'var(--accent)'}}/>Refund History</div>
            {/* Status filter pills */}
            <div style={{ display: 'flex', gap: 6 }}>
              {STATUS_FILTERS.map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: '4px 12px', borderRadius: 99, border: '1px solid', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                  ...(filterStatus === s
                    ? { background: isLight ? '#059669' : 'var(--accent)', borderColor: isLight ? '#059669' : 'var(--accent)', color: isLight ? '#fff' : '#0a0a0a' }
                    : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text2)' })
                }}>{s} {statusCounts[s]}</button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {['Refund #', 'Txn #', 'Date', 'Customer', 'Total', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Total' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.7px', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRefunds.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text3)' }}>
                    <RefreshCw size={32} style={{ opacity: .2, marginBottom: 8 }}/>
                    <div>No refunds found</div>
                  </td></tr>
                ) : refundsPg.pageItems.map(r => {
                  const isWalkIn = (r.customerName || 'Walk-in') === 'Walk-in'
                  return (
                  <tr key={r.id} className="refund-row" style={{
                    borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    background: r.status === 'Pending' ? (isLight ? '#fffbeb' : 'rgba(245,158,11,0.05)') : 'transparent',
                  }} onClick={() => setViewRefund(r)}>
                    <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700 }}>#{String(r.id).padStart(4, '0')}</td>
                    <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>#{String(r.transactionId).padStart(4, '0')}</td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: isWalkIn ? 'var(--text3)' : 'var(--text)', fontStyle: isWalkIn ? 'italic' : 'normal' }}>{r.customerName || 'Walk-in'}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text)', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{peso(r.total)}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <StatusBadge status={r.status} isLight={isLight}/>
                      {r.status === 'Rejected' && r.rejectionReason && (
                        <div title={r.rejectionReason} style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 3, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {r.status === 'Pending' ? (
                        <button onClick={e => { e.stopPropagation(); setViewRefund(r) }} className="btn-success" style={{ fontSize: 11, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Eye size={12}/>Review
                        </button>
                      ) : (
                        <button onClick={e => { e.stopPropagation(); setViewRefund(r) }} title="View details" style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0,
                        }}><Eye size={13}/></button>
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '0 20px', flexShrink: 0 }}><Pagination {...refundsPg}/></div>

          {/* Footer note */}
          <div style={{ margin: '0 20px 16px', padding: '10px 14px', borderRadius: 10, background: isLight ? '#eff6ff' : 'rgba(59,130,246,0.08)', border: `1px solid ${isLight ? '#bfdbfe' : 'rgba(59,130,246,0.25)'}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <Info size={14} style={{color:'var(--blue)',flexShrink:0}}/>
            <span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
              Refunds return money only and do not change inventory.
            </span>
          </div>
        </div>
      </div>

      <RefundDetailsModal
        open={!!viewRefund}
        onClose={() => setViewRefund(null)}
        record={viewRefund}
        type="refund"
        isAdmin={isAdmin}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  )
}

import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, ClipboardList, Clock, CheckCircle2, Eye, Search, Package, Tag, AlertTriangle } from 'lucide-react'
import { useRefundStore, useTransactionStore, useAuthStore, useProductStore, useCustomerStore, useAppStore } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, fmtDate, REFUND_REASONS } from '../utils/helpers'
import RefundDetailsModal, { StatusBadge, METHOD_ICON } from '../components/RefundDetailsModal'
import ProductThumb from '../components/ProductThumb'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const REFUND_METHODS = ['Cash', 'GCash', 'Store Credit']

const STEPS = [
  { num: 1, label: 'Look up transaction' },
  { num: 2, label: 'Select items' },
  { num: 3, label: 'Refund details' },
  { num: 4, label: 'Confirm & submit' },
]

export default function Refunds() {
  const t = useT()
  const toast = useToast()
  const { role, user } = useAuthStore()
  const { theme, markRefundsSeen } = useAppStore()
  const { transactions, updateTransaction } = useTransactionStore()
  const { products, restockProduct } = useProductStore()
  const { refunds, addRefund, updateRefund } = useRefundStore()
  const { revertPurchase } = useCustomerStore()
  const [searchParams] = useSearchParams()

  const isAdmin = role === 'admin'
  const [showPolicy, setShowPolicy] = useState(true)
  const isLight = theme === 'light'

  // ── Wizard state ─────────────────────────────────────────
  const [step,          setStep]         = useState(1)
  const [searchId,      setSearchId]     = useState('')
  const [selectedTxn,   setSelectedTxn]  = useState(null)
  const [refundItems,   setRefundItems]  = useState({})
  // Lets the Dashboard/Reports "Sales breakdown" card deep-link here already
  // filtered (e.g. /refunds?status=Approved).
  const [filterStatus,  setFilterStatus] = useState(() => searchParams.get('status') || 'All')
  const [viewRefund,    setViewRefund]   = useState(null)
  const [details, setDetails] = useState({
    reason: REFUND_REASONS[0],
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
      { label: 'Total Refunds',  value: refunds.length, color: isLight ? '#2563eb' : 'var(--blue)',   icon: ClipboardList },
      { label: 'Pending',        value: pendingCount,    color: isLight ? '#d97706' : 'var(--yellow)', icon: Clock },
      { label: 'Approved',       value: approved,        color: isLight ? '#059669' : 'var(--accent)', icon: CheckCircle2 },
      { label: 'Total Refunded', value: peso(totalRefunded), color: isLight ? '#dc2626' : 'var(--red)', icon: RefreshCw },
    ]
  }, [refunds, pendingCount, isLight])

  // Admin reviews/approves requests here, so the tab shows how many are
  // waiting — cashiers just see the page they submit requests from.
  useDocumentTitle(isAdmin ? (pendingCount > 0 ? `(${pendingCount}) Refund Approval` : 'Refund Approval') : 'Refunds')

  // ── Filtered refunds table ────────────────────────────────
  const filteredRefunds = useMemo(() =>
    refunds
      .filter(r => filterStatus === 'All' || r.status === filterStatus)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [refunds, filterStatus]
  )
  const refundsPg = usePagination(filteredRefunds)
  useEffect(() => { refundsPg.setPage(1) }, [filterStatus])

  const calcTotals = () => {
    if (!selectedTxn) return { subtotal: 0, vat: 0, total: 0 }
    const subtotal = selectedTxn.items.reduce((sum, item) => {
      const ri = refundItems[item.id]
      return ri?.selected ? sum + item.price * ri.qty : sum
    }, 0)
    const vat   = subtotal * 0.12
    const total = subtotal + vat
    return { subtotal, vat, total: Math.round(total) }
  }

  const selectedCount = Object.values(refundItems).filter(r => r.selected).length
  const { subtotal, vat, total } = calcTotals()

  // Marks the original transaction Refunded/Partially Refunded and reverses the
  // customer's loyalty stats for an approved refund. Safe to call more than once —
  // skips transactions that are already synced.
  const syncRefundToTransaction = async (r) => {
    const txn = transactions.find(tx => tx.id === r.transactionId)
    if (!txn || txn.status === 'Refunded' || txn.status === 'Partially Refunded') return
    const fullRefund = txn.items.every(item => {
      const ri = r.items.find(i => i.id === item.id)
      return ri && (ri.refundQty || ri.qty) >= item.qty
    })
    await updateTransaction(txn.id, { status: fullRefund ? 'Refunded' : 'Partially Refunded' })
    if (txn.customerId) await revertPurchase(txn.customerId, { refundTotal: r.total, fullRefund })
  }

  // Clears the sidebar's pending-request badge the moment this page is opened.
  useEffect(() => { markRefundsSeen() }, [])

  // One-time reconciliation for refunds that were approved before this sync existed.
  const reconciled = useRef(false)
  useEffect(() => {
    if (reconciled.current || !transactions.length || !refunds.length) return
    reconciled.current = true
    refunds
      .filter(r => r.status === 'Approved')
      .forEach(r => syncRefundToTransaction(r))
  }, [transactions, refunds])

  // ── Handlers ─────────────────────────────────────────────
  const handleLookup = () => {
    if (!searchId.trim()) return toast('Enter a transaction ID', 'error')
    const query = searchId.trim().replace('#', '')
    const txn = transactions.find(tx => String(tx.id).padStart(4, '0') === query.padStart(4, '0'))
    if (!txn) return toast(t('txn_not_found'), 'error')
    if (txn.status === 'Refunded') return toast('This transaction was already refunded', 'warning')
    if (refunds.some(r => r.transactionId === txn.id && r.status === 'Pending')) return toast('This transaction already has a pending refund request', 'warning')
    setSelectedTxn(txn)
    const init = {}
    txn.items.forEach(item => { init[item.id] = { selected: false, qty: 1 } })
    setRefundItems(init)
    setStep(2)
  }

  const toggleItem = (itemId) => {
    setRefundItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], selected: !prev[itemId]?.selected }
    }))
  }

  const setRefundItemQty = (itemId, qty, max) => {
    setRefundItems(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], qty: Math.max(1, Math.min(qty, max)) }
    }))
  }

  const goToStep3 = () => {
    if (selectedCount === 0) return toast('Select at least one item', 'error')
    setStep(3)
  }

  const goToStep4 = () => {
    if (!details.reason) return toast('Please select a reason', 'error')
    setStep(4)
  }

  const handleSubmit = async () => {
    if (selectedCount === 0) return toast('Select at least one item', 'error')
    const selectedList = selectedTxn.items
      .filter(item => refundItems[item.id]?.selected)
      .map(item => ({ ...item, refundQty: refundItems[item.id].qty }))

    const r = await addRefund({
      transactionId: selectedTxn.id,
      customerName:  selectedTxn.customerName || 'Walk-in',
      reason:        details.reason,
      refundMethod:  details.method,
      notes:         details.notes,
      total:         total,
      subtotal,
      vat,
      status:        'Pending',
      processedBy:   user?.user_metadata?.name || role || 'Admin',
      items:         selectedList,
    })

    if (!r) return toast('Failed to submit refund — please try again', 'error')
    toast(t('refund_processed'), 'success')
    resetWizard()
  }

  const handleApprove = async (r) => {
    await updateRefund(r.id, { status: 'Approved' })
    if (r.items?.length) {
      r.items.forEach(item => {
        const prod = products.find(p => p.id === item.id)
        if (prod) restockProduct(prod.id, item.refundQty || item.qty || 1)
      })
    }
    // items/status just changed locally via updateRefund, but r is the pre-update
    // object — status doesn't matter for syncRefundToTransaction, only r.items/total do.
    await syncRefundToTransaction(r)
    toast('Refund approved — items restocked', 'success')
  }

  const handleReject = async (r) => {
    await updateRefund(r.id, { status: 'Rejected' })
    toast('Refund rejected', 'info')
  }

  const resetWizard = () => {
    setStep(1); setSearchId(''); setSelectedTxn(null)
    setRefundItems({}); setDetails({ reason: REFUND_REASONS[0], method: 'Cash', notes: '' })
  }

  // ── Shared styles ─────────────────────────────────────────
  const card = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6 }

  const POLICY_ITEMS = [
    { icon: '🕒', title: '15-Day Return Window',      desc: 'Items must be returned within 15 days from the original date of purchase.' },
    { icon: '🛡️', title: 'Administrator Review',      desc: 'Each request is evaluated by the Admin for eligibility before approval.' },
    { icon: '💳', title: 'Original Payment Method',   desc: 'Refunds are issued via the same payment method used in the original purchase.' },
    { icon: '🧾', title: 'Transaction Required',       desc: 'The original transaction receipt or ID must be provided for verification.' },
    { icon: '📦', title: 'Inventory Restocking',       desc: 'Approved items are automatically restocked back into the store inventory.' },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={18} style={{color:'var(--blue)'}}/>Refunds
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
            Manage refund requests · Admin approval required
          </div>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, flexShrink: 0 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card, padding: 18, borderTop: `2px solid ${s.color}`, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 15, right: 15, opacity: 0.15, color: s.color }}>
              <s.icon size={24}/>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════
        POLICY POPUP OVERLAY
      ══════════════════════════════════ */}
      {showPolicy && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
          overflowY: 'auto',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            maxWidth: 460, width: '100%',
            overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            margin: 'auto',
          }}>

            {/* ── Top header ── */}
            <div style={{
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              padding: '20px 24px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                Refund Policy
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

            {/* ── Policy list ── */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, background: '#ffffff' }}>
              {POLICY_ITEMS.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '12px 14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
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

            {/* ── Footer button ── */}
            <div style={{ padding: '0 20px 20px', background: '#ffffff' }}>
              <button
                onClick={() => setShowPolicy(false)}
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
                I Understand — Proceed to Refund
              </button>
              <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: '#94a3b8' }}>
                By proceeding you confirm that you have read and understood the refund policy.
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── MAIN GRID ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, flexShrink: 0 }}>

        {/* LEFT: Wizard */}
        <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 300px', maxWidth: 360 }}>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map(s => (
              <div key={s.num} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: step === s.num ? (isLight ? '#059669' : 'var(--accent)') : step > s.num ? (isLight ? '#d1fae5' : 'rgba(52,211,153,0.15)') : 'var(--bg3)',
                  color: step === s.num ? (isLight ? '#fff' : '#0a0a0a') : step > s.num ? (isLight ? '#047857' : 'var(--accent)') : 'var(--text3)',
                  border: step > s.num ? (isLight ? '1px solid #6ee7b7' : '1px solid rgba(52,211,153,0.3)') : '1px solid var(--border2)',
                  transition: 'all .2s',
                }}>
                  {step > s.num ? '✓' : s.num}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: step >= s.num ? 'var(--text2)' : 'var(--text3)', textAlign: 'center', letterSpacing: '.2px' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ height: 2, background: 'var(--bg3)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: isLight ? '#059669' : 'var(--accent)', borderRadius: 99, width: `${((step - 1) / 3) * 100}%`, transition: 'width .3s' }}/>
          </div>

          {/* ── STEP 1: Lookup ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Look up Transaction</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
                  Enter the Transaction ID from the original sale receipt.
                </div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('orig_txn')} #
                </label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }}/>
                  <input
                    className="input-field"
                    style={{ paddingLeft: 34 }}
                    placeholder="e.g. 0021"
                    value={searchId}
                    onChange={e => setSearchId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLookup()}
                  />
                </div>
              </div>
              <button onClick={handleLookup} className="btn-primary" style={{ width: '100%', padding: 12 }}>
                {t('look_up')} →
              </button>

              {/* Recent transactions hint */}
              {transactions.length > 0 && (
                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 9.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, fontWeight: 700 }}>Recent Transactions</div>
                  {transactions.slice(0, 4).map(tx => (
                    <div key={tx.id} onClick={() => setSearchId(String(tx.id).padStart(4, '0'))} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.7'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: isLight ? '#059669' : 'var(--accent)' }}>#{String(tx.id).padStart(4, '0')}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--text2)' }}>{tx.customerName || 'Walk-in'}</span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: 'var(--green)' }}>{peso(tx.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Select Items ── */}
          {step === 2 && selectedTxn && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* TXN info */}
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700 }}>
                    #{String(selectedTxn.id).padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDate(selectedTxn.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {selectedTxn.customerName || 'Walk-in'} · {peso(selectedTxn.total)}
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Select items to refund:</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {selectedTxn.items.map(item => {
                  const ri = refundItems[item.id]
                  const isSelected = ri?.selected
                  const product = products.find(p => p.id === item.id)
                  return (
                    <div key={item.id} onClick={() => toggleItem(item.id)} style={{
                      background: isSelected ? (isLight ? '#ecfdf5' : 'rgba(52,211,153,0.05)') : 'var(--bg3)',
                      border: `1px solid ${isSelected ? (isLight ? '#6ee7b7' : 'rgba(52,211,153,0.3)') : 'var(--border)'}`,
                      borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                      transition: 'all .15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Checkbox */}
                        <div style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          border: `2px solid ${isSelected ? (isLight ? '#059669' : 'var(--accent)') : 'var(--border2)'}`,
                          background: isSelected ? (isLight ? '#059669' : 'var(--accent)') : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all .15s',
                        }}>
                          {isSelected && <span style={{ fontSize: 10, color: '#0a0a0a', fontWeight: 700 }}>✓</span>}
                        </div>
                        {product
                          ? <ProductThumb image={product.image} icon={product.icon} category={product.category} size={36} radius={6}/>
                          : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg4)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, flexShrink: 0 }}><Package size={14}/></div>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{item.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                            {peso(item.price)} × {item.qty} = {peso(item.price * item.qty)}
                          </div>
                        </div>
                        {/* Qty selector */}
                        {isSelected && (
                          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => setRefundItemQty(item.id, ri.qty - 1, item.qty)} style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg4)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{ri.qty}</span>
                            <button onClick={() => setRefundItemQty(item.id, ri.qty + 1, item.qty)} style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg4)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={resetWizard} className="btn-secondary" style={{ flex: 1, padding: 10 }}>← Back</button>
                <button onClick={goToStep3} className="btn-primary" style={{ flex: 2, padding: 10 }}>
                  Next ({selectedCount} item{selectedCount !== 1 ? 's' : ''}) →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Details ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('reason')} *
                </label>
                <select className="select-field" style={{ width: '100%' }}
                  value={details.reason} onChange={e => setDetails(d => ({ ...d, reason: e.target.value }))}>
                  {REFUND_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('refund_method')}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(90px,1fr))', gap: 6 }}>
                  {REFUND_METHODS.map(m => {
                    const MIcon = METHOD_ICON[m] || Tag
                    return (
                    <button key={m} onClick={() => setDetails(d => ({ ...d, method: m }))} style={{
                      padding: '8px 4px', borderRadius: 8, border: '1px solid', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      ...(details.method === m
                        ? { borderColor: isLight ? '#059669' : 'var(--accent)', background: isLight ? 'rgba(4,120,87,0.08)' : 'rgba(52,211,153,0.08)', color: isLight ? '#047857' : 'var(--accent)' }
                        : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text2)' })
                    }}>
                      <MIcon size={13}/>{m}
                    </button>
                  )})}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {t('notes')} (optional)
                </label>
                <textarea className="input-field" rows={3} style={{ resize: 'none' }}
                  placeholder="Additional notes about this refund..."
                  value={details.notes} onChange={e => setDetails(d => ({ ...d, notes: e.target.value }))}/>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(2)} className="btn-secondary" style={{ flex: 1, padding: 10 }}>← Back</button>
                <button onClick={goToStep4} className="btn-primary" style={{ flex: 2, padding: 10 }}>Review →</button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Confirm ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Items summary */}
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, fontWeight: 700 }}>Items to refund</div>
                {selectedTxn.items.filter(i => refundItems[i.id]?.selected).map(item => {
                  const product = products.find(p => p.id === item.id)
                  return (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {product
                          ? <ProductThumb image={product.image} icon={product.icon} category={product.category} size={20} radius={4}/>
                          : <div style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={11}/></div>}
                        <span>{item.name} ×{refundItems[item.id].qty}</span>
                      </div>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text)' }}>{peso(item.price * refundItems[item.id].qty)}</span>
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
              <div style={{ background: isLight ? '#f9fafb' : 'rgba(52,211,153,0.04)', border: isLight ? '1px solid #e5e7eb' : '1px solid rgba(52,211,153,0.15)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>
                  <span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  <span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(vat)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <span>Refund Total</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(total)}</span>
                </div>
              </div>

              {/* Details summary */}
              <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)' }}>Reason</span><span>{details.reason}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)' }}>Method</span><span>{details.method}</span>
                </div>
              </div>

              {/* Cashier note */}
              {!isAdmin && (
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--yellow)', lineHeight: 1.6, display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/><span>Refund will be submitted as <strong>Pending</strong>. Admin must approve before items are restocked.</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(3)} className="btn-secondary" style={{ flex: 1, padding: 10 }}>← Back</button>
                <button onClick={handleSubmit} className="btn-primary" style={{ flex: 2, padding: 12, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
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
              {['All', 'Pending', 'Approved', 'Rejected'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: '4px 12px', borderRadius: 99, border: '1px solid', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                  ...(filterStatus === s
                    ? { background: isLight ? '#059669' : 'var(--accent)', borderColor: isLight ? '#059669' : 'var(--accent)', color: isLight ? '#fff' : '#0a0a0a' }
                    : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text2)' })
                }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {['Refund #', 'TXN #', 'Date', 'Customer', 'Total', 'Status', 'View'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.7px', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRefunds.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text3)' }}>
                    <RefreshCw size={32} style={{ opacity: .2, marginBottom: 8 }}/>
                    <div>No refunds found</div>
                  </td></tr>
                ) : refundsPg.pageItems.map(r => (
                  <tr key={r.id} className="refund-row" style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setViewRefund(r)}>
                    <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700 }}>#{String(r.id).padStart(4, '0')}</td>
                    <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>#{String(r.transactionId).padStart(4, '0')}</td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12 }}>{r.customerName}</td>
                    <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>{peso(r.total)}</td>
                    <td style={{ padding: '11px 14px' }}><StatusBadge status={r.status} isLight={isLight}/></td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={e => { e.stopPropagation(); setViewRefund(r) }} title="View details" style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0,
                        }}><Eye size={13}/></button>
                        {r.status === 'Pending' && (
                          <span style={{ fontSize: 10, color: 'var(--yellow)' }}>{isAdmin ? 'Needs review' : 'Awaiting Admin'}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '0 20px', flexShrink: 0 }}><Pagination {...refundsPg}/></div>

          {/* Footer note */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <AlertTriangle size={14} style={{color:'var(--yellow)',flexShrink:0}}/>
            <span style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
              Items are automatically <span style={{ color: isLight ? '#059669' : 'var(--accent)', fontWeight: 600 }}>restocked</span> to inventory only after an Admin approves the refund.
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

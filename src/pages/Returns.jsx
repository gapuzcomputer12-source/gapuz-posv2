import { useState, useMemo, useEffect, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { RefreshCw, ClipboardList, Clock, CheckCircle2, Eye, Package, AlertTriangle, CheckCircle, Barcode, Check, Info } from 'lucide-react'
import { useReturnStore, useAuthStore, useProductStore, useAppStore, findSaleForReturn } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, fmtDate, RETURN_REASONS, SALE_ADJUSTMENT_DAYS } from '../utils/helpers'
import { StatusBadge } from '../components/RefundDetailsModal'
import ReturnDetailsModal from '../components/ReturnDetailsModal'
import ScanInput from '../components/ScanInput'
import PolicyModal from '../components/PolicyModal'
import SaleLookup from '../components/SaleLookup'
import EvidencePhotoPicker from '../components/EvidencePhotoPicker'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const RETURN_METHODS = ['Cash refund', 'GCash refund', 'Replacement']

const STEPS = [
  { num: 1, label: 'Find sale' },
  { num: 2, label: 'Select items' },
  { num: 3, label: 'Details' },
  { num: 4, label: 'Confirm' },
]

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected']

export default function Returns() {
  useDocumentTitle('Returns')
  const t = useT()
  const toast = useToast()
  const { role, user } = useAuthStore()
  const { theme } = useAppStore()
  const { returns, loading, submitReturn, approveReturn, rejectReturn } = useReturnStore()
  const fetchProducts = useProductStore(s => s.fetchProducts)
  const [searchParams] = useSearchParams()

  const isAdmin = role === 'admin'
  const isLight = theme === 'light'

  const [showPolicy, setShowPolicy] = useState(true)

  // ── Wizard state ─────────────────────────────────────────
  const [step, setStep] = useState(1)
  const [selectedSale, setSelectedSale] = useState(null)
  const [returnItems, setReturnItems] = useState({})
  const [filterStatus, setFilterStatus] = useState(() => searchParams.get('status') || 'All')
  const [viewReturn, setViewReturn] = useState(null)
  const [details, setDetails] = useState({ reason: RETURN_REASONS[0], method: RETURN_METHODS[0], notes: '' })
  // Evidence photos — the picker manages its own upload state internally
  // and just reports the successfully-uploaded storage paths up here;
  // photoPickerKey forces it to remount (fresh draft folder, empty
  // thumbnails) whenever the wizard resets.
  const [evidencePhotos, setEvidencePhotos] = useState([])
  const [photoPickerKey, setPhotoPickerKey] = useState(0)

  const daysSince = selectedSale ? differenceInCalendarDays(new Date(), new Date(selectedSale.createdAt)) : null
  const expired = daysSince != null && daysSince > SALE_ADJUSTMENT_DAYS

  // ── Stats ─────────────────────────────────────────────────
  const pendingCount = useMemo(() => returns.filter(r => r.status === 'Pending').length, [returns])
  const stats = useMemo(() => {
    const approved = returns.filter(r => r.status === 'Approved').length
    const totalReturned = returns.filter(r => r.status === 'Approved').reduce((s, r) => s + r.total, 0)
    return [
      { label: 'Total Returns', value: returns.length, borderColor: isLight ? '#2563eb' : 'var(--blue)', valueColor: 'var(--text)', icon: ClipboardList },
      { label: 'Pending', value: pendingCount, borderColor: isLight ? '#d97706' : 'var(--yellow)', valueColor: isLight ? '#d97706' : 'var(--yellow)', icon: Clock },
      { label: 'Approved', value: approved, borderColor: isLight ? '#059669' : 'var(--accent)', valueColor: isLight ? '#059669' : 'var(--accent)', icon: CheckCircle2 },
      { label: 'Total Returned', value: peso(totalReturned), borderColor: isLight ? '#dc2626' : 'var(--red)', valueColor: 'var(--text)', icon: RefreshCw },
    ]
  }, [returns, pendingCount, isLight])

  useDocumentTitle(isAdmin ? (pendingCount > 0 ? `(${pendingCount}) Return Approval` : 'Return Approval') : 'Returns')

  const statusCounts = useMemo(() => ({
    All: returns.length,
    Pending: returns.filter(r => r.status === 'Pending').length,
    Approved: returns.filter(r => r.status === 'Approved').length,
    Rejected: returns.filter(r => r.status === 'Rejected').length,
  }), [returns])

  const filteredReturns = useMemo(() =>
    returns.filter(r => filterStatus === 'All' || r.status === filterStatus).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [returns, filterStatus]
  )
  const returnsPg = usePagination(filteredReturns)
  useEffect(() => { returnsPg.setPage(1) }, [filterStatus])

  const calcTotals = () => {
    if (!selectedSale) return { subtotal: 0, vat: 0, total: 0 }
    const subtotal = selectedSale.items.reduce((sum, item) => {
      const ri = returnItems[item.itemId]
      if (!ri?.selected) return sum
      const qty = item.serials.length > 0 ? ri.selectedSerials.length : ri.qty
      return sum + item.price * qty
    }, 0)
    const vat = subtotal * 0.12
    const total = subtotal + vat
    return { subtotal, vat, total: Math.round(total) }
  }
  const { subtotal, vat, total } = calcTotals()
  const selectedCount = Object.values(returnItems).filter(r => r.selected).length

  // Every item on this sale already covered by an APPROVED return — same
  // check SaleLookup.jsx uses to grey out a Recent Transactions row, just
  // adapted to findSaleForReturn's item shape (item.productId, not
  // item.id). Without this, searching/scanning a transaction directly
  // bypassed the exact same "nothing left to return" rule the recent-list
  // row already enforces by being disabled.
  const isFullyReturned = (sale) => sale.items.every(item => {
    const returnedQty = returns
      .filter(r => r.transactionId === sale.id && r.status === 'Approved')
      .reduce((sum, r) => sum + (r.items || []).filter(i => i.product_id === item.productId).reduce((s, i) => s + (i.qty || 0), 0), 0)
    return returnedQty >= item.qty
  })

  // ── Handlers ─────────────────────────────────────────────
  const handleLookup = async (query) => {
    if (!query.trim()) return { ok: false, message: 'Enter a transaction ID or scan a serial' }
    const sale = await findSaleForReturn(query)
    if (!sale) return { ok: false, message: t('txn_not_found') }
    if (!sale.items.length) return { ok: false, message: 'No items found for this sale' }
    const daysSinceSale = differenceInCalendarDays(new Date(), new Date(sale.createdAt))
    if (daysSinceSale > SALE_ADJUSTMENT_DAYS) return { ok: false, message: `Return period expired: items can only be returned within ${SALE_ADJUSTMENT_DAYS} days of purchase` }
    if (isFullyReturned(sale)) return { ok: false, message: 'This transaction has already been fully returned' }

    setSelectedSale(sale)
    const init = {}
    sale.items.forEach(item => { init[item.itemId] = { selected: false, qty: 1, selectedSerials: [] } })
    setReturnItems(init)
    setStep(2)
    return { ok: true, message: `Found ${sale.id ? `#${String(sale.id).padStart(4, '0')}` : 'sale'}` }
  }

  const toggleItem = (itemId) => {
    setReturnItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], selected: !prev[itemId]?.selected } }))
  }
  const setItemQty = (itemId, qty, max) => {
    setReturnItems(prev => ({ ...prev, [itemId]: { ...prev[itemId], qty: Math.max(1, Math.min(qty, max)) } }))
  }
  const toggleSerial = (itemId, serial) => {
    setReturnItems(prev => {
      const cur = prev[itemId]?.selectedSerials || []
      const next = cur.includes(serial) ? cur.filter(s => s !== serial) : [...cur, serial]
      return { ...prev, [itemId]: { ...prev[itemId], selected: next.length > 0, selectedSerials: next } }
    })
  }

  // Scanning a serial in step 2 should select it regardless of which of the
  // sale's products it belongs to — searches every item's serials, not just
  // whichever one the cashier scanned first.
  const handleScanToSelect = (code) => {
    for (const item of selectedSale.items) {
      const match = item.serials.find(s => s.serialNumber === code)
      if (!match) continue
      if (match.status !== 'Sold') return { ok: false, message: `Serial is ${match.status}, not returnable` }
      if (returnItems[item.itemId]?.selectedSerials?.includes(code)) return { ok: false, message: 'Already selected' }
      toggleSerial(item.itemId, code)
      return { ok: true, message: `${item.name} — added ${code}` }
    }
    return { ok: false, message: 'Serial not found in this sale' }
  }

  const goToStep3 = () => {
    if (selectedCount === 0) return toast('Select at least one item to return', 'error')
    setStep(3)
  }
  const goToStep4 = () => {
    if (!details.reason) return toast('Please select a reason', 'error')
    if (evidencePhotos.length === 0) return toast('Add at least 1 evidence photo', 'error')
    setStep(4)
  }

  const handleSubmit = async () => {
    if (expired) return toast('Return period expired for this sale', 'error')
    const items = selectedSale.items
      .filter(item => returnItems[item.itemId]?.selected)
      .map(item => {
        const ri = returnItems[item.itemId]
        const serials = item.serials.length > 0 ? ri.selectedSerials : []
        const qty = serials.length > 0 ? serials.length : ri.qty
        return { item_id: item.itemId, product_id: item.productId, name: item.name, price: item.price, costPrice: item.costPrice, qty, serials }
      })

    const { id, error } = await submitReturn({
      transactionId: selectedSale.id,
      customerName: selectedSale.customerName || 'Walk-in',
      reason: details.reason,
      method: details.method,
      notes: details.notes,
      subtotal, vat, total,
      items,
      evidencePhotos,
    })
    if (error) return toast(error.message || 'Failed to submit return', 'error')
    toast(`Return #${String(id).padStart(4, '0')} submitted`, 'success')
    resetWizard()
  }

  const handleApprove = async (r, conditions, replacements) => {
    const { error } = await approveReturn(r.id, conditions, replacements)
    if (error) { toast(error.message || 'Failed to approve return', 'error'); return }
    await fetchProducts()
    toast('Return approved', 'success')
  }
  const handleReject = async (r, reason) => {
    const { error } = await rejectReturn(r.id, reason)
    if (error) return { error }
    toast('Return rejected', 'info')
  }

  const resetWizard = () => {
    setStep(1); setSelectedSale(null); setReturnItems({})
    setDetails({ reason: RETURN_REASONS[0], method: RETURN_METHODS[0], notes: '' })
    setEvidencePhotos([])
    setPhotoPickerKey(k => k + 1)
  }

  const border = '1px solid var(--border)'
  const card = { background: 'var(--bg2)', border, borderRadius: 10 }
  const navBtn = { height: 48 }

  // Matches what create_return/approve_return (supabase/add_returns_table.sql)
  // actually enforce — the window days come from the same SALE_ADJUSTMENT_DAYS
  // constant used in the subtitle below and the days-left badge in step 2.
  const RETURN_POLICY_ITEMS = [
    { icon: '🕒', title: `${SALE_ADJUSTMENT_DAYS}-Day Return Window`, desc: `Items must be returned within ${SALE_ADJUSTMENT_DAYS} days from the original date of purchase.` },
    { icon: '🧾', title: 'Proof of Purchase',     desc: "The unit's serial number or the transaction ID from the receipt is required to find the sale." },
    { icon: '🔖', title: 'Serial Number Match',   desc: 'For serialized items, the returned unit\'s serial number must match the unit sold in that transaction.' },
    { icon: '🛡️', title: 'Administrator Review', desc: 'Each return is checked by the Admin before approval.' },
    { icon: '📦', title: 'Item Condition',        desc: 'Approved units are restocked if Resellable, or marked Defective and not returned to stock.' },
    { icon: '↩️', title: 'Return Method',         desc: `Available methods: ${RETURN_METHODS.join(', ')}.` },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>
        Items returned within {SALE_ADJUSTMENT_DAYS} days · Admin approval required
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, flexShrink: 0 }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card, padding: 18, borderTop: `2px solid ${s.borderColor}`, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 15, right: 15, opacity: 0.15, color: s.borderColor }}><s.icon size={24} /></div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6, fontWeight: 700 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.valueColor, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <PolicyModal
        open={showPolicy}
        onClose={() => setShowPolicy(false)}
        title="Return Policy"
        rules={RETURN_POLICY_ITEMS}
        buttonLabel="I Understand — Proceed to Return"
        footerText="By proceeding you confirm that you have read and understood the return policy."
      />

      <div className="dual-panel-grid">
        {/* LEFT: Wizard */}
        <div className="form-panel" style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 320px', maxWidth: 380 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {STEPS.map((s, i) => (
              <Fragment key={s.num}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: step === s.num ? (isLight ? '#059669' : 'var(--accent)') : step > s.num ? (isLight ? '#d1fae5' : 'rgba(52,211,153,0.15)') : 'var(--bg3)',
                    color: step === s.num ? (isLight ? '#fff' : '#0a0a0a') : step > s.num ? (isLight ? '#047857' : 'var(--accent)') : 'var(--text3)',
                    border: step > s.num ? (isLight ? '1px solid #6ee7b7' : '1px solid rgba(52,211,153,0.3)') : '1px solid var(--border2)',
                    transition: 'all .2s',
                  }}>{step > s.num ? '✓' : s.num}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: step >= s.num ? 'var(--text2)' : 'var(--text3)', textAlign: 'center', whiteSpace: 'nowrap' }}>{s.label}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, marginTop: 11, borderRadius: 99, background: step > s.num ? (isLight ? '#059669' : 'var(--accent)') : 'var(--bg3)', transition: 'background .3s' }} />
                )}
              </Fragment>
            ))}
          </div>

          {/* STEP 1 */}
          {step === 1 && <SaleLookup mode="return" onSaleFound={handleLookup} />}

          {/* STEP 2 */}
          {step === 2 && selectedSale && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700 }}>
                    #{String(selectedSale.id).padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDate(selectedSale.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>{selectedSale.customerName || 'Walk-in'} · {peso(selectedSale.total)}</div>
                {expired ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>
                    <AlertTriangle size={13} />Return period expired (purchased {fmtDate(selectedSale.createdAt)})
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
                    <CheckCircle size={13} />Returnable: {SALE_ADJUSTMENT_DAYS - daysSince} day{SALE_ADJUSTMENT_DAYS - daysSince === 1 ? '' : 's'} left
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Scan each unit being returned — any serial from this sale, any product:</div>
                <ScanInput placeholder="Scan a serial to select it…" onScan={handleScanToSelect} clearOnScan />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>…or select manually:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {selectedSale.items.map(item => {
                  const ri = returnItems[item.itemId]
                  const isSelected = ri?.selected
                  const hasSerials = item.serials.length > 0
                  const soldSerials = item.serials.filter(s => s.status === 'Sold')
                  return (
                    <div key={item.itemId} style={{
                      background: isSelected ? (isLight ? '#ecfdf5' : 'rgba(52,211,153,0.05)') : 'var(--bg3)',
                      border: `1px solid ${isSelected ? (isLight ? '#6ee7b7' : 'rgba(52,211,153,0.3)') : 'var(--border)'}`,
                      borderRadius: 10, padding: '10px 12px',
                    }}>
                      <div onClick={() => !hasSerials && toggleItem(item.itemId)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: hasSerials ? 'default' : 'pointer' }}>
                        {!hasSerials && (
                          <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${isSelected ? (isLight ? '#059669' : 'var(--accent)') : 'var(--border2)'}`, background: isSelected ? (isLight ? '#059669' : 'var(--accent)') : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isSelected && <span style={{ fontSize: 10, color: '#0a0a0a', fontWeight: 700 }}>✓</span>}
                          </div>
                        )}
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg4)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {hasSerials ? <Barcode size={14} /> : <Package size={14} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{peso(item.price)} × {item.qty} sold</div>
                        </div>
                        {!hasSerials && isSelected && (
                          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => setItemQty(item.itemId, ri.qty - 1, item.qty)} style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg4)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>−</button>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{ri.qty}</span>
                            <button onClick={() => setItemQty(item.itemId, ri.qty + 1, item.qty)} style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border2)', background: 'var(--bg4)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+</button>
                          </div>
                        )}
                      </div>
                      {hasSerials && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingLeft: 48 }}>
                          {soldSerials.length === 0
                            ? <span style={{ fontSize: 10.5, color: 'var(--text3)', fontStyle: 'italic' }}>All units already returned</span>
                            : soldSerials.map(s => {
                              const checked = ri?.selectedSerials?.includes(s.serialNumber)
                              return (
                                <button key={s.serialNumber} onClick={() => toggleSerial(item.itemId, s.serialNumber)} style={{
                                  fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, padding: '4px 9px', borderRadius: 99, cursor: 'pointer',
                                  border: `1px solid ${checked ? (isLight ? '#059669' : 'var(--accent)') : 'var(--border2)'}`,
                                  background: checked ? (isLight ? 'rgba(4,120,87,0.1)' : 'rgba(52,211,153,0.1)') : 'var(--bg4)',
                                  color: checked ? (isLight ? '#047857' : 'var(--accent)') : 'var(--text2)',
                                }}>{s.serialNumber}</button>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={resetWizard} className="btn-secondary" style={{ flex: 1, ...navBtn }}>← Back</button>
                <button onClick={goToStep3} className="btn-primary" style={{ flex: 2, ...navBtn }}>Next ({selectedCount} item{selectedCount !== 1 ? 's' : ''}) →</button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('reason')} *</label>
                <select className="form-field" value={details.reason} onChange={e => setDetails(d => ({ ...d, reason: e.target.value }))}>
                  {RETURN_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>Return Method</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {RETURN_METHODS.map(m => {
                    const active = details.method === m
                    return (
                      <button key={m} onClick={() => setDetails(d => ({ ...d, method: m }))} style={{
                        padding: '10px 4px', minHeight: 42, borderRadius: 8, border: active ? '2px solid' : '1px solid', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        ...(active ? { borderColor: isLight ? '#059669' : 'var(--accent)', background: isLight ? 'rgba(4,120,87,0.1)' : 'rgba(52,211,153,0.12)', color: isLight ? '#047857' : 'var(--accent)' } : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--text2)' }),
                      }}>
                        {active && <Check size={13} />}{m}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('notes')} (optional)</label>
                <textarea className="form-field form-field-textarea" rows={3} placeholder="Additional notes about this return..." value={details.notes} onChange={e => setDetails(d => ({ ...d, notes: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>Evidence Photos *</label>
                <EvidencePhotoPicker key={photoPickerKey} onChange={setEvidencePhotos} />
                {evidencePhotos.length === 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 6 }}>Add at least 1 photo</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(2)} className="btn-secondary" style={{ flex: 1, ...navBtn }}>← Back</button>
                <button onClick={goToStep4} disabled={evidencePhotos.length === 0} className="btn-primary" style={{ flex: 2, ...navBtn, opacity: evidencePhotos.length === 0 ? 0.5 : 1, cursor: evidencePhotos.length === 0 ? 'not-allowed' : 'pointer' }}>Review →</button>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, border }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, fontWeight: 700 }}>Items to return</div>
                {selectedSale.items.filter(i => returnItems[i.itemId]?.selected).map(item => {
                  const ri = returnItems[item.itemId]
                  const qty = item.serials.length > 0 ? ri.selectedSerials.length : ri.qty
                  return (
                    <div key={item.itemId} style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{item.name} ×{qty}</span>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text)' }}>{peso(item.price * qty)}</span>
                      </div>
                      {item.serials.length > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>SN: {ri.selectedSerials.join(', ')}</div>}
                    </div>
                  )
                })}
              </div>
              <div style={{ background: isLight ? '#f9fafb' : 'rgba(52,211,153,0.04)', border: isLight ? '1px solid #e5e7eb' : '1px solid rgba(52,211,153,0.15)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}><span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(subtotal)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}><span>VAT (12%)</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{peso(vat)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <span>Return Total</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: isLight ? '#059669' : 'var(--accent)' }}>{peso(total)}</span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Reason</span><span>{details.reason}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Method</span><span>{details.method}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>Evidence Photos</span><span>{evidencePhotos.length === 0 ? 'None' : `${evidencePhotos.length} attached`}</span></div>
              </div>
              {expired && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--red)', lineHeight: 1.6, display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>This sale is past the {SALE_ADJUSTMENT_DAYS}-day return window — submission is blocked.</span>
                </div>
              )}
              {!isAdmin && !expired && (
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--yellow)', lineHeight: 1.6, display: 'flex', gap: 6 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>Return will be submitted as <strong>Pending</strong>. Admin must approve before items are restocked.</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(3)} className="btn-secondary" style={{ flex: 1, ...navBtn }}>← Back</button>
                <button onClick={handleSubmit} disabled={expired} className="btn-primary" style={{ flex: 2, ...navBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: expired ? 0.5 : 1, cursor: expired ? 'not-allowed' : 'pointer' }}>
                  <RefreshCw size={14} />Submit Return
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Return history */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '2 1 420px' }}>
          <div style={{ padding: '16px 20px', borderBottom: border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><ClipboardList size={14} style={{ color: 'var(--accent)' }} />Return History</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {STATUS_FILTERS.map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: '4px 12px', borderRadius: 99, border: '1px solid', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  ...(filterStatus === s ? { background: isLight ? '#059669' : 'var(--accent)', borderColor: isLight ? '#059669' : 'var(--accent)', color: isLight ? '#fff' : '#0a0a0a' } : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text2)' }),
                }}>{s} {statusCounts[s]}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {['Return #', 'Txn #', 'Date', 'Customer', 'Total', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Total' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.7px', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text3)' }}>Loading…</td></tr>
                ) : filteredReturns.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text3)' }}><RefreshCw size={32} style={{ opacity: .2, marginBottom: 8 }} /><div>No returns found</div></td></tr>
                ) : returnsPg.pageItems.map(r => {
                  const isWalkIn = (r.customerName || 'Walk-in') === 'Walk-in'
                  return (
                    <tr key={r.id} className="refund-row" style={{
                      borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: r.status === 'Pending' ? (isLight ? '#fffbeb' : 'rgba(245,158,11,0.05)') : 'transparent',
                    }} onClick={() => setViewReturn(r)}>
                      <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isLight ? '#059669' : 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        #{String(r.id).padStart(4, '0')}
                        {r.evidencePhotos?.length > 0 && <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 6, fontWeight: 600, fontFamily: 'inherit' }}>📷 {r.evidencePhotos.length}</span>}
                      </td>
                      <td style={{ padding: '11px 14px', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>#{String(r.transactionId).padStart(4, '0')}</td>
                      <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                      <td style={{ padding: '11px 14px', fontSize: 12, color: isWalkIn ? 'var(--text3)' : 'var(--text)', fontStyle: isWalkIn ? 'italic' : 'normal' }}>{r.customerName || 'Walk-in'}</td>
                      <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text)', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{peso(r.total)}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <StatusBadge status={r.status} isLight={isLight} />
                        {r.status === 'Rejected' && r.rejectionReason && (
                          <div title={r.rejectionReason} style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 3, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '11px 14px' }}>
                        {r.status === 'Pending' ? (
                          <button onClick={e => { e.stopPropagation(); setViewReturn(r) }} className="btn-success" style={{ fontSize: 11, padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Eye size={12} />Review
                          </button>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setViewReturn(r) }} title="View details" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0 }}><Eye size={13} /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 20px', flexShrink: 0 }}><Pagination {...returnsPg} /></div>
          <div style={{ margin: '0 20px 16px', padding: '10px 14px', borderRadius: 10, background: isLight ? '#eff6ff' : 'rgba(59,130,246,0.08)', border: `1px solid ${isLight ? '#bfdbfe' : 'rgba(59,130,246,0.25)'}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <Info size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
              Each unit is <span style={{ color: isLight ? '#059669' : 'var(--accent)', fontWeight: 600 }}>restocked or marked Defective</span> only after an Admin approves the return.
            </span>
          </div>
        </div>
      </div>

      <ReturnDetailsModal open={!!viewReturn} onClose={() => setViewReturn(null)} record={viewReturn} isAdmin={isAdmin} onApprove={handleApprove} onReject={handleReject} />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Gift, Barcode, Check, AlertTriangle, Printer, ChevronLeft, Mail, Lock } from 'lucide-react'
import { useProductStore, useAuthStore, useRewardStore, useActivityLogStore, fetchAvailableSerials, logActivity } from '../store'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../utils/toast'
import { fmtDate, fmtDateTime } from '../utils/helpers'
import { TIERS, getTier } from '../utils/loyalty'
import ProductThumb from './ProductThumb'
import Modal from './Modal'

const SERIAL_PAGE_SIZE = 5
// Only the tiers that ever have a reward list — Bronze is the base tier
// everyone starts at, nothing to claim there.
const REWARD_TIERS = TIERS.filter(t => t.key !== 'bronze')
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

// Self-contained like CustomerHistoryModal — given just a customer, it
// reads products from the store itself and drives the whole claim
// (pick a tier's item -> pick serial if needed -> confirm -> success/slip)
// so Customers.jsx stays a thin "Claim Reward" button.
export default function RedeemRewardModal({ open, onClose, customer }) {
  const products = useProductStore(s => s.products)
  const redemptions = useRewardStore(s => s.redemptions)
  const { user } = useAuthStore()
  const claimTierReward = useRewardStore(s => s.claimTierReward)
  const toast = useToast()
  const border = '1px solid var(--border)'

  const [step, setStep] = useState('select') // 'select' | 'serial' | 'confirm' | 'success'
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedTier, setSelectedTier] = useState(null) // 'silver' | 'gold' | 'platinum'
  const [selectedSerial, setSelectedSerial] = useState(null)
  const [serialRows, setSerialRows] = useState([])
  const [serialCount, setSerialCount] = useState(0)
  const [serialPage, setSerialPage] = useState(1)
  const [serialSearch, setSerialSearch] = useState('')
  const [serialLoading, setSerialLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState(null)
  const [emailStatus, setEmailStatus] = useState(null) // null | 'sending' | 'sent' | 'skipped' | 'failed'
  const printRef = useRef(null)
  const handlePrint = useReactToPrint({ content: () => printRef.current })
  // Guards against the email firing twice for the same claim — not a
  // concern from a double-click (the Confirm button is gone by the time
  // this runs, and `confirming` already blocks a second RPC call while
  // the first is in flight), but cheap insurance against a stray re-render
  // of the success step re-triggering the send effect.
  const emailSentRef = useRef(false)

  useEffect(() => {
    if (open) {
      setStep('select'); setSelectedProduct(null); setSelectedTier(null); setSelectedSerial(null)
      setSerialRows([]); setSerialCount(0); setSerialPage(1); setSerialSearch('')
      setConfirming(false); setResult(null); setEmailStatus(null); emailSentRef.current = false
    }
  }, [open, customer?.id])

  useEffect(() => {
    if (step !== 'serial' || !selectedProduct) return
    let active = true
    setSerialLoading(true)
    const delay = serialSearch ? 250 : 0
    const timer = setTimeout(async () => {
      const { data, count } = await fetchAvailableSerials(selectedProduct.id, { page: serialPage, pageSize: SERIAL_PAGE_SIZE, search: serialSearch })
      if (active) { setSerialRows(data); setSerialCount(count); setSerialLoading(false) }
    }, delay)
    return () => { active = false; clearTimeout(timer) }
  }, [step, selectedProduct, serialPage, serialSearch])

  if (!open || !customer) return null

  const points = customer.points || 0
  const currentTier = getTier(points)
  const customerClaims = redemptions.filter(r => r.customerId === customer.id && r.tier)

  const pickProduct = (p, tierKey) => {
    setSelectedProduct(p); setSelectedTier(tierKey)
    if (p.hasSerial) { setSerialPage(1); setSerialSearch(''); setStep('serial') }
    else { setSelectedSerial(null); setStep('confirm') }
  }
  const pickSerial = (row) => { setSelectedSerial(row); setStep('confirm') }

  const tierCost = selectedTier ? (TIERS.find(t => t.key === selectedTier)?.min || 0) : 0
  const pointsAfterClaim = Math.max(0, points - tierCost)
  const tierAfterClaim = getTier(pointsAfterClaim)
  const tierWillChange = tierAfterClaim.key !== currentTier.key

  // Fires once, right after the claim that owns it is saved — never undoes
  // anything on failure (the claim already happened), just records what
  // happened to the email. Activity log gets a SEPARATE entry for this
  // (action 'email') rather than editing the claim's own 'claimed' entry —
  // activity_log has no UPDATE policy anywhere in this schema on purpose
  // (append-only audit trail), so amending that row in place isn't an
  // option; a second row right after it is.
  const sendRedemptionEmail = async (redemption, itemName, serialNumber) => {
    if (emailSentRef.current) return
    emailSentRef.current = true

    if (!customer.email) {
      setEmailStatus('skipped')
      logActivity('email', 'reward', redemption.redemptionNo, { emailStatus: 'skipped', redemptionNo: redemption.redemptionNo })
      useActivityLogStore.getState().fetchLogs()
      return
    }

    setEmailStatus('sending')
    try {
      const afterTier = getTier(redemption.customerPoints)
      const beforeTier = getTier(redemption.customerPoints + redemption.pointsUsed)
      const { error } = await supabase.functions.invoke('send-reward-redemption-email', {
        body: {
          email: customer.email,
          redemption: {
            customerName: customer.name,
            claimedTierLabel: capitalize(redemption.tier),
            itemName, quantity: 1, serialNumber: serialNumber || null,
            redemptionNo: redemption.redemptionNo,
            createdAt: redemption.createdAt,
            pointsUsed: redemption.pointsUsed,
            pointsRemaining: redemption.customerPoints,
            currentTierLabel: afterTier.label,
            tierChanged: afterTier.key !== beforeTier.key,
            previousTierLabel: beforeTier.label,
          },
        },
      })
      if (error) throw error
      setEmailStatus('sent')
      logActivity('email', 'reward', redemption.redemptionNo, { emailStatus: 'sent', email: customer.email, redemptionNo: redemption.redemptionNo })
    } catch (err) {
      console.error('reward claim email failed:', err.message)
      setEmailStatus('failed')
      logActivity('email', 'reward', redemption.redemptionNo, { emailStatus: 'failed', email: customer.email, redemptionNo: redemption.redemptionNo })
    }
    useActivityLogStore.getState().fetchLogs()
  }

  const handleConfirm = async () => {
    if (!selectedProduct || confirming) return
    setConfirming(true)
    const { error, redemption } = await claimTierReward({
      customerId: customer.id,
      productId: selectedProduct.id,
      serialId: selectedSerial?.id || null,
    })
    setConfirming(false)
    if (error) { toast(error.message || 'Claim failed', 'error'); return }
    setResult(redemption)
    setStep('success')
    sendRedemptionEmail(redemption, selectedProduct.name, selectedSerial?.serialNumber)
  }

  const totalSerialPages = Math.max(1, Math.ceil(serialCount / SERIAL_PAGE_SIZE))

  // Derived entirely from `result` (never the live `customer` prop) — by
  // the time the success step renders, the store has already applied the
  // new points balance, so `customer.points` here is the AFTER value, not
  // the before one. result.customerPoints + result.pointsUsed recovers
  // "before" without needing a separate snapshot taken pre-claim.
  const resultAfterTier = result ? getTier(result.customerPoints) : null
  const resultBeforeTier = result ? getTier(result.customerPoints + result.pointsUsed) : null
  const resultTierChanged = result && resultAfterTier.key !== resultBeforeTier.key

  return (
    <Modal open={open} onClose={onClose} closeOnBackdrop={step!=='confirm'&&!confirming} closeOnEsc={step!=='confirm'&&!confirming}>
      <div className="card animate-scale-in" style={{ width: 'min(480px,94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 20px', borderBottom: border, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Gift size={15} style={{ color: 'var(--accent)' }} />Claim Reward</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {customer.name} · <span style={{ color: currentTier.color, fontWeight: 600 }}>{currentTier.label}</span> · {points.toLocaleString()} pts
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>

          {/* STEP — pick a tier's reward item */}
          {step === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {REWARD_TIERS.map(t => {
                const reached = points >= t.min
                const claimedRow = customerClaims.find(r => r.tier === t.key)
                const itemsForTier = products.filter(p => !p.isService && p.rewardTier === t.key && p.stock > 0)
                const TierIcon = t.icon
                return (
                  <div key={t.key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <TierIcon size={14} style={{ color: t.color }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: t.color }}>{t.label}</span>
                      {!reached && <Lock size={11} style={{ color: 'var(--text3)' }} />}
                    </div>

                    {!reached ? (
                      <div style={{ fontSize: 11.5, color: 'var(--text3)', padding: '10px 12px', borderRadius: 8, background: 'var(--bg2)', border: '1px dashed var(--border2)' }}>
                        Unlocks at {t.label} ({(t.min - points).toLocaleString()} pts more)
                      </div>
                    ) : itemsForTier.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: 'var(--text3)', padding: '10px 12px' }}>No reward items set for this tier yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {claimedRow && (
                          <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>Last claimed: {fmtDate(claimedRow.createdAt)}</div>
                        )}
                        {itemsForTier.map(p => (
                          <button key={p.id} onClick={() => pickProduct(p, t.key)} style={{
                            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                            padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border2)',
                            background: 'var(--bg3)', cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                            <ProductThumb image={p.image} icon={p.icon} category={p.category} size={40} radius={9} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{p.stock} in stock{p.hasSerial ? ' · serial-tracked' : ''}</div>
                            </div>
                            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, fontWeight: 700, color: t.color, flexShrink: 0 }}>{t.min.toLocaleString()} pts</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* STEP — pick a serial (serial-tracked reward only) */}
          {step === 'serial' && selectedProduct && (
            <div>
              <button onClick={() => setStep('select')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: 0, marginBottom: 12 }}>
                <ChevronLeft size={13} />Back
              </button>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}><Barcode size={14} style={{ color: 'var(--accent)' }} />Choose a Unit</div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 10 }}>{selectedProduct.name}</div>
              <input autoFocus className="input-field" style={{ width: '100%', marginBottom: 10 }} placeholder="Filter by serial number…"
                value={serialSearch} onChange={e => { setSerialSearch(e.target.value); setSerialPage(1) }} />
              {serialLoading ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
              ) : serialCount === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--text3)', fontSize: 12 }}>{serialSearch ? 'No serials match your search' : 'No serial numbers in stock'}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {serialRows.map(row => (
                    <button key={row.id} onClick={() => pickSerial(row)} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                      padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)',
                      cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'left',
                    }}>
                      {row.serialNumber}
                    </button>
                  ))}
                </div>
              )}
              {serialCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
                  <button onClick={() => setSerialPage(p => p - 1)} disabled={serialPage <= 1} className="btn-secondary" style={{ padding: '5px 10px', fontSize: 11, opacity: serialPage <= 1 ? 0.5 : 1 }}>Back</button>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>Page {serialPage} of {totalSerialPages}</span>
                  <button onClick={() => setSerialPage(p => p + 1)} disabled={serialPage >= totalSerialPages} className="btn-secondary" style={{ padding: '5px 10px', fontSize: 11, opacity: serialPage >= totalSerialPages ? 0.5 : 1 }}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* STEP — confirm */}
          {step === 'confirm' && selectedProduct && (
            <div>
              <button onClick={() => setStep(selectedProduct.hasSerial ? 'serial' : 'select')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: 0, marginBottom: 12 }}>
                <ChevronLeft size={13} />Back
              </button>
              <div style={{ textAlign: 'center', background: 'var(--bg3)', border, borderRadius: 10, padding: '20px 16px' }}>
                <ProductThumb image={selectedProduct.image} icon={selectedProduct.icon} category={selectedProduct.category} size={48} radius={10} />
                <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)', margin: '10px 0 2px' }}>
                  Claim {selectedProduct.name} – uses {tierCost.toLocaleString()} points
                </div>
                {selectedSerial && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace" }}>SN: {selectedSerial.serialNumber}</div>}
              </div>
              <div style={{ background: 'var(--bg3)', border, borderRadius: 10, padding: '10px 14px', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}>
                  <span>Points</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--text)' }}>{points.toLocaleString()} → {pointsAfterClaim.toLocaleString()} pts</span>
                </div>
                {tierWillChange && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text2)' }}>Tier</span>
                    <span style={{ fontWeight: 700 }}><span style={{ color: currentTier.color }}>{currentTier.label}</span> → <span style={{ color: tierAfterClaim.color }}>{tierAfterClaim.label}</span></span>
                  </div>
                )}
              </div>
              {tierWillChange && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--yellow)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={13} />This claim will drop the customer to {tierAfterClaim.label}.
                </div>
              )}
              <button onClick={handleConfirm} disabled={confirming} className="btn-primary" style={{ width: '100%', padding: 12, marginTop: 16, opacity: confirming ? 0.6 : 1 }}>
                {confirming ? 'Claiming…' : 'Confirm Claim'}
              </button>
            </div>
          )}

          {/* STEP — success */}
          {step === 'success' && result && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className="animate-pop" style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', background: 'var(--accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={22} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>Reward Claimed!</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{result.redemptionNo}</div>
                </div>
              </div>
              <div style={{ background: 'var(--bg3)', border, borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}><span>Tier reward claimed</span><span style={{ fontWeight: 700, color: 'var(--text)' }}>{capitalize(result.tier)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}><span>Points used</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--text)' }}>{result.pointsUsed.toLocaleString()}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}><span>Points remaining</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--text)' }}>{result.customerPoints.toLocaleString()}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text2)' }}>
                  <span>Tier</span>
                  <span style={{ fontWeight: 700 }}>
                    {resultTierChanged ? (<><span style={{ color: resultBeforeTier.color }}>{resultBeforeTier.label}</span> → <span style={{ color: resultAfterTier.color }}>{resultAfterTier.label}</span></>) : (<span style={{ color: resultAfterTier.color }}>{resultAfterTier.label}</span>)}
                  </span>
                </div>
              </div>

              {emailStatus === 'sending' && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-9-9" /></svg>
                  Sending email…
                </div>
              )}
              {emailStatus === 'sent' && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={13} />Email sent to {customer.email}
                </div>
              )}
              {emailStatus === 'skipped' && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text3)' }}>No email on file for this customer.</div>
              )}
              {emailStatus === 'failed' && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--yellow)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={13} />Redemption saved, but the email could not be sent.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
                <button onClick={onClose} className="btn-secondary" style={{ padding: 10 }}>Close</button>
                <button onClick={handlePrint} className="btn-secondary" style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Printer size={14} />Print Slip</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Printable claim slip — hidden on screen, shown via the global
          #receipt-printable print rule (index.css). No price/VAT/points
          anywhere — this is a free tier-reward item, not a sale. */}
      {result && (
        <div style={{ display: 'none' }}>
          <div id="receipt-printable" ref={printRef} style={{ background: '#fff', color: '#000', fontFamily: "'Courier New',monospace", fontSize: 11, padding: 20, width: 300, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', paddingBottom: 10, borderBottom: '1px dashed #ccc', marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>GAPUZ COMPUTER SERVICES</div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6 }}>FREE ITEM – {result.tier?.toUpperCase()} TIER REWARD</div>
            </div>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>
              Redemption No.: {result.redemptionNo}<br />
              Date: {fmtDateTime(result.createdAt)}<br />
              Customer: {customer.name}<br />
              Staff: {user?.user_metadata?.name || 'Staff'}
            </div>
            <div style={{ borderTop: '1px dashed #ccc', borderBottom: '1px dashed #ccc', padding: '8px 0', marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>{selectedProduct?.name}</div>
              {selectedSerial && <div style={{ fontSize: 10, color: '#555' }}>SN: {selectedSerial.serialNumber}</div>}
            </div>
            <div style={{ fontSize: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Points used</span><span>{result.pointsUsed.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Points remaining</span><span>{result.customerPoints.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>Tier</span><span>{resultTierChanged ? `${resultBeforeTier.label} → ${resultAfterTier.label}` : resultAfterTier.label}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center', fontSize: 9, color: '#888', borderTop: '1px dashed #ccc', paddingTop: 8, marginTop: 10 }}>
              No cash value. No price. No VAT. Not a sale.
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { X, Info, Star, ShoppingBag, Wallet, Receipt, ChevronDown, ChevronUp } from 'lucide-react'
import { useTransactionStore, useProductStore, useRefundStore } from '../store'
import { useT, peso, fmtDate, fmtDateTime, paymentDisplay } from '../utils/helpers'
import { TIERS, getTier, getNextTier } from '../utils/loyalty'
import ProductThumb from './ProductThumb'
import { usePagination } from '../hooks/usePagination'
import Pagination from './Pagination'

const FILTERS = ['all', 'completed', 'refunded']

// Shared by Customers.jsx — self-contained: given just a customer, it reads
// transactions/products/refunds from the stores itself (same pattern as
// RefundDetailsModal.jsx) so the caller stays thin.
export default function CustomerHistoryModal({ open, onClose, customer }) {
  const t = useT()
  const transactions = useTransactionStore(s => s.transactions)
  const txnLoading   = useTransactionStore(s => s.loading)
  const products     = useProductStore(s => s.products)
  const refunds      = useRefundStore(s => s.refunds)

  const [filterStatus, setFilterStatus] = useState('all')
  const [expanded, setExpanded] = useState({})
  const [showTip, setShowTip] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
  }, [open, onClose])

  // Reset transient UI state whenever a different customer's history opens,
  // so filters/expanded rows from the last customer don't carry over.
  useEffect(() => {
    if (open) { setFilterStatus('all'); setExpanded({}); setShowTip(false) }
  }, [open, customer?.id])

  const isRefunded = tx => tx.status === 'Refunded'
  const isPartial  = tx => tx.status === 'Partially Refunded'
  const isVoided   = tx => isRefunded(tx) || isPartial(tx)

  // custTxns/filteredTxns and the pagination hook below must run on every
  // render (Rules of Hooks), so they're computed above the early return —
  // customer?.id keeps this safe while the modal is closed.
  const custTxns = transactions.filter(tx => tx.customerId === customer?.id)
  const filteredTxns = custTxns.filter(tx => {
    if (filterStatus === 'completed') return !isVoided(tx)
    if (filterStatus === 'refunded')  return isVoided(tx)
    return true
  })
  const pg = usePagination(filteredTxns)
  useEffect(() => { pg.setPage(1) }, [filterStatus, customer?.id])

  if (!open || !customer) return null

  // Store orders newest-first, so the oldest (first) purchase is the last item.
  const firstPurchaseAt = custTxns.length ? custTxns[custTxns.length - 1].createdAt : customer.createdAt

  const points    = customer.points || 0
  const tier      = getTier(points)
  const nextTier  = getNextTier(points)
  const TierIcon  = tier.icon
  const progressPct = nextTier
    ? Math.min(100, Math.max(0, ((points - tier.min) / (nextTier.min - tier.min)) * 100))
    : 100
  const tierIndex = TIERS.findIndex(x => x.key === tier.key)

  const initials = (customer.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
  const contactLine = [customer.email, customer.phone].filter(Boolean).join(' · ')

  const refundedAmountFor = (txnId) =>
    refunds.filter(r => r.transactionId === txnId && r.status === 'Approved').reduce((s, r) => s + r.total, 0)

  const filterLabel = f => f === 'all' ? t('filter_all') : f === 'completed' ? t('completed') : t('filter_refunded')

  const statCards = [
    { label: t('loyalty_points'),  value: points.toLocaleString(),               Icon: Star,        color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
    { label: t('total_purchases'), value: (customer.purchases || 0).toLocaleString(), Icon: ShoppingBag, color: 'var(--blue)', bg: 'rgba(59,130,246,0.12)' },
    { label: t('total_spent'),     value: peso(customer.totalSpent || 0),        Icon: Wallet,      color: 'var(--green)', bg: 'rgba(34,197,94,0.12)' },
  ]

  return (
    <div
      role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="card animate-modal-in" style={{ width: 'min(720px,94vw)', maxHeight: '90vh', borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Sticky header ── */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div className="select-none" style={{
              width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
              background: tier.bg, color: tier.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 19, fontWeight: 700,
            }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{customer.name}</span>
                <span className="select-none" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 9px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                  background: tier.bg, color: tier.color,
                }}>
                  <TierIcon size={11} />{tier.label}
                </span>
              </div>
              {contactLine && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contactLine}</div>}
              {firstPurchaseAt && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{t('customer_since')} {fmtDate(firstPurchaseAt)}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, flexShrink: 0, display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Tier progress card */}
          <div className="card-surface" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="select-none" style={{ width: 38, height: 38, borderRadius: 12, background: tier.bg, color: tier.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TierIcon size={19} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{tier.label} {t('member_suffix')}</span>
              </div>
              <div
                style={{ position: 'relative', color: 'var(--text3)', cursor: 'help', display: 'flex' }}
                onMouseEnter={() => setShowTip(true)}
                onMouseLeave={() => setShowTip(false)}
                onFocus={() => setShowTip(true)}
                onBlur={() => setShowTip(false)}
                tabIndex={0}
              >
                <Info size={15} />
                {showTip && (
                  <div style={{
                    position: 'absolute', top: '125%', right: 0, zIndex: 10, width: 220,
                    background: 'var(--bg5)', border: '1px solid var(--border2)', borderRadius: 10,
                    padding: '10px 12px', fontSize: 11, lineHeight: 1.5, color: 'var(--text2)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  }}>
                    {t('loyalty_info_tip')}
                  </div>
                )}
              </div>
            </div>

            <div style={{ height: 8, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 99, background: nextTier ? nextTier.color : tier.color, transition: 'width .4s ease' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
              {nextTier
                ? <>{points.toLocaleString()} / {nextTier.min.toLocaleString()} pts — {(nextTier.min - points).toLocaleString()} {t('pts_to')} {nextTier.label}</>
                : t('highest_tier')}
            </div>

            {/* Tier ladder */}
            <div className="select-none" style={{ marginTop: 20, position: 'relative', padding: '0 14px' }}>
              <div style={{ position: 'absolute', left: 28, right: 28, top: 14, height: 2, background: 'var(--border2)' }} />
              <div style={{
                position: 'absolute', left: 28, top: 14, height: 2, background: tier.color,
                width: tierIndex === 0 ? 0 : `calc((100% - 56px) * ${tierIndex / (TIERS.length - 1)})`,
                transition: 'width .4s ease',
              }} />
              <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {TIERS.map(lt => {
                  const reached = points >= lt.min
                  const isCurrent = lt.key === tier.key
                  const LtIcon = lt.icon
                  return (
                    <div key={lt.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: reached ? lt.bg : 'var(--bg3)',
                        color: reached ? lt.color : 'var(--text3)',
                        opacity: reached ? 1 : 0.5,
                        boxShadow: isCurrent ? `0 0 0 2px ${lt.color}` : '0 0 0 1px var(--border)',
                        transition: 'all .2s',
                      }}>
                        <LtIcon size={13} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: reached ? lt.color : 'var(--text3)' }}>{lt.label}</div>
                        <div style={{ fontSize: 8.5, color: 'var(--text3)' }}>{lt.min.toLocaleString()}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
            {statCards.map(s => (
              <div key={s.label} className="card-surface" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <s.Icon size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Purchase history */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{t('purchases')} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>({custTxns.length})</span></div>
              <div style={{ display: 'flex', gap: 6 }}>
                {FILTERS.map(f => (
                  <button key={f} onClick={() => setFilterStatus(f)} style={{
                    padding: '4px 11px', borderRadius: 99, border: '1px solid', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                    ...(filterStatus === f
                      ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0a0a' }
                      : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text2)' }),
                  }}>{filterLabel(f)}</button>
                ))}
              </div>
            </div>

            {txnLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 36, color: 'var(--text3)' }}>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-9-9" />
                </svg>
                Loading history…
              </div>
            ) : filteredTxns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text3)' }}>
                <Receipt size={30} style={{ opacity: .25, marginBottom: 8 }} />
                <div style={{ fontSize: 12 }}>{t('no_purchases')}</div>
              </div>
            ) : pg.pageItems.map(tx => {
              const refunded = isRefunded(tx)
              const partial  = isPartial(tx)
              const voided   = refunded || partial
              const refundedAmt = voided ? refundedAmountFor(tx.id) : 0
              const ptsEarned   = 10 + Math.floor((tx.total || 0) / 100)
              const ptsReversed = (refunded ? 10 : 0) + Math.floor(refundedAmt / 100)
              const items = tx.items || []
              const isExpanded = !!expanded[tx.id]
              const visibleItems = isExpanded ? items : items.slice(0, 2)
              const extraCount = items.length - 2
              const pay = paymentDisplay(tx.payment)

              return (
                <div key={tx.id} style={{
                  padding: 14, borderRadius: 12, border: '1px solid var(--border)',
                  background: voided ? 'var(--bg3)' : 'var(--bg2)',
                  opacity: voided ? 0.72 : 1,
                  transition: 'opacity .2s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>#{String(tx.id).padStart(4, '0')}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{fmtDateTime(tx.createdAt)}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: voided ? 'var(--text3)' : 'var(--text)', textDecoration: voided ? 'line-through' : 'none' }}>
                        {peso(tx.total)}
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text3)', marginTop: 4, justifyContent: 'flex-end' }}>
                        <pay.Icon size={11} />{pay.label}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {visibleItems.map((item, idx) => {
                      const product = products.find(p => p.id === item.id)
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProductThumb image={product?.image} icon={product?.icon} category={product?.category} size={32} radius={8} />
                          <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{item.name} <span style={{ color: 'var(--text3)' }}>×{item.qty}</span></div>
                        </div>
                      )
                    })}
                    {items.length > 2 && (
                      <button
                        onClick={() => setExpanded(e => ({ ...e, [tx.id]: !e[tx.id] }))}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 10.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}
                      >
                        {isExpanded ? <>{t('show_less')} <ChevronUp size={12} /></> : <>+{extraCount} {t('items_more')} <ChevronDown size={12} /></>}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    {refunded ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>−{ptsReversed} {t('pts_reversed_suffix')}</span>
                    ) : partial ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--yellow)', fontVariantNumeric: 'tabular-nums' }}>−{ptsReversed} {t('pts_reversed_suffix')}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>+{ptsEarned} {t('pts_earned_suffix')}</span>
                    )}

                    {refunded && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '.4px', background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)' }}>
                        {t('refunded_status')}
                      </span>
                    )}
                    {partial && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)', border: '1px solid rgba(245,158,11,0.25)', fontVariantNumeric: 'tabular-nums' }}>
                        {t('partially_refunded')} · {peso(refundedAmt)} {t('amount_returned')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            <Pagination {...pg}/>
          </div>
        </div>
      </div>
    </div>
  )
}

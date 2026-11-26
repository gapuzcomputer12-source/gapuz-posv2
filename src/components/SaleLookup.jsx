import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { differenceInCalendarDays, isToday, format } from 'date-fns'
import { useTransactionStore, useAppStore, fetchTransactionSettlement } from '../store'
import { useToast } from '../utils/toast'
import { useT, peso, SALE_ADJUSTMENT_DAYS } from '../utils/helpers'
import ScanInput from './ScanInput'

const COPY = {
  refund: { title: 'Look up Transaction' },
  return: { title: 'Find the Sale' },
}

const PILL_TONE = {
  good:  { bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.3)',  color: 'var(--accent)' },
  warn:  { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', color: 'var(--yellow)' },
  muted: { bg: 'var(--bg4)',            border: 'var(--border2)',        color: 'var(--text3)' },
}
function Pill({ label, tone }) {
  const s = PILL_TONE[tone] || PILL_TONE.muted
  return <span style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: s.bg, border: `1px solid ${s.border}`, color: s.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
}

// "Today, 9:42 PM" for same-day sales, "Nov 10, 5:47 PM" otherwise.
function fmtRecentDate(d) {
  const date = new Date(d)
  return isToday(date) ? `Today, ${format(date, 'h:mm a')}` : format(date, 'MMM d, h:mm a')
}

// Status pill for one row, read ENTIRELY off get_transaction_settlement —
// no local re-derivation, so this can never drift from what actually gates
// clickability (settlement.status) or from what the server itself enforces
// inside create_return/create_refund. 'pending' always outranks 'settled'
// (a pending request needs attention first); the wording for 'settled'/
// 'partial' picks Return vs Refund phrasing off which side actually has an
// approved claim, purely cosmetic (the underlying status is server-decided).
function pillFor(settlement) {
  if (!settlement) return null
  if (settlement.status === 'pending') {
    const prefix = settlement.pendingKind === 'return' ? 'RET' : 'REF'
    return { label: `Pending ${prefix} #${String(settlement.pendingId).padStart(4, '0')}`, tone: 'warn' }
  }
  if (settlement.status === 'settled') {
    return { label: settlement.approvedReturned >= settlement.amountPaid ? 'Fully Returned' : 'Fully Refunded', tone: 'good' }
  }
  if (settlement.status === 'partial') {
    return { label: settlement.approvedReturned > 0 ? 'Partially Returned' : 'Partially Refunded', tone: 'good' }
  }
  return null
}

// Shared "find the sale" step — same ScanInput + Look Up button + Recent
// Transactions list on both Refunds and Returns. The page keeps owning its
// own lookup/validation logic (steps 2-4 untouched) and just hands it in as
// onSaleFound(rawQueryOrId) -> Promise<{ok,message}>; this component calls
// that for a scan, a button click, or a recent-row click alike, so clicking
// a row behaves exactly like looking up that row's transaction id.
export default function SaleLookup({ mode, onSaleFound }) {
  const t = useT()
  const toast = useToast()
  const { theme } = useAppStore()
  const isLight = theme === 'light'
  const transactions = useTransactionStore(s => s.transactions)
  const txLoading = useTransactionStore(s => s.loading)

  const [query, setQuery] = useState('')
  const [looking, setLooking] = useState(false)
  // Settlement (badge + clickable-state source of truth) for each row
  // currently shown — fetched fresh whenever the visible set of recent
  // transactions changes, since it can go stale the moment a return/
  // refund gets approved elsewhere.
  const [settlements, setSettlements] = useState({})

  const runLookup = async (raw) => {
    setLooking(true)
    const result = await onSaleFound(raw)
    setLooking(false)
    return result
  }

  const handleButtonClick = async () => {
    const r = await runLookup(query)
    if (r && !r.ok) toast(r.message, 'error')
  }
  const handleRowClick = async (tx) => {
    const r = await runLookup(String(tx.id))
    if (r && !r.ok) toast(r.message, 'error')
  }

  const recent = transactions.slice(0, 5)
  const recentIds = recent.map(tx => tx.id).join(',')

  useEffect(() => {
    if (recent.length === 0) return
    let cancelled = false
    Promise.all(recent.map(tx => fetchTransactionSettlement(tx.id).then(s => [tx.id, s]))).then(pairs => {
      if (cancelled) return
      setSettlements(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [recentIds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{COPY[mode].title}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.6 }}>
          Scan a unit's serial number, or type the Transaction ID from the receipt.
        </div>
        <ScanInput placeholder="Scan a serial, or type a TXN ID…" value={query} onChange={setQuery} onScan={runLookup} disabled={looking} clearOnScan={false} />
      </div>

      <button onClick={handleButtonClick} disabled={looking} className="btn-primary" style={{ width: '100%', padding: 12, opacity: looking ? 0.6 : 1 }}>
        {looking ? 'Looking up…' : <>{t('look_up')} →</>}
      </button>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text2)' }}>Recent Transactions</div>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>click to select</span>
        </div>

        {txLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 46, borderRadius: 8 }} />)}
          </div>
        ) : recent.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12, padding: '16px 0' }}>No recent transactions</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map(tx => {
              const settlement = settlements[tx.id]
              const settled = settlement?.status === 'settled'
              const pending = settlement?.status === 'pending'
              const statusPill = pillFor(settlement)
              const daysSince = differenceInCalendarDays(new Date(), new Date(tx.createdAt))
              const daysLeft = SALE_ADJUSTMENT_DAYS - daysSince
              const timeExpired = daysLeft < 0
              // Settlement not loaded yet (brief window right after the
              // recent list changes) is treated as not-yet-clickable too,
              // rather than flashing a row clickable that turns out to be
              // settled/pending a moment later.
              const fullyClaimed = !settlement || settled || pending
              const expired = timeExpired || fullyClaimed
              const items = tx.items || []
              return (
                <button key={tx.id} type="button" disabled={expired} onClick={() => handleRowClick(tx)}
                  className="sale-lookup-row"
                  style={{
                    width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg3)', fontFamily: 'inherit', color: 'inherit',
                    cursor: expired ? 'not-allowed' : 'pointer', opacity: expired ? 0.5 : 1,
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden', minWidth: 0 }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 12, color: isLight ? '#059669' : 'var(--accent)', flexShrink: 0 }}>#{String(tx.id).padStart(4, '0')}</span>
                        <span style={{ color: 'var(--text3)', flexShrink: 0 }}>·</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.customerName || 'Walk-in'}</span>
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{peso(tx.total)}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtRecentDate(tx.createdAt)} · {items.length} item{items.length === 1 ? '' : 's'} · {items.map(i => i.name).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {statusPill && <Pill {...statusPill} />}
                    {timeExpired && !fullyClaimed && <Pill label="Expired" tone="muted" />}
                    {!timeExpired && !fullyClaimed && (
                      <Pill label={`${daysLeft} day${daysLeft === 1 ? '' : 's'} left`} tone={daysLeft <= 2 ? 'warn' : 'good'} />
                    )}
                    {!expired && <ChevronRight size={14} className="sale-lookup-row-arrow" style={{ color: isLight ? '#059669' : 'var(--accent)' }} />}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

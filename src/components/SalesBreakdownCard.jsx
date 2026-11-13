import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { peso, useT } from '../utils/helpers'

// Shared by Dashboard.jsx (Reports tab) and Reports.jsx (Sales tab) so the
// Gross/Net breakdown always looks and behaves the same in both places.
export default function SalesBreakdownCard({ metrics, isLight, title }) {
  const navigate = useNavigate()
  const t = useT()
  const { grossSales, refundTotal, refundCount, returnTotal, returnCount, netSales, refundRate, grossProfit, netProfit, grossVat, refundedVat, netVat } = metrics

  const rateColor = refundRate < 2 ? (isLight ? '#059669' : 'var(--accent)') : refundRate <= 5 ? (isLight ? '#d97706' : 'var(--yellow)') : 'var(--red)'
  const rateBg    = refundRate < 2 ? (isLight ? '#d1fae5' : 'rgba(52,211,153,0.12)') : refundRate <= 5 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)'
  const netColor  = isLight ? '#059669' : 'var(--accent)'

  const Row = ({ label, value, color, count, onClick, bold }) => (
    <div
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '9px 0', cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.opacity = '.7' } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.opacity = '1' } : undefined}
    >
      <span style={{ fontSize: bold ? 13 : 12, fontWeight: bold ? 700 : 500, color: bold ? 'var(--text)' : 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {count != null && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)' }}>({count} {t('approved_suffix')})</span>}
      </span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: bold ? 15 : 12.5, fontWeight: bold ? 700 : 600, color: color || 'var(--text)' }}>
        {value}
      </span>
    </div>
  )

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ClipboardList size={13} style={{ color: 'var(--accent)' }} />{title || t('sales_breakdown')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row label={t('gross_sales')} value={peso(grossSales)} />
        <Row label={t('gross_profit')} value={peso(grossProfit)} color={grossProfit >= 0 ? undefined : 'var(--red)'} />
        <div style={{ borderTop: '1px solid var(--border)' }} />
        <Row label={t('refunds')} value={`−${peso(refundTotal)}`} color="var(--red)" count={refundCount} onClick={() => navigate('/refunds?status=Approved')} />
        <Row label={t('returns')} value={`−${peso(returnTotal)}`} color="var(--red)" count={returnCount} onClick={() => navigate('/returns?status=Approved')} />
        <div style={{ borderTop: '1px solid var(--border)' }} />
        <Row label={t('net_sales')} value={peso(netSales)} color={netColor} bold />
        <Row label={t('net_profit')} value={peso(netProfit)} color={netProfit >= 0 ? netColor : 'var(--red)'} />
        {grossVat != null && (
          <>
            <div style={{ borderTop: '1px solid var(--border)' }} />
            <Row label={t('gross_vat')} value={peso(grossVat)} />
            <Row label="Refunded VAT" value={`−${peso(refundedVat)}`} color="var(--red)" />
            <Row label={t('net_vat')} value={peso(netVat)} color={netColor} bold />
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('refund_rate')}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: rateBg, color: rateColor }}>
            {refundRate.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}

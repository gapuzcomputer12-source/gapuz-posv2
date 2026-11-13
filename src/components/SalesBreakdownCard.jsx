import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { peso, useT } from '../utils/helpers'
import ChartCard from './ChartCard'

// Shared by Dashboard.jsx and Reports.jsx (Sales tab) so the Gross/Net
// breakdown always looks and behaves the same in both places. Both callers
// live in the light-locked analytics design, so colors are the fixed rpt-*
// tokens rather than theme-dependent.
export default function SalesBreakdownCard({ metrics, title }) {
  const navigate = useNavigate()
  const t = useT()
  const { grossSales, refundTotal, refundCount, returnTotal, returnCount, netSales, refundRate, grossProfit, netProfit, grossVat, refundedVat, netVat } = metrics

  const rateColor = refundRate < 2 ? 'var(--rpt-green)' : refundRate <= 5 ? 'var(--rpt-amber)' : 'var(--rpt-red)'
  const rateBg    = refundRate < 2 ? 'var(--rpt-green-light)' : refundRate <= 5 ? 'var(--rpt-amber-light)' : 'var(--rpt-red-light)'

  const Row = ({ label, value, color, count, onClick, bold }) => (
    <div
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 0', minHeight: 36, cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.opacity = '.7' } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.opacity = '1' } : undefined}
    >
      <span style={{ fontSize: bold ? 13.5 : 13, fontWeight: bold ? 700 : 500, color: bold ? 'var(--rpt-title)' : 'var(--rpt-body)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {count != null && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--rpt-muted)' }}>({count} {t('approved_suffix')})</span>}
      </span>
      <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 600, color: color || 'var(--rpt-title)' }}>
        {value}
      </span>
    </div>
  )

  return (
    <ChartCard title={<><ClipboardList size={14} style={{ color: 'var(--rpt-green)' }} />{title || t('sales_breakdown')}</>} style={{ height: '100%' }} bodyStyle={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <Row label={t('gross_sales')} value={peso(grossSales)} />
        <Row label={t('gross_profit')} value={peso(grossProfit)} color={grossProfit >= 0 ? undefined : 'var(--rpt-red)'} />
        <div style={{ borderTop: '1px solid var(--rpt-divider)' }} />
        <Row label={t('refunds')} value={`−${peso(refundTotal)}`} color="var(--rpt-red)" count={refundCount} onClick={() => navigate('/refunds?status=Approved')} />
        <Row label={t('returns')} value={`−${peso(returnTotal)}`} color="var(--rpt-red)" count={returnCount} onClick={() => navigate('/returns?status=Approved')} />
        <div style={{ borderTop: '1px solid var(--rpt-divider)' }} />
        <div style={{ background: 'var(--rpt-green-light)', borderRadius: 8, padding: '0 10px', margin: '4px 0' }}>
          <Row label={t('net_sales')} value={peso(netSales)} color="var(--rpt-green)" bold />
        </div>
        <Row label={t('net_profit')} value={peso(netProfit)} color={netProfit >= 0 ? undefined : 'var(--rpt-red)'} />
        {grossVat != null && (
          <>
            <div style={{ borderTop: '1px solid var(--rpt-divider)' }} />
            <Row label={t('gross_vat')} value={peso(grossVat)} />
            <Row label="Refunded VAT" value={`−${peso(refundedVat)}`} color="var(--rpt-red)" />
            <Row label={t('net_vat')} value={peso(netVat)} color="var(--rpt-green)" bold />
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--rpt-body)' }}>{t('refund_rate')}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: rateBg, color: rateColor }}>
            {refundRate.toFixed(1)}%
          </span>
        </div>
      </div>
    </ChartCard>
  )
}

import { useState } from 'react'
import { History, Search } from 'lucide-react'
import { useActivityLogStore } from '../store'
import { useT, fmtDateTime } from '../utils/helpers'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePagination } from '../hooks/usePagination'
import Pagination from '../components/Pagination'

const ACTION_BADGE = {
  created:     'badge-green',
  updated:     'badge-blue',
  deleted:     'badge-red',
  approved:    'badge-green',
  rejected:    'badge-red',
  suspended:   'badge-red',
  reactivated: 'badge-green',
  restocked:   'badge-yellow',
  submitted:   'badge-accent',
}

const ENTITY_LABEL = { staff: 'Staff', product: 'Product', category: 'Category', customer: 'Customer', refund: 'Refund' }

function Spinner({ size = 14, color = 'currentColor' }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  )
}

export default function ActivityLog() {
  useDocumentTitle('Activity Log')
  const { logs, loading } = useActivityLogStore()
  const [search, setSearch] = useState('')
  const t = useT()

  const filtered = logs.filter(l => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return l.actorName?.toLowerCase().includes(q) || l.entityLabel?.toLowerCase().includes(q) || l.action?.toLowerCase().includes(q)
  })

  const pg = usePagination(filtered)

  const detailsText = (d) => {
    if (!d) return ''
    if (d.roleChange) return `Role: ${d.roleChange}`
    if (d.qty != null) return `+${d.qty} (now ${d.newStock})`
    if (d.total != null) return `₱${Number(d.total).toLocaleString()}`
    return ''
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 20, gap: 16 }}>
      <div className="page-header">
        <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={18} style={{ color: 'var(--accent)' }} />{t('activity_log')}
        </div>
      </div>

      <div style={{ position: 'relative', maxWidth: 280, flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center', opacity: 0.6 }}>
          <Search size={15} />
        </div>
        <input className="input-field" style={{ paddingLeft: 40, width: '100%' }} placeholder={t('search_logs')} value={search} onChange={e => { setSearch(e.target.value); pg.setPage(1) }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div className="tbl-wrap">
          <table>
            <thead><tr>{[t('when'), t('actor'), t('action'), t('entity'), 'Details'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <Spinner size={18} color="var(--accent)" />
                  {t('loading')}
                </div>
              </td></tr>
                : pg.pageItems.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t('no_logs')}</td></tr>
                  : pg.pageItems.map(l => (
                    <tr key={l.id}>
                      <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{fmtDateTime(l.createdAt)}</td>
                      <td style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{l.actorName}</td>
                      <td><span className={`badge ${ACTION_BADGE[l.action] || 'badge-accent'}`} style={{ fontSize: 10, textTransform: 'capitalize' }}>{l.action}</span></td>
                      <td style={{ fontSize: 12.5, color: 'var(--text2)' }}>{ENTITY_LABEL[l.entityType] || l.entityType} {l.entityLabel ? `· ${l.entityLabel}` : ''}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--text3)' }}>{detailsText(l.details)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination {...pg}/>
    </div>
  )
}

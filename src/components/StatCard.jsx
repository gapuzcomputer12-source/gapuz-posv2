const TONE = {
  default: { bg: '#F3F4F6', fg: '#6B7280' },
  red:     { bg: 'var(--rpt-red-light)',   fg: 'var(--rpt-red)' },
  amber:   { bg: 'var(--rpt-amber-light)', fg: 'var(--rpt-amber)' },
  green:   { bg: 'var(--rpt-green-light)', fg: 'var(--rpt-green)' },
}

// Compact KPI tile for Reports/Dashboard — icon sits inline with the label
// on one line, value below, one optional subtext line. `tone` colors both
// the icon tile and the value together — only pass a semantic tone
// ('red'/'amber') when the metric itself means something is wrong;
// everything else stays neutral/dark per the design spec ("semantic colors
// only where they mean something").
export default function StatCard({ icon: Icon, label, value, sub, tone = 'default', onClick }) {
  const c = TONE[tone] || TONE.default
  return (
    <div className={`rpt-card stat-card${onClick ? ' rpt-clickable' : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-card-top">
        {Icon && (
          <div className="stat-card-icon" style={{ background: c.bg, color: c.fg }}>
            <Icon size={15} />
          </div>
        )}
        <div className="stat-card-label">{label}</div>
      </div>
      <div className={`stat-card-value${tone !== 'default' ? ` v-${tone}` : ''}`}>{value}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  )
}

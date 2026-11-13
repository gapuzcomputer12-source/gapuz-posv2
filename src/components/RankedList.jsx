// Rank + label + thin progress bar + value — used for every "Top N" list
// in Reports/Dashboard (Top Products, Top 10 by units, Top Reasons) instead
// of a Recharts bar chart, so every label stays fully readable.
// `items`: [{ key, label, value }]. `renderLeft(item)` renders an optional
// thumbnail/icon before the label. `renderValue(item)` formats the right-
// hand value (defaults to the raw number).
export default function RankedList({ items, max, barColor = 'var(--rpt-green)', renderLeft, renderValue, emptyText = 'No data.' }) {
  if (!items.length) return <div className="rpt-empty">{emptyText}</div>
  const m = max ?? Math.max(...items.map(i => i.value), 1)
  return (
    <div className="ranked-list">
      {items.map((it, i) => (
        <div key={it.key ?? i} className="ranked-row">
          <span className="ranked-rank">{i + 1}</span>
          {renderLeft?.(it)}
          <div className="ranked-main">
            <div className="ranked-label" title={it.label}>{it.label}</div>
            <div className="ranked-track">
              <div className="ranked-fill" style={{ width: `${Math.max(it.value > 0 ? 3 : 0, Math.min(100, Math.round((it.value / m) * 100)))}%`, background: barColor }} />
            </div>
          </div>
          <div className="ranked-value">{renderValue ? renderValue(it) : it.value}</div>
        </div>
      ))}
    </div>
  )
}

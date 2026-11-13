// Generic Recharts <Tooltip content={...}> renderer — white card, shadow,
// a colored dot + label + value per series. Pass `formatValue` to format
// each series' raw value (e.g. peso()); defaults to printing it as-is.
export default function ChartTooltip({ active, payload, label, formatValue = v => v }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      {label != null && <div className="chart-tooltip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="chart-tooltip-name">{p.name}</span>
          <span className="chart-tooltip-value">{formatValue(p.value, p)}</span>
        </div>
      ))}
    </div>
  )
}

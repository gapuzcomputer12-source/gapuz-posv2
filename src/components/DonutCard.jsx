import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

// Donut with a centered total + a legend beside it (not below) — shared by
// Payment Methods, Returned Units by Condition, and Tier Distribution.
// `data`: [{ name, value, color }]. When only one category has data, the
// slice renders with a hairline gap so the light gray track underneath
// still reads as a ring rather than a solid-filled circle.
export default function DonutCard({ data, caption, size = 180, formatValue = v => v, emptyText = 'No data.' }) {
  if (!data.length) return <div className="rpt-empty">{emptyText}</div>
  const total = data.reduce((s, d) => s + d.value, 0)
  const isSingle = data.length === 1

  return (
    <div className="donut-card">
      <div className="donut-chart-wrap" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {isSingle && (
              <Pie data={[{ value: 1 }]} dataKey="value" cx="50%" cy="50%" innerRadius="70%" outerRadius="100%"
                cornerRadius={6} fill="var(--rpt-track)" stroke="none" isAnimationActive={false} />
            )}
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius="70%" outerRadius="100%"
              startAngle={90} endAngle={isSingle ? 449.5 : 450} paddingAngle={isSingle ? 0 : 3} cornerRadius={6} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <div className="donut-center-value">{formatValue(total)}</div>
          {caption && <div className="donut-center-caption">{caption}</div>}
        </div>
      </div>
      <div className="donut-legend">
        {data.map(d => (
          <div key={d.name} className="donut-legend-row">
            <span className="donut-legend-dot" style={{ background: d.color }} />
            <span className="donut-legend-name">{d.name}</span>
            <span className="donut-legend-value">{formatValue(d.value)} · {total ? Math.round(d.value / total * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

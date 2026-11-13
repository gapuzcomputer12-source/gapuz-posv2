// Shared chart/table card shell for Reports & Dashboard — title + optional
// subtitle on the left, optional actions (a toggle, a link) on the right,
// then the content. Keeps every chart/list/table card's header identical.
export default function ChartCard({ title, subtitle, actions, children, style, bodyStyle, className = '' }) {
  return (
    <div className={`rpt-card chart-card${className ? ` ${className}` : ''}`} style={style}>
      {(title || actions) && (
        <div className="chart-card-head">
          <div>
            {title && <div className="chart-card-title">{title}</div>}
            {subtitle && <div className="chart-card-subtitle">{subtitle}</div>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      <div className="chart-card-body" style={bodyStyle}>{children}</div>
    </div>
  )
}

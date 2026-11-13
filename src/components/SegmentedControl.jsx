// Gray-track pill switcher — shared by the Reports/Dashboard toolbar (tabs,
// period) and any filter-pill row that wants the same look (e.g. Demand
// status, History type/status). Active option renders as a white pill with
// a soft shadow and green text; everything else is transparent/muted.
export default function SegmentedControl({ options, value, onChange, size = 'md', className = '' }) {
  return (
    <div className={`seg-track${size === 'sm' ? ' seg-sm' : ''}${className ? ` ${className}` : ''}`}>
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={`seg-btn${value === opt.value ? ' active' : ''}`}>
          {opt.icon}{opt.label}
        </button>
      ))}
    </div>
  )
}

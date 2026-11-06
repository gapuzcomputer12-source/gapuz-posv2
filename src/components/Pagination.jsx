// Compact Back/Next pager shared by every table and list in the app.
// Pass the object returned by usePagination() straight through:
//   const pg = usePagination(filteredRows)
//   ...
//   <Pagination {...pg}/>
export default function Pagination({ page, totalPages, start, end, total, next, prev, canNext, canPrev }) {
  if (totalPages <= 1) return null
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
      flexWrap:'wrap', paddingTop:12, marginTop:4, borderTop:'1px solid var(--border)',
    }}>
      <div style={{fontSize:11,color:'var(--text3)'}}>Showing {start}–{end} of {total}</div>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <button onClick={prev} disabled={!canPrev} className="btn-secondary"
          style={{padding:'5px 10px',fontSize:11,gap:5,opacity:canPrev?1:0.5,cursor:canPrev?'pointer':'not-allowed'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        <div style={{fontSize:11.5,color:'var(--text3)',fontWeight:600,whiteSpace:'nowrap'}}>Page {page} of {totalPages}</div>
        <button onClick={next} disabled={!canNext} className="btn-secondary"
          style={{padding:'5px 10px',fontSize:11,gap:5,opacity:canNext?1:0.5,cursor:canNext?'pointer':'not-allowed'}}>
          Next
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  )
}

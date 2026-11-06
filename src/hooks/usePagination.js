import { useEffect, useState } from 'react'

// Client-side pagination over an already-loaded array. Pass the FILTERED/
// SORTED array in — pageItems is sliced from whatever you hand it, so
// filtering/sorting upstream and resetting `page` to 1 when those change is
// the caller's job (the page number itself isn't reset here, since some
// callers want it to persist and others don't).
export const usePagination = (items, pageSize = 8) => {
  const [page, setPage] = useState(1)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Clamp down when the data shrinks out from under the current page (a row
  // gets deleted, a filter narrows the list) so we never render an empty
  // page while records still exist.
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages])

  const start = (page - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  return {
    page,
    totalPages,
    pageItems,
    next: () => setPage(p => Math.min(totalPages, p + 1)),
    prev: () => setPage(p => Math.max(1, p - 1)),
    canNext: page < totalPages,
    canPrev: page > 1,
    start: total === 0 ? 0 : start + 1,
    end: Math.min(start + pageSize, total),
    total,
    setPage,
  }
}

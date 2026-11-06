import { useEffect } from 'react'

const BRAND_TITLE = 'Gapuz POS — Computer Shop & Accessories'

// Sets the browser tab title to "<page> · Gapuz POS" so the page name is
// always the first thing shown, since Chrome truncates long tab titles from
// the end. Call with no argument for the full brand title (login screen).
export const useDocumentTitle = (page) => {
  useEffect(() => {
    document.title = page ? `${page} · Gapuz POS` : BRAND_TITLE
  }, [page])
}

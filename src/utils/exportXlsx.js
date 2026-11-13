// Shared Excel-export building blocks for Reports.jsx — every sheet gets
// the same title block (brand, report name, real period dates, generated
// line), the same bold green/white header row, typed date/money cells with
// the right number formats, a bold TOTAL row with real SUM formulas (not
// hardcoded numbers, so the file stays correct if someone edits a row),
// frozen header, auto-filter, and content-fit column widths.

const BRAND = 'GAPUZ COMPUTER SERVICES AND ACCESSORIES'
const GREEN = 'FF059669'
const WHITE = 'FFFFFFFF'
const RED = 'FFDC2626'
export const MONEY_FMT = '"₱"#,##0.00'
export const DATE_FMT = 'mmm d, yyyy h:mm AM/PM'
export const PERCENT_FMT = '0.0%'
// "Dec 31, 2026 11:59 PM" — the widest a DATE_FMT value ever renders.
const DATE_WIDTH = 22

// 1-indexed column number -> Excel column letter(s), for SUM formula ranges.
function colLetter(n) {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// How wide a value RENDERS once its number format is applied — not just
// String(v).length — so a column is sized for what Excel actually shows
// ("₱271,989.00", "93.0%"), not for the raw unformatted number.
function renderedWidth(v, { money, percent, date } = {}) {
  if (v == null || v === '') return 0
  if (date && v instanceof Date) return DATE_WIDTH
  if (money && typeof v === 'number') {
    const sign = v < 0 ? '-' : ''
    return (sign + '₱' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).length
  }
  if (percent && typeof v === 'number') {
    return `${(v * 100).toFixed(1)}%`.length
  }
  return String(v).length
}

function writeHeaderBlock(ws, { reportName, periodLabel, generatedLabel, numCols }) {
  ws.mergeCells(1, 1, 1, Math.max(numCols, 2))
  const title = ws.getCell(1, 1)
  title.value = BRAND
  title.font = { bold: true, size: 14 }

  ws.getCell(2, 1).value = reportName
  ws.getCell(2, 1).font = { bold: true, size: 11 }
  ws.getCell(3, 1).value = `Period: ${periodLabel}`
  ws.getCell(4, 1).value = generatedLabel
  return 6 // first usable row, after a blank spacer row 5
}

// Writes one table (optional title line, bold green/white header, typed
// data rows, optional bold TOTAL row with SUM formulas) starting at
// `startRow`. Returns the next free row so a caller can stack another
// table below it (e.g. Sales > Summary's Payment Methods block).
// `columns`: [{ header, value(row) => string|number|Date, money?, percent?, date?, total? }]
// `money`/`percent`/`date` may be a plain boolean (whole column) or a
// predicate `(row) => boolean` for a column whose rows mix types (e.g. a
// Metric/Value table where only some rows are money). `value()` must
// return the real number for money/percent cells (percent as a fraction,
// e.g. 0.093 for "9.3%") — never a pre-formatted string — so Excel stores
// an actual number instead of text (no green "number as text" warning) and
// SUM()/number formats work on it.
function writeTable(ws, { startRow, columns, rows, title, applyViews = true }) {
  let r = startRow
  if (title) {
    ws.getCell(r, 1).value = title
    ws.getCell(r, 1).font = { bold: true, size: 12 }
    r += 1
  }
  const headerRowIdx = r
  const headerRow = ws.getRow(headerRowIdx)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = { bold: true, color: { argb: WHITE } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
  })
  headerRow.commit()

  const dataStart = headerRowIdx + 1
  rows.forEach((row, ri) => {
    const er = ws.getRow(dataStart + ri)
    columns.forEach((col, ci) => {
      const cell = er.getCell(ci + 1)
      const v = col.value(row)
      cell.value = v
      const isMoney = typeof col.money === 'function' ? col.money(row) : col.money
      const isPercent = typeof col.percent === 'function' ? col.percent(row) : col.percent
      const isDate = typeof col.date === 'function' ? col.date(row) : col.date
      if (isMoney) {
        cell.numFmt = MONEY_FMT
        if (typeof v === 'number' && v < 0) cell.font = { color: { argb: RED } }
      }
      if (isPercent) cell.numFmt = PERCENT_FMT
      if (isDate && v instanceof Date) cell.numFmt = DATE_FMT
    })
  })
  const dataEnd = dataStart + rows.length - 1
  const hasTotalRow = rows.length > 0 && columns.some(c => c.total)

  // Column widths fit RENDERED content — header vs. every data row vs. the
  // bold TOTAL row's own SUM result (computed here in JS, matching the
  // formula Excel will evaluate) — so a column is never narrower than what
  // actually displays. Only ever grows, so a second table stacked on the
  // same sheet (fewer/narrower columns) can't shrink widths the first
  // table already needs. Money columns get a 14-char floor; +4 padding
  // everywhere covers the bold TOTAL/header text rendering a touch wider
  // than the same string at regular weight.
  columns.forEach((col, ci) => {
    const isMoneyCol = typeof col.money === 'function' ? rows.some(r => col.money(r)) : !!col.money
    const isDateCol = typeof col.date === 'function' ? rows.some(r => col.date(r)) : !!col.date
    let maxLen = col.header.length
    rows.forEach(row => {
      const v = col.value(row)
      const money = typeof col.money === 'function' ? col.money(row) : col.money
      const percent = typeof col.percent === 'function' ? col.percent(row) : col.percent
      const date = typeof col.date === 'function' ? col.date(row) : col.date
      maxLen = Math.max(maxLen, renderedWidth(v, { money, percent, date }))
    })
    if (hasTotalRow) {
      if (ci === 0) {
        maxLen = Math.max(maxLen, 'TOTAL'.length)
      } else if (col.total) {
        const sum = rows.reduce((s, row) => { const v = col.value(row); return s + (typeof v === 'number' ? v : 0) }, 0)
        maxLen = Math.max(maxLen, renderedWidth(sum, { money: isMoneyCol }))
      }
    }
    const width = Math.min(44, Math.max(isMoneyCol ? 14 : isDateCol ? DATE_WIDTH : 11, maxLen + 4))
    const c = ws.getColumn(ci + 1)
    c.width = Math.max(c.width || 0, width)
  })

  if (hasTotalRow) {
    const tr = ws.getRow(dataStart + rows.length)
    columns.forEach((col, ci) => {
      const cell = tr.getCell(ci + 1)
      if (ci === 0) {
        cell.value = 'TOTAL'
      } else if (col.total) {
        cell.value = { formula: `SUM(${colLetter(ci + 1)}${dataStart}:${colLetter(ci + 1)}${dataEnd})` }
        if (col.money) cell.numFmt = MONEY_FMT
      }
      cell.font = { bold: true }
      cell.border = { top: { style: 'thin' } }
    })
  }
  const nextRow = dataStart + rows.length + (hasTotalRow ? 1 : 0)

  if (applyViews) {
    ws.views = [{ state: 'frozen', ySplit: headerRowIdx }]
    if (columns.length) ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: columns.length } }
  }

  return nextRow + 1 // leave one blank row before any next block
}

// A sheet with exactly one table.
export function addSheet(wb, { name, reportName, periodLabel, generatedLabel, columns, rows, title }) {
  const ws = wb.addWorksheet(name)
  const startRow = writeHeaderBlock(ws, { reportName, periodLabel, generatedLabel, numCols: columns.length })
  writeTable(ws, { startRow, columns, rows, title })
  return ws
}

// A sheet with two or more tables stacked vertically (e.g. Sales > Summary:
// Metric/Value, then Payment Methods). Freeze/auto-filter only make sense
// for a single header row, so they're skipped here.
export function addMultiTableSheet(wb, { name, reportName, periodLabel, generatedLabel, tables }) {
  const numCols = Math.max(...tables.map(t => t.columns.length))
  const ws = wb.addWorksheet(name)
  let row = writeHeaderBlock(ws, { reportName, periodLabel, generatedLabel, numCols })
  tables.forEach(t => { row = writeTable(ws, { startRow: row, columns: t.columns, rows: t.rows, title: t.title, applyViews: false }) })
  return ws
}

export async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// exceljs is ~1MB — load it only when someone actually exports, not on
// every page load for every user who never opens Reports.
export async function createWorkbook({ creator, created } = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  if (creator) wb.creator = creator
  if (created) wb.created = created
  return wb
}

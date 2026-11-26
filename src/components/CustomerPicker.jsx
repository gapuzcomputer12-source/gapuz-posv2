import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, User, Plus } from 'lucide-react'
import { getTier } from '../utils/loyalty'

// Searchable "Walk-in Customer or a registered customer" picker for the
// Cart panel. Deliberately has no "none selected" render state of its own
// — `chosen` is owned by the caller (useCartStore) so the empty placeholder
// can be told apart from an explicit Walk-in pick everywhere else in the
// app too (held orders, the checkout gate), not just here.
//
// Exposes focus() via ref so the caller can pull focus here and flash the
// invalid state if checkout is attempted before a choice is made.
const CustomerPicker = forwardRef(function CustomerPicker(
  { customers, selectedId, chosen, invalid, onClearInvalid, onSelectWalkIn, onSelectCustomer, onAddNew },
  ref
) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef(null)
  const searchInputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    focus: () => { setOpen(true); onClearInvalid?.() },
  }))

  useEffect(() => {
    if (!open) return
    setSearch('')
    const t = setTimeout(() => searchInputRef.current?.focus(), 0)
    const onClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  const q = search.trim().toLowerCase()
  const filteredCustomers = customers.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
  )
  const selectedCustomer = chosen && selectedId != null ? customers.find(c => c.id === selectedId) : null
  const label = !chosen ? 'Select customer…' : selectedId == null ? 'Walk-in Customer' : (selectedCustomer?.name || 'Walk-in Customer')

  const pick = (fn) => { fn(); onClearInvalid?.(); setOpen(false) }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className={`select-field${invalid ? ' form-shake' : ''}`} style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        borderColor: invalid ? 'var(--red)' : undefined,
        background: invalid ? 'rgba(239,68,68,0.08)' : undefined,
      }}>
        <span style={{ color: chosen ? 'var(--text)' : 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, color: 'var(--text3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {chosen && selectedCustomer && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: getTier(selectedCustomer.points).color, fontWeight: 700 }}>{getTier(selectedCustomer.points).label}</span>
          <span>· {(selectedCustomer.points || 0).toLocaleString()} pts</span>
        </div>
      )}

      {open && (
        <div className="card animate-scale-in" style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 150,
          padding: 8, border: '1px solid var(--border2)', boxShadow: '0 12px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)',
          maxHeight: 300, display: 'flex', flexDirection: 'column',
        }}>
          <input ref={searchInputRef} className="input-field" style={{ marginBottom: 6, fontSize: 12, flexShrink: 0 }}
            placeholder="Search name, email, or phone…" value={search} onChange={e => setSearch(e.target.value)} />

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <button type="button" onClick={() => pick(onSelectWalkIn)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
              background: chosen && selectedId == null ? 'var(--accent-tint)' : 'transparent',
              color: chosen && selectedId == null ? 'var(--accent)' : 'var(--text)',
            }}>
              <User size={13} />Walk-in Customer
            </button>

            {filteredCustomers.length === 0 && search ? (
              <div style={{ padding: '10px 10px', fontSize: 11.5, color: 'var(--text3)', textAlign: 'center' }}>No customers match "{search}"</div>
            ) : filteredCustomers.map(c => {
              const tier = getTier(c.points)
              const active = chosen && selectedId === c.id
              return (
                <button key={c.id} type="button" onClick={() => pick(() => onSelectCustomer(c.id))} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? 'var(--accent-tint)' : 'transparent',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: tier.bg, color: tier.color, flexShrink: 0 }}>{tier.label}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{(c.points || 0).toLocaleString()} pts</span>
                </button>
              )
            })}
          </div>

          <button type="button" onClick={() => { setOpen(false); onAddNew() }} style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7,
            border: 'none', borderTop: '1px solid var(--border)', marginTop: 4, flexShrink: 0,
            background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
          }}>
            <Plus size={13} />Add new customer
          </button>
        </div>
      )}
    </div>
  )
})

export default CustomerPicker

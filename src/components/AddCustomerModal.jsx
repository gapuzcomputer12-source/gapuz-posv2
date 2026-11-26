import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useCustomerStore } from '../store'
import { useToast } from '../utils/toast'
import { useT } from '../utils/helpers'
import Modal from './Modal'

const EMPTY = { name: '', email: '', phone: '+63', address: '' }
const GMAIL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@gmail\.com$/
const PH_PHONE_RE = /^\+63\d{10}$/

const toPHPhone = (raw) => {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('63')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return '+63' + digits.slice(0, 10)
}

// Shared "Add Customer" form — Customers.jsx's own + button and the Cart's
// Customer Picker ("+ Add new customer") both open this. Only ever
// creates (editing an existing customer stays Customers.jsx-only, since
// nothing else in the app needs it). onAdded gets the newly inserted
// customer row, so a caller like the Cart can select it immediately.
export default function AddCustomerModal({ open, onClose, onAdded }) {
  const addCustomer = useCustomerStore(s => s.addCustomer)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const t = useT()

  useEffect(() => { if (open) setForm(EMPTY) }, [open])

  const handlePhoneChange = e => setForm(f => ({ ...f, phone: toPHPhone(e.target.value) }))

  const handleSave = async () => {
    if (!form.name.trim()) return toast('Name is required', 'error')
    const email = form.email.trim()
    if (email && !GMAIL_RE.test(email)) return toast('Email must be a valid Gmail address (e.g. juan@gmail.com)', 'error')
    const phone = form.phone.trim()
    const hasPhoneDigits = phone.replace('+63', '').length > 0
    if (hasPhoneDigits && !PH_PHONE_RE.test(phone)) return toast('Phone must be a valid PH number: +63 followed by 10 digits', 'error')
    setSaving(true)
    const inserted = await addCustomer({ ...form, email, phone: hasPhoneDigits ? phone : '' })
    setSaving(false)
    if (!inserted) return toast('Could not add customer', 'error')
    toast(t('customer_added'), 'success')
    onAdded?.(inserted)
    onClose()
  }

  if (!open) return null

  return (
    <Modal open onClose={onClose} contentStyle={{ width: 'min(420px,92vw)' }}>
      <div className="card animate-scale-in" style={{ padding: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} style={{ color: 'var(--green)' }} />{t('add_customer')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[['name', t('full_name'), 'Juan dela Cruz', 'text'], ['email', t('email_addr'), 'juan@gmail.com', 'email']].map(([key, label, ph, type]) => (
            <div key={key}>
              <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</label>
              <input className="input-field" type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('phone')}</label>
            <input className="input-field" type="tel" inputMode="numeric" value={form.phone} onChange={handlePhoneChange} placeholder="+639171234567" maxLength={13} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text3)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('address')}</label>
            <input className="input-field" type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Cagayan de Oro City" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} className="btn-secondary">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : t('save')}</button>
        </div>
      </div>
    </Modal>
  )
}

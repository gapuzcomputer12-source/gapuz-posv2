import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabaseClient'

// ── AUTH STORE (Supabase Auth + profiles table) ───────────────────
export const useAuthStore = create((set, get) => ({
  user: null,
  role: null,
  initialized: false,

  _loadProfile: async (authUser) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name, role')
      .eq('id', authUser.id)
      .single()
    set({
      user: { ...authUser, user_metadata: { ...authUser.user_metadata, name: profile?.name } },
      role: profile?.role || 'cashier',
    })
  },

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) await get()._loadProfile(session.user)
    set({ initialized: true })
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) get()._loadProfile(session.user)
      else set({ user: null, role: null })
    })
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { ok: false, error }
    await get()._loadProfile(data.user)
    return { ok: true, error: null }
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, role: null })
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  },

  updatePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password: password.trim() })
    return { error }
  },

  updateProfile: async ({ name, currentPassword, password }) => {
    const { user } = get()
    if (name?.trim()) {
      const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', user.id)
      if (error) return { error }
    }
    if (password?.trim()) {
      // Re-authenticate with the current password first — Supabase's updateUser() will
      // happily change the password of whoever holds the active session, so this check
      // is the only thing standing between "I forgot to lock my screen" and account takeover.
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (verifyError) return { error: { message: 'Current password is incorrect' } }
      const { error } = await supabase.auth.updateUser({ password: password.trim() })
      if (error) return { error }
    }
    await get()._loadProfile(user)
    return { error: null }
  },
}))

// ── ACTIVITY LOG (audit trail — who did what, for disputes) ──────
// Fire-and-forget: a logging failure must never block the action it's
// recording (a delete, a refund decision, etc.), so errors are just logged
// to the console instead of surfacing to the user.
export function logActivity(action, entityType, entityLabel, details) {
  const { user } = useAuthStore.getState()
  const actorName = user?.user_metadata?.name || user?.email || 'Unknown'
  supabase.from('activity_log').insert({
    actor_id: user?.id || null,
    actor_name: actorName,
    action,
    entity_type: entityType,
    entity_label: entityLabel || null,
    details: details || null,
  }).then(({ error }) => { if (error) console.error('activity log failed:', error.message) })
}

const LOG_SELECT = 'id:log_id, actorName:actor_name, action, entityType:entity_type, entityLabel:entity_label, details, createdAt:created_at'

// Fire-and-forget: emails every active admin via the send-low-stock-alert
// edge function. Call this only at the moment a real decrease lands stock
// at 1, 2, or 3 (level 'low') or exactly 0 (level 'out') — never on a poll
// — so a checkout that drains stock one unit at a time still emails once
// per level crossed, and a batch sale that jumps straight into that range
// (skipping individual values) still emails once for wherever it landed.
function notifyLowStock(product, level = 'out') {
  supabase.functions.invoke('send-low-stock-alert', { body: { product, level } })
    .then(({ error }) => { if (error) console.error('low-stock alert failed:', error.message) })
}

export const useActivityLogStore = create((set) => ({
  logs: [],
  loading: false,

  fetchLogs: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('activity_log').select(LOG_SELECT).order('created_at', { ascending: false }).limit(500)
    if (!error) set({ logs: data, loading: false })
    else set({ loading: false })
  },
}))

// ── STAFF STORE (profiles — admin manages cashier accounts) ───────
const STAFF_SELECT = 'id, name, email, role, active, createdAt:created_at'

export const useStaffStore = create((set, get) => ({
  staff: [],
  loading: false,

  fetchStaff: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('profiles').select(STAFF_SELECT).order('created_at')
    if (!error) set({ staff: data, loading: false })
    else set({ loading: false })
  },

  addCashier: async ({ name, email, password }) => {
    const { data, error } = await supabase.functions.invoke('create-cashier', {
      body: { name: name.trim(), email: email.trim(), password },
    })
    if (error) {
      const serverMsg = await error.context?.json?.().then(j => j?.error).catch(() => null)
      return { error: { message: serverMsg || error.message } }
    }
    if (data?.error) return { error: { message: data.error } }
    await get().fetchStaff()
    logActivity('created', 'staff', name.trim())
    return { error: null }
  },

  updateStaff: async ({ id, name, email, password, role }) => {
    const prevRole = get().staff.find(s => s.id === id)?.role
    const { data, error } = await supabase.functions.invoke('update-staff', {
      body: { id, name: name.trim(), email: email.trim(), password: password?.trim() || undefined, role },
    })
    if (error) {
      const serverMsg = await error.context?.json?.().then(j => j?.error).catch(() => null)
      return { error: { message: serverMsg || error.message } }
    }
    if (data?.error) return { error: { message: data.error } }
    await get().fetchStaff()
    logActivity('updated', 'staff', name.trim(), prevRole && prevRole !== role ? { roleChange: `${prevRole} → ${role}` } : null)
    return { error: null }
  },

  toggleStaffStatus: async ({ id, active }) => {
    const name = get().staff.find(s => s.id === id)?.name
    const { data, error } = await supabase.functions.invoke('toggle-staff-status', {
      body: { id, active },
    })
    if (error) {
      const serverMsg = await error.context?.json?.().then(j => j?.error).catch(() => null)
      return { error: { message: serverMsg || error.message } }
    }
    if (data?.error) return { error: { message: data.error } }
    await get().fetchStaff()
    logActivity(active ? 'reactivated' : 'suspended', 'staff', name)
    return { error: null }
  },

  deleteStaff: async (id) => {
    const name = get().staff.find(s => s.id === id)?.name
    const { data, error } = await supabase.functions.invoke('delete-staff', {
      body: { id },
    })
    if (error) {
      const serverMsg = await error.context?.json?.().then(j => j?.error).catch(() => null)
      return { error: { message: serverMsg || error.message } }
    }
    if (data?.error) return { error: { message: data.error } }
    logActivity('deleted', 'staff', name)
    return { error: null }
  },
}))

// ── APP STORE (theme, sidebar — local UI prefs only) ────
export const useAppStore = create(
  persist(
    (set, get) => ({
      theme: 'light',
      revenueView: 'net',
      refundsLastSeenAt: null,
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        document.documentElement.classList.toggle('light', next === 'light')
        set({ theme: next })
      },
      setRevenueView: (view) => set({ revenueView: view }),
      // Called when the Refunds page mounts — clears the sidebar's pending-
      // request badge by marking everything pending as of now "seen". Any
      // refund submitted after this moment still counts as new.
      markRefundsSeen: () => set({ refundsLastSeenAt: new Date().toISOString() }),
    }),
    { name: 'gapuz-app', partialize: s => ({ theme: s.theme, revenueView: s.revenueView, refundsLastSeenAt: s.refundsLastSeenAt }) }
  )
)

// ── PRODUCT STORE ────────────────────────────────────────────────
const PRODUCT_SELECT = 'id:product_id, name, category, price, costPrice:cost_price, stock, barcode, icon, image, sold, createdAt:created_at, lastSoldAt:last_sold_at'

export const useProductStore = create((set, get) => ({
  products: [],
  loading: false,

  fetchProducts: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).order('name')
    if (!error) set({ products: data, loading: false })
    else set({ loading: false })
  },

  addProduct: async (data) => {
    const row = { name: data.name, category: data.category, price: data.price, cost_price: data.costPrice, stock: data.stock, barcode: data.barcode, icon: data.icon, image: data.image }
    const { data: inserted, error } = await supabase.from('products').insert(row).select(PRODUCT_SELECT).single()
    if (error || !inserted) return null
    set(s => ({ products: [...s.products, inserted] }))
    logActivity('created', 'product', inserted.name)
    return inserted
  },

  updateProduct: async (id, data) => {
    const row = {}
    if ('name' in data) row.name = data.name
    if ('category' in data) row.category = data.category
    if ('price' in data) row.price = data.price
    if ('costPrice' in data) row.cost_price = data.costPrice
    if ('stock' in data) row.stock = data.stock
    if ('barcode' in data) row.barcode = data.barcode
    if ('icon' in data) row.icon = data.icon
    if ('image' in data) row.image = data.image
    const prev = get().products.find(p => p.id === id)
    const { error } = await supabase.from('products').update(row).eq('product_id', id)
    if (!error) {
      set(s => ({ products: s.products.map(p => p.id === id ? { ...p, ...data } : p) }))
      logActivity('updated', 'product', data.name || prev?.name)
      if ('stock' in data && prev?.stock > data.stock) {
        const alertProduct = { name: data.name || prev?.name, category: data.category || prev?.category, barcode: data.barcode || prev?.barcode, stock: data.stock }
        if (data.stock === 0) notifyLowStock(alertProduct, 'out')
        else if (data.stock <= 3) notifyLowStock(alertProduct, 'low')
      }
    }
  },

  deleteProduct: async (id) => {
    const name = get().products.find(p => p.id === id)?.name
    const { error } = await supabase.from('products').delete().eq('product_id', id)
    if (!error) {
      set(s => ({ products: s.products.filter(p => p.id !== id) }))
      logActivity('deleted', 'product', name)
    }
  },

  // Atomic on the server (see deduct_stock in schema.sql) — locks each
  // product row before computing its new stock, so two concurrent
  // checkouts on the same product can't both read the same starting
  // stock and oversell it. The authoritative new stock comes back from
  // the RPC; we never compute stock - qty on the client.
  deductStock: async (items) => {
    const { data, error } = await supabase.rpc('deduct_stock', {
      items: items.map(i => ({ id: i.id, qty: i.qty })),
    })
    if (error) { console.error('deductStock failed:', error.message); return }
    const byId = new Map(data.map(r => [r.out_id, r]))
    const alerts = []
    set(s => ({
      products: s.products.map(p => {
        const r = byId.get(p.id)
        if (!r) return p
        if (r.out_zeroed) alerts.push([{ name: p.name, category: p.category, barcode: p.barcode, stock: r.out_stock }, 'out'])
        else if (r.out_low) alerts.push([{ name: p.name, category: p.category, barcode: p.barcode, stock: r.out_stock }, 'low'])
        const ci = items.find(i => i.id === p.id)
        return { ...p, stock: r.out_stock, sold: (p.sold || 0) + (ci?.qty || 0) }
      })
    }))
    alerts.forEach(([product, level]) => notifyLowStock(product, level))
  },

  restockProduct: async (id, qty) => {
    const p = get().products.find(pp => pp.id === id)
    const newStock = (p?.stock || 0) + qty
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('product_id', id)
    if (!error) {
      set(s => ({ products: s.products.map(p => p.id === id ? { ...p, stock: newStock } : p) }))
      logActivity('restocked', 'product', p?.name, { qty, newStock })
    }
  },

  // Patches local product stock from server-authoritative values already
  // written by an RPC (e.g. approve_return) — no network call here, just
  // reconciling client state with what the database already did.
  applyStockUpdates: (updates) => {
    if (!updates?.length) return
    set(s => ({
      products: s.products.map(p => {
        const u = updates.find(x => x.id === p.id)
        return u ? { ...p, stock: u.stock } : p
      })
    }))
  },
}))

// ── CATEGORY STORE ───────────────────────────────────────────────
const CATEGORY_SELECT = 'id:category_id, name, badgeColor:badge_color, icon, sortOrder:sort_order'

export const useCategoryStore = create((set, get) => ({
  categories: [],
  loading: false,

  fetchCategories: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('categories').select(CATEGORY_SELECT).order('sort_order')
    if (!error) set({ categories: data, loading: false })
    else set({ loading: false })
  },

  addCategory: async (name, badgeColor, icon) => {
    const sortOrder = get().categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1
    const row = { name: name.trim(), badge_color: badgeColor, icon: icon || null, sort_order: sortOrder }
    const { data: inserted, error } = await supabase.from('categories').insert(row).select(CATEGORY_SELECT).single()
    if (error || !inserted) return null
    set(s => ({ categories: [...s.categories, inserted] }))
    logActivity('created', 'category', inserted.name)
    return inserted
  },

  updateCategory: async (id, data) => {
    const name = get().categories.find(c => c.id === id)?.name
    const row = {}
    if ('badgeColor' in data) row.badge_color = data.badgeColor
    if ('icon' in data) row.icon = data.icon || null
    const { error } = await supabase.from('categories').update(row).eq('category_id', id)
    if (!error) {
      set(s => ({ categories: s.categories.map(c => c.id === id ? { ...c, ...data } : c) }))
      logActivity('updated', 'category', name)
    }
    return !error
  },

  deleteCategory: async (id) => {
    const name = get().categories.find(c => c.id === id)?.name
    const { error } = await supabase.from('categories').delete().eq('category_id', id)
    if (!error) {
      set(s => ({ categories: s.categories.filter(c => c.id !== id) }))
      logActivity('deleted', 'category', name)
    }
    return !error
  },
}))

// ── CUSTOMER STORE ───────────────────────────────────────────────
const CUSTOMER_SELECT = 'id:customer_id, name, email, phone, address, points, purchases, totalSpent:total_spent, createdAt:created_at'

export const useCustomerStore = create((set, get) => ({
  customers: [],
  loading: false,

  fetchCustomers: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('customers').select(CUSTOMER_SELECT).order('name')
    if (!error) set({ customers: data, loading: false })
    else set({ loading: false })
  },

  addCustomer: async (data) => {
    const row = { name: data.name, email: data.email, phone: data.phone, address: data.address }
    const { data: inserted, error } = await supabase.from('customers').insert(row).select(CUSTOMER_SELECT).single()
    if (error || !inserted) return null
    set(s => ({ customers: [...s.customers, inserted] }))
    return inserted
  },

  updateCustomer: async (id, data) => {
    const row = {}
    if ('name' in data) row.name = data.name
    if ('email' in data) row.email = data.email
    if ('phone' in data) row.phone = data.phone
    if ('address' in data) row.address = data.address
    const { error } = await supabase.from('customers').update(row).eq('customer_id', id)
    if (!error) set(s => ({ customers: s.customers.map(c => c.id === id ? { ...c, ...data } : c) }))
  },

  deleteCustomer: async (id) => {
    const name = get().customers.find(c => c.id === id)?.name
    const { error } = await supabase.from('customers').delete().eq('customer_id', id)
    if (!error) {
      set(s => ({ customers: s.customers.filter(c => c.id !== id) }))
      logActivity('deleted', 'customer', name)
    }
  },

  addPoints: async (id, total) => {
    const c = get().customers.find(cc => cc.id === id)
    if (!c) return
    const points = c.points + 10 + Math.floor(total / 100)
    const purchases = c.purchases + 1
    const totalSpent = c.totalSpent + total
    const { error } = await supabase.from('customers').update({ points, purchases, total_spent: totalSpent }).eq('customer_id', id)
    if (!error) set(s => ({ customers: s.customers.map(cc => cc.id === id ? { ...cc, points, purchases, totalSpent } : cc) }))
  },

  // Reverses stats credited by addPoints when a sale is refunded
  revertPurchase: async (id, { refundTotal, fullRefund }) => {
    const c = get().customers.find(cc => cc.id === id)
    if (!c) return
    const pointsDeducted = (fullRefund ? 10 : 0) + Math.floor(refundTotal / 100)
    const points = Math.max(0, c.points - pointsDeducted)
    const purchases = fullRefund ? Math.max(0, c.purchases - 1) : c.purchases
    const totalSpent = Math.max(0, c.totalSpent - refundTotal)
    const { error } = await supabase.from('customers').update({ points, purchases, total_spent: totalSpent }).eq('customer_id', id)
    if (!error) set(s => ({ customers: s.customers.map(cc => cc.id === id ? { ...cc, points, purchases, totalSpent } : cc) }))
  },
}))

// ── TRANSACTION STORE ────────────────────────────────────────────
const TXN_SELECT = 'id:transaction_id, customerId:customer_id, customerName:customer_name, payment, subtotal, discAmt:disc_amt, vat, total, cashGiven:cash_given, status, cashierName:cashier_name, createdAt:created_at'

export const useTransactionStore = create((set, get) => ({
  transactions: [],
  loading: false,

  fetchTransactions: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('transactions')
      .select(`${TXN_SELECT}, items:transaction_items(id:product_id, name, price, qty, costPrice:cost_price)`)
      .order('created_at', { ascending: false })
    if (!error) set({ transactions: data, loading: false })
    else set({ loading: false })
  },

  addTransaction: async (txn) => {
    const row = {
      customer_id: txn.customerId || null,
      customer_name: txn.customerName || 'Walk-in',
      payment: txn.payment,
      subtotal: txn.subtotal,
      disc_amt: txn.discAmt,
      vat: txn.vat,
      total: txn.total,
      cash_given: txn.cashGiven,
      status: txn.status,
      cashier_name: txn.cashierName,
    }
    const { data: inserted, error } = await supabase.from('transactions').insert(row).select(TXN_SELECT).single()
    if (error || !inserted) return null
    const itemRows = txn.items.map(i => ({ transaction_id: inserted.id, product_id: i.id, name: i.name, qty: i.qty, price: i.price, cost_price: i.costPrice || 0 }))
    await supabase.from('transaction_items').insert(itemRows)
    const full = { ...inserted, items: txn.items }
    set(s => ({ transactions: [full, ...s.transactions] }))
    return full
  },

  updateTransaction: async (id, data) => {
    const row = {}
    if ('status' in data) row.status = data.status
    const { error } = await supabase.from('transactions').update(row).eq('transaction_id', id)
    if (!error) set(s => ({ transactions: s.transactions.map(tx => tx.id === id ? { ...tx, ...data } : tx) }))
  },
}))

// ── REFUND STORE ─────────────────────────────────────────────────
const REFUND_SELECT = 'id:refund_id, transactionId:transaction_id, customerName:customer_name, reason, refundMethod:refund_method, notes, total, status, processedBy:processed_by, items, subtotal, vat, createdAt:created_at, processedAt:processed_at'

export const useRefundStore = create((set, get) => ({
  refunds: [],

  fetchRefunds: async () => {
    const { data, error } = await supabase.from('refunds').select(REFUND_SELECT).order('created_at', { ascending: false })
    if (!error) set({ refunds: data })
  },

  addRefund: async (data) => {
    const row = {
      transaction_id: data.transactionId,
      customer_name: data.customerName,
      reason: data.reason,
      refund_method: data.refundMethod,
      notes: data.notes,
      total: data.total,
      status: data.status,
      processed_by: data.processedBy,
      items: data.items,
      subtotal: data.subtotal,
      vat: data.vat,
    }
    const { data: inserted, error } = await supabase.from('refunds').insert(row).select(REFUND_SELECT).single()
    if (error || !inserted) return null
    set(s => ({ refunds: [inserted, ...s.refunds] }))
    logActivity('submitted', 'refund', `#${String(inserted.id).padStart(4, '0')}`, { total: inserted.total })
    return inserted
  },

  // Stamps processed_at (approval time, distinct from created_at) when a
  // refund is approved — Gross vs Net sales reporting deducts an approved
  // refund from revenue in the period it was approved, not the period of
  // the original sale.
  updateRefund: async (id, data) => {
    const row = {}
    if ('status' in data) row.status = data.status
    if (data.status === 'Approved') row.processed_at = new Date().toISOString()
    const { error } = await supabase.from('refunds').update(row).eq('refund_id', id)
    if (!error) {
      const r = get().refunds.find(rr => rr.id === id)
      const patch = row.processed_at ? { ...data, processedAt: row.processed_at } : data
      set(s => ({ refunds: s.refunds.map(r => r.id === id ? { ...r, ...patch } : r) }))
      if (data.status === 'Approved') logActivity('approved', 'refund', `#${String(id).padStart(4, '0')}`, { total: r?.total })
      else if (data.status === 'Rejected') logActivity('rejected', 'refund', `#${String(id).padStart(4, '0')}`, { total: r?.total })
    }
  },
}))

// ── HOLD STORE ───────────────────────────────────────────────────
const HOLD_SELECT = 'id:hold_id, label, items, customerId:customer_id, savedAt:saved_at'

export const useHoldStore = create((set, get) => ({
  holds: [],

  fetchHolds: async () => {
    const { data, error } = await supabase.from('holds').select(HOLD_SELECT).order('saved_at')
    if (!error) set({ holds: data })
  },

  saveHold: async (label, items, customerId) => {
    const row = { label, items, customer_id: customerId }
    const { data: inserted, error } = await supabase.from('holds').insert(row).select(HOLD_SELECT).single()
    if (!error) set(s => ({ holds: [...s.holds, inserted] }))
  },

  removeHold: async (id) => {
    const { error } = await supabase.from('holds').delete().eq('hold_id', id)
    if (!error) set(s => ({ holds: s.holds.filter(h => h.id !== id) }))
  },
}))

// ── CART STORE (local session state — not persisted server-side) ──
export const useCartStore = create((set, get) => ({
  items: [],
  discount: { value:0, type:'pct' },
  payMethod: 'Cash',
  customerId: null,
  splitMode: false,
  split1Pay: 'Cash',
  split2Pay: 'GCash',
  split1Amt: '',

  addItem: (product) => {
    if (product.stock === 0) return false
    set(s => {
      const ex = s.items.find(i => i.id===product.id)
      if (ex) {
        if (ex.qty >= product.stock) return s
        return { items: s.items.map(i => i.id===product.id ? {...i,qty:i.qty+1} : i) }
      }
      return { items: [...s.items, {...product, qty:1}] }
    })
    return true
  },
  removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id!==id) })),
  setQty: (id, qty, max) => set(s => ({ items: s.items.map(i => i.id===id ? {...i,qty:Math.max(1,Math.min(qty,max))} : i) })),
  clearCart: () => set({ items:[], discount:{value:0,type:'pct'}, customerId:null, splitMode:false, split1Amt:'' }),
  setDiscount: (value, type) => set({ discount:{value,type} }),
  setPayMethod: (m) => set({ payMethod:m }),
  setCustomer: (id) => set({ customerId:id }),
  setSplitMode: (v) => set({ splitMode:v }),
  setSplit1Pay: (v) => set({ split1Pay:v }),
  setSplit2Pay: (v) => set({ split2Pay:v }),
  setSplit1Amt: (v) => set({ split1Amt:v }),

  getTotals: () => {
    const { items, discount } = get()
    const subtotal = items.reduce((s,i)=>s+i.price*i.qty,0)
    const discAmt  = discount.type==='pct' ? subtotal*(discount.value/100) : Math.min(discount.value||0,subtotal)
    const afterDisc = subtotal - discAmt
    const vat       = afterDisc * 0.12
    const total     = afterDisc + vat
    return { subtotal, discAmt, vat, total, totalInt: Math.round(total) }
  },
}))

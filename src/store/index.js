import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabaseClient'
import { getEffectiveLowStockLevel, refundSettledAmount, moneyBackReturnSettledAmount } from '../utils/helpers'
import { TIERS, getTier } from '../utils/loyalty'

// Password-reset emails must always point at the stable production URL, not
// window.location.origin — if "Forgot password" is ever clicked from a
// Vercel preview deployment, that origin is ephemeral and the emailed link
// 404s with DEPLOYMENT_NOT_FOUND once the preview is replaced or cleaned up.
// localhost is kept as-is so local dev testing still redirects locally.
const SITE_URL = window.location.hostname === 'localhost' ? window.location.origin : 'https://gapuz-pos.vercel.app'

// Logs a "Logged in"/"Logged out" Session entry — unlike logActivity below,
// this is AWAITED by its caller rather than fire-and-forget. logout() needs
// that: it must write this row while the session is still valid, before
// signOut() runs, since RLS has no auth.uid() to satisfy the insert policy
// at all once that happens. Still never throws into the caller — a failed
// write here must not block an actual login/logout, just gets logged.
async function logSessionEvent(action, user) {
  const actorName = user?.user_metadata?.name || user?.email || 'Unknown'
  const { error } = await supabase.from('activity_log').insert({
    actor_id: user?.id || null,
    actor_name: actorName,
    action,
    entity_type: 'session',
    entity_label: 'Session',
  })
  if (error) console.error('session activity log failed:', error.message)
}

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

  // Logs "Logged in" only here, after a real signInWithPassword succeeds —
  // never from init()'s session restore or onAuthStateChange's
  // TOKEN_REFRESHED/INITIAL_SESSION firing, since neither of those paths
  // calls login() or this helper, only the shared _loadProfile. That's what
  // keeps a page refresh or a token refresh from ever writing a duplicate
  // "Logged in" entry.
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) return { ok: false, error }
    await get()._loadProfile(data.user)
    logSessionEvent('logged in', get().user)
    return { ok: true, error: null }
  },

  // Writes the "Logged out" entry BEFORE signOut() — once signed out there's
  // no auth.uid() left for RLS to match against, so the insert would be
  // rejected if ordered the other way around.
  logout: async () => {
    const { user } = get()
    if (user) await logSessionEvent('logged out', user)
    await supabase.auth.signOut()
    set({ user: null, role: null })
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/reset-password`,
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

// create_refund/create_return are RETURNS TABLE(id, created) functions, so
// supabase.rpc() normally hands back [{ id, created }] — but PostgREST
// shapes a set-returning function's result differently depending on how it
// resolves (a bare scalar, or a single composite row keyed by the function
// name) across the migrations that have redefined these RPCs over time.
// Pulling the id out this defensively is what keeps a shape mismatch from
// silently stringifying into "#[object Object]" in the activity log instead
// of just failing loudly.
function getReturnedId(result) {
  const row = Array.isArray(result) ? result[0] : result
  if (row == null) return null
  if (typeof row === 'number') return row
  return row.id ?? row.refund_id ?? row.return_id ?? row.create_refund ?? row.create_return ?? null
}

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

// Fire-and-forget: emails every active admin via the send-request-alert edge
// function when a cashier submits a new return/refund request. The function
// itself re-checks the caller's role server-side and silently skips when
// it's not 'cashier', so this is safe to call unconditionally here — but
// callers should still only invoke it when a row was genuinely just created
// (not on a deduped resubmit) to avoid spamming admins with retries.
function notifyRequestAlert(type, id) {
  supabase.functions.invoke('send-request-alert', { body: { type, id } })
    .then(({ error }) => { if (error) console.error('request alert failed:', error.message) })
}

// Fire-and-forget: emails every active admin when a CASHIER voids one of
// their own sales — the edge function itself re-checks the caller's role
// and silently skips when it's not 'cashier' (no email when the admin
// voids), so this is safe to call unconditionally after any successful
// void. A failure here never undoes the void — see voidTransaction below.
function notifyVoidAlert(txnId) {
  supabase.functions.invoke('send-void-alert', { body: { txnId } })
    .then(({ error }) => { if (error) console.error('void alert failed:', error.message) })
}

// Cancels a whole sale — no admin approval needed, same-day/15-minute/
// own-sale/no-pending-request rules all enforced server-side inside
// void_transaction itself (see add_void_transaction.sql); this is just the
// thin wrapper plus the admin email, fired only once the void itself has
// actually succeeded. Returns { error } with the RPC's exact message
// (e.g. "Void time limit passed (15 minutes). Please ask the admin.") so
// the UI can show it as-is.
export async function voidTransaction(txnId, reason) {
  const { error } = await supabase.rpc('void_transaction', { p_txn_id: txnId, p_reason: reason })
  if (error) return { error }
  await useTransactionStore.getState().fetchTransactions()
  notifyVoidAlert(txnId)
  return { error: null }
}

// Fire-and-forget: emails the customer the moment a sale's earned points
// push them UP across the Silver/Gold/Platinum line — never on the way
// down (refunds use revertPurchase, tier claims use claimTierReward,
// neither calls this), and only for the one purchase that actually
// crosses the threshold, never again on a later purchase that's already
// past it. Skips silently if the customer has no email on file, same as
// the reward-claim email does. Also drops a 'customer'/'upgraded'
// activity log entry so staff can see it happened.
function notifyTierUpgrade(customer, newTier) {
  logActivity('upgraded', 'customer', customer.name, { tierReached: newTier.label, points: customer.points })
  if (!customer.email) return
  const rewardItems = useProductStore.getState().products
    .filter(p => !p.isService && p.rewardTier === newTier.key && p.stock > 0)
    .map(p => p.name)
  supabase.functions.invoke('send-tier-upgrade-email', {
    body: { email: customer.email, customerName: customer.name, tierLabel: newTier.label, points: customer.points, rewardItems },
  }).then(({ error }) => { if (error) console.error('tier upgrade email failed:', error.message) })
}

// Emails the customer when their Return/Refund request is approved or
// rejected — called from RefundDetailsModal.jsx / ReturnDetailsModal.jsx
// right after the decision itself is saved, never before (a failed email
// must never undo an approval/rejection). Unlike the fire-and-forget
// helpers above, this one is AWAITED by its caller so the UI can show
// "Customer notified at …" / "could not be sent" once it resolves.
//
// Writes its own 'email' activity_log entry rather than editing the
// 'approved'/'rejected' entry already written by approveReturn/rejectReturn
// /updateRefund/rejectRefund — activity_log has no UPDATE policy anywhere
// in this schema on purpose (append-only audit trail), same reasoning as
// the reward-claim email's separate log entry.
export async function sendDecisionEmail({ type, id, notifyEmail, action, ...details }) {
  const label = `#${String(id).padStart(4, '0')}`
  if (!notifyEmail) {
    logActivity('email', type, label, { emailStatus: 'skipped', decisionAction: action })
    return { status: 'skipped' }
  }
  try {
    const { error } = await supabase.functions.invoke('send-request-decision-email', {
      body: { email: notifyEmail, type, action, ...details },
    })
    if (error) throw error
    logActivity('email', type, label, { emailStatus: 'sent', email: notifyEmail, decisionAction: action })
    return { status: 'sent' }
  } catch (err) {
    console.error('decision email failed:', err.message)
    logActivity('email', type, label, { emailStatus: 'failed', email: notifyEmail, decisionAction: action })
    return { status: 'failed' }
  }
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
      refundsLastSeenAt: null,
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        document.documentElement.classList.toggle('light', next === 'light')
        set({ theme: next })
      },
      // Called when the Refunds page mounts — clears the sidebar's pending-
      // request badge by marking everything pending as of now "seen". Any
      // refund submitted after this moment still counts as new.
      markRefundsSeen: () => set({ refundsLastSeenAt: new Date().toISOString() }),
    }),
    { name: 'gapuz-app', partialize: s => ({ theme: s.theme, refundsLastSeenAt: s.refundsLastSeenAt }) }
  )
)

// ── PRODUCT STORE ────────────────────────────────────────────────
const PRODUCT_SELECT = 'id:product_id, name, category, price, costPrice:cost_price, stock, barcode, icon, image, sold, hasSerial:has_serial, isService:is_service, isAvailable:is_available, lowStockLevel:low_stock_level, rewardTier:reward_tier, createdAt:created_at, lastSoldAt:last_sold_at'

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
    const row = { name: data.name, category: data.category, price: data.price, cost_price: data.costPrice, stock: data.stock, barcode: data.barcode, icon: data.icon, image: data.image, has_serial: !!data.hasSerial, is_service: !!data.isService, is_available: data.isAvailable !== false, low_stock_level: data.lowStockLevel ?? null, reward_tier: data.isService ? null : (data.rewardTier || null) }
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
    if ('hasSerial' in data) row.has_serial = !!data.hasSerial
    if ('isService' in data) row.is_service = !!data.isService
    if ('isAvailable' in data) row.is_available = !!data.isAvailable
    if ('lowStockLevel' in data) row.low_stock_level = data.lowStockLevel ?? null
    if ('rewardTier' in data) row.reward_tier = data.isService ? null : (data.rewardTier || null)
    const prev = get().products.find(p => p.id === id)
    const { error } = await supabase.from('products').update(row).eq('product_id', id)
    if (!error) {
      set(s => ({ products: s.products.map(p => p.id === id ? { ...p, ...data } : p) }))
      logActivity('updated', 'product', data.name || prev?.name)
      if ('stock' in data && prev?.stock > data.stock && !data.isService && !prev?.isService) {
        const merged = { ...prev, ...data }
        const level = getEffectiveLowStockLevel(merged, useCategoryStore.getState().categories)
        const alertProduct = { name: data.name || prev?.name, category: data.category || prev?.category, barcode: data.barcode || prev?.barcode, stock: data.stock, lowStockLevel: level }
        if (data.stock === 0) notifyLowStock(alertProduct, 'out')
        else if (data.stock <= level) notifyLowStock(alertProduct, 'low')
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
        if (r.out_zeroed) alerts.push([{ name: p.name, category: p.category, barcode: p.barcode, stock: r.out_stock, lowStockLevel: r.out_level }, 'out'])
        else if (r.out_low) alerts.push([{ name: p.name, category: p.category, barcode: p.barcode, stock: r.out_stock, lowStockLevel: r.out_level }, 'low'])
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

  // Same idea as applyStockUpdates, for the single-product case — used
  // after add_serials/delete_serial already wrote products.stock atomically
  // on the server, so the client just mirrors the delta locally.
  bumpStock: (id, delta) => {
    set(s => ({ products: s.products.map(p => p.id === id ? { ...p, stock: Math.max(0, p.stock + delta) } : p) }))
  },
}))

// Looks up a single serial by its number — used by POS to resolve a scan
// against product_serials before falling back to a barcode match. Returns
// null for "not found" so callers don't need to branch on Supabase's error
// shape for a plain missing row.
export async function lookupSerial(serialNumber) {
  const { data, error } = await supabase
    .from('product_serials')
    .select('id:serial_id, productId:product_id, status')
    .eq('serial_number', serialNumber)
    .maybeSingle()
  if (error || !data) return null
  return data
}

// Paginated, searchable list of a single product's In Stock serials — used
// by the POS page's inline "Serial Numbers" panel so it never has to load
// every serial for a product at once. search (if any) is applied server-side
// via ilike; count:'exact' drives the "Page X of Y" label.
export async function fetchAvailableSerials(productId, { page = 1, pageSize = 5, search = '' } = {}) {
  let query = supabase
    .from('product_serials')
    .select('id:serial_id, productId:product_id, serialNumber:serial_number, status', { count: 'exact' })
    .eq('product_id', productId)
    .eq('status', 'In Stock')
  const term = search.trim()
  if (term) query = query.ilike('serial_number', `%${term}%`)
  const from = (page - 1) * pageSize
  const { data, error, count } = await query.order('serial_number').range(from, from + pageSize - 1)
  if (error) return { data: [], count: 0 }
  return { data, count: count || 0 }
}

// ── PRODUCT SERIALS STORE (admin: receive stock, find a serial) ──
const SERIAL_SELECT = 'id:serial_id, productId:product_id, serialNumber:serial_number, status, transactionId:transaction_id, soldAt:sold_at, createdAt:created_at'

export const useSerialStore = create((set, get) => ({
  serials: [],   // serials for whichever product's panel is currently open
  loading: false,

  fetchSerials: async (productId) => {
    set({ loading: true })
    const { data, error } = await supabase.from('product_serials').select(SERIAL_SELECT).eq('product_id', productId).order('created_at', { ascending: false })
    if (!error) set({ serials: data, loading: false })
    else set({ loading: false })
  },

  // Registers new serials for a product — stock increases atomically on the
  // server (add_serials RPC), so we just mirror the delta locally afterward.
  addSerials: async (productId, productName, serials) => {
    const { data: count, error } = await supabase.rpc('add_serials', { p_product_id: productId, p_serials: serials })
    if (error) return { error }
    useProductStore.getState().bumpStock(productId, count)
    await get().fetchSerials(productId)
    logActivity('added', 'serial', productName, { count, serials })
    return { count, error: null }
  },

  deleteSerial: async (serial, productId, productName) => {
    const { error } = await supabase.rpc('delete_serial', { p_serial_id: serial.id })
    if (error) return { error }
    useProductStore.getState().bumpStock(productId, -1)
    set(s => ({ serials: s.serials.filter(x => x.id !== serial.id) }))
    logActivity('deleted', 'serial', productName, { serialNumber: serial.serialNumber })
    return { error: null }
  },

  // Global "find serial" search — not scoped to a product.
  findSerial: async (serialNumber) => {
    const { data, error } = await supabase
      .from('product_serials')
      .select(`${SERIAL_SELECT}, product:products(id:product_id, name), transaction:transactions(id:transaction_id, createdAt:created_at, customerName:customer_name)`)
      .eq('serial_number', serialNumber.trim())
      .maybeSingle()
    if (error || !data) return null
    return data
  },
}))

// ── CATEGORY STORE ───────────────────────────────────────────────
const CATEGORY_SELECT = 'id:category_id, name, badgeColor:badge_color, icon, sortOrder:sort_order, lowStockLevel:low_stock_level'

export const useCategoryStore = create((set, get) => ({
  categories: [],
  loading: false,

  fetchCategories: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('categories').select(CATEGORY_SELECT).order('sort_order')
    if (!error) set({ categories: data, loading: false })
    else set({ loading: false })
  },

  addCategory: async (name, badgeColor, icon, lowStockLevel) => {
    const sortOrder = get().categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1
    const row = { name: name.trim(), badge_color: badgeColor, icon: icon || null, sort_order: sortOrder, low_stock_level: lowStockLevel ?? null }
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
    if ('lowStockLevel' in data) row.low_stock_level = data.lowStockLevel ?? null
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
    if (!error) {
      set(s => ({ customers: s.customers.map(cc => cc.id === id ? { ...cc, points, purchases, totalSpent } : cc) }))
      const oldRank = TIERS.findIndex(t => t.key === getTier(c.points).key)
      const newTier = getTier(points)
      const newRank = TIERS.findIndex(t => t.key === newTier.key)
      if (newRank > oldRank) notifyTierUpgrade({ ...c, points }, newTier)
    }
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

// ── REWARD STORE (tier rewards — one free item per tier reached) ──
// Not a discount, and never touches transactions/transaction_items — see
// the migration-level comment at the top of add_reward_redemptions.sql /
// add_tier_rewards.sql for why that keeps a claim out of every sales-based
// report. tier is null on every pre-tier-rewards row (the old points-
// exchange system had no tier concept) — callers show "—" for those.
const REDEMPTION_SELECT = 'id, redemptionNo:redemption_no, customerId:customer_id, productId:product_id, serialId:serial_id, quantity, pointsUsed:points_used, tier, redeemedByName:redeemed_by_name, createdAt:created_at, customer:customers(name), product:products(name), serial:product_serials(serialNumber:serial_number)'

export const useRewardStore = create((set, get) => ({
  redemptions: [],
  loading: false,

  fetchRedemptions: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('reward_redemptions').select(REDEMPTION_SELECT).order('created_at', { ascending: false })
    if (!error) {
      set({
        redemptions: (data || []).map(r => ({ ...r, customerName: r.customer?.name, productName: r.product?.name, serialNumber: r.serial?.serialNumber })),
        loading: false,
      })
    } else set({ loading: false })
  },

  // Atomic on the server (claim_tier_reward) — locks the product then the
  // customer row before validating anything, same shape deduct_stock
  // follows locking a product row at checkout. Deducts the tier's point
  // cost (never below 0) — a customer can claim the same tier's reward
  // again once they've earned back enough points, there's no longer a
  // once-ever restriction. Returns { error } with a message ready to show
  // the staff as-is ("Not enough points", "Reach Gold to unlock this
  // reward", "Out of stock") on any failed check; nothing is changed in
  // that case.
  claimTierReward: async ({ customerId, productId, serialId }) => {
    const { data, error } = await supabase.rpc('claim_tier_reward', {
      p_customer_id: customerId,
      p_product_id: productId,
      p_serial_id: serialId || null,
    })
    if (error) return { error }
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { error: { message: 'Claim failed' } }

    // Mirror the customer's new points balance locally (the RPC already
    // computed and floored it at 0) so the UI updates without a refetch —
    // same pattern as addPoints/revertPurchase above.
    useCustomerStore.setState(s => ({ customers: s.customers.map(c => c.id === customerId ? { ...c, points: row.out_customer_points } : c) }))
    const product = useProductStore.getState().products.find(p => p.id === productId)
    useProductStore.setState(s => ({ products: s.products.map(p => p.id === productId ? { ...p, stock: row.out_stock } : p) }))
    // Same "only on a genuine crossing" rule deductStock follows after a sale.
    if (product && row.out_zeroed) notifyLowStock({ name: product.name, category: product.category, barcode: product.barcode, stock: row.out_stock, lowStockLevel: row.out_level }, 'out')
    else if (product && row.out_low) notifyLowStock({ name: product.name, category: product.category, barcode: product.barcode, stock: row.out_stock, lowStockLevel: row.out_level }, 'low')

    await get().fetchRedemptions()
    // Normalized to camelCase here (the RPC itself returns raw column
    // names, unlike a .select() call, which never gets to alias them).
    return {
      error: null,
      redemption: {
        id: row.id, redemptionNo: row.redemption_no, customerId: row.customer_id, productId: row.product_id,
        serialId: row.serial_id, tier: row.tier, pointsUsed: row.points_used, redeemedByName: row.redeemed_by_name,
        createdAt: row.created_at, customerPoints: row.out_customer_points,
      },
    }
  },
}))

// ── TRANSACTION STORE ────────────────────────────────────────────
const TXN_SELECT = 'id:transaction_id, customerId:customer_id, customerName:customer_name, payment, subtotal, discAmt:disc_amt, vat, total, cashGiven:cash_given, status, cashierName:cashier_name, cashierId:cashier_id, gcashReference:gcash_reference, createdAt:created_at'

export const useTransactionStore = create((set, get) => ({
  transactions: [],
  loading: false,

  fetchTransactions: async () => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('transactions')
      .select(`${TXN_SELECT}, items:transaction_items(id:product_id, name, price, qty, costPrice:cost_price, notes)`)
      .order('created_at', { ascending: false })
    if (!error) set({ transactions: data, loading: false })
    else set({ loading: false })
  },

  // Returns the full transaction on success, null on a generic failure, or
  // { duplicateGcashRef: true } when the insert was rejected by the
  // idx_transactions_gcash_reference unique index (Postgres 23505) — the
  // only way a raw insert can fail for a reason the cashier needs to see a
  // specific message for, rather than the generic "Checkout failed" toast.
  addTransaction: async (txn) => {
    const row = {
      customer_id: txn.customerId || null,
      customer_name: txn.customerName || 'Walk-in',
      payment: txn.payment,
      subtotal: txn.subtotal,
      // Discount feature removed — every new sale saves 0. The column
      // itself stays (default 0) so old discounted sales still show their
      // real disc_amt and compute correctly.
      disc_amt: 0,
      vat: txn.vat,
      total: txn.total,
      cash_given: txn.cashGiven,
      status: txn.status,
      cashier_name: txn.cashierName,
      gcash_reference: txn.gcashReference || null,
    }
    const { data: inserted, error } = await supabase.from('transactions').insert(row).select(TXN_SELECT).single()
    if (error || !inserted) {
      if (error?.code === '23505') return { duplicateGcashRef: true }
      return null
    }
    const itemRows = txn.items.map(i => ({ transaction_id: inserted.id, product_id: i.id, name: i.name, qty: i.qty, price: i.price, cost_price: i.costPrice || 0, notes: i.notes || null }))
    await supabase.from('transaction_items').insert(itemRows)
    const full = { ...inserted, items: txn.items }
    set(s => ({ transactions: [full, ...s.transactions] }))
    logActivity('completed', 'sale', `#${String(full.id).padStart(4, '0')}`, {
      total: full.total, payment: full.payment, gcashReference: full.gcashReference || undefined,
    })
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
const REFUND_SELECT = 'id:refund_id, transactionId:transaction_id, customerName:customer_name, reason, refundMethod:refund_method, notes, total, status, processedBy:processed_by, submittedBy:submitted_by, rejectionReason:rejection_reason, items, subtotal, vat, notifyEmail:notify_email, gcashReference:gcash_reference, createdAt:created_at, processedAt:processed_at'

export const useRefundStore = create((set, get) => ({
  refunds: [],

  fetchRefunds: async () => {
    const { data, error } = await supabase.from('refunds').select(REFUND_SELECT).order('created_at', { ascending: false })
    if (!error) set({ refunds: data })
  },

  // Refunds are money-only now (no items/qty — see the refund audit) and
  // insert only through create_refund (SECURITY DEFINER), which is what
  // actually enforces the 7-day window and the remaining-amount cap; a
  // raw insert is no longer possible (see add_create_refund_rpc.sql — the
  // old "Allow authenticated insert" policy on refunds is dropped there).
  //
  // create_refund is idempotent on data.clientRequestId (see
  // add_submit_idempotency_and_dup_guards.sql) — a spam-clicked Submit
  // that fires this twice with the same id gets the same row back the
  // second time (created: false) instead of a duplicate, so the
  // 'submitted' activity_log entry below only gets written for the one
  // request that actually created something.
  addRefund: async (data) => {
    const { data: rows, error } = await supabase.rpc('create_refund', {
      p_transaction_id: data.transactionId,
      p_amount: data.amount,
      p_reason: data.reason,
      p_method: data.refundMethod,
      p_notes: data.notes || null,
      p_client_request_id: data.clientRequestId || null,
      p_notify_email: data.notifyEmail || null,
      p_gcash_reference: data.gcashReference || null,
    })
    if (error) return { error }
    const row = rows?.[0]
    const id = getReturnedId(rows)
    await get().fetchRefunds()
    if (row?.created) {
      logActivity('submitted', 'refund', `#${String(id).padStart(4, '0')}`, { refund_id: id, total: data.amount })
      notifyRequestAlert('refund', id)
    }
    return { id, error: null }
  },

  // Stamps processed_at (approval time, distinct from created_at) when a
  // refund is approved — Gross vs Net sales reporting deducts an approved
  // refund from revenue in the period it was approved, not the period of
  // the original sale. Approve-only now — rejecting goes through
  // reject_refund below (a plain status update can no longer set
  // 'Rejected' anyway: refunds_rejection_requires_reason blocks it without
  // a valid rejection_reason, which only that RPC sets).
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
    }
  },

  // Rejection now requires a reason — enforced both here (reject_refund is
  // the only path that can set status='Rejected') and at the DB level
  // (refunds_rejection_requires_reason). Admin-only check lives in the RPC
  // itself; it also stamps processed_by/processed_at server-side, same
  // style as create_refund. Touches only this refund row — no stock,
  // serials, points, or totals.
  rejectRefund: async (id, reason) => {
    const r = get().refunds.find(rr => rr.id === id)
    const { error } = await supabase.rpc('reject_refund', { p_refund_id: id, p_reason: reason })
    if (error) return { error }
    await get().fetchRefunds()
    logActivity('rejected', 'refund', `#${String(id).padStart(4, '0')}`, { reason, customerName: r?.customerName, total: r?.total })
    return { error: null }
  },
}))

// Resolves a "find the sale" lookup — a transaction id or a scanned serial
// number — down to just a transaction id, with no further fetch. Shared by
// the Refunds and Returns step-1 lookup (see SaleLookup component) so both
// pages resolve a scan the same way. Mirrors findSaleForReturn's own
// resolution below (serial match wins first — a serial can be all-digits,
// e.g. "002", which would otherwise misread as a transaction ID — falling
// back to treating the value as a transaction id only when no serial
// matches it).
export async function resolveLookupId(query) {
  const trimmed = (query || '').trim().replace('#', '')
  if (!trimmed) return null
  const { data: serialRow } = await supabase.from('product_serials').select('transaction_id').eq('serial_number', trimmed).maybeSingle()
  if (serialRow?.transaction_id) return serialRow.transaction_id
  // A GCash reference is always exactly 13 digits — checked before the
  // bare-integer fallback below so it can't be misread as a (much shorter)
  // transaction id.
  if (/^\d{13}$/.test(trimmed)) {
    const { data: refRow } = await supabase.from('transactions').select('transaction_id').eq('gcash_reference', trimmed).maybeSingle()
    if (refRow?.transaction_id) return refRow.transaction_id
  }
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  return null
}

// Resolves a cashier's lookup — either a transaction id or a serial number —
// into the full sale for the Returns wizard: the transaction row, every
// line item (with its real transaction_items.item_id, needed by
// create_return), and whichever serials were sold under each line. This is
// a dedicated query rather than reading the cached useTransactionStore list,
// since Returns needs item_id and per-item serials that TXN_SELECT doesn't
// carry (and extending it there isn't needed by anything else).
export async function findSaleForReturn(query) {
  const trimmed = (query || '').trim().replace('#', '')
  if (!trimmed) return null

  // Always try a serial match first — a serial number can be all-digits
  // (e.g. "002"), which would otherwise get misread as a transaction ID
  // and fail the lookup entirely even though the serial itself is valid.
  // Only fall back to treating the input as a transaction ID when no
  // serial matches it.
  const { data: serialRow } = await supabase.from('product_serials').select('transaction_id').eq('serial_number', trimmed).maybeSingle()
  let txnId = serialRow?.transaction_id || null
  // Same 13-digit GCash reference check as resolveLookupId above, for the
  // same reason — must be tried before the bare-integer fallback.
  if (!txnId && /^\d{13}$/.test(trimmed)) {
    const { data: refRow } = await supabase.from('transactions').select('transaction_id').eq('gcash_reference', trimmed).maybeSingle()
    txnId = refRow?.transaction_id || null
  }
  if (!txnId && /^\d+$/.test(trimmed)) txnId = parseInt(trimmed, 10)
  if (!txnId) return null

  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('id:transaction_id, customerId:customer_id, customerName:customer_name, subtotal, vat, total, status, payment, cashierName:cashier_name, gcashReference:gcash_reference, createdAt:created_at')
    .eq('transaction_id', txnId)
    .maybeSingle()
  if (txnErr || !txn) return null

  // Services never go through Returns (they can't be physically returned —
  // see Refunds for the money-only path), so they're dropped here before
  // the wizard ever sees them, rather than filtered out of its UI later.
  const { data: items } = await supabase
    .from('transaction_items')
    .select('itemId:item_id, productId:product_id, name, price, qty, costPrice:cost_price, product:products(isService:is_service)')
    .eq('transaction_id', txnId)
  const returnableItems = (items || []).filter(i => !i.product?.isService)
  const { data: serialRows } = await supabase
    .from('product_serials')
    .select('serialNumber:serial_number, status, transactionItemId:transaction_item_id')
    .eq('transaction_id', txnId)

  return {
    ...txn,
    items: returnableItems.map(i => ({
      itemId: i.itemId, productId: i.productId, name: i.name, price: i.price, qty: i.qty, costPrice: i.costPrice,
      serials: (serialRows || []).filter(s => s.transactionItemId === i.itemId),
    })),
  }
}

// Single source of truth for "how much of this transaction is still
// available to return/refund" — one call to the get_transaction_settlement
// RPC (see add_transaction_settlement.sql), reused by SaleLookup.jsx's
// Recent Transactions badges/clickable-state, Returns.jsx/Refunds.jsx's
// handleLookup gating, and TransactionSummaryCard's Details-step numbers.
// The same function also runs server-side inside create_return/
// create_refund, so the server rejects exactly what the UI already hides —
// keyed only on transaction_id, so walk-in sales (no customer_id) work
// identically to registered ones. Returns null (never throws) on any
// error, since every caller already has a sensible "couldn't determine
// this, treat as unavailable" fallback.
export async function fetchTransactionSettlement(txnId) {
  const { data, error } = await supabase.rpc('get_transaction_settlement', { p_transaction_id: txnId })
  if (error || !data?.[0]) return null
  const row = data[0]
  return {
    transactionId: row.transaction_id,
    amountPaid: row.amount_paid,
    approvedReturned: row.approved_returned,
    pendingReturned: row.pending_returned,
    approvedRefunded: row.approved_refunded,
    pendingRefunded: row.pending_refunded,
    remainingRefundable: row.remaining_refundable,
    status: row.status, // 'available' | 'partial' | 'pending' | 'settled'
    pendingKind: row.pending_kind, // 'return' | 'refund' | null
    pendingId: row.pending_id,
    serialStatuses: row.serial_statuses || [], // [{itemId,productId,serial,status:'returned'|'pending'}]
    itemQtyClaimed: row.item_qty_claimed || [], // [{itemId,productId,returnedQty,pendingQty}]
  }
}

// Everything the TransactionDetailsModal shows, in one gated call — see
// add_transaction_details.sql. Unlike get_transaction_settlement (returns
// table(...), so PostgREST hands back an array), this function returns a
// single jsonb value, which PostgREST/supabase-js already hand back as the
// plain JS object — no array unwrap, and every field is already camelCase
// since the SQL builds it with jsonb_build_object('camelKey', ...) itself.
// Returns null (never throws) on any error — including the RPC's own
// "Not authorized to view this transaction" — so the modal can show one
// generic "couldn't load" state rather than leaking the raw Postgres error.
export async function fetchTransactionDetails(txnId) {
  const { data, error } = await supabase.rpc('get_transaction_details', { p_transaction_id: txnId })
  if (error || !data) return null
  return data
}

// Reverses an APPROVED refund's loyalty-points impact on the customer
// (points, purchase count, total spent) — same formula revertPurchase uses
// elsewhere, and the one approve_return applies server-side for
// money-back returns. "Fully settled" is checked across BOTH refunds and
// money-back returns (the flat +10/purchase-count bonus should only flip
// once the whole transaction is actually paid back, through whichever mix
// of the two channels got it there). Moved here (was page-local to
// Refunds.jsx) so TransactionDetailsModal.jsx's "approve this refund from
// wherever it was opened" can call the exact same side effect instead of
// re-deriving it — reads the other stores via .getState() since it isn't
// itself a hook.
// Thin wrapper around the same send-receipt edge function Cart.jsx already
// calls at checkout — reused here for TransactionDetailsModal's "Email
// Receipt" action on a HISTORICAL sale.
export async function emailReceipt(email, txn) {
  const { error } = await supabase.functions.invoke('send-receipt', { body: { email, txn } })
  return { error }
}

export async function syncRefundToTransaction(r) {
  const txn = useTransactionStore.getState().transactions.find(tx => tx.id === r.transactionId)
  if (!txn || !txn.customerId) return
  const refunds = useRefundStore.getState().refunds
  const returns = useReturnStore.getState().returns
  const settledBefore = refundSettledAmount(txn.id, refunds, { excludeIds: [r.id] }) + moneyBackReturnSettledAmount(txn.id, returns)
  const settledAfter = settledBefore + r.total
  const wasFullBefore = settledBefore >= txn.total
  const isFullAfter = settledAfter >= txn.total
  await useCustomerStore.getState().revertPurchase(txn.customerId, { refundTotal: r.total, fullRefund: !wasFullBefore && isFullAfter })
}

// Refunds' Details-step summary card shows serials per item too, but
// useTransactionStore's own items join (TXN_SELECT) only carries
// product_id, not the transaction_items.id that product_serials actually
// keys on — this is a small dedicated lookup, grouped by product_id, so
// that card can decorate each already-fetched item without a second round
// trip per row. Display-only (unlike findSaleForReturn's serials, this
// never gates a selection), so grouping by product_id instead of the exact
// item_id is an acceptable simplification.
export async function fetchSaleSerialsByProduct(txnId) {
  const { data } = await supabase
    .from('product_serials')
    .select('serialNumber:serial_number, status, transactionItem:transaction_items(productId:product_id)')
    .eq('transaction_id', txnId)
  return (data || []).map(s => ({ serialNumber: s.serialNumber, status: s.status, productId: s.transactionItem?.productId }))
}

// ── RETURN STORE (returned items — physically come back; see Refunds for
// the money-only flow) ────────────────────────────────────────────
const RETURN_SELECT = 'id:return_id, transactionId:transaction_id, customerName:customer_name, reason, method, notes, subtotal, vat, total, status, processedBy:processed_by, submittedBy:submitted_by, rejectionReason:rejection_reason, items, conditions, evidencePhotos:evidence_photos, notifyEmail:notify_email, createdAt:created_at, processedAt:processed_at'

const EVIDENCE_BUCKET = 'return-evidence'

// Uploads one already-compressed evidence photo (see
// src/utils/compressImage.js) to its draft-session path, ahead of the
// return itself existing — create_return writes the final path list into
// returns.evidence_photos once the cashier actually submits.
export async function uploadEvidencePhoto(path, blob) {
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  return { error }
}

// Used when a cashier removes or retakes a photo before submitting —
// cleans up the now-orphaned object in storage.
export async function deleteEvidencePhoto(path) {
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path])
  return { error }
}

// Signed URLs only ever get fetched when a return's detail modal is
// actually opened (see ReturnDetailsModal.jsx) — never for the whole
// Return History list — so the list stays fast no matter how many returns
// have evidence photos attached. 5-minute expiry is plenty for one review.
export async function getEvidencePhotoUrls(paths) {
  if (!paths?.length) return []
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 300)
  if (error || !data) return []
  return data.map(d => d.signedUrl).filter(Boolean)
}

export const useReturnStore = create((set, get) => ({
  returns: [],
  loading: false,

  fetchReturns: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('returns').select(RETURN_SELECT).order('created_at', { ascending: false })
    if (!error) set({ returns: data, loading: false })
    else set({ loading: false })
  },

  // Inserts only through create_return (SECURITY DEFINER) — it enforces the
  // 7-day window and the serial/qty validation a raw insert couldn't.
  //
  // create_return is idempotent on data.clientRequestId (see
  // add_submit_idempotency_and_dup_guards.sql) — a spam-clicked Submit
  // that fires this twice with the same id gets the same row back the
  // second time (created: false) instead of a duplicate, so the
  // 'created' activity_log entry below only gets written for the one
  // request that actually created something.
  submitReturn: async (data) => {
    const { data: rows, error } = await supabase.rpc('create_return', {
      p_transaction_id: data.transactionId,
      p_items: data.items,
      p_reason: data.reason,
      p_method: data.method,
      p_notes: data.notes || null,
      p_subtotal: data.subtotal,
      p_vat: data.vat,
      p_total: data.total,
      p_evidence_photos: data.evidencePhotos || [],
      p_client_request_id: data.clientRequestId || null,
      p_notify_email: data.notifyEmail || null,
    })
    if (error) return { error }
    const row = rows?.[0]
    const id = getReturnedId(rows)
    await get().fetchReturns()
    if (row?.created) {
      logActivity('created', 'return', `#${String(id).padStart(4, '0')}`, { return_id: id, total: data.total })
      notifyRequestAlert('return', id)
    }
    return { id, error: null }
  },

  // Approval (restock/defective split, Replacement serial swap, and the
  // money-back loyalty-points reversal) happens atomically on the server —
  // see approve_return in add_return_unit_conditions.sql. The RPC itself
  // rejects the call unless every returned unit has an explicit condition
  // (no more defaulting an unset one to Resellable) and persists exactly
  // what was sent onto the row for later display. Caller refreshes
  // products afterward (a plain refetch, which never fires the low-stock
  // alert).
  approveReturn: async (id, conditions = {}, replacements = {}) => {
    const { error } = await supabase.rpc('approve_return', { p_return_id: id, p_conditions: conditions, p_replacements: replacements })
    if (error) return { error }
    const r = get().returns.find(rr => rr.id === id)
    await get().fetchReturns()
    logActivity('approved', 'return', `#${String(id).padStart(4, '0')}`, { total: r?.total, conditions })
    return { error: null }
  },

  // Rejection now requires a reason — enforced both here (reject_return is
  // the only path that can set status='Rejected') and at the DB level
  // (returns_rejection_requires_reason). Admin-only check lives in the
  // RPC itself, which also stamps processed_by/processed_at server-side.
  // Touches only this return row — no stock, serials, points, or totals.
  rejectReturn: async (id, reason) => {
    const r = get().returns.find(rr => rr.id === id)
    const { error } = await supabase.rpc('reject_return', { p_return_id: id, p_reason: reason })
    if (error) return { error }
    await get().fetchReturns()
    logActivity('rejected', 'return', `#${String(id).padStart(4, '0')}`, { reason, customerName: r?.customerName, total: r?.total })
    return { error: null }
  },
}))

// ── STORE SETTINGS (GCash QR + account name) ──────────────────────
// Single row (id=1), pre-seeded by the migration — see add_gcash_settings.sql.
// gcashQrPath is a storage object path, never a public URL (the bucket is
// private, same reasoning as return-evidence); gcashQrSignedUrl is derived
// from it on fetch and just held in memory, never persisted.
const STORE_ASSETS_BUCKET = 'store-assets'

export const useSettingsStore = create((set, get) => ({
  gcashQrPath: null,
  gcashQrSignedUrl: null,
  gcashAccountName: '',
  loaded: false,

  fetchSettings: async () => {
    const { data, error } = await supabase.from('store_settings').select('gcashQrPath:gcash_qr_path, gcashAccountName:gcash_account_name').eq('id', 1).maybeSingle()
    if (error || !data) { set({ loaded: true }); return }
    let signedUrl = null
    if (data.gcashQrPath) {
      const { data: signed } = await supabase.storage.from(STORE_ASSETS_BUCKET).createSignedUrl(data.gcashQrPath, 60 * 60 * 24)
      signedUrl = signed?.signedUrl || null
    }
    set({ gcashQrPath: data.gcashQrPath, gcashQrSignedUrl: signedUrl, gcashAccountName: data.gcashAccountName || '', loaded: true })
  },

  // Uploads the new QR to a fresh timestamped path (so a stale signed URL
  // some cashier still has cached keeps working until they refresh), then
  // points store_settings at it and deletes the old file.
  uploadGcashQr: async (file) => {
    const prevPath = get().gcashQrPath
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `gcash-qr-${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage.from(STORE_ASSETS_BUCKET).upload(path, file, { contentType: file.type })
    if (uploadErr) return { error: uploadErr }
    const { error: updateErr } = await supabase.from('store_settings').update({ gcash_qr_path: path, updated_at: new Date().toISOString() }).eq('id', 1)
    if (updateErr) { await supabase.storage.from(STORE_ASSETS_BUCKET).remove([path]); return { error: updateErr } }
    if (prevPath) await supabase.storage.from(STORE_ASSETS_BUCKET).remove([prevPath])
    await get().fetchSettings()
    logActivity('updated', 'settings', 'GCash QR')
    return { error: null }
  },

  updateGcashAccountName: async (name) => {
    const { error } = await supabase.from('store_settings').update({ gcash_account_name: name.trim() || null, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) return { error }
    set({ gcashAccountName: name.trim() })
    logActivity('updated', 'settings', 'GCash Account Name')
    return { error: null }
  },
}))

// ── HOLD STORE ───────────────────────────────────────────────────
// customerChosen distinguishes "Walk-in Customer was explicitly chosen"
// (customerId null, customerChosen true) from "no customer was chosen at
// all" (customerId null, customerChosen false) — customer_id alone can't
// tell those apart, since Walk-in has no real row to reference either way.
const HOLD_SELECT = 'id:hold_id, label, items, customerId:customer_id, customerChosen:customer_chosen, savedAt:saved_at'

export const useHoldStore = create((set, get) => ({
  holds: [],

  fetchHolds: async () => {
    const { data, error } = await supabase.from('holds').select(HOLD_SELECT).order('saved_at')
    if (!error) set({ holds: data })
  },

  saveHold: async (label, items, customerId, customerChosen) => {
    const row = { label, items, customer_id: customerId, customer_chosen: !!customerChosen }
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
  payMethod: 'Cash',
  // customerId: null means "Walk-in" OR "nothing chosen yet" — customerChosen
  // is what actually distinguishes the two, so the cashier is forced to make
  // an explicit choice (Walk-in counts as a choice) before checkout.
  customerId: null,
  customerChosen: false,
  splitMode: false,
  split1Pay: 'Cash',
  split2Pay: 'GCash',
  split1Amt: '',

  // Services have no stock to run out of — unlimited add, capped at 99
  // like any other quantity field rather than gated by product.stock.
  addItem: (product) => {
    const max = product.isService ? 99 : product.stock
    if (!product.isService && product.stock === 0) return false
    set(s => {
      const ex = s.items.find(i => i.id===product.id)
      if (ex) {
        if (ex.qty >= max) return s
        return { items: s.items.map(i => i.id===product.id ? {...i,qty:i.qty+1} : i) }
      }
      return { items: [...s.items, {...product, qty:1}] }
    })
    return true
  },
  removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id!==id) })),
  setQty: (id, qty, max) => set(s => ({ items: s.items.map(i => i.id===id ? {...i,qty:Math.max(1,Math.min(qty,max))} : i) })),
  // Per-line job note for a service item ("Acer laptop – reformat + Windows
  // 11"), saved to transaction_items.notes on checkout and printed on the
  // receipt. Not applicable to physical products.
  setItemNote: (id, note) => set(s => ({ items: s.items.map(i => i.id===id ? {...i, notes: note} : i) })),

  // Serialized lines: qty always equals serials.length, driven by scanning
  // rather than the +/- stepper. Adding the same product's second unit
  // appends to the existing line instead of creating a duplicate one.
  addSerialItem: (product, serial) => {
    set(s => {
      const ex = s.items.find(i => i.id===product.id)
      if (ex) {
        if (ex.serials?.includes(serial)) return s
        return { items: s.items.map(i => i.id===product.id ? {...i, qty:i.qty+1, serials:[...(i.serials||[]), serial]} : i) }
      }
      return { items: [...s.items, {...product, qty:1, serials:[serial]}] }
    })
  },
  // Restores a held cart's items verbatim (full qty, and .serials for any
  // serialized lines) — used when resuming a hold. addItem() can't be
  // reused in a loop here since it always starts a new line at qty:1.
  restoreItems: (restored) => set(s => ({ items: [...s.items, ...restored] })),

  removeSerialFromItem: (id, serial) => {
    set(s => {
      const ex = s.items.find(i => i.id===id)
      if (!ex) return s
      const serials = (ex.serials||[]).filter(sn => sn!==serial)
      if (serials.length===0) return { items: s.items.filter(i => i.id!==id) }
      return { items: s.items.map(i => i.id===id ? {...i, qty:serials.length, serials} : i) }
    })
  },
  clearCart: () => set({ items:[], customerId:null, customerChosen:false, splitMode:false, split1Amt:'' }),
  setPayMethod: (m) => set({ payMethod:m }),
  // id is null for an explicit "Walk-in Customer" pick, or a real customer
  // id — either way this counts as having made a choice.
  setCustomer: (id) => set({ customerId:id, customerChosen:true }),
  // Used when restoring a hold that was saved with no customer chosen at
  // all, so the picker goes back to its empty placeholder state rather
  // than inheriting whatever was selected before the restore.
  unsetCustomer: () => set({ customerId:null, customerChosen:false }),
  setSplitMode: (v) => set({ splitMode:v }),
  setSplit1Pay: (v) => set({ split1Pay:v }),
  setSplit2Pay: (v) => set({ split2Pay:v }),
  setSplit1Amt: (v) => set({ split1Amt:v }),

  // Discount feature removed — total is always subtotal + 12% VAT.
  getTotals: () => {
    const { items } = get()
    const subtotal = items.reduce((s,i)=>s+i.price*i.qty,0)
    const vat       = subtotal * 0.12
    const total     = subtotal + vat
    return { subtotal, vat, total, totalInt: Math.round(total) }
  },
}))

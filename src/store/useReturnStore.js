import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { logActivity } from './index'

const RETURN_SELECT = 'id:return_id, txnId:transaction_id, customerName:customer_name, reason, method, notes, subtotal, vat, total, status, processedBy:processed_by, items, createdAt:created_at, processedAt:processed_at'

export const useReturnStore = create((set, get) => ({
  returns: [],
  loading: false,

  fetchReturns: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('returns').select(RETURN_SELECT).order('created_at', { ascending: false })
    if (!error) set({ returns: data, loading: false })
    else set({ loading: false })
  },

  addReturn: async (data) => {
    const row = {
      transaction_id: data.txnId,
      customer_name:  data.customerName,
      reason:         data.reason,
      method:         data.method,
      notes:          data.notes,
      subtotal:       data.subtotal,
      vat:            data.vat,
      total:          data.total,
      status:         'Pending',
      processed_by:   data.processedBy,
      items:          data.items,
    }
    const { data: inserted, error } = await supabase.from('returns').insert(row).select(RETURN_SELECT).single()
    if (error || !inserted) return null
    set(s => ({ returns: [inserted, ...s.returns] }))
    logActivity('submitted', 'return', `#${String(inserted.id).padStart(4, '0')}`, { total: inserted.total })
    return inserted
  },

  // Approval + restock happen as one atomic call to the approve_return RPC
  // (see schema.sql) instead of a status UPDATE followed by a client-side
  // forEach of restockProduct() calls — that older two-step flow could
  // leave a return "Approved" with only some items restocked if the
  // connection dropped partway, and a double-click could restock twice.
  // The RPC locks the return row, flips status + restocks every item in a
  // single transaction, and reports out_already=true on a repeat call
  // instead of restocking again.
  approveReturn: async (id) => {
    const { data, error } = await supabase.rpc('approve_return', { p_return_id: id })
    if (error) { console.error('approveReturn failed:', error.message); return null }
    const first = data?.[0]
    if (!first) return null

    set(s => ({ returns: s.returns.map(rr => rr.id === id ? { ...rr, status: first.out_status, processedAt: first.out_processed_at || rr.processedAt } : rr) }))

    if (!first.out_already) {
      const r = get().returns.find(rr => rr.id === id)
      logActivity('approved', 'return', `#${String(id).padStart(4, '0')}`, { total: r?.total })
    }

    const productUpdates = data
      .filter(row => row.out_product_id != null)
      .map(row => ({ id: row.out_product_id, stock: row.out_stock }))
    return { already: first.out_already, productUpdates }
  },

  rejectReturn: async (id) => {
    const r = get().returns.find(rr => rr.id === id)
    const { error } = await supabase.from('returns').update({ status: 'Rejected' }).eq('return_id', id)
    if (!error) {
      set(s => ({ returns: s.returns.map(rr => rr.id === id ? { ...rr, status: 'Rejected' } : rr) }))
      logActivity('rejected', 'return', `#${String(id).padStart(4, '0')}`, { total: r?.total })
    }
  },
}))

// Supabase Edge Function: send-void-alert
// Emails every active admin when a CASHIER voids one of their own sales —
// same "notify admin" pattern as send-request-alert (new return/refund
// requests). The caller's role is re-checked server-side against
// `profiles`; an Administrator voiding a sale is a no-op here (no email
// when the admin voids). The transaction itself is re-fetched by id with
// the service role, so the email always reflects what's actually in the
// database, never whatever the client happened to pass.
//
// Called from the frontend store right after void_transaction succeeds,
// fire-and-forget (see notifyVoidAlert in src/store/index.js) — if this
// email fails, the void itself has already succeeded; the caller just
// logs the error.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt /
// send-request-alert: BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-void-alert

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'

function money(n: number) {
  return `₱${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function itemsRowsHtml(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) return ''
  const rows = items.map(i => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#111">${i.name}</td>
      <td style="padding:6px 0;font-size:13px;color:#666;text-align:center">x${i.qty}</td>
      <td style="padding:6px 0;font-size:13px;color:#111;text-align:right;font-weight:600">${money(i.price * i.qty)}</td>
    </tr>`).join('')
  return `
      <table style="width:100%;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;border-collapse:collapse;margin-top:14px">
        <tbody>${rows}</tbody>
      </table>`
}

function voidHtml(txn: any, items: any[], cashierName: string, voidedAt: string, reason: string) {
  const accent = '#dc2626'
  const bg = '#fef2f2'
  const border = '#fecaca'
  const label = '#7f1d1d'

  return `
  <div style="max-width:460px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:${accent};padding:22px 20px;text-align:center">
      <img src="${LOGO_URL}" width="44" height="44" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 8px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:26px 24px;color:#111">
      <div style="text-align:center;font-size:30px;margin-bottom:6px">⚠️</div>
      <div style="text-align:center;font-size:17px;font-weight:800;color:${accent};margin-bottom:16px">Sale Voided by a Cashier</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;overflow:hidden">
        <tr><td style="padding:10px 14px;color:${label};font-weight:600">Transaction #</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#111">#${String(txn.id).padStart(4, '0')}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Original Sale</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${formatDateTime(txn.createdAt)}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Voided At</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${formatDateTime(voidedAt)}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Voided By</td><td style="padding:10px 14px;text-align:right;font-weight:700;border-top:1px solid ${border}">${cashierName}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Customer</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${txn.customerName || 'Walk-in'}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Payment</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${txn.payment || '—'}${(txn.payment || '').includes('GCash') && txn.gcashReference ? ` · ${txn.gcashReference}` : ''}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Total</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:${accent};border-top:1px solid ${border}">${money(txn.total)}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Reason</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${reason}</td></tr>
      </table>
      ${itemsRowsHtml(items)}
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      Automated alert from Gapuz POS — stock, points, and loyalty stats for this sale have already been reversed.
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Missing authorization' }, 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user: caller }, error: callerErr } = await supabaseAdmin.auth.getUser(jwt)
    if (callerErr || !caller) return json({ error: 'Invalid session' }, 401)

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('name, role')
      .eq('id', caller.id)
      .single()
    // Authoritative role check — an Administrator voiding a sale never
    // emails here, regardless of what the client passes.
    if (callerProfile?.role !== 'cashier') {
      return json({ ok: true, skipped: 'voider is not a cashier' })
    }

    const { txnId } = await req.json()
    if (!txnId) return json({ error: 'txnId is required' }, 400)

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('id:transaction_id, createdAt:created_at, customerName:customer_name, payment, total, gcashReference:gcash_reference, status, voidedAt:voided_at, voidReason:void_reason')
      .eq('transaction_id', txnId)
      .single()
    if (txErr || !tx) return json({ error: 'Transaction not found' }, 404)
    if (tx.status !== 'Voided') return json({ ok: true, skipped: 'transaction is not voided' })

    const { data: items } = await supabaseAdmin
      .from('transaction_items')
      .select('name, qty, price')
      .eq('transaction_id', txnId)

    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('role', 'admin')
      .eq('active', true)
      .not('email', 'is', null)

    const recipients = (admins || []).map(a => a.email).filter(Boolean)
    if (recipients.length === 0) return json({ ok: true, skipped: 'no admin email on file' })

    const smtpLogin = Deno.env.get('BREVO_SMTP_LOGIN')
    const smtpKey = Deno.env.get('BREVO_SMTP_KEY')
    const senderEmail = Deno.env.get('SENDER_EMAIL')
    if (!smtpLogin || !smtpKey || !senderEmail) throw new Error('Brevo SMTP credentials are not configured')

    const subject = `Sale Voided – Transaction #${String(tx.id).padStart(4, '0')}`
    const html = voidHtml(tx, items || [], callerProfile?.name || 'Cashier', tx.voidedAt, tx.voidReason || '—')

    // A brand-new connection each attempt, and close() failures never
    // reported as the send itself failing — same fix already applied to
    // send-request-decision-email after it caused false-failure reports
    // ("Error while in datamode - connection not recoverable" on close,
    // even though Brevo had already accepted the message).
    const attemptSend = async () => {
      const client = new SMTPClient({
        connection: { hostname: 'smtp-relay.brevo.com', port: 465, tls: true, auth: { username: smtpLogin, password: smtpKey } },
      })
      try {
        await client.send({ from: `Gapuz POS <${senderEmail}>`, to: recipients, subject, html })
      } finally {
        try { await client.close() } catch (closeErr) { console.error('SMTP close error (ignored, send already resolved):', closeErr.message) }
      }
    }

    try {
      await attemptSend()
    } catch (firstErr) {
      console.error('send-void-alert: first attempt failed, retrying once:', firstErr.message)
      await attemptSend()
    }

    return json({ ok: true })
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500)
  }
})

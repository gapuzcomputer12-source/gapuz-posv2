// Supabase Edge Function: send-request-alert
// Emails every active admin when a CASHIER submits a new Return or Refund
// request, so the request can be approved/rejected without the admin having
// to poll the app. Called from the frontend store right after create_return
// / create_refund succeeds (fire-and-forget — see notifyRequestAlert in
// src/store/index.js). Any signed-in user may call it, but:
//   - the caller's role is re-checked server-side against `profiles` here —
//     an Administrator calling this (directly or via the app) is a no-op,
//     since the role on file, not a client-supplied flag, decides.
//   - the return/refund row itself is re-fetched by id with the service
//     role, so the email always reflects what was actually saved, never
//     whatever the client happened to pass.
//   - the admin recipient list and SMTP credentials stay server-side.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt /
// send-low-stock-alert: BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-request-alert

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'
const APP_URL = 'https://gapuz-pos.vercel.app'

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function money(n: number) {
  return `₱${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function itemsRowsHtml(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) return ''
  const rows = items.map(it => {
    const serials = Array.isArray(it.serials) && it.serials.length > 0 ? ` (SN: ${it.serials.join(', ')})` : ''
    return `<tr><td style="padding:6px 14px;color:#374151;border-top:1px solid #e5e7eb">${it.name}${serials}</td><td style="padding:6px 14px;text-align:right;font-weight:700;color:#111;border-top:1px solid #e5e7eb">x${it.qty}</td></tr>`
  }).join('')
  return `
      <div style="margin-top:16px;text-align:left">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">Items being returned</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
          ${rows}
        </table>
      </div>`
}

function requestHtml(type: 'return' | 'refund', row: any, requestNumber: string) {
  const accent = '#2563eb'
  const bg = '#eff6ff'
  const border = '#bfdbfe'
  const label = '#1e3a8a'
  const emoji = type === 'return' ? '📦' : '💸'
  const heading = type === 'return' ? 'New Return Request' : 'New Refund Request'
  const method = type === 'return' ? row.method : row.refund_method
  const path = type === 'return' ? '/returns' : '/refunds'

  return `
  <div style="max-width:460px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:22px 20px;text-align:center">
      <img src="${LOGO_URL}" width="44" height="44" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 8px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:26px 24px;text-align:center;color:#111">
      <div style="font-size:34px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:17px;font-weight:800;color:${accent};margin-bottom:16px">${heading} — Approval Needed</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;overflow:hidden">
        <tr><td style="padding:10px 14px;color:${label};font-weight:600">Request #</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#111">${requestNumber}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Original Transaction</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#111;border-top:1px solid ${border}">#${String(row.transaction_id).padStart(4, '0')}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Amount</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:${accent};border-top:1px solid ${border}">${money(row.total)}</td></tr>
        ${method ? `<tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Method</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${method}</td></tr>` : ''}
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Reason</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${row.reason}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Submitted By</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${row.submitted_by || 'Cashier'}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Date Submitted</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${formatDateTime(row.created_at)}</td></tr>
      </table>
      ${type === 'return' ? itemsRowsHtml(row.items) : ''}
      <a href="${APP_URL}${path}" style="display:inline-block;margin-top:20px;padding:11px 26px;background:${accent};color:#ffffff;border-radius:8px;text-decoration:none;font-weight:800;font-size:13px">Review Request →</a>
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      Automated alert from Gapuz POS — a cashier is waiting on this approval.
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

    // Authoritative role check — ignores anything the client claims about
    // its own role. An Administrator submitting a request (through the API
    // directly, since the UI already hides the button) never emails here.
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()
    if (callerProfile?.role !== 'cashier') {
      return json({ ok: true, skipped: 'submitter is not a cashier' })
    }

    const { type, id } = await req.json()
    if ((type !== 'return' && type !== 'refund') || !id) {
      return json({ error: 'type (return|refund) and id are required' }, 400)
    }

    const table = type === 'return' ? 'returns' : 'refunds'
    const idColumn = type === 'return' ? 'return_id' : 'refund_id'
    const { data: row, error: rowErr } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq(idColumn, id)
      .single()
    if (rowErr || !row) return json({ error: 'Request not found' }, 404)

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

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp-relay.brevo.com',
        port: 465,
        tls: true,
        auth: { username: smtpLogin, password: smtpKey },
      },
    })

    const requestNumber = `#${String(id).padStart(4, '0')}`
    const subject = type === 'return'
      ? `New Return Request ${requestNumber} – Approval Needed`
      : `New Refund Request ${requestNumber} – Approval Needed`

    await client.send({
      from: `Gapuz POS <${senderEmail}>`,
      to: recipients,
      subject,
      html: requestHtml(type, row, requestNumber),
    })
    await client.close()

    return json({ ok: true })
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500)
  }
})

// Supabase Edge Function: send-request-decision-email
// Emails the customer when their Return or Refund request is approved or
// rejected, via Brevo's SMTP relay — same lean pattern as send-receipt /
// send-reward-redemption-email (the Admin's decision has already been
// saved by the time this is called, so this function just sends; it
// doesn't re-fetch or validate anything server-side). The frontend calls
// this via supabase.functions.invoke('send-request-decision-email', {...}),
// and only when the request has a notify_email saved — see
// RefundDetailsModal.jsx / ReturnDetailsModal.jsx.
//
// type: 'return' | 'refund'. action: 'approved' | 'rejected'.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt:
//   BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-request-decision-email

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'

function money(n: number) {
  return `₱${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function itemsRowsHtml(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) return ''
  const rows = items.map(it => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#111">${it.name}</td>
      <td style="padding:6px 0;font-size:13px;color:#666;text-align:right;vertical-align:top">x${it.qty}</td>
    </tr>`).join('')
  return `
      <table style="width:100%;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;border-collapse:collapse;margin-bottom:10px">
        <tbody>${rows}</tbody>
      </table>`
}

function decisionHtml(d: any) {
  const { typeLabel, action, customerName, requestNo, transactionNo, dateStr, amount, method, items, nextStep, rejectionReason } = d
  const approved = action === 'approved'
  const accent = approved ? '#059669' : '#b45309'
  const bg = approved ? '#ecfdf5' : '#fffbeb'
  const border = approved ? '#a7f3d0' : '#fde68a'
  const heading = approved ? `${typeLabel} Request Approved` : `Update on Your ${typeLabel} Request`

  return `
  <div style="max-width:380px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:24px 20px;text-align:center">
      <img src="${LOGO_URL}" width="48" height="48" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 10px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10.5px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:22px 20px;font-family:'Courier New',monospace;color:#111">
      <div style="font-size:13px;color:#111;margin-bottom:4px">Hi ${customerName || 'Customer'},</div>
      <div style="font-size:14px;font-weight:700;color:${accent};margin-bottom:14px">${heading}</div>

      <table style="width:100%;font-size:11.5px;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;overflow:hidden;margin-bottom:12px">
        <tr><td style="padding:8px 12px;color:#374151;font-weight:600">${typeLabel} Request #</td><td style="padding:8px 12px;text-align:right;font-weight:800;color:#111">${requestNo}</td></tr>
        <tr><td style="padding:8px 12px;color:#374151;font-weight:600;border-top:1px solid ${border}">Original Transaction</td><td style="padding:8px 12px;text-align:right;font-weight:800;color:#111;border-top:1px solid ${border}">${transactionNo}</td></tr>
        <tr><td style="padding:8px 12px;color:#374151;font-weight:600;border-top:1px solid ${border}">Date</td><td style="padding:8px 12px;text-align:right;border-top:1px solid ${border}">${dateStr}</td></tr>
        ${approved && amount != null ? `<tr><td style="padding:8px 12px;color:#374151;font-weight:600;border-top:1px solid ${border}">Amount</td><td style="padding:8px 12px;text-align:right;font-weight:800;color:${accent};border-top:1px solid ${border}">${money(amount)}</td></tr>` : ''}
        ${approved && method ? `<tr><td style="padding:8px 12px;color:#374151;font-weight:600;border-top:1px solid ${border}">Method</td><td style="padding:8px 12px;text-align:right;border-top:1px solid ${border}">${method}</td></tr>` : ''}
      </table>

      ${approved ? itemsRowsHtml(items) : ''}

      ${approved
        ? `<div style="font-size:11.5px;color:#555;text-align:center">${nextStep || ''}</div>`
        : `<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:10px">
             <div style="font-size:10.5px;font-weight:700;color:#7f1d1d;margin-bottom:2px">Reason</div>
             <div style="font-size:12px;color:#111">${rejectionReason || '—'}</div>
           </div>
           <div style="font-size:11.5px;color:#555;text-align:center">For questions, please visit or contact the store.</div>`}
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      Gapuz Computer Services — Door 2 NGAP Building, Purok 3, Tablon, Cagayan de Oro City
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const body = await req.json()
    const { email, type, action, customerName, requestNo, transactionNo, dateStr, amount, method, items, nextStep, rejectionReason } = body

    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (type !== 'return' && type !== 'refund') {
      return new Response(JSON.stringify({ error: "type must be 'return' or 'refund'" }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (action !== 'approved' && action !== 'rejected') {
      return new Response(JSON.stringify({ error: "action must be 'approved' or 'rejected'" }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const smtpLogin = Deno.env.get('BREVO_SMTP_LOGIN')
    const smtpKey = Deno.env.get('BREVO_SMTP_KEY')
    const senderEmail = Deno.env.get('SENDER_EMAIL')
    if (!smtpLogin || !smtpKey || !senderEmail) throw new Error('Brevo SMTP credentials are not configured')

    // requestNo/transactionNo come straight from the client payload and go
    // into the Subject header below — a stray newline/control char in
    // either one corrupts the header and Brevo hard-rejects the whole
    // message with "554 5.0.0 Header parsing error" (seen in production
    // logs). Strip anything that isn't a plain printable character.
    const sanitizeHeaderValue = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim()
    const safeRequestNo = sanitizeHeaderValue(requestNo)

    const typeLabel = type === 'return' ? 'Return' : 'Refund'
    const subject = action === 'approved'
      ? `Your ${typeLabel} Request ${safeRequestNo} has been approved - Gapuz Computer Services`
      : `Update on your ${typeLabel} Request ${safeRequestNo} - Gapuz Computer Services`
    const html = decisionHtml({ typeLabel, action, customerName, requestNo, transactionNo, dateStr, amount, method, items, nextStep, rejectionReason })

    // A brand-new connection each attempt — denomailer's connection to
    // Brevo occasionally throws "Error while in datamode - connection not
    // recoverable" on a cold TLS handshake, which clears on a fresh retry
    // almost every time. Closing the connection is wrapped separately: if
    // send() already resolved, the message is queued with Brevo whether or
    // not the subsequent close() succeeds, so a close failure must never
    // be reported as the send itself having failed.
    const attemptSend = async () => {
      const client = new SMTPClient({
        connection: {
          hostname: 'smtp-relay.brevo.com',
          port: 465,
          tls: true,
          auth: { username: smtpLogin, password: smtpKey },
        },
      })
      try {
        await client.send({ from: `Gapuz POS <${senderEmail}>`, to: email.trim(), subject, html })
      } finally {
        try { await client.close() } catch (closeErr) { console.error('SMTP close error (ignored, send already resolved):', closeErr.message) }
      }
    }

    try {
      await attemptSend()
    } catch (firstErr) {
      console.error('send-request-decision-email: first attempt failed, retrying once:', firstErr.message)
      await attemptSend()
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})

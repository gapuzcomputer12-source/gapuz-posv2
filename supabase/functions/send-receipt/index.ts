// Supabase Edge Function: send-receipt
// Emails a transaction receipt to a customer via Brevo's SMTP relay. The
// SMTP key must never reach the browser, so this call is proxied through here.
// The frontend calls this via supabase.functions.invoke('send-receipt', {...}).
//
// Requires these secrets (from Brevo dashboard → SMTP & API → SMTP tab):
//   supabase secrets set BREVO_SMTP_LOGIN=youraccount@brevo-login.com
//   supabase secrets set BREVO_SMTP_KEY=xxxxxxxxxxxxxxxx
//   supabase secrets set SENDER_EMAIL=receipts@yourdomain.com
// SENDER_EMAIL must be a verified sender in Brevo (Senders & IPs → Senders).
// Deploy with:
//   supabase functions deploy send-receipt

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'
const peso = (n: number) => `₱${(n || 0).toFixed(2)}`

function receiptHtml(txn: any) {
  const items = (txn.items || []).map((i: any) => `
    <tr>
      <td style="padding:5px 0;font-size:13px;color:#111">${i.name}${i.serials?.length ? `<div style="font-size:10px;color:#999;margin-top:2px">SN: ${i.serials.join(', ')}</div>` : ''}${i.notes ? `<div style="font-size:10px;color:#999;margin-top:2px;font-style:italic">${i.notes}</div>` : ''}</td>
      <td style="padding:5px 0;font-size:13px;color:#666;text-align:center;vertical-align:top">x${i.qty}</td>
      <td style="padding:5px 0;font-size:13px;color:#111;text-align:right;font-weight:600;vertical-align:top">${peso(i.price * i.qty)}</td>
    </tr>`).join('')

  return `
  <div style="max-width:380px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:24px 20px;text-align:center">
      <img src="${LOGO_URL}" width="48" height="48" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 10px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10.5px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:22px 20px;font-family:'Courier New',monospace;color:#111">
      <div style="text-align:center;font-size:10.5px;color:#888;margin-bottom:14px">
        Door 2 NGAP Building, Purok 3 · Tablon, Cagayan de Oro City
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#555;background:#f8fafc;border-radius:8px;padding:8px 10px;margin-bottom:12px">
        <span style="font-weight:700;color:#059669">#${String(txn.id).padStart(4, '0')}</span>
        <span>${new Date(txn.createdAt).toLocaleString('en-PH')}</span>
      </div>
      <div style="font-size:11.5px;color:#555;margin-bottom:12px">
        Customer: <strong style="color:#111">${txn.customerName || 'Walk-in'}</strong>
      </div>
      <table style="width:100%;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;border-collapse:collapse">
        <tbody>${items}</tbody>
      </table>
      <div style="font-size:12px;margin-top:10px">
        <div style="display:flex;justify-content:space-between;color:#555;padding:2px 0"><span>Subtotal</span><span>${peso(txn.subtotal)}</span></div>
        ${txn.discAmt > 0 ? `<div style="display:flex;justify-content:space-between;color:#dc2626;padding:2px 0"><span>Discount</span><span>-${peso(txn.discAmt)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;color:#555;padding:2px 0"><span>VAT (12%)</span><span>${peso(txn.vat)}</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:17px;background:#ecfdf5;border-radius:8px;padding:10px 12px;margin-top:10px">
        <span style="color:#065f46">TOTAL</span><span style="color:#059669">${peso(txn.total)}</span>
      </div>
      <div style="margin-top:10px;font-size:11.5px;color:#555;text-align:center">Payment: <strong style="color:#111">${txn.payment}</strong></div>
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      <div style="font-weight:700;color:#059669;margin-bottom:2px">Thank you for shopping at Gapuz!</div>
      <div>Items are non-refundable after 7 days.</div>
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const { email, txn } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (!txn || typeof txn !== 'object') {
      return new Response(JSON.stringify({ error: 'Transaction data is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

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

    await client.send({
      from: `Gapuz POS <${senderEmail}>`,
      to: email.trim(),
      subject: `Your Receipt — #${String(txn.id).padStart(4, '0')}`,
      html: receiptHtml(txn),
    })
    await client.close()

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

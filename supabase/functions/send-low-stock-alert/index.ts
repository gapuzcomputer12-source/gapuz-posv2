// Supabase Edge Function: send-low-stock-alert
// Emails every active admin when a product's stock genuinely decreases
// down into 1, 2, or 3 left (level: 'low') or down to exactly 0 (level:
// 'out'). Called from the frontend store the moment that happens (checkout
// deducting stock, or an admin editing stock directly) — not on a poll.
// Any signed-in user may call it (a cashier can trigger it at checkout),
// but the admin recipient list and SMTP credentials stay server-side.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt:
//   BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-low-stock-alert

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

// level 'out' -> stock hit exactly 0. level 'low' -> stock is now 1, 2, or 3.
function alertHtml(product: any, level: 'out' | 'low') {
  const isOut = level === 'out'
  const stockLeft = isOut ? 0 : (product.stock ?? '')
  const accent = isOut ? '#b91c1c' : '#b45309'
  const bg = isOut ? '#fef2f2' : '#fffbeb'
  const border = isOut ? '#fecaca' : '#fde68a'
  const label = isOut ? '#7f1d1d' : '#92400e'
  const emoji = isOut ? '⚠️' : '📦'
  const heading = isOut ? 'Product Out of Stock' : 'Product Running Low'
  return `
  <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:22px 20px;text-align:center">
      <img src="${LOGO_URL}" width="44" height="44" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 8px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:14px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:26px 24px;text-align:center;color:#111">
      <div style="font-size:34px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:17px;font-weight:800;color:${accent};margin-bottom:16px">${heading}</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;overflow:hidden">
        <tr><td style="padding:10px 14px;color:${label};font-weight:600">Product</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#111">${product.name}</td></tr>
        <tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Stock Left</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:${accent};border-top:1px solid ${border}">${stockLeft}</td></tr>
        ${product.category ? `<tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Category</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${product.category}</td></tr>` : ''}
        ${product.barcode ? `<tr><td style="padding:10px 14px;color:${label};font-weight:600;border-top:1px solid ${border}">Barcode</td><td style="padding:10px 14px;text-align:right;border-top:1px solid ${border}">${product.barcode}</td></tr>` : ''}
      </table>
      <a href="${APP_URL}/products" style="display:inline-block;margin-top:20px;padding:11px 26px;background:#059669;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:800;font-size:13px">Restock Now →</a>
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      Automated alert from Gapuz POS — restock this item before it affects sales.
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

    const { product, level } = await req.json()
    if (!product || typeof product !== 'object' || !product.name) {
      return json({ error: 'Product is required' }, 400)
    }
    const alertLevel: 'out' | 'low' = level === 'low' ? 'low' : 'out'

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

    await client.send({
      from: `Gapuz POS <${senderEmail}>`,
      to: recipients,
      subject: alertLevel === 'out' ? `Out of Stock: ${product.name}` : `Low Stock: ${product.name} (${product.stock ?? '≤3'} left)`,
      html: alertHtml(product, alertLevel),
    })
    await client.close()

    return json({ ok: true })
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500)
  }
})

// Supabase Edge Function: send-tier-upgrade-email
// Congratulates a customer the moment a sale's earned points push them UP
// into Silver, Gold, or Platinum — via Brevo's SMTP relay, same lean
// pattern as send-receipt / send-reward-redemption-email (the frontend has
// already saved the new points balance by the time this is called, so
// this function just sends; it doesn't re-fetch or validate anything
// server-side). Called from notifyTierUpgrade in src/store/index.js, right
// after addPoints lands a sale's points across the threshold — never on
// the way down (refunds/tier claims never call this), and only for the
// exact purchase that crosses it, never again on a later purchase that's
// already past it. Only called when the customer has an email on file.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt:
//   BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-tier-upgrade-email

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'

const TIER_EMOJI: Record<string, string> = { Silver: '🥈', Gold: '🥇', Platinum: '💎' }

function upgradeHtml({ customerName, tierLabel, points, rewardItems }: any) {
  const emoji = TIER_EMOJI[tierLabel] || '🎉'
  const items = Array.isArray(rewardItems) ? rewardItems : []

  return `
  <div style="max-width:380px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:24px 20px;text-align:center">
      <img src="${LOGO_URL}" width="48" height="48" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 10px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10.5px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:26px 24px;text-align:center;color:#111">
      <div style="font-size:34px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:17px;font-weight:800;color:#059669;margin-bottom:4px">Congratulations, ${customerName}!</div>
      <div style="font-size:13px;color:#555;margin-bottom:16px">You've reached <strong style="color:#111">${tierLabel}</strong> tier with <strong style="color:#111">${Number(points).toLocaleString()}</strong> points.</div>

      ${items.length > 0 ? `
      <div style="text-align:left;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:6px">
        <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:6px">Free items you can now claim:</div>
        <div style="font-size:12.5px;color:#111">${items.join(', ')}</div>
      </div>
      <div style="font-size:11px;color:#999">Ask our staff to claim yours on your next visit.</div>` : ''}

      <div style="margin-top:16px;font-size:11.5px;color:#555">Thank you for being a loyal customer!</div>
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      Automated notice from Gapuz POS.
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const { email, customerName, tierLabel, points, rewardItems } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (!tierLabel || typeof tierLabel !== 'string') {
      return new Response(JSON.stringify({ error: 'tierLabel is required' }), {
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
      subject: `You reached ${tierLabel} tier at Gapuz Computer Services!`,
      html: upgradeHtml({ customerName: customerName || 'there', tierLabel, points, rewardItems }),
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

// Supabase Edge Function: send-reward-redemption-email
// Emails a customer confirming a tier-reward claim, via Brevo's SMTP relay
// — same lean pattern as send-receipt (the frontend has already saved the
// claim through claim_tier_reward by the time this is called, so this
// function just sends; it doesn't re-fetch or validate anything server-
// side). The frontend calls this via
// supabase.functions.invoke('send-reward-redemption-email', {...}), and
// only when the customer has an email on file — see RedeemRewardModal.jsx.
//
// NOT a sale — no price or VAT anywhere in this email, same rule the
// printed claim slip follows. Claiming a tier reward DOES cost that tier's
// points now (Silver 500 / Gold 1,500 / Platinum 3,000), so this shows
// points used/remaining and the new tier if it dropped.
//
// Reuses the same Brevo SMTP secrets already set up for send-receipt:
//   BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, SENDER_EMAIL
// Deploy with:
//   supabase functions deploy send-reward-redemption-email

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LOGO_URL = 'https://gapuz-pos.vercel.app/logo.jpg'

function redemptionHtml(redemption: any) {
  const { customerName, claimedTierLabel, itemName, quantity, serialNumber, redemptionNo, createdAt, pointsUsed, pointsRemaining, currentTierLabel, tierChanged, previousTierLabel } = redemption

  return `
  <div style="max-width:380px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);font-family:Arial,sans-serif">
    <div style="background:#059669;padding:24px 20px;text-align:center">
      <img src="${LOGO_URL}" width="48" height="48" alt="Gapuz" style="border-radius:50%;display:block;margin:0 auto 10px;border:2px solid rgba(255,255,255,0.4)"/>
      <div style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.3px">GAPUZ COMPUTER</div>
      <div style="color:rgba(255,255,255,0.85);font-size:10.5px;font-weight:700;letter-spacing:.5px;margin-top:2px">SERVICES & ACCESSORIES</div>
    </div>

    <div style="padding:22px 20px;font-family:'Courier New',monospace;color:#111">
      <div style="font-size:13px;color:#111;margin-bottom:4px">Hi ${customerName},</div>
      <div style="font-size:12.5px;color:#555;margin-bottom:14px">You claimed your ${claimedTierLabel} tier reward: ${quantity} ${itemName}</div>

      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#555;background:#f8fafc;border-radius:8px;padding:8px 10px;margin-bottom:12px">
        <span style="font-weight:700;color:#059669">${redemptionNo}</span>
        <span>${new Date(createdAt).toLocaleString('en-PH')}</span>
      </div>

      <table style="width:100%;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;border-collapse:collapse;margin-bottom:10px">
        <tbody>
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#111">
              ${itemName}${serialNumber ? `<div style="font-size:10px;color:#999;margin-top:2px">SN: ${serialNumber}</div>` : ''}
            </td>
            <td style="padding:6px 0;font-size:13px;color:#666;text-align:right;vertical-align:top">x${quantity}</td>
          </tr>
        </tbody>
      </table>

      <div style="font-size:12px;margin-top:4px">
        <div style="display:flex;justify-content:space-between;color:#555;padding:2px 0"><span>Points used</span><span>${Number(pointsUsed).toLocaleString()}</span></div>
        <div style="display:flex;justify-content:space-between;color:#555;padding:2px 0"><span>Points remaining</span><span>${Number(pointsRemaining).toLocaleString()}</span></div>
        <div style="display:flex;justify-content:space-between;color:#555;padding:2px 0"><span>Current Tier</span><span style="font-weight:700;color:#111">${currentTierLabel}</span></div>
      </div>

      ${tierChanged ? `
      <div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;text-align:center">
        <div style="font-size:12px;font-weight:700;color:#92400e">Your tier changed: ${previousTierLabel} → ${currentTierLabel}</div>
      </div>` : ''}

      <div style="margin-top:14px;font-size:11.5px;color:#555;text-align:center">Thank you for being a loyal customer — enjoy your free item!</div>
    </div>

    <div style="text-align:center;font-size:10.5px;color:#999;border-top:1px dashed #ccc;padding:14px 20px;background:#fafafa">
      <div style="font-weight:700;color:#059669;margin-bottom:2px">No cash value — this is a free tier reward, not a sale.</div>
    </div>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const { email, redemption } = await req.json()
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    if (!redemption || typeof redemption !== 'object') {
      return new Response(JSON.stringify({ error: 'Redemption data is required' }), {
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
      subject: 'You claimed a reward at Gapuz Computer Services!',
      html: redemptionHtml(redemption),
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

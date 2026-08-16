/* ============================================================
   Unseelie Workshop — email provider

   Cloudflare cannot send mail (Email Routing is inbound only), so this
   is the one place that talks to an outside provider. Swapping Resend
   for Postmark means changing this file and nothing else.

   Throws on any non-2xx. The caller records the failure against the
   outbox row and lets the next drain retry it.
   ============================================================ */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set.');
  if (!env.FROM_EMAIL) throw new Error('FROM_EMAIL is not set.');

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, text, html }),
  });

  if (!response.ok) {
    /* The body carries the reason; without it a failure is just a
       number and every retry looks identical. */
    throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
  }
}

/* ============================================================
   Unseelie Workshop — HMAC primitives

   Shared by the Stripe and EasyPost webhook verifiers. Both sign the
   raw request body with HMAC-SHA256 and hex-encode it; only the header
   format and the secret handling differ.
   ============================================================ */

export async function hmacHex(message, secret) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));

  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/* Constant time, so a wrong signature cannot be recovered a byte at a
   time by measuring how long the comparison takes. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

export async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/* ============================================================
   Unseelie Workshop — Stripe webhook signature verification

   Hand-rolled on Web Crypto rather than pulled from the Stripe SDK,
   to match how functions/api/checkout.js already talks to Stripe:
   plain fetch, no dependency.

   Stripe signs `${timestamp}.${rawBody}` with the endpoint's signing
   secret and sends the result as:

     Stripe-Signature: t=1614556800,v1=<hex>[,v1=<hex>][,v0=<hex>]

   Every failure throws with the reason. Callers turn that into a 400:
   a signature that does not verify is never worth retrying.
   ============================================================ */

import { hmacHex, timingSafeEqual } from './hmac.js';

/* Stripe's own libraries default to five minutes. An older timestamp
   means a replayed request, not a slow one. */
const TOLERANCE_SECONDS = 300;

export async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header.');

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  if (!timestamp) throw new Error('Stripe-Signature carried no timestamp.');
  if (signatures.length === 0) throw new Error('Stripe-Signature carried no v1 signature.');

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age)) throw new Error('Stripe-Signature timestamp is not a number.');
  if (age > TOLERANCE_SECONDS) {
    throw new Error(`Stripe-Signature is ${age}s old; tolerance is ${TOLERANCE_SECONDS}s.`);
  }

  const expected = await hmacHex(`${timestamp}.${rawBody}`, secret);

  /* Several v1 signatures arrive at once while a signing secret is
     being rolled, so any match is a match. */
  const verified = signatures.some(candidate => timingSafeEqual(candidate, expected));
  if (!verified) throw new Error('Stripe-Signature did not match the signing secret.');
}

function parseSignatureHeader(header) {
  const result = { timestamp: null, signatures: [] };

  for (const pair of header.split(',')) {
    const split = pair.indexOf('=');
    if (split === -1) continue;

    const key = pair.slice(0, split).trim();
    const value = pair.slice(split + 1).trim();

    if (key === 't') result.timestamp = value;
    if (key === 'v1') result.signatures.push(value);
  }

  return result;
}


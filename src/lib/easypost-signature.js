/* ============================================================
   Unseelie Workshop — EasyPost webhook signature verification

   EasyPost signs the raw request body with HMAC-SHA256 and sends it as

     X-Hmac-Signature: hmac-sha256-hex=<lowercase hex>

   Every failure throws with the reason. Callers turn that into a 400:
   a signature that does not verify is never worth retrying.
   ============================================================ */

import { hmacHex, timingSafeEqual } from './hmac.js';

const SIGNATURE_PREFIX = 'hmac-sha256-hex=';

export async function verifyEasyPostSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) throw new Error('Missing X-Hmac-Signature header.');

  /* EasyPost's own client libraries normalise the secret to Unicode
     NFKD before signing. Omitting this is the usual cause of
     signatures that never match when the secret contains anything
     outside ASCII, and it is invisible until it happens. */
  const expected = SIGNATURE_PREFIX + await hmacHex(rawBody, secret.normalize('NFKD'));

  const presented = signatureHeader.trim().toLowerCase();

  if (!timingSafeEqual(expected, presented)) {
    throw new Error('X-Hmac-Signature did not match the webhook secret.');
  }
}

/* ============================================================
   Unseelie Workshop — review invite tokens

   One token per purchased item, derived rather than drawn at random,
   because two separate emails carry the same links: the delivery notice
   and, if no review arrives, the nudge seven days later.

   A random token would have to be kept in plaintext to be reused a week
   later, or the second email would invalidate the first. Deriving it
   means the raw token is never stored — the database holds only its
   SHA-256, and recomputing it requires REVIEW_TOKEN_SECRET, which the
   database does not contain.
   ============================================================ */

import { hmacHex, sha256Hex } from './hmac.js';

export function mintReviewToken(orderItemId, secret) {
  return hmacHex(`review:${orderItemId}`, secret);
}

export function hashReviewToken(token) {
  return sha256Hex(token);
}

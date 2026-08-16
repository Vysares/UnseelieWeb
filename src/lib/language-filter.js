/* ============================================================
   Unseelie Workshop — language filter

   Runs on the server, on submit. Deliberately not mirrored in the
   browser: a check that runs only in the page would let a blocked
   review vanish without the server ever hearing about it, which is the
   invisible suppression this whole system is built to avoid. Blocking
   here means every attempt is counted (see blocked_submissions) and
   the customer is told exactly which words to change.

   SCOPE — this matters more here than on most shops.

   We sell restraints. Customers will describe intended use in frank
   sexual language, and those are the most useful reviews on the site.
   Anatomical, clinical, and plain sexual vocabulary is therefore NOT
   filtered, on purpose. Filtering it would reject the good reviews and
   would skew toward rejecting candid ones, which are disproportionately
   the critical ones.

   What is filtered is slurs and hard vulgarity — words that add nothing
   a review needs and that nobody has to use to describe a product.

   The lists are separate because they age differently. SLURS is not a
   matter of taste and should only ever grow. VULGARITY is a judgement
   call about tone on your own storefront: prune or extend it freely,
   but keep in mind that every word added is a word a frustrated
   customer might reach for, and frustrated customers leave the reviews
   that prove you are not cherry-picking.
   ============================================================ */

/* Not negotiable. Matched whole-word, case-insensitive. */
const SLURS = [
  'nigger', 'nigga', 'faggot', 'fag', 'tranny', 'kike', 'spic',
  'chink', 'gook', 'wetback', 'retard', 'retarded', 'coon',
];

/* Tone, not harm. Curate to taste — this is the list to argue with. */
const VULGARITY = [
  'cunt', 'motherfucker', 'rape'
];

const BLOCKED = [...SLURS, ...VULGARITY];

/* Word boundaries, so "assess" is not caught by "ass" and "Scunthorpe"
   survives. Leetspeak and spacing tricks are not chased: a filter that
   tries to catch every evasion catches ordinary words instead, and the
   moderation queue exists for whatever slips through. */
const PATTERN = new RegExp(`\\b(${BLOCKED.join('|')})\\b`, 'gi');

/* Handed to the review page so it can catch these while the customer
   is still typing, rather than after a submit that looks like a
   rejection. The page is a courtesy; this module stays the authority,
   and the submit handler checks again regardless of what the browser
   did or did not do.

   Publishing the list makes it trivially evadable — but it already was.
   Nothing here chases leetspeak, and the moderation queue is what
   catches deliberate evasion. The list is not a secret; it is a house
   rule, and house rules work better posted. */
export function blockedWordList() {
  return [...BLOCKED];
}

/* Returns the distinct words found, lowercased, in the order matched.
   Empty array means nothing objectionable. */
export function findBlockedWords(...texts) {
  const found = new Set();

  for (const text of texts) {
    if (!text) continue;
    for (const match of String(text).matchAll(PATTERN)) {
      found.add(match[1].toLowerCase());
    }
  }

  return [...found];
}

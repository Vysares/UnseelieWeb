/* ============================================================
   Unseelie Workshop — catalog lookup

   data/products.json already records which Stripe price belongs to
   which piece and size, so it stays the single source of truth and
   this builds the reverse map from it: price id → reviewable piece.

   Used by the Stripe webhook to turn a purchased line item into
   something a review can attach to.
   ============================================================ */

import catalog from '../../public/data/products.json';

/* Collections that are not on sale yet carry placeholder ids. They can
   never appear on a real order, so they are left out of the map rather
   than mapped to a piece that has no purchasable price. */
const PLACEHOLDER_PREFIX = 'REPLACE_';

/* Built once per isolate, on first use. */
let priceMap = null;

/* Returns { type, collection, size }, or null when the price is not in
   the catalog — a retired price, or one added in Stripe but not here.
   Callers are expected to store the null and flag it for a human
   rather than guess; see order_items in db/migrations. */
export function resolvePrice(stripePriceId) {
  if (!priceMap) priceMap = buildPriceMap();
  return priceMap.get(stripePriceId) ?? null;
}

function buildPriceMap() {
  const map = new Map();

  for (const product of catalog.products) {
    for (const [collection, entry] of Object.entries(product.collections)) {
      for (const variant of entry.variants) {
        if (variant.stripePriceId.startsWith(PLACEHOLDER_PREFIX)) continue;

        map.set(variant.stripePriceId, {
          type: product.type,
          collection,
          size: variant.size,
        });
      }
    }
  }

  return map;
}

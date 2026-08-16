/* ============================================================
   Unseelie Workshop — Stripe webhook
   Route: POST /api/hooks/stripe  (dispatched from src/index.js)

   Stripe is the source of truth for what was bought and by whom. This
   handler records the order, resolves each line item back to a
   reviewable piece, and queues the confirmation email.

   It never sends mail itself. A webhook has milliseconds to reply, and
   Stripe answers a timeout by calling again — so slow work here
   duplicates rather than fails. The mailer Worker drains the outbox.

   Secrets (wrangler secret put ...):
     STRIPE_SECRET_KEY      sk_live_... / sk_test_...
     STRIPE_WEBHOOK_SECRET  whsec_...  — this endpoint's signing secret

   Bindings (wrangler.toml):
     DB                     D1 database; schema in db/migrations
   ============================================================ */

import { verifyStripeSignature } from '../lib/stripe-signature.js';
import { resolvePrice } from '../lib/catalog.js';

const STRIPE_API = 'https://api.stripe.com/v1';

/* Stripe's maximum page size, and far beyond any order this shop will
   see. An order larger than this would silently lose items, so it is
   checked rather than assumed. */
const LINE_ITEM_LIMIT = 100;

export async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.DB) {
    console.error('Stripe webhook: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, or DB binding is missing.');
    return new Response('Webhook is not configured.', { status: 500 });
  }

  /* The raw text is what was signed, so it has to be read before
     anything parses it. */
  const rawBody = await request.text();

  try {
    await verifyStripeSignature(
      rawBody,
      request.headers.get('Stripe-Signature'),
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook rejected:', err.message);
    return new Response(err.message, { status: 400 });
  }

  const event = JSON.parse(rawBody);

  if (await alreadyHandled(env.DB, event, rawBody)) {
    return new Response('Already handled.', { status: 200 });
  }

  if (event.type !== 'checkout.session.completed') {
    await markHandled(env.DB, event.id);
    return new Response('Ignored.', { status: 200 });
  }

  try {
    await recordOrder(env, event.data.object);
  } catch (err) {
    /* 500 so Stripe retries. The reason is stored against the event so
       a webhook that keeps failing shows up in the admin rather than
       only in a log nobody is reading. */
    console.error('Stripe webhook handler failed:', err);
    await recordError(env.DB, event.id, err.message);
    return new Response('Handler failed; will retry.', { status: 500 });
  }

  await markHandled(env.DB, event.id);
  return new Response('OK', { status: 200 });
}

/* ============================================================
   Event bookkeeping
   ============================================================ */

/* Records the event, then reports whether it has already been carried
   out. Existence is not enough: the row is written before the work, so
   a retry after a failure must find handled = 0 and try again. */
async function alreadyHandled(db, event, rawBody) {
  await db.prepare(
    `INSERT OR IGNORE INTO webhook_events
       (provider, event_id, event_type, received_at, payload)
     VALUES ('stripe', ?, ?, ?, ?)`
  ).bind(event.id, event.type, new Date().toISOString(), rawBody).run();

  const row = await db.prepare(
    `SELECT handled FROM webhook_events WHERE provider = 'stripe' AND event_id = ?`
  ).bind(event.id).first();

  return row?.handled === 1;
}

function markHandled(db, eventId) {
  return db.prepare(
    `UPDATE webhook_events SET handled = 1, handler_error = NULL
     WHERE provider = 'stripe' AND event_id = ?`
  ).bind(eventId).run();
}

function recordError(db, eventId, message) {
  return db.prepare(
    `UPDATE webhook_events SET handler_error = ?
     WHERE provider = 'stripe' AND event_id = ?`
  ).bind(message, eventId).run();
}

/* ============================================================
   Order
   ============================================================ */

async function recordOrder(env, session) {
  /* Asynchronous payment methods complete the session before the money
     arrives. Only a paid session is an order; the unpaid case resolves
     later through checkout.session.async_payment_succeeded, which this
     endpoint does not yet subscribe to. */
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    console.warn(`Checkout session ${session.id} is ${session.payment_status}; no order recorded.`);
    return;
  }

  /* A second event for a session already recorded. The webhook_events
     guard catches redelivery of the same event; this catches a
     different event describing the same purchase. */
  const existing = await env.DB.prepare(
    'SELECT id FROM orders WHERE stripe_session_id = ?'
  ).bind(session.id).first();

  if (existing) {
    console.warn(`Checkout session ${session.id} is already recorded as order ${existing.id}.`);
    return;
  }

  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) throw new Error(`Checkout session ${session.id} carries no customer email.`);

  /* Null is fine — the templates greet by name when there is one and
     say "Hello," when there is not. */
  const name = customerName(session);

  const lineItems = await fetchLineItems(env.STRIPE_SECRET_KEY, session.id);
  if (lineItems.length === 0) {
    throw new Error(`Checkout session ${session.id} reported no line items.`);
  }

  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const statements = [
    env.DB.prepare(
      `INSERT INTO orders
         (id, stripe_session_id, email, customer_name, placed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId,
      session.id,
      email,
      name,
      new Date(session.created * 1000).toISOString(),
      now
    ),
  ];

  const unresolved = [];

  for (const item of lineItems) {
    const piece = resolvePrice(item.priceId);
    if (!piece) unresolved.push(item.priceId);

    statements.push(
      env.DB.prepare(
        `INSERT INTO order_items
           (id, order_id, stripe_price_id, type, collection, size, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        orderId,
        item.priceId,
        piece?.type ?? null,
        piece?.collection ?? null,
        piece?.size ?? null,
        item.quantity
      )
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO outbox (id, order_id, kind, scheduled_for)
       VALUES (?, ?, 'order_confirmed', ?)`
    ).bind(crypto.randomUUID(), orderId, now)
  );

  /* D1 runs a batch as one transaction, so the order, its items, and
     its confirmation email either all land or none do. */
  await env.DB.batch(statements);

  /* An unresolved price is stored as a null piece rather than dropped:
     the order stays complete and the item is mapped by hand later. It
     is loud here so it is not discovered weeks on. */
  if (unresolved.length > 0) {
    console.error(
      `Order ${orderId} has ${unresolved.length} line item(s) missing from the catalog: ` +
      unresolved.join(', ')
    );
  }
}

/* The shipping recipient, which is the only name this checkout actually
   asks anyone for.

   customer_details.name comes last, not first: Checkout fills it only
   when it collects a name, and functions/api/checkout.js sets
   shipping_address_collection without billing address or name
   collection. Reading it first would leave every greeting as "Hello,".

   Both shipping paths are checked because Stripe moved the field into
   collected_information in API version 2025-03-31 and is removing the
   top-level one, while a webhook delivers whichever version its
   endpoint is pinned to. */
function customerName(session) {
  return session.collected_information?.shipping_details?.name
    ?? session.shipping_details?.name
    ?? session.customer_details?.name
    ?? null;
}

/* Line items are not part of the webhook payload and cannot be
   expanded onto it, so they are fetched separately. The price object
   comes back nested by default, so price.id needs no expand — but the
   endpoint's own default limit is 10, which is why the limit is set
   explicitly and has_more is checked rather than trusted. */
async function fetchLineItems(secretKey, sessionId) {
  const response = await fetch(
    `${STRIPE_API}/checkout/sessions/${sessionId}/line_items?limit=${LINE_ITEM_LIMIT}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Stripe line_items failed: ${body.error?.message ?? response.status}`);
  }

  if (body.has_more) {
    throw new Error(`Checkout session ${sessionId} has more than ${LINE_ITEM_LIMIT} line items.`);
  }

  return body.data.map(item => {
    if (!item.price?.id) {
      throw new Error(`Checkout session ${sessionId} has a line item with no price id.`);
    }
    return { priceId: item.price.id, quantity: item.quantity ?? 1 };
  });
}

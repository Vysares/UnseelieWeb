/* ============================================================
   Unseelie Workshop — EasyPost webhook
   Route: POST /api/hooks/easypost  (dispatched from src/index.js)

   EasyPost never creates orders — its Trackers carry no product data.
   It only moves an order forward: shipped, then delivered.

   tracker.updated fires on every carrier scan, so this handler is
   written to be repeatable. It reads the tracker's current status and
   brings the order up to date, rather than reacting to a transition.
   An event that arrives late, twice, or out of order lands on the same
   result, and the outbox's UNIQUE(order_id, kind) keeps the mail to one
   copy each.

   Secrets:
     EASYPOST_WEBHOOK_SECRET   the endpoint's HMAC secret
   ============================================================ */

import { verifyEasyPostSignature } from '../lib/easypost-signature.js';
import { enqueue, nudgeTime } from '../mailer/outbox.js';

/* EasyPost tracker statuses that mean the parcel is moving. Reaching
   any of them is what "shipped" means here. */
const IN_MOTION = new Set(['pre_transit', 'in_transit', 'out_for_delivery']);

/* Statuses that need a person. These deliberately send no mail: a
   customer whose parcel is going back to us should hear from Jackson,
   not from a template. */
const NEEDS_ATTENTION = new Set(['return_to_sender', 'failure', 'error', 'cancelled']);

export async function handleEasyPostWebhook(request, env) {
  if (!env.EASYPOST_WEBHOOK_SECRET || !env.DB) {
    console.error('EasyPost webhook: EASYPOST_WEBHOOK_SECRET or DB binding is missing.');
    return new Response('Webhook is not configured.', { status: 500 });
  }

  const rawBody = await request.text();

  try {
    await verifyEasyPostSignature(
      rawBody,
      request.headers.get('X-Hmac-Signature'),
      env.EASYPOST_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('EasyPost webhook rejected:', err.message);
    return new Response(err.message, { status: 400 });
  }

  const event = JSON.parse(rawBody);

  if (await alreadyHandled(env.DB, event, rawBody)) {
    return new Response('Already handled.', { status: 200 });
  }

  /* EasyPost names the event in `description`, not `type`. */
  if (event.description !== 'tracker.updated') {
    await markHandled(env.DB, event.id);
    return new Response('Ignored.', { status: 200 });
  }

  let enqueued;
  try {
    enqueued = await applyTracker(env, event.result);
  } catch (err) {
    console.error('EasyPost webhook handler failed:', err);
    await recordError(env.DB, event.id, err.message);
    return new Response('Handler failed; will retry.', { status: 500 });
  }

  await markHandled(env.DB, event.id);
  return new Response('OK', { status: 200 });
}

/* ============================================================
   Tracker
   ============================================================ */

async function applyTracker(env, tracker) {
  if (!tracker?.tracking_code) {
    throw new Error('tracker.updated carried no tracking_code.');
  }

  const order = await env.DB.prepare(
    `SELECT id, shipped_at, delivered_at FROM orders WHERE tracking_code = ?`
  ).bind(tracker.tracking_code).first();

  /* No order carries this tracking code. Almost always a label whose
     number was never recorded against the order. Thrown rather than
     shrugged off: it leaves handler_error set on the event, which is
     what the admin attention list reads. */
  if (!order) {
    throw new Error(
      `No order has tracking code ${tracker.tracking_code}. ` +
      `Record it against the order before the carrier's next scan.`
    );
  }

  if (NEEDS_ATTENTION.has(tracker.status)) {
    console.error(
      `Order ${order.id} tracker is ${tracker.status}; no mail sent, needs a person.`
    );
    return [];
  }

  const statements = [];
  const now = new Date().toISOString();

  /* Delivered implies motion, so a parcel first seen as delivered still
     gets its shipped timestamp rather than a gap in the record. */
  const moving = IN_MOTION.has(tracker.status) || tracker.status === 'delivered';

  if (moving && !order.shipped_at) {
    statements.push(
      env.DB.prepare('UPDATE orders SET shipped_at = ? WHERE id = ?')
        .bind(shipDate(tracker, now), order.id)
    );
    statements.push(enqueue(env.DB, order.id, 'shipped'));
  }

  if (tracker.status === 'delivered' && !order.delivered_at) {
    const deliveredAt = deliveryDate(tracker, now);

    statements.push(
      env.DB.prepare('UPDATE orders SET delivered_at = ?, easypost_tracker_id = ? WHERE id = ?')
        .bind(deliveredAt, tracker.id ?? null, order.id)
    );
    statements.push(enqueue(env.DB, order.id, 'delivered'));
    statements.push(enqueue(env.DB, order.id, 'review_nudge', nudgeTime(deliveredAt)));
  }

  if (statements.length === 0) return [];

  await env.DB.batch(statements);
  return statements;
}

/* Carrier timestamps are preferred over arrival time here, so a webhook
   that turns up late does not misdate the order — and, for delivery,
   does not shift the review clock by however long the delay was. */
function shipDate(tracker, fallback) {
  const first = tracker.tracking_details?.[0]?.datetime;
  return first ? new Date(first).toISOString() : fallback;
}

function deliveryDate(tracker, fallback) {
  const scan = tracker.tracking_details
    ?.filter(detail => detail.status === 'delivered')
    .pop();

  return scan?.datetime ? new Date(scan.datetime).toISOString() : fallback;
}

/* ============================================================
   Event bookkeeping

   Same shape as the Stripe handler: the row is written before the work,
   so existence alone is not proof the work happened. Only handled = 1
   short-circuits, which is what lets a retry after a failure run again.
   ============================================================ */

async function alreadyHandled(db, event, rawBody) {
  await db.prepare(
    `INSERT OR IGNORE INTO webhook_events
       (provider, event_id, event_type, received_at, payload)
     VALUES ('easypost', ?, ?, ?, ?)`
  ).bind(
    event.id,
    event.description ?? 'unknown',
    new Date().toISOString(),
    rawBody
  ).run();

  const row = await db.prepare(
    `SELECT handled FROM webhook_events WHERE provider = 'easypost' AND event_id = ?`
  ).bind(event.id).first();

  return row?.handled === 1;
}

function markHandled(db, eventId) {
  return db.prepare(
    `UPDATE webhook_events SET handled = 1, handler_error = NULL
     WHERE provider = 'easypost' AND event_id = ?`
  ).bind(eventId).run();
}

function recordError(db, eventId, message) {
  return db.prepare(
    `UPDATE webhook_events SET handler_error = ?
     WHERE provider = 'easypost' AND event_id = ?`
  ).bind(message, eventId).run();
}

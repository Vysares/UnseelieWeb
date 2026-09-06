/* ============================================================
   Unseelie Workshop — outbox

   Webhook handlers enqueue; drain() sends. drain() is called twice:
   immediately after a webhook via ctx.waitUntil(), so mail goes out at
   once, and from the cron trigger, which catches anything the
   immediate attempt failed or never reached.

   The queue is not primarily about scheduling — only the nudge is
   actually delayed. It is about not sending twice. EasyPost fires
   tracker.updated on every carrier scan and retries on any non-2xx, so
   several events reporting "delivered" is ordinary. UNIQUE(order_id,
   kind) in the schema is what makes the resulting email happen once.
   ============================================================ */

import { renderEmail } from './templates.js';
import { sendEmail } from './send.js';
import { mintReviewToken, hashReviewToken } from '../lib/review-token.js';

const NUDGE_DELAY_DAYS = 7;
const INVITE_LIFETIME_DAYS = 120;

/* Given up on after this many failures, so a permanently bad address
   stops being retried every five minutes forever. */
const MAX_ATTEMPTS = 5;

/* Bounds one drain. Well beyond a day's volume here, but an unbounded
   loop in a cron is how a backlog turns into a timeout. */
const DRAIN_LIMIT = 25;

/* Mail the customer needs, versus mail they may switch off. Only the
   second consults the suppression list. */
const MARKETING_KINDS = new Set(['review_nudge']);

/* ============================================================
   Enqueue
   ============================================================ */

/* Returns a statement rather than running it, so callers can commit the
   enqueue in the same D1 batch as the state change that caused it.

   INSERT OR IGNORE leans on UNIQUE(order_id, kind): enqueuing the same
   notification twice is a no-op rather than an error, which is what
   makes repeated webhooks harmless. */
export function enqueue(db, orderId, kind, scheduledFor = new Date().toISOString()) {
  return db.prepare(
    `INSERT OR IGNORE INTO outbox (id, order_id, kind, scheduled_for)
     VALUES (?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), orderId, kind, scheduledFor);
}

export function nudgeTime(deliveredAt) {
  const due = new Date(deliveredAt);
  due.setUTCDate(due.getUTCDate() + NUDGE_DELAY_DAYS);
  return due.toISOString();
}

/* ============================================================
   Drain
   ============================================================ */

export async function drain(env) {
  const now = new Date().toISOString();

  const { results } = await env.DB.prepare(
    `SELECT ob.id, ob.order_id, ob.kind, ob.attempts,
            o.email, o.customer_name, o.order_number, o.tracking_code,
            o.shipping_address, o.shipping_method, o.delivered_at
     FROM outbox ob
     JOIN orders o ON o.id = ob.order_id
     WHERE ob.state = 'scheduled' AND ob.scheduled_for <= ?
     ORDER BY ob.scheduled_for
     LIMIT ?`
  ).bind(now, DRAIN_LIMIT).all();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of results) {
    try {
      const outcome = await deliver(env, row);
      if (outcome === 'sent') sent++;
      else skipped++;
    } catch (err) {
      await recordFailure(env.DB, row, err);
      failed++;
    }
  }

  return { considered: results.length, sent, skipped, failed };
}

async function deliver(env, row) {
  const skipReason = await reasonToSkip(env, row);
  if (skipReason) {
    await env.DB.prepare(
      `UPDATE outbox SET state = 'skipped', skip_reason = ? WHERE id = ?`
    ).bind(skipReason, row.id).run();
    return 'skipped';
  }

  const items = await loadItems(env.DB, row.order_id);
  const message = renderEmail(row.kind, await buildContext(env, row, items));

  await sendEmail(env, { to: row.email, ...message });

  await env.DB.prepare(
    `UPDATE outbox SET state = 'sent', sent_at = ?, last_error = NULL WHERE id = ?`
  ).bind(new Date().toISOString(), row.id).run();

  return 'sent';
}

/* The nudge is decided here rather than cancelled when a review lands.
   Checking at send time means there is no race between the submit
   handler and the drain, and nothing to unwind if a review is later
   rejected. */
async function reasonToSkip(env, row) {
  if (MARKETING_KINDS.has(row.kind)) {
    const suppressed = await env.DB.prepare(
      'SELECT 1 FROM suppressions WHERE email = ?'
    ).bind(row.email).first();

    if (suppressed) return 'suppressed';
  }

  if (row.kind === 'review_nudge' && !(await hasUnreviewedItems(env.DB, row.order_id))) {
    return 'already_reviewed';
  }

  return null;
}

/* Items with no resolved type cannot carry a review, so they are not
   counted as outstanding — otherwise an unmapped line would nudge the
   customer forever about something they cannot review. */
async function hasUnreviewedItems(db, orderId) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS outstanding
     FROM order_items oi
     LEFT JOIN reviews r ON r.order_item_id = oi.id
     WHERE oi.order_id = ? AND oi.type IS NOT NULL AND r.id IS NULL`
  ).bind(orderId).first();

  return row.outstanding > 0;
}

async function loadItems(db, orderId) {
  const { results } = await db.prepare(
    `SELECT stripe_price_id, type, collection, size
     FROM order_items WHERE order_id = ?`
  ).bind(orderId).all();

  return results;
}

async function buildContext(env, row, items) {
  const order = {
    customer_name: row.customer_name,
    order_number: row.order_number,
    tracking_code: row.tracking_code,
    shipping_address: row.shipping_address,
    shipping_method: row.shipping_method,
  };

  if (row.kind !== 'delivered' && row.kind !== 'review_nudge') {
    return { order, items, siteUrl: siteUrl(env) };
  }

  return {
    order,
    items,
    siteUrl: siteUrl(env),
    reviewItems: await reviewLinks(env, row.order_id),
    unsubscribeUrl: `${siteUrl(env)}/api/unsubscribe?t=${await unsubscribeToken(env, row.email)}`,
    businessAddress: env.BUSINESS_ADDRESS ?? null,
  };
}

/* One link per piece still awaiting a review, so the nudge never asks
   again about something already written up. Records each invite the
   first time its link is handed out, which is what gives expiry a start
   date; the tokens themselves are derived, not stored. */
async function reviewLinks(env, orderId) {
  if (!env.REVIEW_TOKEN_SECRET) throw new Error('REVIEW_TOKEN_SECRET is not set.');

  const base = siteUrl(env);

  const { results } = await env.DB.prepare(
    `SELECT oi.id, oi.type, oi.collection, oi.size
     FROM order_items oi
     LEFT JOIN reviews r ON r.order_item_id = oi.id
     WHERE oi.order_id = ? AND oi.type IS NOT NULL AND r.id IS NULL`
  ).bind(orderId).all();

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITE_LIFETIME_DAYS);

  const links = [];

  for (const item of results) {
    const token = await mintReviewToken(item.id, env.REVIEW_TOKEN_SECRET);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO invites (token_hash, order_item_id, issued_at, expires_at)
       VALUES (?, ?, ?, ?)`
    ).bind(
      await hashReviewToken(token),
      item.id,
      issuedAt.toISOString(),
      expiresAt.toISOString()
    ).run();

    links.push({
      type: item.type,
      collection: item.collection,
      size: item.size,
      url: `${base}/review.html?t=${token}`,
    });
  }

  return links;
}

/* A trailing slash is easy to paste into a config value and would build
   every link as host//review.html, which the asset router does not
   match — so every review link in every email would 404. Normalised
   here rather than trusted, because the value is edited by hand. */
function siteUrl(env) {
  if (!env.SITE_URL) throw new Error('SITE_URL is not set.');
  return env.SITE_URL.replace(/\/+$/, '');
}

/* Keyed off the address rather than an order, since suppression is
   per-address and outlives any one purchase. */
function unsubscribeToken(env, email) {
  return mintReviewToken(`unsubscribe:${email}`, env.REVIEW_TOKEN_SECRET);
}

async function recordFailure(db, row, err) {
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  console.error(
    `Outbox ${row.kind} for order ${row.order_id} failed ` +
    `(attempt ${attempts}/${MAX_ATTEMPTS}): ${err.message}`
  );

  await db.prepare(
    `UPDATE outbox SET attempts = ?, last_error = ?, state = ? WHERE id = ?`
  ).bind(
    attempts,
    err.message,
    exhausted ? 'failed' : 'scheduled',
    row.id
  ).run();
}

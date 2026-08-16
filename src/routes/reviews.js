/* ============================================================
   Unseelie Workshop — review submission
   Routes:  GET  /api/reviews/invite?t=<token>
            POST /api/reviews/submit

   The token is per-order and stays usable until it expires, because an
   order can hold several pieces and a customer may review one now and
   another later. One review per item is enforced by UNIQUE on
   reviews.order_item_id, not by burning the token.

   Nothing here publishes anything. Every accepted review lands as
   'pending' for moderation.
   ============================================================ */

import { hashReviewToken } from '../lib/review-token.js';
import { findBlockedWords } from '../lib/language-filter.js';

const TITLE_MAX = 80;
const BODY_MIN = 20;
const BODY_MAX = 2000;
const AUTHOR_MAX = 40;
const MAX_RATING = 5;

/* ============================================================
   GET /api/reviews/invite
   ============================================================ */

export async function handleReviewInvite(request, env) {
  if (!env.DB) return jsonError('Reviews are not available.', 500);

  const token = new URL(request.url).searchParams.get('t');
  const invite = await lookupInvite(env, token);

  if (invite.error) return jsonError(invite.error, invite.status);

  const items = await reviewableItems(env.DB, invite.orderId);

  return Response.json({
    items,
    /* Nothing left to review is a normal end state, not a failure —
       the page says so rather than showing an empty form. */
    complete: items.every(item => item.reviewed),
  });
}

/* ============================================================
   POST /api/reviews/submit
   ============================================================ */

export async function handleReviewSubmit(request, env) {
  if (!env.DB) return jsonError('Reviews are not available.', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.', 400);
  }

  const invite = await lookupInvite(env, body.token);
  if (invite.error) return jsonError(invite.error, invite.status);

  const item = await findItem(env.DB, invite.orderId, body.orderItemId);
  if (!item) return jsonError('That item is not on this order.', 400);
  if (item.reviewed) return jsonError('That piece has already been reviewed.', 409);

  const fields = validate(body);
  if (fields.error) return jsonError(fields.error, 400);

  /* Checked before anything is written, and recorded even though the
     review is not. A block is a decision about someone's words, so it
     leaves a trace like every other decision does. */
  const blocked = findBlockedWords(fields.title, fields.body, fields.author);
  if (blocked.length > 0) {
    await recordBlocked(env.DB, invite.orderId, fields.rating, blocked);

    return Response.json(
      {
        error: 'Please reword before submitting.',
        blockedWords: blocked,
      },
      { status: 422 }
    );
  }

  await env.DB.prepare(
    `INSERT INTO reviews
       (id, order_item_id, rating, title, body, author, submitted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    crypto.randomUUID(),
    item.id,
    fields.rating,
    fields.title,
    fields.body,
    fields.author,
    new Date().toISOString()
  ).run();

  return Response.json({ ok: true });
}

/* ============================================================
   Token
   ============================================================ */

/* Resolves a token to its order, or to the reason it will not resolve.
   Wrong and expired are told apart deliberately: "this link has
   expired" is actionable, "not found" is not. */
async function lookupInvite(env, token) {
  if (!token || typeof token !== 'string') {
    return { error: 'This review link is missing its code.', status: 400 };
  }

  const row = await env.DB.prepare(
    'SELECT order_id, expires_at FROM invites WHERE token_hash = ?'
  ).bind(await hashReviewToken(token)).first();

  if (!row) {
    return { error: 'This review link is not valid.', status: 404 };
  }

  if (row.expires_at <= new Date().toISOString()) {
    return { error: 'This review link has expired.', status: 410 };
  }

  return { orderId: row.order_id };
}

/* ============================================================
   Items
   ============================================================ */

/* Items whose price never resolved to a piece are left out — there is
   no product page for a review of them to appear on. They surface in
   the admin instead, so the order is not silently short an item. */
async function reviewableItems(db, orderId) {
  const { results } = await db.prepare(
    `SELECT oi.id, oi.type, oi.collection, oi.size,
            CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS reviewed
     FROM order_items oi
     LEFT JOIN reviews r ON r.order_item_id = oi.id
     WHERE oi.order_id = ? AND oi.type IS NOT NULL`
  ).bind(orderId).all();

  return results.map(row => ({
    id: row.id,
    type: row.type,
    collection: row.collection,
    size: row.size,
    reviewed: row.reviewed === 1,
  }));
}

async function findItem(db, orderId, orderItemId) {
  if (!orderItemId) return null;

  const items = await reviewableItems(db, orderId);
  return items.find(item => item.id === orderItemId) ?? null;
}

/* ============================================================
   Validation
   ============================================================ */

function validate(body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > MAX_RATING) {
    return { error: `Choose a rating from 1 to ${MAX_RATING}.` };
  }

  const title = trim(body.title);
  if (!title) return { error: 'Please give your review a title.' };
  if (title.length > TITLE_MAX) return { error: `Titles are limited to ${TITLE_MAX} characters.` };

  const text = trim(body.body);
  if (text.length < BODY_MIN) return { error: `Please write at least ${BODY_MIN} characters.` };
  if (text.length > BODY_MAX) return { error: `Reviews are limited to ${BODY_MAX} characters.` };

  const author = trim(body.author);
  if (!author) return { error: 'Please give a name to show with your review.' };
  if (author.length > AUTHOR_MAX) return { error: `Names are limited to ${AUTHOR_MAX} characters.` };

  return { rating, title, body: text, author };
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordBlocked(db, orderId, rating, blocked) {
  return db.prepare(
    `INSERT INTO blocked_submissions (order_id, attempted_at, rating, matched)
     VALUES (?, ?, ?, ?)`
  ).bind(orderId, new Date().toISOString(), rating, blocked.join(',')).run();
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

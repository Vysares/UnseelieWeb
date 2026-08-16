/* ============================================================
   Unseelie Workshop — review submission
   Routes:  GET  /api/reviews/invite?t=<token>
            GET  /api/reviews/language
            POST /api/reviews/submit

   One token per purchased item, so a link identifies exactly what is
   being reviewed and the page never has to ask. An order with three
   pieces gets three links in its email.

   The token stays usable until it expires rather than being burnt on
   use; UNIQUE on reviews.order_item_id is what allows only one review.

   Nothing here publishes anything. Every accepted review lands as
   'pending' for moderation.
   ============================================================ */

import { hashReviewToken } from '../lib/review-token.js';
import { findBlockedWords, blockedWordList } from '../lib/language-filter.js';

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

  return Response.json({
    item: {
      type: invite.item.type,
      collection: invite.item.collection,
      size: invite.item.size,
    },
    /* Already written up is a normal end state, not a failure — the
       page says so rather than showing a form that cannot be used. */
    reviewed: invite.item.reviewed,
  });
}

/* ============================================================
   GET /api/reviews/language

   The page uses this to grey out the submit button while a flagged
   word is present, so nothing is ever sent and handed back. Served
   rather than copied into the page script so there is one list rather
   than two that drift apart.
   ============================================================ */

export function handleLanguageList() {
  return Response.json(
    { words: blockedWordList() },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
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

  if (invite.item.reviewed) {
    return jsonError('That piece has already been reviewed.', 409);
  }

  const fields = validate(body);
  if (fields.error) return jsonError(fields.error, 400);

  /* The page greys out the submit button before it comes to this, so
     reaching here means a stale word list, scripting off, or a direct
     post. Checked anyway — the browser is not a place to enforce
     anything. */
  const blocked = findBlockedWords(fields.title, fields.body, fields.author);
  if (blocked.length > 0) {
    return Response.json(
      { error: rewordMessage(blocked), blockedWords: blocked },
      { status: 422 }
    );
  }

  await env.DB.prepare(
    `INSERT INTO reviews
       (id, order_item_id, rating, title, body, author, submitted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    crypto.randomUUID(),
    invite.item.id,
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

   Resolves a token to the one item it was issued for, or to the reason
   it will not resolve. Wrong and expired are told apart deliberately:
   "this link has expired" is actionable, "not found" is not.
   ============================================================ */

async function lookupInvite(env, token) {
  if (!token || typeof token !== 'string') {
    return { error: 'This review link is missing its code.', status: 400 };
  }

  const row = await env.DB.prepare(
    `SELECT i.expires_at,
            oi.id, oi.type, oi.collection, oi.size,
            CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS reviewed
     FROM invites i
     JOIN order_items oi ON oi.id = i.order_item_id
     LEFT JOIN reviews r ON r.order_item_id = oi.id
     WHERE i.token_hash = ?`
  ).bind(await hashReviewToken(token)).first();

  if (!row) {
    return { error: 'This review link is not valid.', status: 404 };
  }

  if (row.expires_at <= new Date().toISOString()) {
    return { error: 'This review link has expired.', status: 410 };
  }

  return {
    item: {
      id: row.id,
      type: row.type,
      collection: row.collection,
      size: row.size,
      reviewed: row.reviewed === 1,
    },
  };
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

/* Same wording the page shows, so a customer who reaches the backstop
   reads what an ordinary submission would have told them. */
function rewordMessage(blocked) {
  return `We can't allow the following language to be published publicly: ${blocked.join(', ')}`;
}

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

-- ============================================================
-- Unseelie Workshop — orders, notifications, reviews
-- D1 / SQLite.  wrangler d1 migrations apply unseelie_reviews
--
-- Timestamps are ISO-8601 UTC strings ('2026-08-16T14:03:00Z').
-- SQLite has no date type, and for this format lexical order matches
-- chronological order, so comparisons and sorts work directly.
--
-- Two upstreams, cleanly divided:
--   Stripe   — what was bought, by whom.  Creates orders.
--   EasyPost — where the parcel is.       Only ever updates state.
-- EasyPost Trackers carry no product data (no SKUs, no quantities, and
-- no customs_items on domestic US shipments), which is why Stripe owns
-- order contents and EasyPost is never a source of order records.
-- ============================================================


-- ============================================================
-- Webhook receipts
--
-- Every inbound webhook is recorded before it is acted on. INSERT OR
-- IGNORE on (provider, event_id) makes redelivery a no-op: if the
-- insert reports no change, the event was already handled.
--
-- handled/handler_error exist so a webhook that cannot be applied —
-- an unknown tracking code, a price id absent from the catalog — stays
-- visible in the admin instead of vanishing into a log line.
-- ============================================================

CREATE TABLE webhook_events (
  provider      TEXT NOT NULL,        -- 'stripe' | 'easypost'
  event_id      TEXT NOT NULL,        -- the provider's own event id
  event_type    TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  payload       TEXT NOT NULL,        -- raw JSON, kept for debugging
  handled       INTEGER NOT NULL DEFAULT 0,
  handler_error TEXT,
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX idx_webhook_unhandled ON webhook_events (received_at) WHERE handled = 0;


-- ============================================================
-- Orders
--
-- Created by the Stripe checkout.session.completed webhook, so the
-- order exists from the moment of payment and order_confirmed mail can
-- go out immediately.
--
-- tracking_code is the join to EasyPost. It is set when the label is
-- bought — pasted in the admin today, or written directly if labels
-- are ever purchased through the EasyPost API. Matching inbound
-- trackers on this column avoids depending on EasyPost's shipment
-- `reference` field, which is only populated if whoever buys the label
-- remembers to fill it in.
--
-- delivered_at is t0 for the review clock and is never inferred. An
-- order that ships and never reports delivery surfaces in the admin
-- attention list rather than quietly aging into an email.
-- ============================================================

CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  stripe_session_id  TEXT NOT NULL UNIQUE,
  email              TEXT NOT NULL,
  customer_name      TEXT,
  placed_at          TEXT NOT NULL,
  tracking_code      TEXT UNIQUE,
  easypost_tracker_id TEXT,
  shipped_at         TEXT,
  delivered_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_orders_email       ON orders (email);
CREATE INDEX idx_orders_undelivered ON orders (shipped_at) WHERE delivered_at IS NULL;


-- ============================================================
-- Order items
--
-- stripe_price_id is what Stripe actually reported and is always
-- recorded. type/collection/size are the resolution of that price id
-- through data/products.json, and are null when it does not resolve —
-- a retired price, or a webhook retried after a catalog edit.
--
-- Null rather than a guess, and null rather than dropping the line:
-- the order stays complete, the unresolved item shows up in the admin,
-- and it can be mapped by hand. Reviews may only attach to a resolved
-- item; that is enforced in the submit handler, not here.
--
-- Once resolved, these columns are a snapshot. Later catalog edits do
-- not rewrite history.
--
-- qty is informational — a line is one reviewable item regardless.
-- ============================================================

CREATE TABLE order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  stripe_price_id TEXT NOT NULL,
  type            TEXT,               -- 'wrist-cuffs'
  collection      TEXT,               -- 'classic'
  size            TEXT,
  qty             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_order_items_order      ON order_items (order_id);
CREATE INDEX idx_order_items_unresolved ON order_items (order_id) WHERE type IS NULL;


-- ============================================================
-- Outbox
--
-- Every email the system intends to send, before it is sent. Webhook
-- handlers enqueue; the scheduled Worker drains.
--
-- UNIQUE(order_id, kind) is the safety rail: a redelivered webhook
-- cannot produce a second copy of the same notification.
--
-- Transactional vs marketing is not stored. It is a property of the
-- kind, mapped in the mailer, and only marketing sends consult
-- suppressions.
--
-- Exception states from EasyPost (return_to_sender, failure, error)
-- deliberately enqueue nothing. Those need a person, not a template.
-- ============================================================

CREATE TABLE outbox (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  kind          TEXT NOT NULL
                CHECK (kind IN ('order_confirmed','shipped','delivered','review_nudge')),
  scheduled_for TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (state IN ('scheduled','sent','skipped','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  sent_at       TEXT,
  skip_reason   TEXT,                 -- 'already_reviewed' | 'suppressed'
  UNIQUE (order_id, kind)
);

-- The drain query: due, not yet resolved, oldest first.
CREATE INDEX idx_outbox_due ON outbox (scheduled_for) WHERE state = 'scheduled';


-- ============================================================
-- Suppressions
--
-- Keyed by email, not by order, so an unsubscribe persists across a
-- repeat customer's future orders. Consulted only for marketing-class
-- mail: order_confirmed, shipped, and delivered are transactional and
-- are sent regardless.
-- ============================================================

CREATE TABLE suppressions (
  email         TEXT PRIMARY KEY,
  suppressed_at TEXT NOT NULL,
  source        TEXT NOT NULL         -- 'unsubscribe' | 'bounce' | 'complaint' | 'manual'
);


-- ============================================================
-- Review invites
--
-- One token per order, carried by both the delivery email and the
-- 7-day nudge. Only the SHA-256 of the token is stored, so a database
-- leak does not yield working review links.
--
-- Deliberately not single-use: a customer may review one item now and
-- another later. "Already reviewed" is derived from the reviews table,
-- not tracked here.
-- ============================================================

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL UNIQUE REFERENCES orders(id),
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);


-- ============================================================
-- Reviews
--
-- UNIQUE(order_item_id) plus invite-gated submission means "verified
-- purchase" is a structural property of every row rather than a flag
-- anyone can set, and caps submissions at one per item purchased.
-- ============================================================

CREATE TABLE reviews (
  id            TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  author        TEXT NOT NULL,        -- display name as the customer entered it
  submitted_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','published','rejected'))
);

-- Moderation queue: oldest pending first. No index on rating, by design.
CREATE INDEX idx_reviews_pending ON reviews (submitted_at) WHERE status = 'pending';


-- ============================================================
-- Blocked submissions
--
-- The language filter stops a review before it is ever stored, which
-- would otherwise be a rejection that leaves no trace — the same
-- invisible suppression the moderation log exists to prevent, moved
-- one step earlier.
--
-- The attempted rating is the point of this table. If blocks turn out
-- to skew toward one-star reviews, the filter is suppressing criticism
-- regardless of what the word list claims to be for.
--
-- The text itself is deliberately not kept: the rating and the matched
-- words answer the question, and the customer is invited to edit and
-- resubmit rather than having the attempt held against them.
-- ============================================================

CREATE TABLE blocked_submissions (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  rating       INTEGER NOT NULL,
  matched      TEXT NOT NULL       -- comma-separated, as matched
);


-- ============================================================
-- Moderation log
--
-- Append-only. No UPDATE, no DELETE, ever.
--
-- rating_at_decision is denormalized so the fairness audit never
-- depends on joining a table that might later change. review_snapshot
-- preserves what was actually decided on, so that if a customer
-- invokes a deletion right and reviews is scrubbed, the record of what
-- was rejected and why survives independently.
--
-- actor is the email from the verified Cloudflare Access JWT. It is
-- never taken from client input.
-- ============================================================

CREATE TABLE moderation_log (
  seq                INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id          TEXT NOT NULL,
  decided_at         TEXT NOT NULL,
  actor              TEXT NOT NULL,
  action             TEXT NOT NULL
                     CHECK (action IN ('published','rejected','unpublished','internal_note')),
  reason_code        TEXT,            -- required when action = 'rejected'
  reason_note        TEXT,
  rating_at_decision INTEGER NOT NULL,
  review_snapshot    TEXT NOT NULL,   -- full review JSON as it read at decision time

  CHECK (action <> 'rejected' OR reason_code IS NOT NULL)
);

CREATE INDEX idx_modlog_review ON moderation_log (review_id);

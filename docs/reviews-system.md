# Reviews & Notifications — Architecture Notes

Status: schema, both webhooks, the mailer, and review submission are built and
deployed to the Worker in test mode. The admin surface is not built.

Schema lives in `db/migrations/0001_init.sql`; rationale for the non-obvious parts is
in the comments there rather than duplicated here.

## Decisions

| | |
|---|---|
| Order source | Stripe `checkout.session.completed` |
| Shipping | EasyPost — state transitions only, never order records |
| Stripe ↔ EasyPost join | `orders.tracking_code` |
| Review clock t0 | `delivered_at`, never inferred |
| Nudge delay | t0 + 7 days |
| Incentive for reviewing | None |
| Admin surface | Stripe App, embedded in the Stripe Dashboard |
| Moderation log retention | Indefinite |

## Two upstreams

**Stripe owns what was bought.** EasyPost Trackers carry only carrier and parcel
data — `tracking_code`, `status`, `tracking_details[]`, `shipment_id`. No SKUs, no
quantities, and no `customs_items` on domestic US shipments, which is the only place
EasyPost holds item descriptions at all. So EasyPost can never create an order; it
only ever moves one forward.

**The join is `tracking_code`,** set when the label is bought — pasted in the admin
today, written directly if labels ever move to the EasyPost API. Matching inbound
trackers on that column avoids depending on EasyPost's shipment `reference` field,
which is only populated if whoever buys the label remembers to fill it in.

**Line items resolve through `data/products.json`,** which already maps
`stripePriceId` → type/collection/size. The raw `stripe_price_id` is always stored;
the resolution is a snapshot taken at webhook time, so later catalog edits never
rewrite history. A price id that does not resolve — retired price, webhook retried
after a catalog edit — leaves those columns null and surfaces in the admin. The order
stays complete and nothing is silently dropped.

## Blocker before launch

`data/reviews.json` holds eight fabricated reviews with invented names and
`"verified": true`. Test fixtures for the renderer. Delete the file at cutover — do
not seed them into D1. Publishing them is what 16 CFR §465.2 exists to prohibit.

## The principle this design encodes

The FTC rule does not ban moderation. It bans *sentiment-based* moderation, and it
bans presenting a filtered subset as though it were the whole.

Rejecting for obscenity or off-topic content is fine, provided the same standard hits
1-star and 5-star alike. So the log is not there because rejections are suspicious —
it is there to make evenhandedness provable statistically. If 1-star rejections run
30% and 5-star run 3%, reason codes will not save you.

The same logic reaches upstream, and this is the easier one to get wrong: **the ask
must be unconditional too.** Solicitation is enqueued automatically by the delivered
webhook. There is deliberately no "skip the review request for this customer" button.
Hand-picking who gets asked biases the pool before moderation runs, and it is harder
to defend than a rejection because there is no record of the ask you didn't make.

## Topology

One Worker, one D1 database.

```
Worker "unseelie"
  fetch()      ── assets from ./public, matched before any code runs
               └─ src/routes/checkout.js   POST /api/checkout
                  src/routes/stripe.js     POST /api/hooks/stripe
                  src/routes/easypost.js   POST /api/hooks/easypost
                  src/routes/reviews.js    GET  /api/reviews/invite
                                           GET  /api/reviews/language
                                           POST /api/reviews/submit

  scheduled()  ── src/mailer/outbox.js drain(), every 5 minutes
                              │
                              ▼
                  D1: unseelie_reviews
```

One codebase with two entry points is the ordinary shape for this — the same split as
`web:` and `worker:` in a Procfile, or an HTTP server beside a ticker goroutine. Two
separate services is what you reach for when the background work has different
scaling, ownership, or lifecycle, which sending four email templates does not.

Only `./public` is uploaded, so `db/`, `docs/`, and `src/` are never served.

Routing is a `switch` in `src/index.js` rather than a router library. Pages' file-based
routing derived URLs from paths under `functions/`; a Worker has a single `fetch`
entry point, and at this route count the whole table should be readable at once.

Migrated from the Pages project `late-shadow-8d77`, which keeps serving on its
`.pages.dev` URL as a rollback until the custom domain is moved and it is deleted.

The mailer has no public surface at all. Cron-only, unreachable from the internet.

## Notifications

Webhook handlers never send email. They write `outbox` rows; the cron drains them.
`UNIQUE(order_id, kind)` means a redelivered webhook cannot double-send.

| Kind | Class | Trigger |
|---|---|---|
| `order_confirmed` | transactional | Stripe `checkout.session.completed` |
| `shipped` | transactional | first tracker status showing motion |
| `delivered` | transactional | tracker status `delivered` — carries the review ask |
| `review_nudge` | marketing | `delivered_at + 7d` |

**Mail is sent immediately, not on the cron.** A webhook that returns 2xx schedules a
drain through `ctx.waitUntil()`, so the response goes back to Stripe or EasyPost at
once and the sending continues after. The cron is the safety net: failed sends,
webhooks that never arrived, and nudges coming due days later.

The queue is still not optional. Its job is not scheduling — only the nudge is
actually delayed — but preventing a second copy. `tracker.updated` fires on every
carrier scan and EasyPost retries any non-2xx, so several events reporting
`delivered` is ordinary traffic. `UNIQUE(order_id, kind)` is what makes the resulting
email happen once. Sending inline with no record would mail the customer three times.

The EasyPost handler reads the tracker's *current status* and brings the order up to
date rather than reacting to a transition, so an event arriving late, twice, or out of
order lands on the same result. That also self-heals the case where a tracking code is
recorded after the carrier's first scans: the next event fills in what was missed.

Exception statuses — `return_to_sender`, `failure`, `error`, `cancelled` — enqueue
nothing and go to the attention list. Those need a person, not a template.

The 7-day nudge is enqueued when the delivered webhook lands, and **skipped at drain
time** if every item on the order already has a review. A predicate, not a
cancellation: no race between the submit handler and the cron, nothing to unwind.

Class is not a column. It is a property of the kind, mapped in the mailer, and only
marketing sends consult `suppressions`. Shipped and delivered go out regardless —
they are transactional, and offering an unsubscribe from them would be wrong.

The delivery email is a hybrid under CAN-SPAM's primary-purpose test. Keep the
subject line and lead content about delivery and the review ask below it, and it
stays transactional. The standalone nudge is commercial: unsubscribe link and
physical address required.

Cloudflare Queues is the textbook fit and is skipped on purpose — paid add-on, and a
table you can `SELECT` from beats a queue you cannot inspect. It also means the
admin's "upcoming email" view is just a query.

## Admin

`/admin/*` as static HTML plus `/api/admin/*` JSON routes. Cloudflare Access must
cover **both** — protecting only the HTML leaves the API open, since the pages are
just a client.

Routes verify the `Cf-Access-Jwt-Assertion` header rather than assuming Access is
configured. That is defense in depth, and it does double duty: the verified email
from that JWT is what becomes `moderation_log.actor`. Auth and audit are the same
mechanism.

Four screens:

- **Dashboard** — pending count, orders shipped with no delivery event, mail going
  out in the next 7 days. You should never be surprised by a customer email.
- **Queue** — see below.
- **Orders** — manual delivered override and the stuck-order attention list.
- **Audit** — the fairness table as a standing page, not a query you must remember.

The queue's compliance properties come from what it *cannot* do:

- Ordered by `submitted_at`, oldest first. **No sort or filter by rating** — the
  capability to triage negatives simply is not built.
- Rating collapsed behind a click. Sentiment leaks through prose anyway, so this is
  not airtight, but it sets the default.
- Publish is one click. **Reject requires a reason code**, submit disabled until one
  is chosen. No path to an uncoded rejection.
- Age displayed, flagged past 14 days. Pending is not a parking space; a review left
  to rot is suppression by inaction, and it is the failure mode a solo operator hits.
  Nag rather than auto-publish — auto-publish just lets spam through on a timer.

**No editing of review text.** Not typos, not trimming. Altering a consumer statement
and displaying it as theirs is its own category of problem, and an edit box is the
most dangerous control that screen could carry. The only remedy for a flawed review
is reject with a code and invite resubmission. PII redaction is the one arguable
exception and is still skipped in v1, so that "we never alter review text" stays
unqualified.

## Rejection taxonomy

| Code | Meaning |
|---|---|
| `off_topic` | Not about the product or purchase experience |
| `personal_information` | Contact details, or identifies a third party |
| `harassment_or_slurs` | Directed abuse or hate speech |
| `spam_or_promotional` | Links, competitor promotion |
| `suspected_inauthentic` | Evidence it is not from the purchaser |
| `unintelligible` | No substantive content |
| `customer_withdrew` | Customer asked for removal |

`harassment_or_slurs` needs a written scope note given the product category: a review
describing intended use of a restraint is on-topic and not obscene. Without it, the
code becomes a backdoor for taste-based rejection.

**Not grounds:** negative sentiment, low rating, mentioning a defect, complaining
about shipping. A review reporting a safety problem is escalated, never rejected.

Rejected customers are told why and may resubmit for `personal_information` and
`off_topic`. Silent rejection is what suppression looks like from outside.

## The audit query

```sql
SELECT rating_at_decision AS stars,
       SUM(action = 'published') AS published,
       SUM(action = 'rejected')  AS rejected,
       ROUND(100.0 * SUM(action = 'rejected') / COUNT(*), 1) AS reject_pct
FROM moderation_log
WHERE action IN ('published','rejected')
GROUP BY stars ORDER BY stars;
```

A reject rate that climbs as stars fall is the finding.

## Frontend consequences

`js/reviews.js` filters by type client-side (line 37) and `averageRating()` (line 77)
computes the mean from whatever array it receives. Correct only while the fetch
returns everything.

**The moment reviews paginate, the displayed average silently becomes the average of
page one** — a bug and a misrepresented aggregate at once. `/api/reviews` must return
the summary as a server-side aggregate over all published reviews of that type,
computed separately from the page of cards. The file header anticipates the endpoint
swap; it does not anticipate this.

Default sort stays newest-first with no rating filter. An optional "1 star only"
filter is fine; defaulting to anything that hides low ratings is not.

## Still to build

- **Nothing records `tracking_code` against an order yet.** Until something does, every
  EasyPost event fails to match and lands on the attention list. This is the next
  piece, and it is what the Stripe App's payment-detail view is for.
- **`/api/unsubscribe` does not exist**, and the review nudge links to it. A dead
  unsubscribe link in commercial mail is a CAN-SPAM problem, so the nudge cannot be
  switched on until it exists. Transactional mail is unaffected.
- The moderation queue and the audit view.
- The internal moderation policy. Short, cheap for a lawyer to read, and the thing
  actually worth having reviewed before launch.

## Going live

Everything below is currently in test mode. Stripe and EasyPost keep test and live
entirely separate — separate keys, separate webhook endpoints, separate signing
secrets — so none of it carries over.

**Stripe price ids change, and this is the one that bites.** A live-mode Price is a
different object with a different id, and the id carries no marker saying which mode
it belongs to. `data/products.json` currently holds test ids. Recreate the prices in
live mode and paste the new ids in, or checkout fails with "no such price" the first
time a real customer tries to buy something.

| | |
|---|---|
| `STRIPE_SECRET_KEY` | live key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | live-mode endpoint has its own signing secret |
| `EASYPOST_WEBHOOK_SECRET` | production webhook, created separately from the test one |
| `data/products.json` | live-mode price ids throughout |
| `SITE_URL` | the real domain, once it points at the Worker |
| `BUSINESS_ADDRESS` | still empty; the review nudge needs it |
| `CHECKOUT_ENABLED` | `true` in both `src/routes/checkout.js` and `public/js/cart.js` |

Also: move the custom domain off the Pages project (edit the Stripe endpoint URL in
place rather than creating a new one, so the signing secret survives), confirm
SPF/DKIM/DMARC on the sending domain, and delete the Pages project once the Worker
has been serving the domain long enough to trust.

`REVIEW_TOKEN_SECRET` is the exception — it is not mode-specific and must not be
rotated, since every review link already emailed is derived from it.

# The Reviews System, Plainly

Companion to `reviews-system.md`, which is the precise version. This one explains the
shape of it. Written assuming you know systems programming and not web deployment,
so the analogies lean embedded.

## What it does, in one paragraph

Someone buys cuffs. Stripe tells us. We email them a receipt. You buy a shipping
label and paste the tracking number in; we email them that it shipped. EasyPost tells
us when it arrives; we email them that it landed and ask for a review. If they haven't
reviewed a week later, we ask once more. Reviews land in a queue where you approve or
reject them, every decision is recorded permanently, and approved ones appear on the
product page.

## The parts, translated

| Thing | What it actually is |
|---|---|
| **Worker** | One program on Cloudflare's edge. Serves the site's files *and* runs your code |
| **Static assets** | Everything in `public/`. Matched and served before your code runs, so a stylesheet never costs you a function call |
| **`fetch()` handler** | Runs when a request matches no file. `src/index.js` looks at the URL and calls the right route |
| **`scheduled()` handler** | Same Worker, woken by a timer instead of a request |
| **Cron trigger** | The timer itself, configured in `wrangler.toml` |
| **D1** | SQLite, hosted. Real SQL, real constraints |
| **Webhook** | An inbound HTTP request from Stripe or EasyPost saying "something happened." You don't poll them; they call you |
| **ESP** | Email service provider (Resend or Postmark). Cloudflare can't send mail, so something has to |

One deployable, two entry points — requests come in the front, the timer wakes it from
the side, both share the same code and database. That's the usual arrangement for this
kind of system, and the same split as `web:` and `worker:` in a Procfile.

## The one design decision worth understanding

Webhook handlers never send email. They write a row to a table called `outbox`. The
Worker reads that table and does the sending.

This is deferred work from interrupt context, and it's the same reasoning. A webhook
is someone else's HTTP request; you have milliseconds to acknowledge it, and if you
block on a third-party API inside that window you time out. Stripe and EasyPost both
respond to a timeout by **calling again** — so the slow path doesn't just fail, it
duplicates. Same as doing I/O in an ISR and getting re-entered.

So the handler validates, writes a row, returns 200. The Worker is the main loop that
drains the queue.

Four things fall out of that:

- **Duplicate webhooks are free to ignore.** `UNIQUE(order_id, kind)` means the second
  "delivered" event can't insert a second email. The database refuses it.
- **Retries are trivial.** Email provider returns a 500, `attempts` goes up, it tries
  again next tick.
- **"Don't nudge people who already reviewed" needs no cancellation logic.** The nudge
  row sits scheduled; when its time comes, the Worker checks whether they reviewed and
  either sends or marks it `skipped`. Checking at send time means there's no race
  between someone submitting a review and the timer firing.
- **You can see the future.** Every email that will be sent is a row you can `SELECT`
  before it goes out. That's the admin's "upcoming" view.

## The life of one order

1. **Payment.** Stripe calls `/api/hooks/stripe`. We write the order and its items,
   and queue `order_confirmed`.
2. **You make a label.** In EasyPost, then paste the tracking number into the admin.
   That queues `shipped`.
3. **Carrier scans it delivered.** EasyPost calls `/api/hooks/easypost`. We match on
   tracking number, set `delivered_at`, queue `delivered` (which contains the review
   link) and queue `review_nudge` for seven days out.
4. **They review, or don't.** If they do, the nudge is skipped when its turn comes.
5. **You moderate.** Approve or reject with a reason.
6. **It publishes.** The product page reads approved reviews from the database.

Steps 1, 3, and 6 are fully automatic. Step 2 is one paste. Step 5 is your recurring
job and takes a minute.

## Why some things look paranoid

**Review links are hashed, not stored.** The token in the email is random; the
database keeps only its SHA-256. Someone who dumps the database gets hashes, not
working links. Same reason you don't store passwords.

**The moderation log is append-only — no UPDATE, no DELETE.** It's a flight recorder.
Its value comes entirely from the fact that it cannot be tidied up afterward. A log
you can edit proves nothing.

**Product details are copied onto the order, not referenced.** If you rename a
collection or retire a price next year, orders from this year still say what was
actually bought. Snapshot, not pointer.

**Nothing is inferred.** If a package never reports delivery, we don't guess a date
and mail someone who hasn't received their order. It goes on a list for you to look
at. Loud failure over quiet wrong behavior.

## The legal part, briefly

The FTC rule (effective October 2024) bans fake reviews and bans *cherry-picking*
real ones. Fines are per violation.

It does **not** ban moderation. You can reject a review for being off-topic,
obscene, containing someone's phone number, or not being from a real buyer. What you
cannot do is apply those standards more harshly to bad reviews than good ones.

Which is why the design looks the way it does:

- **Every buyer gets asked, automatically.** There's no button to skip someone.
  Choosing who to ask biases the pool before moderation even happens, and it's worse
  than a bad rejection because there's no record of the ask you didn't make.
- **Rejection requires a reason code from a fixed list.** No free-text-only rejections.
- **The queue can't sort or filter by star rating.** If you can't find the 1-stars,
  you can't quietly work through them.
- **Every decision is logged with the rating attached**, so one query answers "do you
  reject bad reviews more often than good ones?" You should run it on yourself.
- **You cannot edit review text.** Not typos. Changing what a customer said and
  presenting it as theirs is its own problem.

The uncomfortable version: the risk isn't that you'd fake a review. It's that you'd
let a harsh-but-legitimate one sit in the queue for two months because dealing with it
is unpleasant. Sitting on it is suppression by inaction, and it's the realistic
failure mode for a one-person shop. That's why the queue shows age and nags you.

## Before any of this goes live

`public/data/reviews.json` contains eight invented reviews with invented names, dates,
and "verified purchase" badges. They exist so the page renderer had something to draw
during development. **Publishing them is precisely the thing the rule prohibits** —
they must be deleted when the real system turns on, and never loaded into the
database.

## Your actual job, once it's running

- Paste a tracking number when you buy a label.
- Clear the review queue when it has something in it.
- Glance at the audit page occasionally.
- Look at the attention list when something shows up there — a package that never
  arrived, a product that didn't map, a webhook that failed.

Everything else runs without you.

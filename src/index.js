/* ============================================================
   Unseelie Workshop — Worker entry point

   One Worker serves the whole site: static files out of ./public and
   every API route below. Assets are matched before this code runs, so
   a request for a stylesheet or a page never reaches the switch — only
   paths with no file behind them do.

   Adding a route means adding a case. There is no file-based routing
   here and no router library; at this size the whole routing table
   should be readable at once.

   Two entry points, one codebase: fetch() answers requests, scheduled()
   is woken by the cron trigger in wrangler.toml. Both drain the outbox.
   ============================================================ */

import { handleCheckout } from './routes/checkout.js';
import { handleStripeWebhook } from './routes/stripe.js';
import { handleEasyPostWebhook } from './routes/easypost.js';
import { handleReviewInvite, handleReviewSubmit } from './routes/reviews.js';
import { drain } from './mailer/outbox.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    switch (`${request.method} ${url.pathname}`) {
      case 'POST /api/checkout':
        return handleCheckout(request, env);

      case 'POST /api/hooks/stripe':
        return afterWebhook(handleStripeWebhook(request, env), env, ctx);

      case 'POST /api/hooks/easypost':
        return afterWebhook(handleEasyPostWebhook(request, env), env, ctx);

      case 'GET /api/reviews/invite':
        return handleReviewInvite(request, env);

      case 'POST /api/reviews/submit':
        return handleReviewSubmit(request, env);

      default:
        return notARoute(request, env, url);
    }
  },

  /* The cron is a safety net, not the delivery path. Mail is already
     sent by the drain that follows each webhook; this catches what
     failed, what the immediate attempt never reached, and the review
     nudges that come due a week later. */
  async scheduled(event, env) {
    const summary = await drain(env);
    console.log(
      `Outbox drain: ${summary.sent} sent, ${summary.skipped} skipped, ` +
      `${summary.failed} failed, of ${summary.considered} due.`
    );
  },
};

/* A webhook that succeeded may have queued mail. Flush it now rather
   than waiting up to five minutes for the cron — the customer should
   hear that their parcel arrived while that is still news.

   waitUntil lets the 2xx go back to Stripe or EasyPost immediately and
   keeps the sending alive afterwards, which matters because both
   providers answer a slow response by delivering the event again.

   The drain runs even when nothing was queued; that costs one indexed
   select returning no rows, which is cheaper than threading a "did you
   enqueue anything" answer back through every handler. */
async function afterWebhook(responsePromise, env, ctx) {
  const response = await responsePromise;

  if (response.ok) {
    ctx.waitUntil(
      drain(env).catch(err => console.error('Post-webhook drain failed:', err))
    );
  }

  return response;
}

/* An unmatched /api path is a client error, not a missing page, so it
   answers in JSON rather than handing back the site's 404 document —
   which a webhook sender or fetch() would have to parse as HTML to
   discover it had gone wrong.

   Everything else falls through to the assets binding, which serves
   public/404.html per not_found_handling in wrangler.toml. */
function notARoute(request, env, url) {
  if (url.pathname.startsWith('/api/')) {
    return Response.json(
      { error: `No route for ${request.method} ${url.pathname}.` },
      { status: 404 }
    );
  }

  /* html_handling = "none" is what stops /shop.html redirecting to
     /shop, but it also stops "/" resolving to index.html on its own.
     The site is flat — every page is a file at the root — so the bare
     domain is the only path that needs mapping. */
  if (url.pathname === '/') {
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  }

  return env.ASSETS.fetch(request);
}

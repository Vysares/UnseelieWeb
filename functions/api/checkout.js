/* ============================================================
   Unseelie Workshop — Stripe Checkout Worker
   Cloudflare Pages Function: POST /api/checkout

   Environment variable required (set in Cloudflare Pages dashboard):
     STRIPE_SECRET_KEY  — sk_test_... or sk_live_...

   Request body (JSON):
     { items: [{ stripePriceId, qty }], successUrl, cancelUrl }

   Response (JSON):
     { url }  on success
     { error } on failure
   ============================================================ */

export async function onRequestPost(context) {
    let body;
    try {
        body = await context.request.json();
    } catch (e) {
        return jsonResponse({ error: 'Invalid request body.' }, 400);
    }

    const { items, successUrl, cancelUrl } = body;

    if (!Array.isArray(items) || !successUrl || !cancelUrl) {
        return jsonResponse({ error: 'Missing required fields.' }, 400);
    }

    const lineItems = items
        .filter(function (item) { return item.stripePriceId && item.qty > 0; })
        .map(function (item) { return { price: item.stripePriceId, quantity: item.qty }; });

    if (lineItems.length === 0) {
        return jsonResponse({ error: 'No valid items in cart.' }, 400);
    }

    const stripeBody = new URLSearchParams();
    stripeBody.append('mode', 'payment');
    stripeBody.append('success_url', successUrl);
    stripeBody.append('cancel_url', cancelUrl);
    lineItems.forEach(function (li, i) {
        stripeBody.append('line_items[' + i + '][price]',    li.price);
        stripeBody.append('line_items[' + i + '][quantity]', String(li.quantity));
    });

    let stripeResp, session;
    try {
        stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method:  'POST',
            headers: {
                'Authorization':  'Bearer ' + context.env.STRIPE_SECRET_KEY,
                'Content-Type':   'application/x-www-form-urlencoded',
            },
            body: stripeBody,
        });
        session = await stripeResp.json();
    } catch (e) {
        return jsonResponse({ error: 'Could not reach Stripe. Please try again.' }, 502);
    }

    if (!stripeResp.ok) {
        var msg = (session.error && session.error.message) || 'Stripe error.';
        return jsonResponse({ error: msg }, 502);
    }

    return jsonResponse({ url: session.url }, 200);
}

function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
        status:  status,
        headers: { 'Content-Type': 'application/json' },
    });
}

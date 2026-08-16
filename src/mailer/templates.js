/* ============================================================
   Unseelie Workshop — email templates

   One function per outbox kind, each returning { subject, text, html }.
   Both versions render from the same block list, so the copy cannot
   drift between them.

   Transactional mail (order_confirmed, shipped, delivered) carries no
   unsubscribe: the customer needs it, and offering to switch it off
   would be a disservice. The review nudge is commercial.

   The delivery notice is a hybrid — delivery information leading, the
   review ask below it — which keeps its primary purpose transactional.
   Do not let the review ask climb above the delivery news.
   ============================================================ */

export function renderEmail(kind, context) {
  switch (kind) {
    case 'order_confirmed': return orderConfirmed(context);
    case 'shipped':         return shipped(context);
    case 'delivered':       return delivered(context);
    case 'review_nudge':    return reviewNudge(context);
    default:
      throw new Error(`No template for outbox kind "${kind}".`);
  }
}

/* ============================================================
   Templates
   ============================================================ */

function orderConfirmed({ order, items, siteUrl }) {
  return build({
    siteUrl,
    subject: 'Your Unseelie Workshop order',
    heading: '~ Order Confirmed ~',
    body: [
      subheading('Thank you!'),
      orderNumberLine(order),
      'We are a (very) small operation; most pieces are made to order. Please allow up to 5 days for production.',
      "You'll receive an email as soon as your order ships.",
      itemList(items),
      addressBlock(order.shipping_address),
    ],
    footer: null,
  });
}

function shipped({ order, items, siteUrl }) {
  return build({
    siteUrl,
    subject: 'Your order has shipped',
    heading: "~ It's on the way ~",
    body: [
      'Your order has left the workshop.',
      orderNumberLine(order),
      shippingMethodLine(order),
      panel('Tracking Number', order.tracking_code ?? ''),
      itemList(items),
      addressBlock(order.shipping_address),
    ],
    footer: null,
  });
}

function delivered({ order, items, reviewItems, siteUrl }) {
  return build({
    siteUrl,
    subject: 'Your order has arrived',
    heading: "~ It's here! ~",
    body: [
      'Your order has arrived.',
      orderNumberLine(order),
      shippingMethodLine(order),
      panel('Tracking Number', order.tracking_code ?? ''),
      itemList(items),
      'If you have a minute, please leave us a review. It really does help our little operation grow.',
      reviewPicker(reviewItems),
    ],
    footer: null,
  });
}

function reviewNudge({ reviewItems, unsubscribeUrl, businessAddress, siteUrl }) {
  return build({
    siteUrl,
    subject: 'Leave us a review?',
    heading: 'What do you think?',
    body: [
      "Thank you again for your business. We'd love to know what you think!",
      reviewPicker(reviewItems),
    ],
    footer: { unsubscribeUrl, businessAddress },
  });
}

/* ============================================================
   Blocks
   ============================================================ */

function subheading(text) { return { subheading: text }; }

/* A shaded box with a small label above its value. Used for the
   tracking number, which is the one thing in a shipping email someone
   opens the message specifically to find.

   The label is a separate element on purpose: with the value alone on
   its own line, a double click selects the whole code. EasyPost returns
   tracking codes unspaced, so there is nothing for the selection to
   stop at — do not prettify them with spaces or grouping. */
function panel(label, value) { return { panel: { label, value } }; }

/* Sits second in the three order emails, so a customer chasing an order
   finds the same line in the same place whichever one they open. Left
   out of the review nudge, where the pieces name themselves and an
   order reference is just noise.

   Null-guarded because nothing in a template should assume a column is
   populated. */
function orderNumberLine(order) {
  return order?.order_number ? `Order number: ${order.order_number}` : null;
}

function shippingMethodLine(order) {
  return order.shipping_method ? `Shipping method: ${order.shipping_method}` : null;
}

function itemList(items) {
  if (!items || items.length === 0) return null;
  return { label: 'Items in this order:', list: items.map(describeItemFully) };
}

/* Stored as JSON so the emails can decide how it reads. Anything
   unparseable is dropped rather than printed raw at a customer. */
function addressBlock(shippingAddress) {
  if (!shippingAddress) return null;

  let address;
  try {
    address = typeof shippingAddress === 'string' ? JSON.parse(shippingAddress) : shippingAddress;
  } catch {
    return null;
  }

  const lines = [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(' '),
    address.country && address.country !== 'US' ? address.country : null,
  ].filter(Boolean);

  return lines.length === 0 ? null : { label: 'Shipping Address:', lines };
}

/* One block per piece still to be reviewed, each with its own token, so
   the page it opens already knows which item is meant.

   Within a block, five star links, each landing on that same page with
   the rating preselected and still changeable. Every star is the same
   size and colour and goes to the same place — the usual version of
   this pattern routes four and five stars to the review form and one
   through three to a private "what went wrong" page, which is review
   gating and must not creep back in by making the high end prettier. */
function reviewPicker(reviewItems) {
  if (!reviewItems || reviewItems.length === 0) return null;

  return {
    reviews: reviewItems.map(item => ({
      label: describeItemFully(item),
      url: item.url,
      stars: RATINGS.map(value => ({ value, href: `${item.url}&r=${value}` })),
    })),
  };
}

const RATINGS = [1, 2, 3, 4, 5];

/* ============================================================
   Item labels
   ============================================================ */

/* Includes the size, because two of the same piece in different sizes
   are two different things to review — anything that identifies one
   has to carry it. */
function describeItemFully(item) {
  const piece = describeItem(item);
  return item.size ? `${piece} — ${item.size}` : piece;
}

/* Falls back to the raw price id when the catalog could not resolve
   the line. An order with an unmapped item still gets its email; the
   item shows up for a human to fix rather than blocking the send. */
function describeItem(item) {
  if (!item.type) return item.stripe_price_id;

  const piece = TYPE_LABELS[item.type] ?? item.type;
  const collection = COLLECTION_LABELS[item.collection];

  return collection ? `${piece}, ${collection}` : piece;
}

const TYPE_LABELS = {
  'wrist-cuffs': 'Wrist Cuffs',
  'ankle-cuffs': 'Ankle Cuffs',
  'collars': 'Collar',
  'sets': 'Full Set',
  'accessories': 'Accessory',
};

const COLLECTION_LABELS = {
  classic: 'Classic',
  nightshade: 'Nightshade',
  regent: 'Regent',
};

/* ============================================================
   Rendering

   Blocks are plain strings, or one of: { subheading }, { panel },
   { label, list }, { label, lines }, { reviews }. Both renderers walk
   the same list, so the two versions cannot drift apart.
   ============================================================ */

function build({ siteUrl, subject, heading, body, footer }) {
  const blocks = body.filter(Boolean);

  return {
    subject,
    text: renderText(heading, blocks, footer),
    html: renderHtml(siteUrl, heading, blocks, footer),
  };
}

function renderText(heading, blocks, footer) {
  const parts = [heading, ''];

  for (const block of blocks) {
    if (typeof block === 'string') parts.push(block, '');
    else if (block.subheading) parts.push(block.subheading, '');
    else if (block.panel) parts.push(block.panel.label, block.panel.value, '');
    else if (block.list) parts.push(block.label, ...block.list.map(line => `  · ${line}`), '');
    else if (block.lines) parts.push(block.label, ...block.lines, '');
    else if (block.reviews) {
      for (const review of block.reviews) {
        parts.push(review.label);
        parts.push(...review.stars.map(star =>
          `  ${'★'.repeat(star.value)}${'☆'.repeat(RATINGS.length - star.value)}  ${star.href}`));
        parts.push('');
      }
    }
  }

  parts.push('—', 'Unseelie Workshop');

  if (footer) {
    if (footer.businessAddress) parts.push('', footer.businessAddress);
    if (footer.unsubscribeUrl) parts.push(`Unsubscribe: ${footer.unsubscribeUrl}`);
  }

  return parts.join('\n');
}

function renderHtml(siteUrl, heading, blocks, footer) {
  const parts = [];

  /* Absolute URL — a relative one has nothing to resolve against once
     the message is sitting in someone's mailbox. */
  if (siteUrl) {
    parts.push(
      `<p style="${STYLE.logoWrap}">` +
      `<img src="${escapeHtml(siteUrl)}/images/UWlogo.png" width="96" height="96" ` +
      `alt="Unseelie Workshop" style="${STYLE.logo}"></p>`
    );
  }

  parts.push(`<h1 style="${STYLE.h1}">${escapeHtml(heading)}</h1>`);

  for (const block of blocks) {
    if (typeof block === 'string') {
      parts.push(`<p style="${STYLE.paragraph}">${escapeHtml(block)}</p>`);
    } else if (block.subheading) {
      parts.push(`<h2 style="${STYLE.h2}">${escapeHtml(block.subheading)}</h2>`);
    } else if (block.panel) {
      parts.push(
        `<div style="${STYLE.panel}">` +
        `<p style="${STYLE.panelLabel}">${escapeHtml(block.panel.label)}</p>` +
        `<p style="${STYLE.panelValue}">${escapeHtml(block.panel.value)}</p></div>`
      );
    } else if (block.list) {
      const rows = block.list
        .map(line => `<li style="${STYLE.listItem}">${escapeHtml(line)}</li>`)
        .join('');
      parts.push(
        `<p style="${STYLE.addressLabel}">${escapeHtml(block.label)}</p>` +
        `<ul style="${STYLE.list}">${rows}</ul>`
      );
    } else if (block.lines) {
      const rows = block.lines.map(escapeHtml).join(`<br>`);
      parts.push(
        `<p style="${STYLE.addressLabel}">${escapeHtml(block.label)}</p>` +
        `<p style="${STYLE.address}">${rows}</p>`
      );
    } else if (block.reviews) {
      for (const review of block.reviews) {
        const row = review.stars.map(star =>
          `<a href="${escapeHtml(star.href)}" style="${STYLE.star}" ` +
          `title="${star.value} of ${RATINGS.length}">&#9734;</a>`
        ).join('');

        parts.push(
          `<p style="${STYLE.reviewLabel}">${escapeHtml(review.label)}</p>` +
          `<p style="${STYLE.starRow}">${row}</p>`
        );
      }
    }
  }

  parts.push(
    `<hr style="${STYLE.signoffRule}">` +
    `<p style="${STYLE.signoff}">Unseelie Workshop</p>`
  );

  if (footer) {
    const address = footer.businessAddress
      ? `<p style="${STYLE.fine}">${escapeHtml(footer.businessAddress)}</p>`
      : '';
    const unsubscribe = footer.unsubscribeUrl
      ? `<p style="${STYLE.fine}"><a href="${escapeHtml(footer.unsubscribeUrl)}" ` +
        `style="${STYLE.fineLink}">Unsubscribe</a></p>`
      : '';
    parts.push(`<hr style="${STYLE.divider}">${address}${unsubscribe}`);
  }

  return `<div style="${STYLE.wrapper}">${parts.join('')}</div>`;
}

/* Inline styles only — mail clients discard stylesheets.

   Helvetica/Arial rather than the site's Jost: mail clients cannot be
   relied on to load a webfont, and a recipient will not have Jost
   installed, so naming it would buy nothing but a fallback nobody
   controls. Everything inherits from the wrapper. */
const STYLE = {
  wrapper:      'max-width:560px;margin:0 auto;padding:32px 24px;font-family:Helvetica,Arial,sans-serif;color:#1e1d1c;line-height:1.6;',
  logoWrap:     'text-align:center;margin:0 0 18px;',
  logo:         'display:inline-block;width:96px;height:auto;',
  /* The one serif in the message, and the only bold. No quoted font
     names anywhere in STYLE — these are emitted into style="...", so a
     double quote would end the attribute. */
  h1:           'text-align:center;font-family:Georgia,serif;font-weight:bold;font-size:27px;letter-spacing:0.01em;margin:0 0 22px;',
  h2:           'text-align:center;font-size:18px;font-weight:normal;letter-spacing:0.01em;margin:26px 0 14px;',
  paragraph:    'font-size:15px;margin:0 0 16px;',
  panel:        'background:#f3f0e9;border:1px solid #e3ddd1;border-radius:3px;padding:15px 18px;margin:0 0 20px;text-align:center;',
  panelLabel:   'margin:0 0 5px;font-size:13px;color:#6b665e;',
  panelValue:   'margin:0;font-size:19px;letter-spacing:0.02em;',
  list:         'font-size:15px;margin:0 0 18px;padding-left:20px;',
  listItem:     'margin:0 0 4px;',
  addressLabel: 'font-size:13px;color:#6b665e;margin:18px 0 4px;',
  address:      'font-size:15px;margin:0 0 16px;',
  reviewLabel:  'text-align:center;font-size:14px;margin:22px 0 6px;color:#57534c;',
  /* Identical for all five — see reviewPicker(). */
  starRow:      'text-align:center;font-size:15px;margin:0 0 22px;',
  /* Outline glyph (&#9734;), not the filled one. Dark enough to hold up
     at outline weight against a white ground. */
  star:         'color:#4f6350;font-size:42px;line-height:1;text-decoration:none;padding:0 4px;',
  /* A short rule rather than a full-width one: it marks the end of the
     message without reading as a section break. */
  signoffRule:  'border:0;border-top:1px solid #d8d2c6;width:44px;margin:30px 0 12px;',
  signoff:      'font-size:15px;font-style:italic;margin:0;',
  divider:      'border:0;border-top:1px solid #ddd8cc;margin:24px 0;',
  fine:         'font-size:12px;color:#77726a;margin:0 0 6px;',
  fineLink:     'font-size:12px;color:#77726a;',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

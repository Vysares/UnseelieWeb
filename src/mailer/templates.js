/* ============================================================
   Unseelie Workshop — email templates

   One function per outbox kind, each returning { subject, text, html }.
   Shared chrome lives in layout() so the footer, address, and voice are
   defined once.

   Transactional mail (order_confirmed, shipped, delivered) carries no
   unsubscribe: the customer needs it, and offering to switch it off
   would be a disservice. The review nudge is commercial and carries
   both an unsubscribe link and the postal address CAN-SPAM requires.

   The delivery notice is a hybrid — delivery information leading, the
   review ask below it — which keeps its primary purpose transactional.
   Do not let the review ask climb above the delivery news.
   ============================================================ */

const NUDGE_DELAY_DAYS = 7;

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

function orderConfirmed({ order, items }) {
  const greeting = greet(order);

  return build({
    subject: 'Your Unseelie Workshop order',
    heading: 'Order received',
    body: [
      greeting,
      'Thank you — your order is confirmed and going into the queue.',
      'Every piece is made to order by hand, so allow around two weeks before it ships. You will hear from us again when it does.',
      itemList(items),
    ],
    footer: null,
  });
}

function shipped({ order, items }) {
  const tracking = order.tracking_code
    ? `Tracking number: ${order.tracking_code}`
    : null;

  return build({
    subject: 'Your Unseelie Workshop order has shipped',
    heading: 'On its way',
    body: [
      greet(order),
      'Your order has left the workshop.',
      tracking,
      itemList(items),
    ],
    footer: null,
  });
}

function delivered({ order, items, reviewUrl }) {
  return build({
    subject: 'Your Unseelie Workshop order has arrived',
    heading: 'Delivered',
    body: [
      greet(order),
      'The carrier has marked your order as delivered.',
      itemList(items),
      'Give the leather a little time — full-grain stiffens in transit and softens with wear. The care guide covers the rest.',
      divider(),
      'If you have a few minutes once you have handled it, we would be glad to hear what you think. Good or bad, it gets published as written.',
      stars(reviewUrl),
      link(reviewUrl, 'Write a review'),
    ],
    footer: null,
  });
}

function reviewNudge({ order, items, reviewUrl, unsubscribeUrl, businessAddress }) {
  return build({
    subject: 'How are your cuffs?',
    heading: 'A week in',
    body: [
      greet(order),
      `It has been about ${NUDGE_DELAY_DAYS} days since your order arrived. If you have had a chance to use it, a review would help the next person decide.`,
      itemList(items),
      'We publish reviews as written — we do not filter out the critical ones, and there is nothing on offer in exchange.',
      stars(reviewUrl),
      link(reviewUrl, 'Write a review'),
    ],
    footer: { unsubscribeUrl, businessAddress },
  });
}

/* ============================================================
   Shared pieces
   ============================================================ */

function greet(order) {
  const name = firstName(order.customer_name);
  return name ? `${name},` : 'Hello,';
}

function firstName(fullName) {
  if (!fullName) return null;
  return fullName.trim().split(/\s+/)[0];
}

function itemList(items) {
  if (!items || items.length === 0) return null;

  const lines = items.map(item => {
    const piece = describeItem(item);
    return item.size ? `${piece} — ${item.size}` : piece;
  });

  return { list: lines };
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

function divider() { return { divider: true }; }
function link(href, label) { return { href, label }; }

/* Five links, one per rating, each landing on the same page with that
   rating preselected and still changeable.

   Every star is the same size and colour and goes to the same place.
   The common version of this pattern sends four and five stars to the
   review form and one through three to a private "what went wrong"
   page; that is review gating, it is what the FTC rule prohibits, and
   it must not be reintroduced here by making the high end prettier. */
function stars(reviewUrl) {
  return { stars: MAX_RATING_LINKS.map(value => ({ value, href: `${reviewUrl}&r=${value}` })) };
}

const MAX_RATING_LINKS = [1, 2, 3, 4, 5];

/* ============================================================
   Rendering

   Blocks are plain strings, or one of three shapes: { list }, { href,
   label }, { divider }. Both the text and HTML versions walk the same
   block list, so the two can never drift apart.
   ============================================================ */

function build({ subject, heading, body, footer }) {
  const blocks = body.filter(Boolean);

  return {
    subject,
    text: renderText(heading, blocks, footer),
    html: renderHtml(heading, blocks, footer),
  };
}

function renderText(heading, blocks, footer) {
  const parts = [heading.toUpperCase(), ''];

  for (const block of blocks) {
    if (typeof block === 'string') parts.push(block, '');
    else if (block.list) parts.push(...block.list.map(line => `  · ${line}`), '');
    else if (block.stars) {
      parts.push('Rate it:');
      parts.push(...block.stars.map(star =>
        `  ${'★'.repeat(star.value)}${'☆'.repeat(5 - star.value)}  ${star.href}`));
      parts.push('');
    }
    else if (block.href) parts.push(`${block.label}: ${block.href}`, '');
    else if (block.divider) parts.push('—', '');
  }

  parts.push('Unseelie Workshop');

  if (footer) {
    parts.push('', footer.businessAddress ?? '');
    parts.push(`Unsubscribe from review requests: ${footer.unsubscribeUrl}`);
  }

  return parts.join('\n');
}

function renderHtml(heading, blocks, footer) {
  const parts = [`<h1 style="${STYLE.heading}">${escapeHtml(heading)}</h1>`];

  for (const block of blocks) {
    if (typeof block === 'string') {
      parts.push(`<p style="${STYLE.paragraph}">${escapeHtml(block)}</p>`);
    } else if (block.list) {
      const items = block.list
        .map(line => `<li style="${STYLE.listItem}">${escapeHtml(line)}</li>`)
        .join('');
      parts.push(`<ul style="${STYLE.list}">${items}</ul>`);
    } else if (block.stars) {
      const row = block.stars.map(star =>
        `<a href="${escapeHtml(star.href)}" style="${STYLE.star}" ` +
        `title="${star.value} of 5">&#9733;</a>`
      ).join('');
      parts.push(`<p style="${STYLE.starRow}">${row}</p>`);
    } else if (block.href) {
      parts.push(
        `<p style="${STYLE.paragraph}">` +
        `<a href="${escapeHtml(block.href)}" style="${STYLE.link}">${escapeHtml(block.label)}</a>` +
        `</p>`
      );
    } else if (block.divider) {
      parts.push(`<hr style="${STYLE.divider}">`);
    }
  }

  parts.push(`<p style="${STYLE.signoff}">Unseelie Workshop</p>`);

  if (footer) {
    const address = footer.businessAddress
      ? `<p style="${STYLE.fine}">${escapeHtml(footer.businessAddress)}</p>`
      : '';
    parts.push(
      `<hr style="${STYLE.divider}">${address}` +
      `<p style="${STYLE.fine}">` +
      `<a href="${escapeHtml(footer.unsubscribeUrl)}" style="${STYLE.fineLink}">` +
      `Unsubscribe from review requests</a></p>`
    );
  }

  return `<div style="${STYLE.wrapper}">${parts.join('')}</div>`;
}

/* Inline styles only — mail clients discard stylesheets. */
const STYLE = {
  wrapper:   'max-width:560px;margin:0 auto;padding:32px 24px;font-family:Georgia,serif;color:#1e1d1c;line-height:1.55;',
  heading:   'font-size:22px;font-weight:normal;letter-spacing:0.02em;margin:0 0 20px;',
  paragraph: 'font-size:15px;margin:0 0 16px;',
  list:      'font-size:15px;margin:0 0 16px;padding-left:20px;',
  listItem:  'margin:0 0 4px;',
  link:      'color:#8a7440;',
  /* Identical for all five — see stars(). */
  starRow:   'font-size:15px;margin:0 0 16px;',
  star:      'color:#c9a961;font-size:30px;text-decoration:none;padding:0 3px;',
  divider:   'border:0;border-top:1px solid #ddd8cc;margin:24px 0;',
  signoff:   'font-size:15px;margin:24px 0 0;',
  fine:      'font-size:12px;color:#77726a;margin:0 0 6px;',
  fineLink:  'font-size:12px;color:#77726a;',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

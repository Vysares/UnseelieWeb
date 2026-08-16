/* ============================================================
   Unseelie Workshop — email preview

   Renders every template to .preview/emails.html so the copy can be
   read the way a customer will see it. Run it again after editing
   templates.js; the preview is generated, never hand-edited.

     ./dev.sh emails

   Sample data only — no database, no sending.
   ============================================================ */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderEmail } from '../src/mailer/templates.js';

const OUT_DIR = '.preview';
const OUT_FILE = `${OUT_DIR}/emails.html`;

const order = {
  customer_name: 'Alex Fenwick',
  order_number: 1042,
  tracking_code: '9400100000000000000000',
  shipping_method: 'Free standard (5-7 days)',
  shipping_address: JSON.stringify({
    line1: '412 SE Morrison St', line2: 'Apt 3B',
    city: 'Portland', state: 'OR', postal_code: '97214', country: 'US',
  }),
};

const cuffs = { stripe_price_id: 'p1', type: 'wrist-cuffs', collection: 'classic', size: 'Larger' };
const collar = { stripe_price_id: 'p2', type: 'collars', collection: 'classic', size: 'S (12 - 14.5 in)' };

const link = (item, token) => ({ ...item, url: `https://unseelieworkshop.com/review.html?t=${token}` });

const base = {
  order,
  siteUrl: 'https://unseelieworkshop.com',
  unsubscribeUrl: 'https://unseelieworkshop.com/api/unsubscribe?t=a41b9c2e',
  businessAddress: 'Unseelie Workshop, 123 Example St, Portland OR 97201',
};

/* The last one exists because a second piece doubles the star block,
   which is the layout most likely to look wrong. */
const previews = [
  { kind: 'order_confirmed', note: 'Sent the moment Stripe confirms payment.',
    context: { ...base, items: [cuffs] } },

  { kind: 'shipped', note: 'Sent when the carrier first reports movement.',
    context: { ...base, items: [cuffs] } },

  { kind: 'delivered', note: 'Transactional — delivery news must stay above the review ask.',
    context: { ...base, items: [cuffs], reviewItems: [link(cuffs, '9f2c41ab')] } },

  { kind: 'review_nudge', note: 'Commercial — carries the unsubscribe and postal address.',
    context: { ...base, items: [cuffs], reviewItems: [link(cuffs, '9f2c41ab')] } },

  { kind: 'delivered', label: 'delivered — two pieces',
    note: 'Each piece gets its own token and its own row of stars.',
    context: { ...base, items: [cuffs, collar],
               reviewItems: [link(cuffs, '9f2c41ab'), link(collar, '77de03f1')] } },
];

const cards = previews.map(preview => {
  const mail = renderEmail(preview.kind, preview.context);
  const label = preview.label ?? preview.kind;

  return `
    <section class="card">
      <header class="card-head">
        <h2>${escapeHtml(label)}</h2>
        <p class="note">${escapeHtml(preview.note)}</p>
        <p class="subject"><span>Subject</span> ${escapeHtml(mail.subject)}</p>
      </header>

      <div class="tabs">
        <button class="tab is-on" data-show="html">HTML</button>
        <button class="tab" data-show="text">Plain text</button>
      </div>

      <div class="view" data-view="html"><div class="mail">${mail.html}</div></div>
      <div class="view" data-view="text" hidden><pre>${escapeHtml(mail.text)}</pre></div>
    </section>`;
}).join('');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email preview — Unseelie Workshop</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 32px 20px 80px;
    background: #edeae3; color: #23211e;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .page-head { max-width: 680px; margin: 0 auto 30px; }
  .page-head h1 { font-size: 21px; margin: 0 0 6px; font-weight: 600; }
  .page-head p { margin: 0; font-size: 13.5px; color: #6a6459; line-height: 1.6; }
  code { background: #dcd8cf; padding: 1px 5px; border-radius: 3px; font-size: 12.5px; }

  .card {
    max-width: 680px; margin: 0 auto 26px;
    background: #fff; border: 1px solid #d3cec4; border-radius: 4px; overflow: hidden;
  }
  .card-head { padding: 16px 20px 14px; border-bottom: 1px solid #e6e2da; }
  .card-head h2 { margin: 0; font-size: 14px; font-family: ui-monospace, Menlo, monospace; color: #8a7440; }
  .note { margin: 5px 0 0; font-size: 12.5px; color: #6a6459; line-height: 1.55; }
  .subject { margin: 10px 0 0; font-size: 14px; }
  .subject span {
    font-size: 10.5px; letter-spacing: 0.11em; text-transform: uppercase;
    color: #9a9287; margin-right: 8px;
  }

  .tabs { display: flex; gap: 0; border-bottom: 1px solid #e6e2da; background: #faf9f6; }
  .tab {
    font: inherit; font-size: 12px; cursor: pointer;
    background: none; border: 0; border-bottom: 2px solid transparent;
    padding: 8px 16px; color: #6a6459;
  }
  .tab:hover { color: #23211e; }
  .tab.is-on { color: #23211e; border-bottom-color: #8a7440; }

  /* Email bodies are entirely inline-styled, so they win over anything
     inherited here. This only supplies the white ground they assume. */
  .mail { background: #fff; }
  pre {
    margin: 0; padding: 22px 24px; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; line-height: 1.6; color: #3a3733;
  }
  .view { overflow-x: auto; }
</style>
</head>
<body>
  <div class="page-head">
    <h1>Email preview</h1>
    <p>Generated from <code>src/mailer/templates.js</code> with sample data. Re-run
       <code>./dev.sh emails</code> after editing copy — this file is overwritten and
       is not checked in.</p>
  </div>
  ${cards}
<script>
  document.addEventListener('click', function (event) {
    var tab = event.target.closest('.tab');
    if (!tab) return;

    var card = tab.closest('.card');
    card.querySelectorAll('.tab').forEach(function (other) {
      other.classList.toggle('is-on', other === tab);
    });
    card.querySelectorAll('.view').forEach(function (view) {
      view.hidden = view.dataset.view !== tab.dataset.show;
    });
  });
</script>
</body>
</html>
`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, page);

console.log(`Wrote ${previews.length} previews to ${OUT_FILE}`);

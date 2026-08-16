/* ============================================================
   Unseelie Workshop — Product Reviews

   Renders the reviews section on the product page. Waits for the
   `product:rendered` event from product.js so the product id is
   known and the info column exists to hang the rating link on.

   Reviews are pooled per product type, so every Wrist Cuffs review
   shows on the Wrist Cuffs page whichever collection it was bought
   in, with the collection named on the card.

   DATA SOURCE
   ───────────
   Reviews currently come from a static sample file and are filtered
   by type here in the browser. When the Cloudflare reviews database
   is live, point REVIEWS_URL at the API route and have it return
   only that type's reviews; the record shape is unchanged:

     { reviews: [ { id, type, collection, rating, title, body,
                    author, date, size, verified } ] }
   ============================================================ */

const REVIEWS_URL = 'data/reviews.json';
const MAX_RATING = 5;

/* Collection key → display label, handed over by product.js so this
   file does not need its own copy of products.json. */
let collectionLabels = {};

document.addEventListener('product:rendered', event => {
  const { productType, collections } = event.detail;
  collectionLabels = collections || {};

  fetch(REVIEWS_URL)
    .then(res => res.json())
    .then(data => {
      const reviews = data.reviews.filter(r => r.type === productType);
      renderReviews(reviews);
    })
    .catch(err => {
      console.error('Failed to load reviews:', err);
      showReviewsMessage('Unable to load reviews. Please try again later.');
    });
});

/* ============================================================
   Section renderer
   ============================================================ */

function renderReviews(reviews) {
  const section = document.getElementById('product-reviews');
  if (!section) return;

  if (reviews.length === 0) {
    section.innerHTML = `
      <h2 class="section-title">Reviews</h2>
      <p class="reviews-empty">No reviews yet for this piece.</p>
    `;
    return;
  }

  const sorted = reviews.slice().sort((a, b) => b.date.localeCompare(a.date));
  const average = averageRating(sorted);

  section.innerHTML = `
    <h2 class="section-title">Reviews</h2>
    ${buildSummary(sorted, average)}
    <ul class="reviews-list">
      ${sorted.map(buildReviewCard).join('')}
    </ul>
  `;

  addRatingLinkToProductInfo(average, sorted.length);
}

/* Average, rounded to one decimal place. */
function averageRating(reviews) {
  const total = reviews.reduce((sum, r) => sum + r.rating, 0);
  return Math.round((total / reviews.length) * 10) / 10;
}

/* ============================================================
   Summary — average, star row, and a bar per rating value
   ============================================================ */

function buildSummary(reviews, average) {
  const bars = [];
  for (let rating = MAX_RATING; rating >= 1; rating--) {
    const count = reviews.filter(r => r.rating === rating).length;
    const percent = (count / reviews.length) * 100;
    bars.push(`
      <li class="reviews-bar-row">
        <span class="reviews-bar-label">${rating}</span>
        <span class="reviews-bar-track">
          <span class="reviews-bar-fill" style="width: ${percent}%;"></span>
        </span>
        <span class="reviews-bar-count">${count}</span>
      </li>
    `);
  }

  return `
    <div class="reviews-summary">
      <div class="reviews-average">
        <span class="reviews-average-number">${average.toFixed(1)}</span>
        ${buildStars(average, 'reviews-stars-large')}
        <span class="reviews-average-count">${countLabel(reviews.length)}</span>
      </div>
      <ul class="reviews-bars">${bars.join('')}</ul>
    </div>
  `;
}

function countLabel(count) {
  return count === 1 ? '1 review' : `${count} reviews`;
}

/* ============================================================
   Review card
   ============================================================ */

function buildReviewCard(review) {
  const size = review.size
    ? `<span class="review-size">Size ${escapeHtml(review.size)}</span>`
    : '';

  const collection = collectionLabels[review.collection]
    ? `<span class="review-collection">${escapeHtml(collectionLabels[review.collection].short)}</span>`
    : '';

  const verified = review.verified
    ? '<span class="review-verified">Verified purchase</span>'
    : '';

  return `
    <li class="review-card">
      <div class="review-head">
        ${buildStars(review.rating, 'reviews-stars-small')}
        <span class="review-date">${formatDate(review.date)}</span>
      </div>
      <h3 class="review-title">${escapeHtml(review.title)}</h3>
      <p class="review-body">${escapeHtml(review.body)}</p>
      <div class="review-meta">
        <span class="review-author">${escapeHtml(review.author)}</span>
        ${size}
        ${collection}
        ${verified}
      </div>
    </li>
  `;
}

/* ============================================================
   Stars

   Two stacked rows of the same glyphs: a dim row underneath and a
   gold row on top, clipped to the fraction of the rating earned.
   That gives half stars without a second glyph set.
   ============================================================ */

function buildStars(rating, sizeClass) {
  const glyphs = '★'.repeat(MAX_RATING);
  const percent = (rating / MAX_RATING) * 100;

  return `
    <span class="reviews-stars ${sizeClass}" role="img"
          aria-label="${rating} out of ${MAX_RATING} stars">
      <span class="reviews-stars-empty" aria-hidden="true">${glyphs}</span>
      <span class="reviews-stars-fill" aria-hidden="true" style="width: ${percent}%;">${glyphs}</span>
    </span>
  `;
}

/* ============================================================
   Rating link in the product info column
   ============================================================ */

function addRatingLinkToProductInfo(average, count) {
  const price = document.querySelector('.product-price');
  if (!price) return;

  price.insertAdjacentHTML('beforebegin', `
    <a href="#product-reviews" class="product-rating-link">
      ${buildStars(average, 'reviews-stars-small')}
      <span class="product-rating-count">${countLabel(count)}</span>
    </a>
  `);
}

/* ============================================================
   Utility
   ============================================================ */

/* "2026-06-18" → "June 18, 2026". Split rather than parsed as a Date
   so the day never shifts with the reader's time zone. */
function formatDate(isoDate) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const [year, month, day] = isoDate.split('-');
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/* Review text is written by customers, so it never reaches innerHTML raw. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showReviewsMessage(msg) {
  const section = document.getElementById('product-reviews');
  if (!section) return;
  section.innerHTML = `
    <h2 class="section-title">Reviews</h2>
    <p class="reviews-empty">${msg}</p>
  `;
}

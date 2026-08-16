/* ============================================================
   Unseelie Workshop — Collection Page Rendering
   Reads data-collection attribute from <body> to know which
   collection's products to render into .products-grid.
   Product data lives in products.json — edit only that file.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const collectionKey = document.body.dataset.collection;
  if (!collectionKey) {
    console.error('collection.js: <body> is missing a data-collection attribute.');
    return;
  }

  fetch('data/products.json')
    .then(res => res.json())
    .then(data => renderCollection(collectionKey, data))
    .catch(err => {
      console.error('Failed to load data/products.json:', err);
      const grid = document.querySelector('.products-grid');
      if (grid) {
        grid.innerHTML = '<p style="color:var(--gold);text-align:center;padding:2rem;grid-column:1/-1;">Unable to load products. Please try again later.</p>';
      }
    });
});

function renderCollection(collectionKey, data) {
  const { products, collections } = data;
  const col = collections[collectionKey];
  const grid = document.querySelector('.products-grid');

  if (!grid || !col) return;

  // Clear any hardcoded placeholder cards
  grid.innerHTML = '';

  /* A product is one type made in one or more collections; this page
     shows the ones made in its own collection. */
  const collectionProducts = products.filter(p => p.collections[collectionKey]);

  collectionProducts.forEach(product => {
    const variant = product.collections[collectionKey];

    /* Same card as the shop grid — see .shop-card in shared.css */
    const card = document.createElement('a');
    card.className = 'shop-card';
    card.href = `product.html?type=${encodeURIComponent(product.type)}&collection=${encodeURIComponent(collectionKey)}`;

    const firstImage = variant.images && variant.images.length
      ? variant.images[0]
      : null;

    const imageHTML = firstImage
      ? `<img src="${firstImage}" alt="${product.name}" class="shop-card-img" loading="lazy">`
      : `<div class="shop-card-placeholder" style="background: linear-gradient(135deg, ${col.gradientFrom}, ${col.gradientTo});"></div>`;

    card.innerHTML = `
      <div class="shop-card-image">
        ${imageHTML}
        <div class="shop-card-glow"></div>
      </div>
      <div class="shop-card-body">
        <span class="shop-card-tag" style="--tag-color: ${col.accent};">${col.label}</span>
        <h3 class="shop-card-name">${product.name}</h3>
        <p class="shop-card-price">${variant.price}</p>
      </div>
    `;

    grid.appendChild(card);
  });
}

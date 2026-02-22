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

  const collectionProducts = products.filter(p => p.collection === collectionKey);

  collectionProducts.forEach(product => {
    const card = document.createElement('a');
    card.className = 'product-card';
    card.href = `product.html?id=${product.id}`;

    const firstImage = product.images && product.images.length
      ? product.images[0]
      : null;

    const imageHTML = firstImage
      ? `<img src="${firstImage}" alt="${product.name}" class="product-card-img" loading="lazy">`
      : `<div class="product-card-placeholder" style="background: linear-gradient(135deg, ${col.gradientFrom}, ${col.gradientTo});"></div>`;

    card.innerHTML = `
      <div class="product-image">${imageHTML}</div>
      <div class="product-content">
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <p class="product-price">${product.price}</p>
      </div>
    `;

    grid.appendChild(card);
  });
}

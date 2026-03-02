/* ============================================================
   Unseelie Workshop — Shop Rendering & Filter Logic
   Product data lives in data/products.json.
   To add/edit/remove products, only edit that file.
   ============================================================ */

/* ============================================================
   Card builder
   ============================================================ */

function buildCard(product, collections) {
  const col = collections[product.collection];
  const card = document.createElement('a');
  card.className = 'shop-card';
  card.href = `product.html?id=${product.id}`;
  card.dataset.collection = product.collection;
  card.dataset.type = product.type;

  const firstImage = product.images && product.images.length
    ? product.images[0]
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
      <p class="shop-card-price">${product.price}</p>
    </div>
  `;
  return card;
}

/* ============================================================
   Filter pill builder
   ============================================================ */

function buildFilterBar(collections, types, onFilter) {
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = '';

  // ---- Row 1: type filters ----
  const typeRow = document.createElement('div');
  typeRow.className = 'filter-row';

  const typeLabel = document.createElement('span');
  typeLabel.className = 'filter-row-label';
  typeLabel.textContent = 'Type';
  typeRow.appendChild(typeLabel);

  const typePills = document.createElement('div');
  typePills.className = 'filter-row-pills';
  typePills.appendChild(makePill('All', 'all', true));
  Object.entries(types).forEach(([key, type]) => {
    typePills.appendChild(makePill(type.label, `type:${key}`, false));
  });
  typeRow.appendChild(typePills);

  bar.appendChild(typeRow);

  // ---- Row 2: collection filters ----
  const colRow = document.createElement('div');
  colRow.className = 'filter-row';

  const colLabel = document.createElement('span');
  colLabel.className = 'filter-row-label';
  colLabel.textContent = 'Collection';
  colRow.appendChild(colLabel);

  const colPills = document.createElement('div');
  colPills.className = 'filter-row-pills';
  Object.entries(collections).forEach(([key, col]) => {
    const shortLabel = col.label.replace(/^The /, '');
    colPills.appendChild(makePill(shortLabel, `collection:${key}`, false));
  });
  colRow.appendChild(colPills);

  bar.appendChild(colRow);

  // Wire up clicks — active state spans both rows
  bar.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      bar.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      onFilter(pill.dataset.filter);
    });
  });
}

function makePill(label, filterValue, active) {
  const btn = document.createElement('button');
  btn.className = 'filter-pill' + (active ? ' active' : '');
  btn.dataset.filter = filterValue;
  btn.textContent = label;
  return btn;
}

function makeDivider() {
  const d = document.createElement('span');
  d.className = 'filter-divider';
  return d;
}

/* ============================================================
   Filter logic
   ============================================================ */

function applyFilter(filterValue, allCards) {
  allCards.forEach(card => {
    let visible = false;
    if (filterValue === 'all') {
      visible = true;
    } else if (filterValue.startsWith('type:')) {
      visible = card.dataset.type === filterValue.slice(5);
    } else if (filterValue.startsWith('collection:')) {
      visible = card.dataset.collection === filterValue.slice(11);
    }
    card.classList.toggle('hidden', !visible);
  });

  const grid = document.getElementById('shop-grid');
  const existing = grid.querySelector('.shop-empty');
  const anyVisible = allCards.some(c => !c.classList.contains('hidden'));
  if (!anyVisible && !existing) {
    const empty = document.createElement('p');
    empty.className = 'shop-empty';
    empty.textContent = 'No products here\u2026yet.';
    grid.appendChild(empty);
  } else if (anyVisible && existing) {
    existing.remove();
  }
}

/* ============================================================
   Render all cards into the grid (once on load)
   ============================================================ */

function renderAllCards(products, collections) {
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  const cards = products.map(p => buildCard(p, collections));
  cards.forEach((c, i) => {
    // Stagger up to 6 cards, then hold steady so late cards don't wait too long
    const delay = Math.min(i, 5) * 0.08 + 0.2;
    c.style.animationDelay = `${delay}s`;
    grid.appendChild(c);
  });
  return cards;
}

/* ============================================================
   Init
   ============================================================ */

function initShop(data) {
  const { products, collections, types } = data;

  const allCards = renderAllCards(products, collections);

  buildFilterBar(collections, types, filterValue => {
    applyFilter(filterValue, allCards);
    history.replaceState(null, '', `#${filterValue}`);
  });

  // Honour URL hash on load (e.g. #type:cuffs or #collection:vampiric)
  const hash = window.location.hash.slice(1);
  if (hash) {
    const matchingPill = document.querySelector(`.filter-pill[data-filter="${hash}"]`);
    if (matchingPill) matchingPill.click();
  }
}

/* ============================================================
   Bootstrap
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  fetch('data/products.json')
    .then(res => res.json())
    .then(data => initShop(data))
    .catch(err => {
      console.error('Failed to load data/products.json:', err);
      const grid = document.getElementById('shop-grid');
      if (grid) {
        grid.innerHTML = '<p style="color:var(--gold);text-align:center;padding:2rem;grid-column:1/-1;">Unable to load products. Please try again later.</p>';
      }
    });
});

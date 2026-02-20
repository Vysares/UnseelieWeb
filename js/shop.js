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

  card.innerHTML = `
    <div class="shop-card-image" style="background: linear-gradient(135deg, ${col.gradientFrom}, ${col.gradientTo});">
      <span class="shop-card-icon">${product.icon}</span>
      <div class="shop-card-glow"></div>
    </div>
    <div class="shop-card-body">
      <span class="shop-card-tag" style="color: ${col.accent};">${col.label}</span>
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

  // "All" pill
  bar.appendChild(makePill('All', 'all', true));

  // Divider
  bar.appendChild(makeDivider());

  // Type pills
  Object.entries(types).forEach(([key, type]) => {
    bar.appendChild(makePill(type.label, `type:${key}`, false));
  });

  // Divider
  bar.appendChild(makeDivider());

  // Collection pills — strip "The " prefix for brevity
  Object.entries(collections).forEach(([key, col]) => {
    const shortLabel = col.label.replace(/^The /, '');
    bar.appendChild(makePill(shortLabel, `collection:${key}`, false));
  });

  // Wire up clicks
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

  // Update count
  const visibleCount = allCards.filter(c => !c.classList.contains('hidden')).length;
  const countEl = document.getElementById('filter-count');
  if (countEl) {
    countEl.textContent = `${visibleCount} piece${visibleCount !== 1 ? 's' : ''}`;
  }
}

/* ============================================================
   Render all cards into the grid (once on load)
   ============================================================ */

function renderAllCards(products, collections) {
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  const cards = products.map(p => buildCard(p, collections));
  cards.forEach(c => grid.appendChild(c));
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

  // Set initial count
  const countEl = document.getElementById('filter-count');
  if (countEl) countEl.textContent = `${products.length} pieces`;

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

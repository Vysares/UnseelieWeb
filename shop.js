/* ============================================================
   Unseelie Workshop — Shop Data & Rendering
   To add/edit/remove products, only edit the PRODUCTS array.
   ============================================================ */

const COLLECTIONS = {
  vampiric: {
    label: 'The Vampiric Set',
    accent: '#8b1a1a',
    gradientFrom: '#1a1a1a',
    gradientTo: '#8b1a1a',
    href: 'vampiric.html',
  },
  nightshade: {
    label: 'The Nightshade Set',
    accent: '#c0c0c0',
    gradientFrom: '#1a2851',
    gradientTo: '#5a3d66',
    href: 'nightshade.html',
  },
  consort: {
    label: 'The Consort Set',
    accent: '#2d7a7e',
    gradientFrom: '#8b5a3c',
    gradientTo: '#2d7a7e',
    href: 'consort.html',
  },
};

const TYPES = {
  cuffs:    { label: 'Cuffs' },
  collars:  { label: 'Collars' },
  leashes:  { label: 'Leashes & Leads' },
  harnesses:{ label: 'Harnesses' },
};

/* ---- Edit this array to manage all products ---- */
const PRODUCTS = [
  {
    name: 'Wrist Cuffs',
    collection: 'vampiric',
    type: 'cuffs',
    icon: '🗝',
    price: 'From $120',
    description: 'Hand-stitched restraints with reinforced D-rings and adjustable buckles. Lined with crimson suede for comfort during extended wear.',
  },
  {
    name: 'Ankle Cuffs',
    collection: 'vampiric',
    type: 'cuffs',
    icon: '🗝',
    price: 'From $130',
    description: 'Matching ankle restraints with the same attention to detail. Lace accents add gothic elegance to these functional pieces.',
  },
  {
    name: 'Day Collar',
    collection: 'vampiric',
    type: 'collars',
    icon: '🗝',
    price: 'From $95',
    description: 'Elegant enough for everyday wear, meaningful enough to matter. Delicate lace trim makes this piece uniquely romantic.',
  },
  {
    name: 'Statement Collar',
    collection: 'vampiric',
    type: 'collars',
    icon: '🗝',
    price: 'From $145',
    description: 'Bold and commanding. Wider band with dramatic hardware and intricate lace details. A true showpiece.',
  },
  {
    name: 'Leash',
    collection: 'vampiric',
    type: 'leashes',
    icon: '🗝',
    price: 'From $85',
    description: '6-foot leather lead with nickel-plated hardware. Beautifully weighted and finished with lace detail at the handle.',
  },
  {
    name: 'Wrist Cuffs',
    collection: 'nightshade',
    type: 'cuffs',
    icon: '✶',
    price: 'From $120',
    description: 'Deep navy leather with violet suede lining and silver contrast stitching. D-rings polished to a moonlit shine.',
  },
  {
    name: 'Ankle Cuffs',
    collection: 'nightshade',
    type: 'cuffs',
    icon: '✶',
    price: 'From $130',
    description: 'Matching ankle pieces tracing constellations in silver thread. Secure, elegant, and unmistakably celestial.',
  },
  {
    name: 'Day Collar',
    collection: 'nightshade',
    type: 'collars',
    icon: '✶',
    price: 'From $95',
    description: 'A slim band of midnight navy, subtle enough for daily wear. Silver stitching catches the light like starlight.',
  },
  {
    name: 'Statement Collar',
    collection: 'nightshade',
    type: 'collars',
    icon: '✶',
    price: 'From $145',
    description: 'Wider band with celestial embossing and polished silver hardware. Where ritual meets adornment.',
  },
  {
    name: 'Leash',
    collection: 'nightshade',
    type: 'leashes',
    icon: '✶',
    price: 'From $85',
    description: '6-foot lead in deep navy with nickel hardware. Silver-stitched handle makes it as beautiful to hold as to wear.',
  },
  {
    name: 'Wrist Cuffs',
    collection: 'consort',
    type: 'cuffs',
    icon: '♛',
    price: 'From $120',
    description: 'Warm cognac leather with turquoise suede lining. Cross-laced detailing and brass hardware give a regal, heirloom quality.',
  },
  {
    name: 'Ankle Cuffs',
    collection: 'consort',
    type: 'cuffs',
    icon: '♛',
    price: 'From $130',
    description: 'Matching ankle restraints in cognac and turquoise. The unexpected colour pairing feels both luxurious and playful.',
  },
  {
    name: 'Day Collar',
    collection: 'consort',
    type: 'collars',
    icon: '♛',
    price: 'From $95',
    description: 'A refined daily collar in cognac leather. Brass hardware and subtle cross-lacing elevate it to quiet jewellery.',
  },
  {
    name: 'Statement Collar',
    collection: 'consort',
    type: 'collars',
    icon: '♛',
    price: 'From $145',
    description: 'Wider band with full cross-laced detailing and polished brass fittings. Fit for royalty — because you are.',
  },
  {
    name: 'Leash',
    collection: 'consort',
    type: 'leashes',
    icon: '♛',
    price: 'From $85',
    description: '6-foot cognac leather lead with brass hardware. Cross-laced handle makes this as elegant to give as to receive.',
  },
];

/* ============================================================
   Rendering
   ============================================================ */

function buildCard(product) {
  const col = COLLECTIONS[product.collection];
  const card = document.createElement('div');
  card.className = 'shop-card';
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
      <p class="shop-card-desc">${product.description}</p>
      <p class="shop-card-price">${product.price}</p>
      <a href="${col.href}" class="shop-card-link">View Collection →</a>
    </div>
  `;
  return card;
}

function buildGroup(label, products) {
  const section = document.createElement('div');
  section.className = 'shop-group';

  const heading = document.createElement('h2');
  heading.className = 'shop-group-title';
  heading.textContent = label;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'shop-grid';
  products.forEach(p => grid.appendChild(buildCard(p)));
  section.appendChild(grid);

  return section;
}

function renderByCollection() {
  const container = document.getElementById('shop-output');
  container.innerHTML = '';
  Object.entries(COLLECTIONS).forEach(([key, col]) => {
    const group = PRODUCTS.filter(p => p.collection === key);
    if (group.length) container.appendChild(buildGroup(col.label, group));
  });
}

function renderByType() {
  const container = document.getElementById('shop-output');
  container.innerHTML = '';
  Object.entries(TYPES).forEach(([key, type]) => {
    const group = PRODUCTS.filter(p => p.type === key);
    if (group.length) container.appendChild(buildGroup(type.label, group));
  });
}

/* ============================================================
   Toggle logic
   ============================================================ */

function initShop() {
  const btnCollection = document.getElementById('btn-by-collection');
  const btnType = document.getElementById('btn-by-type');

  // Check for a hash in the URL so links can deep-link to a view
  const startView = window.location.hash === '#by-type' ? 'type' : 'collection';

  function setView(view) {
    if (view === 'collection') {
      renderByCollection();
      btnCollection.classList.add('active');
      btnType.classList.remove('active');
      history.replaceState(null, '', '#by-collection');
    } else {
      renderByType();
      btnType.classList.add('active');
      btnCollection.classList.remove('active');
      history.replaceState(null, '', '#by-type');
    }
  }

  btnCollection.addEventListener('click', () => setView('collection'));
  btnType.addEventListener('click', () => setView('type'));

  setView(startView);
}

document.addEventListener('DOMContentLoaded', initShop);

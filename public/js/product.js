/* ============================================================
   Unseelie Workshop — Product Page

   One page per product type. The collection and the size are both
   variants chosen on the page itself:

     product.html?type=wrist-cuffs&collection=classic

   Collections a type is not made in yet still appear in the selector,
   dimmed and unselectable, so the full range stays visible.

   The page skeleton is built once; switching collection only swaps the
   parts that actually differ (gallery, sizes, tag, breadcrumb, URL).
   That keeps event listeners from stacking up on repeated switches,
   and leaves the reviews rating link injected by reviews.js intact.
   ============================================================ */

let catalog = null;        /* the whole products.json */
let product = null;        /* the type entry being shown */
let collectionKey = null;  /* currently selected collection */
let galleryImages = [];
let galleryIndex = 0;
let selectedSize = null;

document.addEventListener('DOMContentLoaded', () => {
  fetch('data/products.json')
    .then(res => res.json())
    .then(data => {
      catalog = data;
      const target = resolveTarget(new URLSearchParams(window.location.search), data);
      if (target.error) {
        showError(target.error);
        return;
      }
      product = target.product;
      renderSkeleton();
      selectCollection(target.collectionKey);
      renderMaterials(data.materials);

      /* reviews.js pools reviews by type; it also gets the collections
         map so it can name the collection on each review card. */
      document.dispatchEvent(new CustomEvent('product:rendered', {
        detail: { productType: product.type, collections: catalog.collections }
      }));
    })
    .catch(err => {
      console.error('Failed to load data/products.json:', err);
      showError('Unable to load product. Please try again later.');
    });
});

/* ============================================================
   Which product, and which collection

   Accepts the current ?type=&collection= form, and maps the older
   ?id=classic-wrist-cuffs links through catalog.legacyIds so shared
   links and saved carts keep resolving. Drop legacyIds from
   products.json once those links are considered dead.
   ============================================================ */

function resolveTarget(params, data) {
  let typeKey = params.get('type');
  let wantedCollection = params.get('collection');

  const legacyId = params.get('id');
  if (!typeKey && legacyId) {
    const mapped = data.legacyIds && data.legacyIds[legacyId];
    if (!mapped) return { error: 'Product not found.' };
    typeKey = mapped.type;
    wantedCollection = wantedCollection || mapped.collection;
  }

  if (!typeKey) return { error: 'No product specified.' };

  const found = data.products.find(p => p.type === typeKey);
  if (!found) return { error: 'Product not found.' };

  const available = Object.keys(found.collections);
  if (available.length === 0) {
    return { error: 'This piece is not available yet.' };
  }

  /* An unknown or not-yet-made collection falls back to the first one
     actually available rather than erroring out. */
  const key = available.includes(wantedCollection) ? wantedCollection : available[0];

  return { product: found, collectionKey: key };
}

/* ============================================================
   Skeleton — everything that does not change with collection
   ============================================================ */

function renderSkeleton() {
  const detailsHTML = product.details && product.details.length
    ? `<ul class="product-details">
        <p class="product-details-label">Details</p>
        ${product.details.map(d => `<li>${d}</li>`).join('')}
       </ul>`
    : '';

  document.getElementById('product-layout').innerHTML = `
    <div class="product-gallery" id="product-gallery">
      <div class="gallery-main" id="gallery-main"></div>
      <div class="gallery-thumbs" id="gallery-thumbs"></div>
    </div>

    <div class="product-info">
      <h1 class="product-name">${product.name}</h1>
      <p class="product-price" id="product-price"></p>

      <div class="product-atc">
        <div class="product-size-wrap">
          <span class="product-size-label">
            <span class="collection-mark" id="collection-mark" aria-hidden="true">❖</span>
            Collection
          </span>
          <div class="product-collection-boxes" id="collection-boxes">
            ${buildCollectionBoxes()}
          </div>
        </div>
        <div class="product-size-wrap">
          <span class="product-size-label">
            Size
            <span class="size-hint">
              <button type="button" class="size-hint-trigger"
                      aria-label="Sizing help" aria-describedby="size-hint-bubble">?</button>
              <span class="size-hint-bubble" id="size-hint-bubble" role="tooltip">
                Between sizes? Order smaller for a snug fit. Or
                <a href="contact.html">reach out</a> for custom sizing.
              </span>
            </span>
          </span>
          <div class="product-size-boxes" id="size-boxes"></div>
        </div>
        <span class="atc-wrap">
          <button class="btn-primary atc-button" id="atc-btn" disabled>Add to Cart</button>
          <span class="atc-tip" role="tooltip">Select a size</span>
        </span>
        <p class="atc-note">Each piece is made to order, <a href="contact.html" style="color:inherit;">custom inquiries welcome</a></p>
      </div>

      <p class="product-description">${product.description}</p>

      ${detailsHTML}
    </div>
  `;

  wireCollectionBoxes();
  wireSizeBoxes();
  wireAddToCart();
  wireGalleryAndLightbox();
}

/* Every collection is offered; ones this type is not made in yet are
   rendered dimmed and disabled rather than hidden. */
function buildCollectionBoxes() {
  return Object.entries(catalog.collections).map(([key, col]) => {
    const available = Boolean(product.collections[key]);
    return `
      <button type="button"
              class="collection-box${available ? '' : ' unavailable'}"
              data-collection="${key}"
              ${available ? '' : 'disabled aria-disabled="true"'}
              title="${available ? col.label : col.label + ' — coming soon'}">
        <span class="collection-box-label">${col.short}</span>
        ${available ? '' : '<span class="collection-box-soon">Soon</span>'}
      </button>
    `;
  }).join('');
}

/* ============================================================
   Collection switching — the parts that do change
   ============================================================ */

function selectCollection(key) {
  /* Held across the switch so choosing a collection does not clear the
     size the visitor already picked. */
  const previousSize = selectedSize ? selectedSize.size : null;

  collectionKey = key;

  const collection = catalog.collections[key];
  const variant = product.collections[key];

  document.title = `${product.name} - ${collection.label} | Unseelie Workshop`;

  document.getElementById('breadcrumb').innerHTML = `
    <a href="shop.html">Shop</a>
    <span class="breadcrumb-sep">/</span>
    <a href="${collection.href}">${collection.label}</a>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-current">${product.name}</span>
  `;

  /* textContent, not a rebuild: reviews.js inserts its rating link as a
     sibling just before this element, and replacing it would drop that. */
  document.getElementById('product-price').textContent = variant.price;

  /* The single mark beside the Collection label carries the accent of
     whichever collection is selected. */
  document.getElementById('collection-mark').style.color = collection.accent;

  document.querySelectorAll('.collection-box').forEach(box => {
    box.classList.toggle('active', box.dataset.collection === key);
  });

  renderSizeBoxes(variant, previousSize);
  renderGallery(variant, collection);

  const url = `product.html?type=${encodeURIComponent(product.type)}&collection=${encodeURIComponent(key)}`;
  history.replaceState(null, '', url);
}

function renderSizeBoxes(variant, keepSize) {
  const wrap = document.getElementById('size-boxes');
  const variants = Array.isArray(variant.variants) ? variant.variants : [];

  /* Re-select the previously chosen size if this collection offers it.
     The Stripe price id is taken from the new collection's own variant,
     since each collection prices its sizes separately. */
  const kept = variants.find(v => v.size === keepSize) || null;
  selectedSize = kept ? { size: kept.size, stripePriceId: kept.stripePriceId } : null;

  wrap.innerHTML = variants.map(v =>
    `<button class="size-box${v === kept ? ' active' : ''}" type="button" data-size="${v.size}" data-price-id="${v.stripePriceId}">${v.size}</button>`
  ).join('');

  /* No sizes defined means nothing to choose, so the button is usable
     straight away; otherwise it waits for a size. */
  document.getElementById('atc-btn').disabled = variants.length > 0 && !selectedSize;
}

/* ============================================================
   Wiring — attached once, reads current state when fired
   ============================================================ */

function wireCollectionBoxes() {
  document.getElementById('collection-boxes').addEventListener('click', e => {
    const box = e.target.closest('.collection-box');
    if (!box || box.disabled) return;
    selectCollection(box.dataset.collection);
  });
}

function wireSizeBoxes() {
  document.getElementById('size-boxes').addEventListener('click', e => {
    const box = e.target.closest('.size-box');
    if (!box) return;
    document.querySelectorAll('.size-box').forEach(b => b.classList.remove('active'));
    box.classList.add('active');
    selectedSize = { size: box.dataset.size, stripePriceId: box.dataset.priceId };
    document.getElementById('atc-btn').disabled = false;
  });
}

function wireAddToCart() {
  const btn = document.getElementById('atc-btn');
  btn.addEventListener('click', () => {
    if (!window.Cart) return;
    const collection = catalog.collections[collectionKey];
    const variant = product.collections[collectionKey];
    const priceNum = parseFloat(variant.price.replace(/[^0-9.]/g, '')) || 0;

    window.Cart.add({
      type:            product.type,
      collection:      collectionKey,
      collectionLabel: collection.label,
      name:            product.name,
      price:           variant.price,
      priceNum:        priceNum,
      thumb:           variant.images && variant.images.length ? variant.images[0] : null,
      size:            selectedSize ? selectedSize.size : null,
      stripePriceId:   selectedSize ? selectedSize.stripePriceId : null
    });
  });
}

/* ============================================================
   Gallery
   ============================================================ */

function renderGallery(variant, collection) {
  galleryImages = variant.images || [];
  galleryIndex = 0;

  const main = document.getElementById('gallery-main');
  const thumbs = document.getElementById('gallery-thumbs');

  if (galleryImages.length === 0) {
    main.innerHTML = `
      <div class="gallery-placeholder" style="background: linear-gradient(135deg, ${collection.gradientFrom}, ${collection.gradientTo});">
        <span class="gallery-placeholder-text">Photography coming soon</span>
      </div>
    `;
    thumbs.innerHTML = '';
    return;
  }

  main.innerHTML = `<img src="${galleryImages[0]}" alt="${product.name}" id="main-img">`;

  thumbs.innerHTML = galleryImages.length > 1
    ? galleryImages.map((src, i) =>
        `<div class="gallery-thumb${i === 0 ? ' active' : ''}" data-index="${i}">
           <img src="${src}" alt="${product.name}, image ${i + 1}">
         </div>`
      ).join('')
    : '';
}

function setActiveImage(index) {
  galleryIndex = index;
  const mainImg = document.getElementById('main-img');
  if (mainImg) mainImg.src = galleryImages[index];
  document.querySelectorAll('.gallery-thumb').forEach((t, i) => {
    t.classList.toggle('active', i === index);
  });
}

/* ============================================================
   Lightbox
   ============================================================ */

function wireGalleryAndLightbox() {
  const lightbox = document.getElementById('lightbox');
  const lbImg    = document.getElementById('lightbox-img');
  const prevBtn  = document.getElementById('lightbox-prev');
  const nextBtn  = document.getElementById('lightbox-next');

  document.getElementById('gallery-thumbs').addEventListener('click', e => {
    const thumb = e.target.closest('.gallery-thumb');
    if (thumb) setActiveImage(Number(thumb.dataset.index));
  });

  document.getElementById('gallery-main').addEventListener('click', () => {
    if (galleryImages.length > 0) open(galleryIndex);
  });

  function open(index) {
    galleryIndex = index;
    show();
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function show() {
    lbImg.src = galleryImages[galleryIndex];
    lbImg.alt = `Image ${galleryIndex + 1} of ${galleryImages.length}`;
    prevBtn.classList.toggle('hidden', galleryIndex === 0);
    nextBtn.classList.toggle('hidden', galleryIndex === galleryImages.length - 1);
  }

  function step(delta) {
    const next = galleryIndex + delta;
    if (next < 0 || next >= galleryImages.length) return;
    galleryIndex = next;
    show();
  }

  document.getElementById('lightbox-close').addEventListener('click', close);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));

  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) close();
  });

  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowLeft')  step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
}

/* ============================================================
   Materials diagram

   Callouts sit in one vertical column to the right of the photo, each
   marked by a dot on the datum line. The dot and the datum are both
   drawn in product.css.

   On scroll the datum draws downward, and each callout types its name
   out as the line reaches it. --chars carries the name's length so the
   steps() timing lands one step per character and every name types at
   the same speed.
   ============================================================ */

function renderMaterials(materials) {
  const section = document.getElementById('materials');
  if (!section || !materials || materials.length === 0) return;

  section.innerHTML = `
    <h2 class="section-title">Construction</h2>
    <p class="materials-intro">Made without compromises.</p>

    <div class="materials-diagram" id="materials-diagram">
      <div class="materials-figure">
        <span class="materials-figure-note">Materials, fanned</span>
      </div>
      <ol class="materials-callouts">
        ${materials.map((m, i) => buildCallout(m, i)).join('')}
      </ol>
    </div>
  `;

  revealDiagramOnScroll();
}

function buildCallout(material, index) {
  return `
    <li class="material" style="--i: ${index}; --chars: ${material.name.length};">
      <span class="material-leader" aria-hidden="true"></span>
      <div class="material-body">
        <h3 class="material-name"><span>${material.name}</span></h3>
        <p class="material-note">${material.note}</p>
      </div>
    </li>
  `;
}

/* The diagram reveals itself when it comes into view. Everything is in
   its finished state by default, so if this never runs — no JS, no
   IntersectionObserver, or motion turned down — the diagram is simply
   complete rather than blank. */
function revealDiagramOnScroll() {
  const diagram = document.getElementById('materials-diagram');
  if (!diagram) return;

  const stillPreferred = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (stillPreferred || !('IntersectionObserver' in window)) return;

  diagram.classList.add('will-draw');

  const observer = new IntersectionObserver((entries, self) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      diagram.classList.add('drawn');
      self.disconnect();
    });
  }, { threshold: 0.25 });

  observer.observe(diagram);
}

/* ============================================================
   Error state
   ============================================================ */

function showError(msg) {
  const layout = document.getElementById('product-layout');
  if (layout) {
    layout.innerHTML = `<p class="product-loading">${msg}</p>`;
  }
}

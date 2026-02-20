/* ============================================================
   Unseelie Workshop — Product Page
   Reads ?id= from the URL, fetches products.json, and
   renders the full product page including image gallery
   and lightbox.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');

  if (!productId) {
    showError('No product specified.');
    return;
  }

  fetch('data/products.json')
    .then(res => res.json())
    .then(data => {
      const product = data.products.find(p => p.id === productId);
      if (!product) {
        showError('Product not found.');
        return;
      }
      const collection = data.collections[product.collection];
      renderPage(product, collection);
    })
    .catch(err => {
      console.error('Failed to load data/products.json:', err);
      showError('Unable to load product. Please try again later.');
    });
});

/* ============================================================
   Page renderer
   ============================================================ */

function renderPage(product, collection) {
  // Update page title
  document.title = `${product.name} — ${collection.label} | Unseelie Workshop`;

  // Breadcrumb
  const breadcrumb = document.getElementById('breadcrumb');
  breadcrumb.innerHTML = `
    <a href="shop.html">Shop</a>
    <span class="breadcrumb-sep">/</span>
    <a href="${collection.href}">${collection.label}</a>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-current">${product.name}</span>
  `;

  // Details list
  const detailsHTML = product.details && product.details.length
    ? `<ul class="product-details">
        <p class="product-details-label">Materials & Construction</p>
        ${product.details.map(d => `<li>${d}</li>`).join('')}
       </ul>`
    : '';

  // Sizing
  const sizingHTML = product.sizing
    ? `<div class="product-sizing">
        <strong>Sizing</strong>
        ${product.sizing}
       </div>`
    : '';

  // Main layout
  const layout = document.getElementById('product-layout');
  layout.innerHTML = `
    <div class="product-gallery" id="product-gallery">
      <div class="gallery-main" id="gallery-main">
        ${buildMainImage(product, collection)}
      </div>
      <div class="gallery-thumbs" id="gallery-thumbs"></div>
    </div>

    <div class="product-info">
      <span class="product-collection-tag" style="color: ${collection.accent};">${collection.label}</span>
      <h1 class="product-name">${product.name}</h1>
      <p class="product-price">${product.price}</p>
      <p class="product-description">${product.description}</p>
      ${detailsHTML}
      ${sizingHTML}

      <div class="product-atc">
        <button class="atc-button" disabled>Add to Cart</button>
        <p class="atc-note">Online purchasing coming soon — <a href="contact.html" style="color:inherit;">enquire via contact</a></p>
      </div>

      <a href="${collection.href}" class="product-collection-link">← View full ${collection.label}</a>
    </div>
  `;

  // Wire up gallery
  initGallery(product, collection);
}

/* ============================================================
   Gallery
   ============================================================ */

function buildMainImage(product, collection) {
  if (product.images && product.images.length > 0) {
    return `
      <img src="${product.images[0]}" alt="${product.name}" id="main-img">
      <span class="gallery-hint">Click to expand</span>
    `;
  }
  // Placeholder — gradient from collection colours
  return `
    <div class="gallery-placeholder" style="background: linear-gradient(135deg, ${collection.gradientFrom}, ${collection.gradientTo});">
      <span class="gallery-placeholder-icon">${product.icon}</span>
      <span class="gallery-placeholder-text">Photography coming soon</span>
    </div>
  `;
}

function initGallery(product, collection) {
  const images = product.images || [];
  const mainEl = document.getElementById('gallery-main');
  const thumbsEl = document.getElementById('gallery-thumbs');
  let activeIndex = 0;

  // Build thumbnails only if there are images
  if (images.length > 1) {
    images.forEach((src, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb' + (i === 0 ? ' active' : '');
      thumb.innerHTML = `<img src="${src}" alt="${product.name} — image ${i + 1}">`;
      thumb.addEventListener('click', () => setActiveImage(i));
      thumbsEl.appendChild(thumb);
    });
  }

  function setActiveImage(index) {
    activeIndex = index;
    const mainImg = document.getElementById('main-img');
    if (mainImg) {
      mainImg.src = images[index];
    }
    thumbsEl.querySelectorAll('.gallery-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === index);
    });
  }

  // Click main image to open lightbox
  mainEl.addEventListener('click', () => {
    if (images.length > 0) openLightbox(images, activeIndex);
  });

  // Init lightbox
  initLightbox(images);
}

/* ============================================================
   Lightbox
   ============================================================ */

function initLightbox(images) {
  const lightbox   = document.getElementById('lightbox');
  const lbImg      = document.getElementById('lightbox-img');
  const closeBtn   = document.getElementById('lightbox-close');
  const prevBtn    = document.getElementById('lightbox-prev');
  const nextBtn    = document.getElementById('lightbox-next');
  let current      = 0;

  function open(index) {
    current = index;
    lbImg.src = images[current];
    lbImg.alt = `Image ${current + 1} of ${images.length}`;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    updateNav();
  }

  function close() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function prev() {
    if (current > 0) { current--; lbImg.src = images[current]; updateNav(); }
  }

  function next() {
    if (current < images.length - 1) { current++; lbImg.src = images[current]; updateNav(); }
  }

  function updateNav() {
    prevBtn.classList.toggle('hidden', current === 0);
    nextBtn.classList.toggle('hidden', current === images.length - 1);
  }

  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  // Close on backdrop click
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox) close();
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')      close();
    if (e.key === 'ArrowLeft')   prev();
    if (e.key === 'ArrowRight')  next();
  });

  // Expose open function
  window.openLightbox = open;
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

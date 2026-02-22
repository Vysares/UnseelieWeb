/* ============================================================
   Unseelie Workshop — Cart Drawer
   Self-contained cart: local state + localStorage persistence.

   SHOPIFY MIGRATION GUIDE (when ready):
   ─────────────────────────────────────
   1. Replace _load() / _save() with Shopify checkout object
      retrieval / storage (Buy SDK checkout.id in localStorage).
   2. Replace _addItem / _removeItem / _setQty with SDK calls:
        checkout.lineItems.add / remove / update
   3. Remove [disabled] from #cart-checkout-btn and set
      href to checkout.webUrl from the SDK response.
   4. window.Cart.add() signature is UNCHANGED — product.js
      requires zero modifications.
   ============================================================ */

(function () {
    'use strict';

    /* ============================================================
       Constants & state
       ============================================================ */

    var STORAGE_KEY = 'unseelie_cart';

    /* Line item shape:
       { id, name, collection, collectionLabel, price, priceNum, icon, qty } */
    var _items = [];

    /* ============================================================
       Persistence
       ============================================================ */

    function _load() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_items));
        } catch (e) {
            /* Private browsing / storage full — state lives in memory only */
        }
    }

    /* ============================================================
       State mutations
       ============================================================ */

    function _findItem(id) {
        for (var i = 0; i < _items.length; i++) {
            if (_items[i].id === id) return _items[i];
        }
        return null;
    }

    function _addItem(product) {
        var existing = _findItem(product.id);
        if (existing) {
            existing.qty += 1;
        } else {
            _items.push({
                id:              product.id,
                name:            product.name,
                collection:      product.collection,
                collectionLabel: product.collectionLabel,
                price:           product.price,
                priceNum:        product.priceNum,
                thumb:           product.thumb || null,
                qty:             1
            });
        }
        _save();
        _render();
        _updateBadge();
    }

    function _removeItem(id) {
        _items = _items.filter(function (item) { return item.id !== id; });
        _save();
        _render();
        _updateBadge();
    }

    function _setQty(id, qty) {
        if (qty < 1) {
            _removeItem(id);
            return;
        }
        var item = _findItem(id);
        if (!item) return;
        item.qty = qty;
        _save();
        _render();
        _updateBadge();
    }

    /* ============================================================
       DOM injection — cart icon
       ============================================================ */

    function _injectIcon() {
        var nav = document.querySelector('header nav');
        if (!nav) return; /* msgreceived.html — no nav, silently no-op */

        var btn = document.createElement('button');
        btn.id = 'cart-icon-btn';
        btn.setAttribute('aria-label', 'Open cart');
        btn.innerHTML =
            '<svg width="20" height="22" viewBox="0 0 20 22" fill="none"' +
            ' xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path d="M1.5 7.5h17l-1.4 12H2.9L1.5 7.5z"' +
            ' stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
            '<path d="M6.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2"' +
            ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
            '</svg>' +
            '<span id="cart-badge" aria-live="polite" aria-atomic="true"></span>';

        btn.addEventListener('click', Cart.open);

        /* Insert between </nav> and .nav-hamburger so it stays
           visible in the header row on mobile (nav is display:none) */
        var hamburger = document.querySelector('.nav-hamburger');
        if (hamburger) {
            nav.parentElement.insertBefore(btn, hamburger);
        } else {
            nav.parentElement.appendChild(btn);
        }
    }

    /* ============================================================
       DOM injection — drawer
       ============================================================ */

    function _injectDrawer() {
        var root = document.createElement('div');
        root.id = 'cart-root';
        root.innerHTML =
            '<div id="cart-backdrop" aria-hidden="true"></div>' +
            '<aside id="cart-drawer" role="dialog" aria-modal="true"' +
            '       aria-label="Shopping cart" tabindex="-1">' +
            '  <div id="cart-drawer-header">' +
            '    <h2 id="cart-drawer-title">Your Cart</h2>' +
            '    <button id="cart-close-btn" aria-label="Close cart">&times;</button>' +
            '  </div>' +
            '  <div id="cart-drawer-body"></div>' +
            '  <div id="cart-drawer-footer"></div>' +
            '</aside>';

        document.body.appendChild(root);

        document.getElementById('cart-backdrop')
            .addEventListener('click', Cart.close);
        document.getElementById('cart-close-btn')
            .addEventListener('click', Cart.close);

        /* Escape key closes drawer */
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && document.body.classList.contains('cart-open')) {
                Cart.close();
            }
        });

        /* Delegated handler for quantity / remove buttons.
           Attached once here so re-rendering doesn't stack listeners. */
        document.addEventListener('click', function (e) {
            var id = e.target.dataset && e.target.dataset.id;
            if (!id) return;

            if (e.target.classList.contains('cart-qty-dec')) {
                var dec = _findItem(id);
                if (dec) _setQty(id, dec.qty - 1);
            } else if (e.target.classList.contains('cart-qty-inc')) {
                var inc = _findItem(id);
                if (inc) _setQty(id, inc.qty + 1);
            } else if (e.target.classList.contains('cart-remove-btn')) {
                _removeItem(id);
            }
        });

        /* Checkout button — delegated separately since it has no data-id */
        document.addEventListener('click', function (e) {
            if (e.target.id === 'cart-checkout-btn') {
                _checkout();
            }
        }, true /* capture — runs before other handlers */);
    }

    /* ============================================================
       Render engine
       ============================================================ */

    function _render() {
        var body   = document.getElementById('cart-drawer-body');
        var footer = document.getElementById('cart-drawer-footer');
        if (!body || !footer) return;

        /* ---- Empty state ---- */
        if (_items.length === 0) {
            body.innerHTML =
                '<div id="cart-empty">' +
                '  <span class="cart-empty-ornament">✦</span>' +
                '  <p class="cart-empty-text">Your cart is empty</p>' +
                '  <p class="cart-empty-sub">Discover our handcrafted pieces</p>' +
                '  <a href="shop.html" class="btn-secondary cart-shop-link">Browse the Shop</a>' +
                '</div>';
            footer.innerHTML = '';
            return;
        }

        /* ---- Line items ---- */
        var itemsHTML = _items.map(function (item) {
            return (
                '<li class="cart-item" data-id="' + item.id + '">' +
                '  <div class="cart-item-thumb" aria-hidden="true">' +
                     (item.thumb
                       ? '<img src="' + item.thumb + '" alt="">'
                       : '<span class="cart-item-thumb-fallback">✦</span>') +
                '  </div>' +
                '  <div class="cart-item-info">' +
                '    <span class="cart-item-name">' + _esc(item.name) + (item.size ? ' \u2014 ' + _esc(item.size) : '') + '</span>' +
                '    <span class="cart-item-collection">' + _esc(item.collectionLabel) + '</span>' +
                '    <span class="cart-item-price">' + _esc(item.price) + '</span>' +
                '  </div>' +
                '  <div class="cart-item-controls">' +
                '    <button class="cart-qty-btn cart-qty-dec" data-id="' + item.id + '" aria-label="Decrease quantity">\u2212</button>' +
                '    <span class="cart-qty-display">' + item.qty + '</span>' +
                '    <button class="cart-qty-btn cart-qty-inc" data-id="' + item.id + '" aria-label="Increase quantity">+</button>' +
                '    <button class="cart-remove-btn" data-id="' + item.id + '" aria-label="Remove ' + _esc(item.name) + '">&times;</button>' +
                '  </div>' +
                '</li>'
            );
        }).join('');

        body.innerHTML = '<ul id="cart-items-list">' + itemsHTML + '</ul>';

        /* ---- Subtotal ---- */
        var subtotal = _items.reduce(function (sum, item) {
            return sum + (item.priceNum * item.qty);
        }, 0);

        /* Format: remove trailing .00 for whole numbers */
        var subtotalStr = '$' + subtotal.toFixed(2).replace(/\.00$/, '');

        footer.innerHTML =
            '<div id="cart-subtotal-row">' +
            '  <span class="cart-subtotal-label">Subtotal</span>' +
            '  <span class="cart-subtotal-value">' + subtotalStr + '</span>' +
            '</div>' +
            '<button id="cart-checkout-btn" class="btn-primary">' +
            '  Proceed to Checkout' +
            '</button>' +
            '<div id="cart-checkout-error"></div>' +
            '<p class="cart-footer-note">' +
            '  Interested in custom sizing?&thinsp;' +
            '  <a href="contact.html">Enquire via contact</a>' +
            '</p>';
    }

    /* ============================================================
       Checkout
       ============================================================ */

    function _showCheckoutError(msg) {
        var el = document.getElementById('cart-checkout-error');
        if (!el) return;
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
    }

    function _checkout() {
        var btn = document.getElementById('cart-checkout-btn');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        btn.textContent = 'Redirecting\u2026';
        _showCheckoutError('');

        fetch('/api/checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                items:      _items,
                successUrl: window.location.origin + '/thankyou',
                cancelUrl:  window.location.href
            })
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.url) {
                window.location.href = data.url;
            } else {
                _showCheckoutError(data.error || 'Something went wrong. Please try again.');
                btn.disabled = false;
                btn.textContent = 'Proceed to Checkout';
            }
        })
        .catch(function () {
            _showCheckoutError('Could not reach checkout. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Proceed to Checkout';
        });
    }

    /* ============================================================
       Badge
       ============================================================ */

    function _updateBadge() {
        var badge = document.getElementById('cart-badge');
        if (!badge) return;

        var total = _items.reduce(function (sum, item) { return sum + item.qty; }, 0);

        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.classList.add('cart-badge-visible');
        } else {
            badge.textContent = '';
            badge.classList.remove('cart-badge-visible');
        }
    }

    /* ============================================================
       Open / close
       ============================================================ */

    function _open() {
        document.body.classList.add('cart-open');
        document.body.style.overflow = 'hidden';
        var drawer = document.getElementById('cart-drawer');
        if (drawer) {
            /* Small delay so the transition is visible before focus */
            setTimeout(function () { drawer.focus(); }, 50);
        }
    }

    function _close() {
        document.body.classList.remove('cart-open');
        document.body.style.overflow = '';
        /* Return focus to the cart icon button */
        var iconBtn = document.getElementById('cart-icon-btn');
        if (iconBtn) iconBtn.focus();
    }

    /* ============================================================
       Utility
       ============================================================ */

    function _esc(str) {
        /* Minimal HTML-escape for injected text */
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ============================================================
       Initialisation
       ============================================================ */

    function _init() {
        _items = _load();
        _injectIcon();
        _injectDrawer();
        _render();
        _updateBadge();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    /* ============================================================
       Public API
       ============================================================ */

    window.Cart = {

        /**
         * Add a product to the cart, then open the drawer.
         *
         * @param {Object} product
         * @param {string} product.id
         * @param {string} product.name
         * @param {string} product.collection       — collection key e.g. "classic"
         * @param {string} product.collectionLabel  — display name e.g. "The Classic Collection"
         * @param {string} product.price            — display string e.g. "$135"
         * @param {number} product.priceNum         — numeric value e.g. 135
         * @param {string} product.icon             — emoji e.g. "🗝"
         *
         * SHOPIFY: Replace body of this function with SDK lineItems.add call.
         *          Keep the same function signature.
         */
        add: function (product) {
            _addItem(product);
            _open();

            /* Pulse the bag icon */
            var btn = document.getElementById('cart-icon-btn');
            if (btn) {
                btn.classList.remove('cart-icon-pulse');
                /* Force reflow so re-adding the class restarts the animation */
                void btn.offsetWidth;
                btn.classList.add('cart-icon-pulse');
                setTimeout(function () {
                    btn.classList.remove('cart-icon-pulse');
                }, 600);
            }
        },

        /** Remove a line item by product id. */
        remove: function (id) {
            _removeItem(id);
        },

        /** Set the quantity of a line item. qty < 1 removes the item. */
        updateQty: function (id, qty) {
            _setQty(id, qty);
        },

        /** Open the cart drawer. */
        open: _open,

        /** Close the cart drawer. */
        close: _close,

        /** Return total item count (sum of all quantities). */
        getCount: function () {
            return _items.reduce(function (sum, item) { return sum + item.qty; }, 0);
        },

        /** Return a shallow copy of all line items. */
        getItems: function () {
            return _items.map(function (item) { return Object.assign({}, item); });
        }
    };

}());

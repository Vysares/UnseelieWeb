/* ============================================================
   Unseelie Workshop — Mobile Navigation
   Handles hamburger toggle + inline dropdown expansion on mobile
   ============================================================ */

(function () {
    'use strict';

    function initNav() {
        const hamburger = document.querySelector('.nav-hamburger');
        const nav       = document.querySelector('header nav');

        if (!hamburger || !nav) return;

        /* ---- Hamburger: open / close the whole nav ---- */
        hamburger.addEventListener('click', function () {
            const isOpen = nav.classList.toggle('nav-open');
            hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

            // Close all mobile dropdowns when collapsing the nav
            if (!isOpen) {
                nav.querySelectorAll('.nav-dropdown.mobile-open').forEach(function (d) {
                    d.classList.remove('mobile-open');
                });
            }
        });

        /* ---- Dropdown triggers: expand inline on mobile ---- */
        nav.querySelectorAll('.nav-dropdown-trigger').forEach(function (trigger) {
            trigger.addEventListener('click', function (e) {
                // Only intercept on mobile (hamburger is visible)
                if (window.getComputedStyle(hamburger).display === 'none') return;

                e.stopPropagation();
                const dropdown = trigger.closest('.nav-dropdown');
                const isDropOpen = dropdown.classList.toggle('mobile-open');

                // Close sibling dropdowns
                nav.querySelectorAll('.nav-dropdown').forEach(function (d) {
                    if (d !== dropdown) d.classList.remove('mobile-open');
                });
            });
        });

        /* ---- Close nav when a menu link is tapped ---- */
        nav.addEventListener('click', function (e) {
            if (e.target.tagName === 'A') {
                nav.classList.remove('nav-open');
                hamburger.setAttribute('aria-expanded', 'false');
                nav.querySelectorAll('.nav-dropdown.mobile-open').forEach(function (d) {
                    d.classList.remove('mobile-open');
                });
            }
        });

        /* ---- Close nav when tapping outside the header ---- */
        document.addEventListener('click', function (e) {
            const header = document.querySelector('header');
            if (header && !header.contains(e.target)) {
                nav.classList.remove('nav-open');
                hamburger.setAttribute('aria-expanded', 'false');
                nav.querySelectorAll('.nav-dropdown.mobile-open').forEach(function (d) {
                    d.classList.remove('mobile-open');
                });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNav);
    } else {
        initNav();
    }
}());

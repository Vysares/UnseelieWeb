/* ============================================================
   Unseelie Workshop — Scroll-to-top button
   Injects a fixed button that appears after scrolling 300px
   and smoothly returns to the top on click.
   ============================================================ */

(function () {
  const btn = document.createElement('button');
  btn.id = 'scroll-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = ''; // caret drawn via CSS ::before
  document.body.appendChild(btn);

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

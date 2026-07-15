'use strict';
// Applies the user's saved theme immediately, before the page paints,
// to avoid a flash of the default theme on load.
(function () {
  try {
    const saved = localStorage.getItem('kb_theme');
    if (saved && saved !== 'midnight') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}
})();

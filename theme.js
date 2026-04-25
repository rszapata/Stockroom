/* ── STOCKROOM · Theme Engine (disabled) ──────────────────────────
   Theme switching removed. Pages use their own base styling.
   This stub clears any legacy persisted theme and removes any
   existing picker UI so the old color scheme never reappears.
   ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  try { localStorage.removeItem('stockroom_theme'); } catch (e) {}
  try {
    var root = document.documentElement;
    root.removeAttribute('data-theme');
    ['--ye','--cy','--re','--or','--gr','--pu','--bg','--s1','--s2','--s3',
     '--b1','--b2','--b3','--tx','--t2','--t3','--header-bg','--grid-color',
     '--grid-opacity','--card-shadow','--btn-primary-bg','--btn-primary-tx',
     '--grid-c','--grid-o']
      .forEach(function (k) { root.style.removeProperty(k); });
  } catch (e) {}
  function cleanup() {
    try {
      document.querySelectorAll(
        '#theme-picker,.theme-picker,.theme-opt,[data-theme-picker],#theme-toggle,.theme-toggle'
      ).forEach(function (el) { el.remove(); });
    } catch (e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanup);
  } else {
    cleanup();
  }
  // No-op hooks in case other code calls these
  window.__setTheme = function () {};
  window.__getTheme = function () { return null; };
})();

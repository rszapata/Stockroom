/* ── STOCKROOM · Theme Engine ─────────────────────────────────────
   Manages theme switching across all pages.
   Themes override CSS custom properties on :root.
   Selection is persisted in localStorage.
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var THEMES = {
    cyber: {
      label: 'Cyber',
      icon: '🖥',
      vars: {
        '--bg':'#0c0c0e','--s1':'#141416','--s2':'#1c1c20','--s3':'#242428',
        '--b1':'#2a2a30','--b2':'#3a3a42','--b3':'#55556a',
        '--tx':'#e8e8f0','--t2':'#8888a0','--t3':'#55556a',
        '--ye':'#e8ff47','--cy':'#47ffe8','--re':'#ff4747','--or':'#ff9547','--gr':'#47ff8a','--pu':'#b847ff',
        '--header-bg':'rgba(12,12,14,.97)','--grid-color':'var(--b1)','--grid-opacity':'.25',
        '--card-shadow':'none','--btn-primary-bg':'var(--ye)','--btn-primary-tx':'#0c0c0e',
      }
    },
    midnight: {
      label: 'Midnight',
      icon: '🌙',
      vars: {
        '--bg':'#0a1628','--s1':'#0f1d32','--s2':'#15253e','--s3':'#1b2d4a',
        '--b1':'#1e3455','--b2':'#2a4570','--b3':'#3d5a8a',
        '--tx':'#d8e4f0','--t2':'#7a96b8','--t3':'#4a6a90',
        '--ye':'#4fc3f7','--cy':'#00e5ff','--re':'#ef5350','--or':'#ffa726','--gr':'#66bb6a','--pu':'#ab47bc',
        '--header-bg':'rgba(10,22,40,.97)','--grid-color':'#1e3455','--grid-opacity':'.2',
        '--card-shadow':'0 2px 12px rgba(0,0,0,.3)','--btn-primary-bg':'#4fc3f7','--btn-primary-tx':'#0a1628',
      }
    },
    corporate: {
      label: 'Editorial',
      icon: '◆',
      vars: {
        '--bg':'#0b0f14','--s1':'#101820','--s2':'#151e28','--s3':'#1a2530',
        '--b1':'#1e2a38','--b2':'#283848','--b3':'#3a4f65',
        '--tx':'#c8cdd4','--t2':'#6b7a8d','--t3':'#3e5168',
        '--ye':'#8ab4f8','--cy':'#6ea4dc','--re':'#c47070','--or':'#c4a06e','--gr':'#6eaa7e','--pu':'#9a82c4',
        '--header-bg':'rgba(11,15,20,.98)','--grid-color':'#1e2a38','--grid-opacity':'.08',
        '--card-shadow':'0 1px 4px rgba(0,0,0,.2)','--btn-primary-bg':'#8ab4f8','--btn-primary-tx':'#0b0f14',
      }
    }
  };

  var STORAGE_KEY = 'stockroom_theme';

  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'cyber';
  }

  function applyTheme(id) {
    var theme = THEMES[id];
    if (!theme) return;
    var root = document.documentElement;
    root.setAttribute('data-theme', id);
    Object.keys(theme.vars).forEach(function (k) {
      root.style.setProperty(k, theme.vars[k]);
    });
    // Update meta theme-color
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.vars['--bg']);
    // Update body::before grid
    document.body.style.setProperty('--grid-c', theme.vars['--grid-color'] || theme.vars['--b1']);
    document.body.style.setProperty('--grid-o', theme.vars['--grid-opacity'] || '.25');
    // Mark active in selector
    document.querySelectorAll('.theme-opt').forEach(function (el) {
      el.classList.toggle('active', el.dataset.theme === id);
    });
    localStorage.setItem(STORAGE_KEY, id);
  }

  function injectSelector() {
    // Place inside the header, before the account wrapper
    var header = document.querySelector('header');
    if (!header) return;

    var wrap = document.createElement('div');
    wrap.className = 'theme-wrap';
    wrap.innerHTML =
      '<button class="theme-toggle" title="Cambiar tema" onclick="document.querySelector(\'.theme-dd\').classList.toggle(\'open\')">🎨</button>' +
      '<div class="theme-dd">' +
        Object.keys(THEMES).map(function (id) {
          var t = THEMES[id];
          return '<button class="theme-opt" data-theme="' + id + '" onclick="window.__setTheme(\'' + id + '\')">' +
            '<span class="theme-preview" style="background:' + t.vars['--bg'] + ';border-color:' + t.vars['--b2'] + '">' +
              '<span style="background:' + t.vars['--ye'] + '"></span>' +
              '<span style="background:' + t.vars['--cy'] + '"></span>' +
              '<span style="background:' + t.vars['--pu'] + '"></span>' +
            '</span>' +
            '<span class="theme-name">' + t.label + '</span>' +
          '</button>';
        }).join('') +
      '</div>';

    // Insert style
    var style = document.createElement('style');
    style.textContent =
      '.theme-wrap{position:relative;display:flex;align-items:center}' +
      '.theme-toggle{width:32px;height:32px;border:1px solid var(--b1);background:var(--s1);color:var(--t2);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s}' +
      '.theme-toggle:hover{border-color:var(--b2);background:var(--s2)}' +
      '.theme-dd{display:none;position:absolute;right:0;top:38px;background:var(--s1);border:1px solid var(--b2);z-index:400;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px}' +
      '.theme-dd.open{display:flex;flex-direction:column;gap:4px}' +
      '.theme-opt{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid transparent;background:none;color:var(--tx);cursor:pointer;transition:all .15s;font-family:var(--mono);font-size:10px;letter-spacing:.08em}' +
      '.theme-opt:hover{background:var(--s2);border-color:var(--b1)}' +
      '.theme-opt.active{border-color:var(--ye);background:rgba(37,99,235,.06)}' +
      '.theme-preview{width:36px;height:20px;border:1px solid;display:flex;align-items:center;justify-content:center;gap:3px;padding:0 4px}' +
      '.theme-preview span{width:6px;height:6px;border-radius:50%}' +
      '.theme-name{text-transform:uppercase}' +
      /* Override body::before grid to use theme vars */
      'body::before{background-image:linear-gradient(var(--grid-c,var(--b1)) 1px,transparent 1px),linear-gradient(90deg,var(--grid-c,var(--b1)) 1px,transparent 1px)!important;opacity:var(--grid-o,.25)!important}' +
      /* ── Editorial / High-End Corporate overrides ── */

      /* Background: low-contrast blue gradient veil instead of grid */
      '[data-theme="corporate"] body::before{' +
        'background-image:radial-gradient(ellipse 80% 60% at 20% 20%,rgba(40,70,120,.12) 0%,transparent 70%),' +
        'radial-gradient(ellipse 60% 50% at 85% 75%,rgba(30,55,100,.10) 0%,transparent 70%),' +
        'radial-gradient(ellipse 90% 40% at 50% 0%,rgba(50,80,130,.08) 0%,transparent 60%)!important;' +
        'background-size:100% 100%!important;opacity:1!important}' +

      /* Header: editorial thin separator, no heavy border */
      '[data-theme="corporate"] header{border-bottom:1px solid rgba(138,180,248,.08)!important;box-shadow:none!important}' +

      /* Logo: muted accent, letter-spacing wider for editorial feel */
      '[data-theme="corporate"] .logo{color:#8ab4f8;letter-spacing:.25em}' +
      '[data-theme="corporate"] .logo-dot{background:#6eaa7e;animation:none;opacity:.6}' +

      /* MeLi badge: understated */
      '[data-theme="corporate"] .meli-badge{background:rgba(138,180,248,.06);border-color:rgba(138,180,248,.15);color:#6b8bb8;font-weight:400}' +

      /* LIVE indicator: subdued */
      '[data-theme="corporate"] .live{color:#6eaa7e;opacity:.7}' +
      '[data-theme="corporate"] .live-d{background:#6eaa7e;opacity:.6}' +

      /* Nav buttons: thin, understated */
      '[data-theme="corporate"] .nav-btn{border-color:transparent;background:transparent;color:#4e6580;letter-spacing:.14em}' +
      '[data-theme="corporate"] .nav-btn:hover{color:#8ab4f8;border-color:transparent}' +
      '[data-theme="corporate"] .nav-btn.active{color:#8ab4f8;border-color:transparent;border-bottom:1px solid rgba(138,180,248,.4)}' +

      /* Buttons: primary is soft blue, not saturated */
      '[data-theme="corporate"] .btn.primary{background:rgba(138,180,248,.12);color:#8ab4f8;border-color:rgba(138,180,248,.2);font-weight:400}' +
      '[data-theme="corporate"] .btn.primary:hover{background:rgba(138,180,248,.2)}' +
      '[data-theme="corporate"] .btn{border-color:rgba(138,180,248,.08);color:#5a7a9a}' +
      '[data-theme="corporate"] .btn:hover{border-color:rgba(138,180,248,.18);color:#8ab4f8}' +

      /* Cards: subtle glass, thin border */
      '[data-theme="corporate"] .card{background:rgba(16,24,32,.6);border-color:rgba(138,180,248,.06);box-shadow:0 1px 4px rgba(0,0,0,.15);backdrop-filter:blur(8px)}' +
      '[data-theme="corporate"] .card-header{border-bottom-color:rgba(138,180,248,.06)}' +
      '[data-theme="corporate"] .card-title{color:#4e6580;letter-spacing:.18em}' +

      /* Fields: very subtle borders */
      '[data-theme="corporate"] .field select,[data-theme="corporate"] .field input{background:rgba(11,15,20,.5);border-color:rgba(138,180,248,.08);color:#a0b0c4}' +
      '[data-theme="corporate"] .field select:focus,[data-theme="corporate"] .field input:focus{border-color:rgba(138,180,248,.25)}' +
      '[data-theme="corporate"] .field select option{background:#101820}' +
      '[data-theme="corporate"] .field label{color:#3e5168;letter-spacing:.14em}' +

      /* Table: clean lines, editorial spacing */
      '[data-theme="corporate"] .items-table th,[data-theme="corporate"] table th{background:rgba(16,24,32,.4);border-bottom-color:rgba(138,180,248,.06);color:#3e5168}' +
      '[data-theme="corporate"] .items-table td,[data-theme="corporate"] table td{border-bottom-color:rgba(138,180,248,.04)}' +
      '[data-theme="corporate"] .items-table tr:hover td,[data-theme="corporate"] table tr:hover td{background:rgba(138,180,248,.03)}' +

      /* Status badges: desaturated, muted */
      '[data-theme="corporate"] .status-badge{font-weight:400}' +
      '[data-theme="corporate"] .status-badge.status-active{color:#6eaa7e;border-color:rgba(110,170,126,.2);background:rgba(110,170,126,.06)}' +
      '[data-theme="corporate"] .status-badge.status-paused{color:#c4a06e;border-color:rgba(196,160,110,.2);background:rgba(196,160,110,.06)}' +
      '[data-theme="corporate"] .status-badge.status-closed{color:#c47070;border-color:rgba(196,112,112,.2);background:rgba(196,112,112,.06)}' +
      '[data-theme="corporate"] .status-badge.status-under_review{color:#9a82c4;border-color:rgba(154,130,196,.2);background:rgba(154,130,196,.06)}' +

      /* KPI cards: editorial — thin top accent line */
      '[data-theme="corporate"] .kpi{border-color:rgba(138,180,248,.06);border-top:1px solid rgba(138,180,248,.12)}' +
      '[data-theme="corporate"] .kpi:hover{border-color:rgba(138,180,248,.12)}' +
      '[data-theme="corporate"] .kpi h3{color:#3e5168}' +
      '[data-theme="corporate"] .kpi .num{color:#8ab4f8}' +

      /* Scrollbar */
      '[data-theme="corporate"] ::-webkit-scrollbar-thumb{background:rgba(138,180,248,.15)}' +
      '[data-theme="corporate"] ::-webkit-scrollbar-thumb:hover{background:rgba(138,180,248,.25)}' +

      /* Account menu */
      '[data-theme="corporate"] #acct-menu{background:rgba(16,24,32,.95);border-color:rgba(138,180,248,.1);box-shadow:0 12px 40px rgba(0,0,0,.4)}' +

      /* Progress bars */
      '[data-theme="corporate"] .prog-fill{background:#8ab4f8}' +

      /* Tab buttons (publicaciones) */
      '[data-theme="corporate"] .tab-btn{border-color:transparent;background:transparent;color:#4e6580}' +
      '[data-theme="corporate"] .tab-btn.active{color:#8ab4f8;border-bottom-color:rgba(138,180,248,.4)}';

    document.head.appendChild(style);

    // Desktop: insert in header before acct-wrap
    var acctWrap = header.querySelector('#acct-wrap');
    if (acctWrap) {
      header.querySelector('.hright').insertBefore(wrap, acctWrap);
    } else {
      // Fallback: append to header right
      var hright = header.querySelector('.hright');
      if (hright) hright.appendChild(wrap);
      else header.appendChild(wrap);
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      var dd = document.querySelector('.theme-dd');
      if (dd && !wrap.contains(e.target)) dd.classList.remove('open');
    });
  }

  // Global setter for onclick handlers
  window.__setTheme = function (id) {
    applyTheme(id);
    var dd = document.querySelector('.theme-dd');
    if (dd) dd.classList.remove('open');
  };

  // Boot
  function boot() {
    applyTheme(getTheme());
    injectSelector();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Apply immediately (before DOM ready) to prevent flash
  var earlyId = getTheme();
  var earlyTheme = THEMES[earlyId];
  if (earlyTheme) {
    var root = document.documentElement;
    root.setAttribute('data-theme', earlyId);
    Object.keys(earlyTheme.vars).forEach(function (k) {
      root.style.setProperty(k, earlyTheme.vars[k]);
    });
  }
})();

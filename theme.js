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
    },
    light: {
      label: 'Light',
      icon: '☀',
      vars: {
        '--bg':'#d9dde3','--s1':'#eef0f3','--s2':'#e4e7ec','--s3':'#d9dde3',
        '--b1':'#c7ccd4','--b2':'#a8afb9','--b3':'#8b929c',
        '--tx':'#2a303a','--t2':'#5b6470','--t3':'#8b929c',
        '--ye':'#d9c000','--cy':'#5a7a94','--re':'#a04848','--or':'#a06848','--gr':'#558866','--pu':'#6e5a94',
        '--header-bg':'rgba(238,240,243,.94)','--grid-color':'#c7ccd4','--grid-opacity':'.35',
        '--card-shadow':'0 1px 2px rgba(42,48,58,.05),0 1px 1px rgba(42,48,58,.03)','--btn-primary-bg':'#d9c000','--btn-primary-tx':'#2a303a',
        '--sans':"'Inter',system-ui,-apple-system,sans-serif",'--mono':"'JetBrains Mono',ui-monospace,monospace",
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

  function injectGoogleFonts() {
    if (document.getElementById('sr-google-fonts')) return;
    var link = document.createElement('link');
    link.id = 'sr-google-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
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
      '[data-theme="corporate"] .tab-btn.active{color:#8ab4f8;border-bottom-color:rgba(138,180,248,.4)}' +

      /* ══════════════════════════════════════════════════════════════
         LIGHT THEME — Clean corporate, ML yellow accent
         ══════════════════════════════════════════════════════════════ */

      /* Global: Inter + JetBrains Mono, dark text on muted gray bg */
      '[data-theme="light"] body{color:#2a303a;font-family:"Inter",system-ui,-apple-system,sans-serif;font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased;letter-spacing:-.005em}' +
      '[data-theme="light"] code,[data-theme="light"] .mono,[data-theme="light"] [style*="var(--mono)"]{font-family:"JetBrains Mono",ui-monospace,monospace}' +

      /* Background: soft grid */
      '[data-theme="light"] body::before{opacity:.35!important}' +

      /* Header: muted gray with thin border */
      '[data-theme="light"] header{background:rgba(238,240,243,.94)!important;border-bottom:1px solid #c7ccd4!important;box-shadow:0 1px 2px rgba(42,48,58,.04)!important;backdrop-filter:blur(10px)}' +

      /* Logo: charcoal with muted yellow dot */
      '[data-theme="light"] .logo{color:#2a303a;letter-spacing:.2em;font-weight:700}' +
      '[data-theme="light"] .logo-dot{background:#d9c000;animation:none;box-shadow:0 0 0 2px rgba(217,192,0,.18)}' +

      /* MeLi badge: muted yellow */
      '[data-theme="light"] .meli-badge{background:#d9c000;border-color:#d9c000;color:#2a303a;font-weight:700}' +

      /* LIVE indicator: muted green */
      '[data-theme="light"] .live{color:#558866}' +
      '[data-theme="light"] .live-d{background:#558866}' +

      /* Updated timestamp */
      '[data-theme="light"] #updated{color:#6b7580}' +

      /* Nav buttons: subtle pills */
      '[data-theme="light"] .nav-btn{border:1px solid transparent;background:transparent;color:#5b6470;font-weight:500;letter-spacing:.08em;border-radius:6px;transition:all .15s}' +
      '[data-theme="light"] .nav-btn:hover{color:#2a303a;background:#e4e7ec;border-color:#c7ccd4}' +
      '[data-theme="light"] .nav-btn.active{color:#2a303a;background:#d9c000;border-color:#d9c000;font-weight:600}' +

      /* Buttons: primary muted yellow, secondary ghost */
      '[data-theme="light"] .btn{border:1px solid #a8afb9;background:#eef0f3;color:#3a4048;font-weight:500;border-radius:6px;transition:all .15s;box-shadow:0 1px 2px rgba(42,48,58,.04)}' +
      '[data-theme="light"] .btn:hover{border-color:#8b929c;background:#e4e7ec;color:#2a303a}' +
      '[data-theme="light"] .btn.primary{background:#d9c000;color:#2a303a;border-color:#d9c000;font-weight:600;box-shadow:0 1px 2px rgba(217,192,0,.2)}' +
      '[data-theme="light"] .btn.primary:hover{background:#c4a800;border-color:#c4a800;color:#2a303a}' +
      '[data-theme="light"] .btn.danger{background:#a04848;color:#eef0f3;border-color:#a04848}' +
      '[data-theme="light"] .btn.danger:hover{background:#8a3c3c;border-color:#8a3c3c}' +

      /* Cards: light gray with subtle shadow */
      '[data-theme="light"] .card{background:#eef0f3;border:1px solid #c7ccd4;border-radius:10px;box-shadow:0 1px 2px rgba(42,48,58,.05),0 1px 1px rgba(42,48,58,.03)}' +
      '[data-theme="light"] .card-header{border-bottom-color:#c7ccd4;background:#e4e7ec}' +
      '[data-theme="light"] .card-title{color:#6b7580;letter-spacing:.14em;font-weight:600;text-transform:uppercase;font-size:11px}' +

      /* Fields: clean inputs */
      '[data-theme="light"] .field select,[data-theme="light"] .field input,[data-theme="light"] input[type="text"],[data-theme="light"] input[type="number"],[data-theme="light"] input[type="email"],[data-theme="light"] input[type="password"],[data-theme="light"] input[type="date"],[data-theme="light"] textarea{background:#eef0f3;border:1px solid #a8afb9;color:#2a303a;border-radius:6px;transition:all .15s}' +
      '[data-theme="light"] .field select:focus,[data-theme="light"] .field input:focus,[data-theme="light"] input:focus,[data-theme="light"] textarea:focus{border-color:#d9c000;outline:2px solid rgba(217,192,0,.18);outline-offset:0}' +
      '[data-theme="light"] .field label{color:#6b7580;letter-spacing:.08em;font-weight:500}' +

      /* Tables: clean muted rows */
      '[data-theme="light"] .items-table,[data-theme="light"] table{background:#eef0f3}' +
      '[data-theme="light"] .items-table th,[data-theme="light"] table th{background:#e4e7ec;border-bottom:1px solid #c7ccd4;color:#5b6470;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:11px}' +
      '[data-theme="light"] .items-table td,[data-theme="light"] table td{border-bottom:1px solid #d9dde3;color:#2a303a}' +
      '[data-theme="light"] .items-table tr:hover td,[data-theme="light"] table tr:hover td{background:#e8e5d4}' +

      /* Status badges: desaturated */
      '[data-theme="light"] .status-badge{font-weight:500;border-radius:4px}' +
      '[data-theme="light"] .status-badge.status-active{color:#406650;border-color:#b8c8bc;background:#dee4df}' +
      '[data-theme="light"] .status-badge.status-paused{color:#7a6020;border-color:#d4cc9a;background:#e5e0c8}' +
      '[data-theme="light"] .status-badge.status-closed{color:#823838;border-color:#c8b0b0;background:#e4d5d5}' +
      '[data-theme="light"] .status-badge.status-under_review{color:#564074;border-color:#bcb4ca;background:#ddd7e2}' +

      /* KPI cards: with muted yellow top accent */
      '[data-theme="light"] .kpi{background:#eef0f3;border:1px solid #c7ccd4;border-top:3px solid #d9c000;border-radius:8px;box-shadow:0 1px 2px rgba(42,48,58,.04)}' +
      '[data-theme="light"] .kpi:hover{border-color:#a8afb9;box-shadow:0 3px 8px rgba(42,48,58,.06)}' +
      '[data-theme="light"] .kpi h3{color:#6b7580;font-weight:500}' +
      '[data-theme="light"] .kpi .num{color:#2a303a;font-weight:700}' +

      /* KPI accent colors (muted) */
      '[data-theme="light"] .vh-kpi{background:#eef0f3;border:1px solid #c7ccd4;border-radius:8px;box-shadow:0 1px 2px rgba(42,48,58,.04)}' +
      '[data-theme="light"] .vh-kpi-label{color:#6b7580}' +
      '[data-theme="light"] .vh-kpi-val{color:#2a303a}' +
      '[data-theme="light"] .vh-kpi-val.gr{color:#558866}' +
      '[data-theme="light"] .vh-kpi-val.cy{color:#5a7a94}' +
      '[data-theme="light"] .vh-kpi-val.or{color:#a06848}' +
      '[data-theme="light"] .vh-kpi-val.ye{color:#8a7020}' +

      /* Section titles */
      '[data-theme="light"] .section-title{color:#2a303a;font-weight:700;letter-spacing:-.01em;border-bottom:2px solid #d9c000;padding-bottom:8px}' +

      /* Scrollbar */
      '[data-theme="light"] ::-webkit-scrollbar{width:10px;height:10px}' +
      '[data-theme="light"] ::-webkit-scrollbar-track{background:#d9dde3}' +
      '[data-theme="light"] ::-webkit-scrollbar-thumb{background:#a8afb9;border-radius:4px}' +
      '[data-theme="light"] ::-webkit-scrollbar-thumb:hover{background:#8b929c}' +

      /* Account menu */
      '[data-theme="light"] #acct-menu{background:#eef0f3!important;border:1px solid #c7ccd4!important;box-shadow:0 6px 20px rgba(42,48,58,.1)!important;border-radius:8px}' +
      '[data-theme="light"] #acct-menu a,[data-theme="light"] #acct-menu button{color:#2a303a}' +
      '[data-theme="light"] #acct-menu a:hover,[data-theme="light"] #acct-menu button:hover{background:#e4e7ec}' +

      /* Progress bars */
      '[data-theme="light"] .prog-fill,[data-theme="light"] .progress-fill{background:#d9c000}' +
      '[data-theme="light"] .prog,[data-theme="light"] .progress{background:#c7ccd4}' +

      /* Tabs (publicaciones) */
      '[data-theme="light"] .tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:#6b7580;font-weight:500}' +
      '[data-theme="light"] .tab-btn.active{color:#2a303a;border-bottom-color:#d9c000;font-weight:600}' +

      /* Theme dropdown in light */
      '[data-theme="light"] .theme-dd{background:#eef0f3;border-color:#c7ccd4;box-shadow:0 6px 20px rgba(42,48,58,.1)}' +
      '[data-theme="light"] .theme-opt{color:#2a303a}' +
      '[data-theme="light"] .theme-opt:hover{background:#e4e7ec;border-color:#c7ccd4}' +
      '[data-theme="light"] .theme-opt.active{border-color:#d9c000;background:#e8e5d4}' +
      '[data-theme="light"] .theme-toggle{background:#eef0f3;border-color:#c7ccd4;color:#5b6470}' +
      '[data-theme="light"] .theme-toggle:hover{background:#e4e7ec;border-color:#a8afb9}' +

      /* Dropzones */
      '[data-theme="light"] .dropzone,[data-theme="light"] .drop-area{background:#e4e7ec;border:2px dashed #a8afb9;color:#6b7580;border-radius:10px}' +
      '[data-theme="light"] .dropzone:hover,[data-theme="light"] .drop-area:hover,[data-theme="light"] .dropzone.dragover,[data-theme="light"] .drop-area.dragover{background:#e8e5d4;border-color:#d9c000;color:#2a303a}' +

      /* Pagination */
      '[data-theme="light"] .page-btn,[data-theme="light"] .pag-btn{background:#eef0f3;border:1px solid #c7ccd4;color:#5b6470;border-radius:6px}' +
      '[data-theme="light"] .page-btn:hover,[data-theme="light"] .pag-btn:hover{background:#e4e7ec;border-color:#a8afb9}' +
      '[data-theme="light"] .page-btn.active,[data-theme="light"] .pag-btn.active{background:#d9c000;border-color:#d9c000;color:#2a303a;font-weight:600}' +

      /* Modals / overlays */
      '[data-theme="light"] .modal,[data-theme="light"] .overlay{background:rgba(42,48,58,.35)}' +
      '[data-theme="light"] .modal-content,[data-theme="light"] .modal-inner{background:#eef0f3;border:1px solid #c7ccd4;box-shadow:0 16px 40px rgba(42,48,58,.12);border-radius:12px}' +

      /* Stock bars and indicators */
      '[data-theme="light"] .stock-bar{background:#c7ccd4}' +
      '[data-theme="light"] .stock-fill{background:#558866}' +
      '[data-theme="light"] .stock-fill.low{background:#a06848}' +
      '[data-theme="light"] .stock-fill.zero{background:#a04848}' +

      /* Flex/Despacho sections */
      '[data-theme="light"] .flex-section,[data-theme="light"] .ventas-hoy-section{}' +
      '[data-theme="light"] .flex-card{background:#eef0f3;border:1px solid #c7ccd4;border-radius:10px;box-shadow:0 1px 2px rgba(42,48,58,.05)}' +
      '[data-theme="light"] .flex-info h3{color:#2a303a;font-weight:700}' +
      '[data-theme="light"] .flex-info p{color:#5b6470}' +
      '[data-theme="light"] .flex-btn{background:#d9c000;color:#2a303a;border:1px solid #d9c000;font-weight:600;border-radius:8px;box-shadow:0 1px 2px rgba(217,192,0,.2)}' +
      '[data-theme="light"] .flex-btn:hover{background:#c4a800;border-color:#c4a800}' +

      /* Refresh buttons */
      '[data-theme="light"] .vh-refresh{background:#eef0f3;border:1px solid #c7ccd4;color:#5b6470;border-radius:6px}' +
      '[data-theme="light"] .vh-refresh:hover{background:#e4e7ec;border-color:#a8afb9;color:#2a303a}' +

      /* Loading/empty states */
      '[data-theme="light"] .vh-loading,[data-theme="light"] .dh-loading{color:#6b7580}' +
      '[data-theme="light"] .vh-empty,[data-theme="light"] .dh-empty{color:#8b929c;background:#e4e7ec;border-radius:8px}' +

      /* Main container bg */
      '[data-theme="light"] main{background:transparent}' +

      /* Login specific */
      '[data-theme="light"] .login-box,[data-theme="light"] .login-card{background:#eef0f3;border:1px solid #c7ccd4;box-shadow:0 16px 40px rgba(42,48,58,.08);border-radius:12px}' +

      /* Acct button */
      '[data-theme="light"] #acct-btn{background:#eef0f3;border:1px solid #c7ccd4;color:#2a303a;border-radius:6px}' +
      '[data-theme="light"] #acct-btn:hover{background:#e4e7ec;border-color:#a8afb9}';

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
    injectGoogleFonts();
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

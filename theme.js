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
        '--bg':'#f8fafc','--s1':'#ffffff','--s2':'#f1f5f9','--s3':'#e2e8f0',
        '--b1':'#e2e8f0','--b2':'#cbd5e1','--b3':'#94a3b8',
        '--tx':'#0f172a','--t2':'#475569','--t3':'#94a3b8',
        '--ye':'#FFE600','--cy':'#0284c7','--re':'#dc2626','--or':'#ea580c','--gr':'#16a34a','--pu':'#7c3aed',
        '--header-bg':'rgba(255,255,255,.92)','--grid-color':'#e2e8f0','--grid-opacity':'.5',
        '--card-shadow':'0 1px 3px rgba(15,23,42,.06),0 1px 2px rgba(15,23,42,.04)','--btn-primary-bg':'#FFE600','--btn-primary-tx':'#0f172a',
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

      /* Global: Inter + JetBrains Mono, dark text on light bg */
      '[data-theme="light"] body{color:#0f172a;font-family:"Inter",system-ui,-apple-system,sans-serif;font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased;letter-spacing:-.005em}' +
      '[data-theme="light"] code,[data-theme="light"] .mono,[data-theme="light"] [style*="var(--mono)"]{font-family:"JetBrains Mono",ui-monospace,monospace}' +

      /* Background: soft light grid */
      '[data-theme="light"] body::before{opacity:.4!important}' +

      /* Header: crisp white with subtle border + shadow */
      '[data-theme="light"] header{background:rgba(255,255,255,.92)!important;border-bottom:1px solid #e2e8f0!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important;backdrop-filter:blur(12px)}' +

      /* Logo: charcoal with ML yellow dot */
      '[data-theme="light"] .logo{color:#0f172a;letter-spacing:.2em;font-weight:700}' +
      '[data-theme="light"] .logo-dot{background:#FFE600;animation:none;box-shadow:0 0 0 2px rgba(255,230,0,.2)}' +

      /* MeLi badge: bright yellow official */
      '[data-theme="light"] .meli-badge{background:#FFE600;border-color:#FFE600;color:#0f172a;font-weight:700}' +

      /* LIVE indicator: green subtle */
      '[data-theme="light"] .live{color:#16a34a}' +
      '[data-theme="light"] .live-d{background:#16a34a}' +

      /* Updated timestamp */
      '[data-theme="light"] #updated{color:#64748b}' +

      /* Nav buttons: clean pills */
      '[data-theme="light"] .nav-btn{border:1px solid transparent;background:transparent;color:#475569;font-weight:500;letter-spacing:.08em;border-radius:6px;transition:all .15s}' +
      '[data-theme="light"] .nav-btn:hover{color:#0f172a;background:#f1f5f9;border-color:#e2e8f0}' +
      '[data-theme="light"] .nav-btn.active{color:#0f172a;background:#FFE600;border-color:#FFE600;font-weight:600}' +

      /* Buttons: primary yellow, secondary ghost */
      '[data-theme="light"] .btn{border:1px solid #cbd5e1;background:#ffffff;color:#334155;font-weight:500;border-radius:6px;transition:all .15s;box-shadow:0 1px 2px rgba(15,23,42,.04)}' +
      '[data-theme="light"] .btn:hover{border-color:#94a3b8;background:#f8fafc;color:#0f172a}' +
      '[data-theme="light"] .btn.primary{background:#FFE600;color:#0f172a;border-color:#FFE600;font-weight:600;box-shadow:0 1px 3px rgba(255,230,0,.3)}' +
      '[data-theme="light"] .btn.primary:hover{background:#e8d100;border-color:#e8d100;color:#0f172a}' +
      '[data-theme="light"] .btn.danger{background:#dc2626;color:#ffffff;border-color:#dc2626}' +
      '[data-theme="light"] .btn.danger:hover{background:#b91c1c;border-color:#b91c1c}' +

      /* Cards: white with subtle shadow */
      '[data-theme="light"] .card{background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 1px 3px rgba(15,23,42,.06),0 1px 2px rgba(15,23,42,.04)}' +
      '[data-theme="light"] .card-header{border-bottom-color:#e2e8f0;background:#f8fafc}' +
      '[data-theme="light"] .card-title{color:#64748b;letter-spacing:.14em;font-weight:600;text-transform:uppercase;font-size:11px}' +

      /* Fields: clean inputs */
      '[data-theme="light"] .field select,[data-theme="light"] .field input,[data-theme="light"] input[type="text"],[data-theme="light"] input[type="number"],[data-theme="light"] input[type="email"],[data-theme="light"] input[type="password"],[data-theme="light"] input[type="date"],[data-theme="light"] textarea{background:#ffffff;border:1px solid #cbd5e1;color:#0f172a;border-radius:6px;transition:all .15s}' +
      '[data-theme="light"] .field select:focus,[data-theme="light"] .field input:focus,[data-theme="light"] input:focus,[data-theme="light"] textarea:focus{border-color:#FFE600;outline:2px solid rgba(255,230,0,.2);outline-offset:0}' +
      '[data-theme="light"] .field label{color:#64748b;letter-spacing:.08em;font-weight:500}' +

      /* Tables: clean rows */
      '[data-theme="light"] .items-table,[data-theme="light"] table{background:#ffffff}' +
      '[data-theme="light"] .items-table th,[data-theme="light"] table th{background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:11px}' +
      '[data-theme="light"] .items-table td,[data-theme="light"] table td{border-bottom:1px solid #f1f5f9;color:#0f172a}' +
      '[data-theme="light"] .items-table tr:hover td,[data-theme="light"] table tr:hover td{background:#fffbea}' +

      /* Status badges */
      '[data-theme="light"] .status-badge{font-weight:500;border-radius:4px}' +
      '[data-theme="light"] .status-badge.status-active{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}' +
      '[data-theme="light"] .status-badge.status-paused{color:#a16207;border-color:#fef08a;background:#fefce8}' +
      '[data-theme="light"] .status-badge.status-closed{color:#b91c1c;border-color:#fecaca;background:#fef2f2}' +
      '[data-theme="light"] .status-badge.status-under_review{color:#6d28d9;border-color:#ddd6fe;background:#faf5ff}' +

      /* KPI cards: clean with yellow top accent */
      '[data-theme="light"] .kpi{background:#ffffff;border:1px solid #e2e8f0;border-top:3px solid #FFE600;border-radius:8px;box-shadow:0 1px 3px rgba(15,23,42,.05)}' +
      '[data-theme="light"] .kpi:hover{border-color:#cbd5e1;box-shadow:0 4px 12px rgba(15,23,42,.08)}' +
      '[data-theme="light"] .kpi h3{color:#64748b;font-weight:500}' +
      '[data-theme="light"] .kpi .num{color:#0f172a;font-weight:700}' +

      /* KPI accent colors adjust for light bg */
      '[data-theme="light"] .vh-kpi{background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 1px 3px rgba(15,23,42,.05)}' +
      '[data-theme="light"] .vh-kpi-label{color:#64748b}' +
      '[data-theme="light"] .vh-kpi-val{color:#0f172a}' +
      '[data-theme="light"] .vh-kpi-val.gr{color:#16a34a}' +
      '[data-theme="light"] .vh-kpi-val.cy{color:#0284c7}' +
      '[data-theme="light"] .vh-kpi-val.or{color:#ea580c}' +
      '[data-theme="light"] .vh-kpi-val.ye{color:#ca8a04}' +

      /* Section titles */
      '[data-theme="light"] .section-title{color:#0f172a;font-weight:700;letter-spacing:-.01em;border-bottom:2px solid #FFE600;padding-bottom:8px}' +

      /* Scrollbar */
      '[data-theme="light"] ::-webkit-scrollbar{width:10px;height:10px}' +
      '[data-theme="light"] ::-webkit-scrollbar-track{background:#f1f5f9}' +
      '[data-theme="light"] ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}' +
      '[data-theme="light"] ::-webkit-scrollbar-thumb:hover{background:#94a3b8}' +

      /* Account menu */
      '[data-theme="light"] #acct-menu{background:#ffffff!important;border:1px solid #e2e8f0!important;box-shadow:0 8px 24px rgba(15,23,42,.12)!important;border-radius:8px}' +
      '[data-theme="light"] #acct-menu a,[data-theme="light"] #acct-menu button{color:#0f172a}' +
      '[data-theme="light"] #acct-menu a:hover,[data-theme="light"] #acct-menu button:hover{background:#f8fafc}' +

      /* Progress bars */
      '[data-theme="light"] .prog-fill,[data-theme="light"] .progress-fill{background:#FFE600}' +
      '[data-theme="light"] .prog,[data-theme="light"] .progress{background:#e2e8f0}' +

      /* Tabs (publicaciones) */
      '[data-theme="light"] .tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;font-weight:500}' +
      '[data-theme="light"] .tab-btn.active{color:#0f172a;border-bottom-color:#FFE600;font-weight:600}' +

      /* Theme dropdown in light */
      '[data-theme="light"] .theme-dd{background:#ffffff;border-color:#e2e8f0;box-shadow:0 8px 24px rgba(15,23,42,.12)}' +
      '[data-theme="light"] .theme-opt{color:#0f172a}' +
      '[data-theme="light"] .theme-opt:hover{background:#f8fafc;border-color:#e2e8f0}' +
      '[data-theme="light"] .theme-opt.active{border-color:#FFE600;background:#fffbea}' +
      '[data-theme="light"] .theme-toggle{background:#ffffff;border-color:#e2e8f0;color:#475569}' +
      '[data-theme="light"] .theme-toggle:hover{background:#f8fafc;border-color:#cbd5e1}' +

      /* Dropzones */
      '[data-theme="light"] .dropzone,[data-theme="light"] .drop-area{background:#f8fafc;border:2px dashed #cbd5e1;color:#64748b;border-radius:10px}' +
      '[data-theme="light"] .dropzone:hover,[data-theme="light"] .drop-area:hover,[data-theme="light"] .dropzone.dragover,[data-theme="light"] .drop-area.dragover{background:#fffbea;border-color:#FFE600;color:#0f172a}' +

      /* Pagination */
      '[data-theme="light"] .page-btn,[data-theme="light"] .pag-btn{background:#ffffff;border:1px solid #e2e8f0;color:#475569;border-radius:6px}' +
      '[data-theme="light"] .page-btn:hover,[data-theme="light"] .pag-btn:hover{background:#f8fafc;border-color:#cbd5e1}' +
      '[data-theme="light"] .page-btn.active,[data-theme="light"] .pag-btn.active{background:#FFE600;border-color:#FFE600;color:#0f172a;font-weight:600}' +

      /* Modals / overlays */
      '[data-theme="light"] .modal,[data-theme="light"] .overlay{background:rgba(15,23,42,.4)}' +
      '[data-theme="light"] .modal-content,[data-theme="light"] .modal-inner{background:#ffffff;border:1px solid #e2e8f0;box-shadow:0 20px 50px rgba(15,23,42,.15);border-radius:12px}' +

      /* Stock bars and indicators */
      '[data-theme="light"] .stock-bar{background:#e2e8f0}' +
      '[data-theme="light"] .stock-fill{background:#16a34a}' +
      '[data-theme="light"] .stock-fill.low{background:#ea580c}' +
      '[data-theme="light"] .stock-fill.zero{background:#dc2626}' +

      /* Flex/Despacho sections */
      '[data-theme="light"] .flex-section,[data-theme="light"] .ventas-hoy-section{}' +
      '[data-theme="light"] .flex-card{background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 1px 3px rgba(15,23,42,.06)}' +
      '[data-theme="light"] .flex-info h3{color:#0f172a;font-weight:700}' +
      '[data-theme="light"] .flex-info p{color:#475569}' +
      '[data-theme="light"] .flex-btn{background:#FFE600;color:#0f172a;border:1px solid #FFE600;font-weight:600;border-radius:8px;box-shadow:0 1px 3px rgba(255,230,0,.3)}' +
      '[data-theme="light"] .flex-btn:hover{background:#e8d100;border-color:#e8d100}' +

      /* Refresh buttons */
      '[data-theme="light"] .vh-refresh{background:#ffffff;border:1px solid #e2e8f0;color:#475569;border-radius:6px}' +
      '[data-theme="light"] .vh-refresh:hover{background:#f8fafc;border-color:#cbd5e1;color:#0f172a}' +

      /* Loading/empty states */
      '[data-theme="light"] .vh-loading,[data-theme="light"] .dh-loading{color:#64748b}' +
      '[data-theme="light"] .vh-empty,[data-theme="light"] .dh-empty{color:#94a3b8;background:#f8fafc;border-radius:8px}' +

      /* Main container bg */
      '[data-theme="light"] main{background:transparent}' +

      /* Login specific */
      '[data-theme="light"] .login-box,[data-theme="light"] .login-card{background:#ffffff;border:1px solid #e2e8f0;box-shadow:0 20px 50px rgba(15,23,42,.08);border-radius:12px}' +

      /* Acct button */
      '[data-theme="light"] #acct-btn{background:#ffffff;border:1px solid #e2e8f0;color:#0f172a;border-radius:6px}' +
      '[data-theme="light"] #acct-btn:hover{background:#f8fafc;border-color:#cbd5e1}';

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

/* ─────────────────────────────────────────────────────────────
   shell.js — Layout compartido del Dashboard (sidebar + header)
   Uso:
     <body data-shell-page="analytics" data-shell-title="Stock & Analytics" data-shell-subtitle="Velocidad, alertas y catálogo">
     <script src="https://cdn.tailwindcss.com"></script>
     <script src="/shell.js" defer></script>

   Hace:
     - Configura Tailwind (brand yellow, Inter, JetBrains Mono)
     - Inyecta hojas de fuentes Google
     - Oculta el <header> viejo (queda en DOM para scripts existentes)
     - Inyecta sidebar icon-only + nuevo header top-right
     - Cablea el selector de cuentas (/accounts, /accounts/switch)
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── 1. Configurar Tailwind ──────────────────────────────────
  if (window.tailwind && window.tailwind.config) {
    window.tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
          },
          colors: {
            brand: {
              DEFAULT: '#FFE600', 50: '#FFFBE5', 100: '#FFF7B8', 200: '#FFEF70',
              300: '#FFE82E', 400: '#FFE600', 500: '#E6CF00', 600: '#B8A600',
            },
          },
          boxShadow: {
            soft: '0 1px 2px 0 rgb(0 0 0 / 0.3), 0 1px 3px 0 rgb(0 0 0 / 0.2)',
            pop:  '0 10px 30px -10px rgb(0 0 0 / 0.6)',
          },
        },
      },
    };
  }

  // ── 2. Fuentes + estilos base (inyectados al head) ─────────
  function injectHead() {
    // Google Fonts
    if (!document.querySelector('link[href*="Inter"]')) {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
      document.head.appendChild(fontLink);

      const pre1 = document.createElement('link');
      pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
      document.head.appendChild(pre1);
      const pre2 = document.createElement('link');
      pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = '';
      document.head.appendChild(pre2);
    }

    // Estilos del shell
    const style = document.createElement('style');
    style.id = 'shell-styles';
    style.textContent = `
      /* tipografías */
      body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; background: #0a0a0a; color: #e4e4e7; }
      .font-mono, code, kbd, pre { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      /* kill all browser default blues (accent, selection, autofill, links, focus) */
      html, body, input, select, textarea, button { accent-color: #FFE600; color-scheme: dark; }
      ::selection { background: rgba(255,230,0,.35); color: #fff; }
      ::-moz-selection { background: rgba(255,230,0,.35); color: #fff; }
      a { color: inherit; }
      *:focus-visible { outline: 1px solid #FFE600; outline-offset: 2px; }
      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      textarea:-webkit-autofill,
      select:-webkit-autofill {
        -webkit-text-fill-color: #d4d4d8 !important;
        -webkit-box-shadow: 0 0 0 1000px #171717 inset !important;
        caret-color: #FFE600;
      }

      /* oculta el header viejo pero lo deja en DOM (p/ scripts legacy) */
      body[data-shell-page] > .app > header:first-of-type,
      body[data-shell-page] > header.legacy,
      body[data-shell-page] > .app > header.legacy { display: none !important; }

      /* oculta componentes de mobile.css — el shell ya provee navegación */
      body[data-shell-page] > .m-bottom-nav,
      body[data-shell-page] > .m-drawer,
      body[data-shell-page] > .m-drawer-overlay,
      body[data-shell-page] > .m-fab { display: none !important; }

      /* desactiva el body::before grid (lo reemplaza el radial del shell) */
      body[data-shell-page]::before { display: none !important; }

      /* scrollbar */
      *::-webkit-scrollbar { width: 10px; height: 10px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { background: #262626; border-radius: 10px; }
      *::-webkit-scrollbar-thumb:hover { background: #404040; }

      /* radial glow de fondo — brand yellow only, sin azul */
      body[data-shell-page]::after {
        content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
        background:
          radial-gradient(circle at 20% 10%, rgba(255,230,0,0.04) 0%, transparent 40%),
          radial-gradient(circle at 80% 90%, rgba(255,230,0,0.02) 0%, transparent 40%);
      }

      /* SIDEBAR */
      .shell-side {
        position: fixed; left: 0; top: 0; bottom: 0; width: 64px;
        background: #171717; border-right: 1px solid #262626;
        display: flex; flex-direction: column; align-items: center; padding: 16px 0; z-index: 40;
      }
      .shell-side-logo {
        width: 40px; height: 40px; border-radius: 12px; background: #FFE600;
        display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
        box-shadow: 0 10px 30px -10px rgba(0,0,0,.6); color: #0a0a0a;
      }
      .shell-side-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
      .shell-side-bottom { display: flex; flex-direction: column; gap: 4px; margin-top: auto; }
      .shell-side-item {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        width: 44px; height: 44px; border-radius: 12px;
        color: #71717a; transition: background .2s, color .2s;
        text-decoration: none; cursor: pointer; border: none; background: transparent;
      }
      .shell-side-item:hover { background: #1a1a1a; color: #e4e4e7; }
      .shell-side-item.active { background: #1a1a1a; color: #FFE600; }
      .shell-side-item.active::before {
        content: ''; position: absolute; left: -12px; top: 50%; transform: translateY(-50%);
        width: 3px; height: 22px; background: #FFE600; border-radius: 2px;
      }
      .shell-side-item .tip {
        position: absolute; left: 60px; top: 50%; transform: translateY(-50%);
        background: #171717; color: #e4e4e7; font-size: 11px; font-weight: 500;
        padding: 6px 10px; border-radius: 8px; border: 1px solid #262626;
        white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity .15s, transform .15s; letter-spacing: .02em; z-index: 60;
      }
      .shell-side-item:hover .tip { opacity: 1; transform: translateY(-50%) translateX(4px); }

      /* HEADER — replica del dashboard (index.html) */
      .shell-wrap {
        padding-left: 64px; min-height: 100vh; position: relative; z-index: 10;
      }
      .shell-head {
        position: sticky; top: 0; z-index: 30;
        background: rgba(10,10,10,0.80); backdrop-filter: blur(16px);
        border-bottom: 1px solid #262626;
      }
      .shell-head-inner {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 16px 20px;
      }
      @media (min-width: 1024px) {
        .shell-head-inner { padding: 16px 28px; }
      }
      .shell-head h1 {
        font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: #f5f5f5; margin: 0;
      }
      .shell-head .sub {
        font-size: 11px; color: #737373; margin-top: 2px;
        display: flex; align-items: center; gap: 8px;
      }
      .shell-dot {
        position: relative; width: 8px; height: 8px; border-radius: 50%; background: #22c55e;
      }
      .shell-dot::after {
        content: ''; position: absolute; inset: -4px; border-radius: 50%;
        background: #22c55e; opacity: .35; animation: shell-ring 2s ease-out infinite;
      }
      @keyframes shell-ring { 0% { transform: scale(.6); opacity: .6; } 100% { transform: scale(1.8); opacity: 0; } }

      .shell-btn {
        display: inline-flex; align-items: center; gap: 8px;
        background: #171717; border: 1px solid #262626; color: #d4d4d8;
        padding: 8px 12px; border-radius: 12px; font-size: 13px;
        cursor: pointer; transition: border-color .2s, background .2s;
        text-decoration: none;
      }
      .shell-btn:hover { border-color: #404040; background: #1a1a1a; }

      /* content wrap — solo si NO está envuelto en .shell-wrap */
      body[data-shell-page] > .app:not(.shell-wrap),
      body[data-shell-page] > main:not(.shell-wrap) {
        padding-left: 64px;
        position: relative; z-index: 10;
      }

      /* popover panels */
      .shell-pop {
        position: absolute; right: 0; top: calc(100% + 8px); z-index: 50;
        background: #171717; border: 1px solid #262626; border-radius: 12px;
        box-shadow: 0 10px 30px -10px rgba(0,0,0,.6);
        animation: shell-popIn .18s ease-out both;
      }
      @keyframes shell-popIn {
        from { opacity: 0; transform: scale(.96) translateY(-4px); }
        to { opacity: 1; transform: none; }
      }

      .shell-chip {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 10px; font-weight: 500; padding: 3px 8px; border-radius: 999px;
      }
      .shell-chip-brand { background: rgba(255,230,0,.1); color: #FFE600; border: 1px solid rgba(255,230,0,.25); }
    `;
    document.head.appendChild(style);
  }

  // ── 3. Navegación del sidebar ──────────────────────────────
  const NAV = [
    { id: 'home',          href: '/',                  label: 'Dashboard',      icon: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/>' },
    { id: 'analytics',     href: '/analytics.html',    label: 'Stock & Analytics', icon: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>' },
    { id: 'publicaciones', href: '/publicaciones.html', label: 'Publicar',       icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    { id: 'vinculaciones', href: '/vinculaciones.html', label: 'Vinculaciones',  icon: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>' },
    { id: 'migracion',     href: '/migracion.html',    label: 'Migración',      icon: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>' },
    { id: 'cobros',        href: '/cobros.html',       label: 'Cobros',         icon: '<path d="M20 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/>' },
    { id: 'despachos',     href: '/despachos.html',    label: 'Despachos',      icon: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' },
    { id: 'preguntas',     href: '/preguntas.html',    label: 'Preguntas',      icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
  ];

  function buildSidebar(activeId) {
    const aside = document.createElement('aside');
    aside.className = 'shell-side';
    aside.innerHTML = `
      <div class="shell-side-logo">
        <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
      </div>
      <nav class="shell-side-nav">
        ${NAV.map(n => `
          <a href="${n.href}" class="shell-side-item ${n.id === activeId ? 'active' : ''}" aria-label="${n.label}">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${n.icon}</svg>
            <span class="tip">${n.label}</span>
          </a>`).join('')}
      </nav>
      <div class="shell-side-bottom">
        <button id="shell-btn-oauth" class="shell-side-item" aria-label="Nueva cuenta ML" onclick="location.href='/oauth/start'">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          <span class="tip">Conectar cuenta ML</span>
        </button>
        <a href="/logout" class="shell-side-item" aria-label="Cerrar sesión">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span class="tip">Cerrar sesión</span>
        </a>
      </div>`;
    return aside;
  }

  // ── 4. Header superior ─────────────────────────────────────
  function buildHeader(title, subtitle) {
    const h = document.createElement('header');
    h.className = 'shell-head';
    h.innerHTML = `
      <div class="shell-head-inner">
        <div style="min-width:0">
          <h1>${title || 'Stockroom'}</h1>
          <p class="sub">
            <span class="shell-dot"></span>
            <span id="shell-subtitle">${subtitle || 'MercadoLibre Argentina'}</span>
          </p>
        </div>
        <div style="display:flex; align-items:center; gap:8px">
          <!-- account switcher -->
          <div style="position:relative">
            <button id="shell-acc-btn" class="shell-btn">
              <span id="shell-acc-initial" style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#FFE600,#B8A600);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0a0a0a">?</span>
              <span id="shell-acc-label" style="font-size:12px;font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Cargando…</span>
              <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#71717a"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="shell-acc-panel" class="shell-pop" style="display:none;width:272px;overflow:hidden">
              <div style="padding:12px;border-bottom:1px solid #262626">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#737373;font-weight:500;margin-bottom:4px">Cuenta activa</div>
                <div id="shell-acc-active" style="font-size:13px;color:#e4e4e7;font-weight:500">—</div>
                <div id="shell-acc-active-id" style="font-size:11px;font-family:'JetBrains Mono',monospace;color:#737373;margin-top:2px">—</div>
              </div>
              <div id="shell-acc-list" style="max-height:240px;overflow-y:auto;padding:4px 0"></div>
              <div style="padding:8px;border-top:1px solid #262626">
                <a href="/oauth/start" style="display:block;text-align:center;font-size:11px;color:#d4d4d8;background:#262626;padding:6px;border-radius:8px;text-decoration:none">+ Nueva cuenta</a>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    return h;
  }

  // ── 5. Cablear account switcher ───────────────────────────
  async function wireAccountSwitcher() {
    try {
      const r = await fetch('/accounts');
      if (!r.ok) return;
      const d = await r.json();
      const active = d.accounts.find(a => a.active);
      const labelEl  = document.getElementById('shell-acc-label');
      const initEl   = document.getElementById('shell-acc-initial');
      const activeEl = document.getElementById('shell-acc-active');
      const idEl     = document.getElementById('shell-acc-active-id');
      const listEl   = document.getElementById('shell-acc-list');

      if (active && labelEl) {
        labelEl.textContent = active.label;
        initEl.textContent = (active.label || '?').trim().charAt(0).toUpperCase();
        activeEl.textContent = active.label;
        idEl.textContent = active.user_id ? 'ID ' + active.user_id : '—';
      }

      if (listEl) {
        listEl.innerHTML = d.accounts.map(a => `
          <button data-shell-acct="${escapeHtml(a.id)}" style="width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;background:${a.active ? '#262626' : 'transparent'};border:none;cursor:pointer;text-align:left;transition:background .15s" onmouseenter="this.style.background='#1f1f1f'" onmouseleave="this.style.background='${a.active ? '#262626' : 'transparent'}'">
            <span style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FFE600,#B8A600);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0a0a0a;flex-shrink:0">${escapeHtml((a.label || '?').trim().charAt(0).toUpperCase())}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:500;color:#f5f5f5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.label)}</div>
              <div style="font-size:10px;font-family:'JetBrains Mono',monospace;color:#737373">${escapeHtml(a.user_id || '—')}</div>
            </div>
            ${a.active ? '<svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="#FFE600" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            ${!a.has_token ? '<span style="font-size:9px;color:#f87171;font-family:monospace">SIN TOKEN</span>' : ''}
          </button>`).join('');

        listEl.querySelectorAll('[data-shell-acct]').forEach(btn => {
          btn.addEventListener('click', async () => {
            await fetch('/accounts/switch', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: btn.dataset.shellAcct })
            });
            location.reload();
          });
        });
      }
    } catch (e) { console.error('[shell] accounts', e); }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── 6. Wiring de interacciones ─────────────────────────────
  function wireInteractions() {
    const accBtn = document.getElementById('shell-acc-btn');
    const accPanel = document.getElementById('shell-acc-panel');

    document.addEventListener('click', (e) => {
      if (e.target.closest('#shell-acc-btn')) {
        accPanel.style.display = accPanel.style.display === 'none' ? 'block' : 'none';
      } else if (!e.target.closest('#shell-acc-panel')) {
        accPanel.style.display = 'none';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') accPanel.style.display = 'none';
    });
  }

  // ── 7. Boot ───────────────────────────────────────────────
  function boot() {
    const body = document.body;
    if (!body.hasAttribute('data-shell-page')) return;

    const activeId = body.getAttribute('data-shell-page');
    const title    = body.getAttribute('data-shell-title') || 'Stockroom';
    const subtitle = body.getAttribute('data-shell-subtitle') || '';

    injectHead();

    // Sidebar
    body.insertBefore(buildSidebar(activeId), body.firstChild);

    // Wrapper .shell-wrap (replica del dashboard: <div class="pl-16 min-h-screen relative z-10">)
    // Envuelve el <main> (o .app) y mete el header adentro, ANTES del main.
    const header = buildHeader(title, subtitle);
    const app    = document.querySelector('body > .app');
    const mainEl = document.querySelector('body > main, body > .app > main');
    const target = mainEl || app;

    if (target) {
      const wrap = document.createElement('div');
      wrap.className = 'shell-wrap';
      target.parentNode.insertBefore(wrap, target);
      wrap.appendChild(header);
      wrap.appendChild(target);
    } else {
      body.appendChild(header);
    }

    wireInteractions();
    wireAccountSwitcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ── STOCKROOM · Mobile UX Layer ──────────────────────────────────
   Injected on screens <= 768px.  Adds:
     • Bottom navigation bar  (5 items)
     • Drawer menu            (account switcher, config, OAuth)
     • Floating Action Button  (contextual per page)
   Desktop layout is UNTOUCHED — everything is gated behind matchMedia.
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── only run on mobile ───────────────────────────────────── */
  var initialized = false;
  var MQ = window.matchMedia('(max-width: 768px)');

  function boot() {
    if (initialized) return;
    if (!MQ.matches) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot); return; }
    initialized = true;
    injectBottomNav();
    injectDrawer();
    injectFAB();
    adjustBodyPadding();
  }

  MQ.addEventListener('change', boot);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ── helpers ───────────────────────────────────────────────── */
  function currentPage() {
    const p = location.pathname;
    if (p === '/' || p.endsWith('index.html')) return 'stock';
    if (p.includes('analytics'))   return 'analytics';
    if (p.includes('publicaciones')) return 'publicar';
    if (p.includes('migracion'))   return 'migrar';
    return 'stock';
  }

  /* ── SVG icons (inline, small) ─────────────────────────────── */
  const ICONS = {
    stock: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    publicar: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    migrar: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    mas: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    add: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  };

  /* ══════════════════════════════════════════════════════════════
     BOTTOM NAVIGATION BAR
     ══════════════════════════════════════════════════════════════ */
  function injectBottomNav() {
    const page = currentPage();
    const nav = document.createElement('nav');
    nav.className = 'm-bottom-nav';

    const items = [
      { id: 'stock',     label: 'Stock',     icon: ICONS.stock,     href: '/' },
      { id: 'analytics', label: 'Analytics', icon: ICONS.analytics, href: '/analytics.html' },
      { id: 'publicar',  label: 'Publicar',  icon: ICONS.publicar,  href: '/publicaciones.html' },
      { id: 'migrar',    label: 'Migrar',    icon: ICONS.migrar,    href: '/migracion.html' },
      { id: 'mas',       label: 'Más',       icon: ICONS.mas,       href: '#drawer' },
    ];

    items.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'm-nav-item' + (it.id === page ? ' active' : '');
      a.href = it.href;
      a.innerHTML = '<span class="m-nav-icon">' + it.icon + '</span>' +
                    '<span class="m-nav-label">' + it.label + '</span>';

      if (it.id === 'mas') {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          openDrawer();
        });
      }
      nav.appendChild(a);
    });

    document.body.appendChild(nav);
  }

  /* ══════════════════════════════════════════════════════════════
     DRAWER MENU
     ══════════════════════════════════════════════════════════════ */
  function injectDrawer() {
    /* overlay */
    var overlay = document.createElement('div');
    overlay.className = 'm-drawer-overlay';
    overlay.addEventListener('click', closeDrawer);

    /* drawer panel */
    var drawer = document.createElement('div');
    drawer.className = 'm-drawer';
    drawer.id = 'm-drawer';

    drawer.innerHTML =
      '<div class="m-drawer-header">' +
        '<div class="m-drawer-title">' +
          '<div class="logo-dot" style="width:10px;height:10px;margin-right:8px"></div>' +
          'STOCKROOM' +
        '</div>' +
        '<button class="m-drawer-close" aria-label="Cerrar">' + ICONS.close + '</button>' +
      '</div>' +
      '<div class="m-drawer-body">' +
        '<div class="m-drawer-section">' +
          '<div class="m-drawer-section-title">CUENTA ACTIVA</div>' +
          '<div id="m-drawer-acct" class="m-drawer-acct">Cargando...</div>' +
        '</div>' +
        '<div class="m-drawer-section">' +
          '<div class="m-drawer-section-title">CUENTAS</div>' +
          '<div id="m-drawer-acct-list" class="m-drawer-acct-list"></div>' +
        '</div>' +
        '<div class="m-drawer-divider"></div>' +
        '<a href="#" class="m-drawer-link" id="m-drawer-config">Configuraci&oacute;n</a>' +
        '<a href="/oauth/start" class="m-drawer-link">Autorizar nueva cuenta</a>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    /* close button */
    drawer.querySelector('.m-drawer-close').addEventListener('click', closeDrawer);

    /* config link triggers existing showSetup if available */
    drawer.querySelector('#m-drawer-config').addEventListener('click', function (e) {
      e.preventDefault();
      closeDrawer();
      if (typeof showSetup === 'function') showSetup();
    });

    /* load accounts into drawer */
    loadDrawerAccounts();
  }

  async function loadDrawerAccounts() {
    try {
      var r = await fetch('/accounts');
      var data = await r.json();
      var accounts = data.accounts || [];
      var active = accounts.find(function (a) { return a.active; });

      /* active label */
      var el = document.getElementById('m-drawer-acct');
      if (el && active) {
        el.textContent = active.label || active.id;
      }

      /* account list */
      var list = document.getElementById('m-drawer-acct-list');
      if (list) {
        list.innerHTML = accounts.map(function (a) {
          var isCurrent = a.active ? ' style="color:#e8ff47;font-weight:700"' : '';
          return '<a href="#" class="m-drawer-link m-drawer-acct-item" data-id="' + a.id + '"' + isCurrent + '>' +
                   (a.active ? '● ' : '') + (a.label || a.id) +
                 '</a>';
        }).join('');

        list.querySelectorAll('.m-drawer-acct-item').forEach(function (el) {
          el.addEventListener('click', function (e) {
            e.preventDefault();
            var id = this.getAttribute('data-id');
            if (typeof switchAccount === 'function') {
              switchAccount(id);
            } else {
              fetch('/accounts/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
              }).then(function () { location.reload(); });
            }
            closeDrawer();
          });
        });
      }
    } catch (e) { /* silently fail on desktop or network error */ }
  }

  function openDrawer() {
    document.querySelector('.m-drawer-overlay').classList.add('open');
    document.getElementById('m-drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    document.querySelector('.m-drawer-overlay').classList.remove('open');
    document.getElementById('m-drawer').classList.remove('open');
    document.body.style.overflow = '';
  }

  /* make globally accessible */
  window.mobileOpenDrawer = openDrawer;
  window.mobileCloseDrawer = closeDrawer;

  /* ══════════════════════════════════════════════════════════════
     FLOATING ACTION BUTTON (FAB)
     ══════════════════════════════════════════════════════════════ */
  function injectFAB() {
    var page = currentPage();
    var fab = document.createElement('button');
    fab.className = 'm-fab';
    fab.setAttribute('aria-label', 'Acción principal');

    switch (page) {
      case 'stock':
        fab.innerHTML = ICONS.refresh;
        fab.title = 'Actualizar stock';
        fab.addEventListener('click', function () {
          if (typeof loadItems === 'function') loadItems();
          else location.reload();
        });
        break;

      case 'analytics':
        fab.innerHTML = ICONS.refresh;
        fab.title = 'Actualizar datos';
        fab.addEventListener('click', function () {
          if (typeof loadAnalytics === 'function') loadAnalytics();
          else location.reload();
        });
        break;

      case 'publicar':
        fab.innerHTML = ICONS.add;
        fab.title = 'Publicar';
        fab.addEventListener('click', function () {
          /* scroll to the publish button or trigger publish */
          var pubBtn = document.querySelector('#btn-publish') ||
                       document.querySelector('button[onclick*="publish"]') ||
                       document.querySelector('.btn.primary');
          if (pubBtn) {
            pubBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function () { pubBtn.click(); }, 400);
          }
        });
        break;

      case 'migrar':
        fab.innerHTML = ICONS.copy;
        fab.title = 'Migrar seleccionados';
        fab.addEventListener('click', function () {
          var migBtn = document.querySelector('#btn-migrate') ||
                       document.querySelector('button[onclick*="migra"]') ||
                       document.querySelector('.btn.primary');
          if (migBtn) {
            migBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function () { migBtn.click(); }, 400);
          }
        });
        break;
    }

    document.body.appendChild(fab);
  }

  /* ══════════════════════════════════════════════════════════════
     BODY PADDING (space for bottom nav)
     ══════════════════════════════════════════════════════════════ */
  function adjustBodyPadding() {
    document.body.style.paddingBottom = '72px';
  }

})();

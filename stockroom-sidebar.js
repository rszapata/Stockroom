/* ──────────────────────────────────────────────────────────────
 * stockroom-sidebar.js — Sidebar único de Stockroom/ML
 *
 * Reemplaza el <aside id="sidebar"> hardcodeado que estaba duplicado
 * (y desincronizado) en cada página de Stockroom. Cada página solo
 * necesita:
 *     <aside class="adm-sidebar" id="sidebar"></aside>
 *     <script src="/stockroom-sidebar.js?v=1"></script>
 *
 * El item activo se detecta por location.pathname.
 * index.html NO usa este script: tiene su propio sidebar con el botón
 * de Configuración (modal de cuentas ML) y los badges de notificación.
 * ────────────────────────────────────────────────────────────── */
(function () {
  function activeKey() {
    const p = (location.pathname || '').toLowerCase();
    if (p === '/' || p.includes('index.html'))   return 'dashboard';
    if (p.includes('analytics'))                 return 'analytics';
    if (p.includes('despachos'))                 return 'despachos';
    if (p.includes('cobros'))                    return 'cobros';
    if (p.includes('verificar-envios'))          return 'verificar';
    if (p.includes('publicaciones'))             return 'publicaciones';
    if (p.includes('vinculaciones'))             return 'vinculaciones';
    if (p.includes('migracion'))                 return 'migracion';
    if (p.includes('alibaba'))                   return 'alibaba';
    if (p.includes('preguntas'))                 return 'preguntas';
    if (p.includes('tienda-admin'))              return 'tienda';
    return '';
  }

  const cur = activeKey();
  const A = k => 'adm-item' + (cur === k ? ' active' : '');

  const html = `
  <a href="/" class="adm-logo">
    <div class="adm-logo-mark">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/>
      </svg>
    </div>
    <div class="adm-logo-text">
      <div class="adm-logo-name">Stockroom</div>
      <div class="adm-logo-tag">Panel Admin</div>
    </div>
  </a>

  <nav class="adm-nav">

    <div class="adm-group">
      <div class="adm-group-label">Ventas</div>
      <a href="/" class="${A('dashboard')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <span>Dashboard</span>
      </a>
      <a href="/analytics.html" class="${A('analytics')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
        <span>Analytics</span>
      </a>
      <a href="/despachos.html" class="${A('despachos')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        <span>Despachos</span>
        <span class="adm-item-badge info" id="nav-desp-badge" style="display:none">0</span>
      </a>
      <a href="/cobros.html" class="${A('cobros')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/></svg>
        <span>Cobros</span>
      </a>
      <a href="/verificar-envios.html" class="${A('verificar')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.56.93 6.18 2.45"/></svg>
        <span>Verificar Logística</span>
      </a>
    </div>

    <div class="adm-group">
      <div class="adm-group-label">Catálogo</div>
      <a href="/publicaciones.html" class="${A('publicaciones')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <span>Publicaciones</span>
      </a>
      <a href="/vinculaciones.html" class="${A('vinculaciones')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        <span>Vinculaciones</span>
      </a>
      <a href="/migracion.html" class="${A('migracion')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
        <span>Migración</span>
      </a>
      <a href="/alibaba.html" class="${A('alibaba')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
        <span>Carga Alibaba</span>
      </a>
    </div>

    <div class="adm-group">
      <div class="adm-group-label">Clientes</div>
      <a href="/preguntas.html" class="${A('preguntas')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span>Preguntas</span>
        <span class="adm-item-badge" id="nav-preg-badge" style="display:none">0</span>
      </a>
    </div>
    <div class="adm-group">
      <div class="adm-group-label">Tienda</div>
      <a href="/tienda-admin.html" class="${A('tienda')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
        <span>Admin Tienda</span>
      </a>
    </div>

  </nav>

  <div class="adm-sidebar-foot">
    <a href="/oauth/start" class="adm-item">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
      <span>Conectar cuenta</span>
    </a>
    <a href="/logout" class="adm-item" style="color:var(--red)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <span>Cerrar sesión</span>
    </a>
  </div>

  <div class="foot-info" id="foot-clock">—</div>`;

  const el = document.getElementById('sidebar');
  if (el) el.innerHTML = html;
})();

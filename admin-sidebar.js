/* ──────────────────────────────────────────────────────────────
 * admin-sidebar.js — Sidebar único del Admin de Tienda
 *
 * Reemplaza el <aside id="sidebar"> hardcodeado que estaba duplicado
 * (y desincronizado) en cada página del admin de tienda. Cada página
 * solo necesita:
 *     <aside class="adm-sidebar" id="sidebar"></aside>
 *     <script src="/admin-sidebar.js?v=1"></script>
 *
 * El item activo se detecta por location.pathname. Las páginas de edición
 * (producto-abm / producto-propio) resaltan su sección padre.
 * ────────────────────────────────────────────────────────────── */
(function () {
  // Clave de la sección activa según la URL actual.
  function activeKey() {
    const p = (location.pathname || '').toLowerCase();
    if (p.includes('tienda-categorias'))        return 'categorias';
    if (p.includes('tienda-productos-propios') ||
        p.includes('tienda-producto-propio'))   return 'propios';
    if (p.includes('tienda-productos') ||
        p.includes('tienda-producto-abm'))       return 'abm';
    if (p.includes('tienda-ordenes'))            return 'ordenes';
    if (p.includes('tienda-clientes'))           return 'clientes';
    if (p.includes('tienda-sync'))               return 'sync';
    if (p.includes('tienda-admin'))              return 'dashboard';
    return '';
  }

  const cur = activeKey();
  const A = k => 'adm-item' + (cur === k ? ' active' : '');  // helper clase activa

  const html = `
  <a href="/tienda-admin.html" class="adm-logo">
    <div class="adm-logo-mark">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
    </div>
    <div class="adm-logo-text">
      <div class="adm-logo-name">Admin Tienda</div>
      <div class="adm-logo-tag">WZMALLAS</div>
    </div>
  </a>

  <nav class="adm-nav">

    <div class="adm-group">
      <div class="adm-group-label">General</div>
      <a href="/tienda-admin.html" class="${A('dashboard')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <span>Dashboard</span>
      </a>
    </div>

    <div class="adm-group">
      <div class="adm-group-label">Catálogo</div>
      <a href="/tienda-admin.html#section-cupones" class="adm-item" id="nav-cupones">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <span>Cupones</span>
      </a>
      <a href="/tienda-productos.html" class="${A('abm')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span>Productos ABM</span>
      </a>
      <a href="/tienda-productos-propios.html" class="${A('propios')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21 7.5 13.5 2 9h7z"/></svg>
        <span>Productos propios</span>
      </a>
      <a href="/tienda-categorias.html" class="${A('categorias')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        <span>Categorías</span>
      </a>
    </div>

    <div class="adm-group">
      <div class="adm-group-label">Clientes</div>
      <a href="/tienda-ordenes.html" class="${A('ordenes')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <span>Órdenes</span>
        <span class="adm-item-badge info" id="nav-ord-badge" style="display:none">0</span>
      </a>
      <a href="/tienda-clientes.html" class="${A('clientes')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        <span>Clientes</span>
      </a>
    </div>

    <div class="adm-group">
      <div class="adm-group-label">Configuración</div>
      <a href="/tienda-sync.html" class="${A('sync')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        <span>Sincronizar ML</span>
      </a>
      <a href="#" class="adm-item" style="opacity:.5;cursor:not-allowed" title="Próximamente">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2"/></svg>
        <span>Ajustes</span>
        <span class="soon-tag" style="display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:100px;background:var(--yellow-light);color:#8a5c00;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle;margin-left:4px">pronto</span>
      </a>
    </div>

  </nav>

  <div class="adm-sidebar-foot">
    <a href="/tienda/catalogo.html" target="_blank" class="adm-item" style="color:var(--green)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
      <span>Ver tienda</span>
    </a>
    <a href="/" class="adm-item">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      <span>Volver a Stockroom</span>
    </a>
  </div>`;

  const el = document.getElementById('sidebar');
  if (el) el.innerHTML = html;
})();

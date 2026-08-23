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
 *
 * El botón "Configuración" (modal de cuentas ML) solo lo necesita el
 * dashboard, así que es opt-in: la página lo pide con data-cfg.
 *     <aside class="adm-sidebar" id="sidebar" data-cfg></aside>
 * Si lo pedís, tenés que tener el modal #cfg-modal y enganchar #btn-cfg.
 *
 * NOTA: el admin de la tienda (tienda-*.html, emails.html) tiene su
 * propio menú compartido en admin-sidebar.js — son dos sitios distintos
 * y no comparten navegación a propósito.
 * ────────────────────────────────────────────────────────────── */
(function () {
  function activeKey() {
    const p = (location.pathname || '').toLowerCase();
    if (p === '/' || p.includes('index.html'))   return 'dashboard';
    if (p.includes('analytics'))                 return 'analytics';
    if (p.includes('orden-compra'))              return 'orden';
    if (p.includes('despachos'))                 return 'despachos';
    if (p.includes('cobros'))                    return 'cobros';
    if (p.includes('rentabilidad'))              return 'rentabilidad';
    if (p.includes('verificar-envios'))          return 'verificar';
    if (p.includes('publicaciones'))             return 'publicaciones';
    if (p.includes('vinculaciones'))             return 'vinculaciones';
    if (p.includes('migracion'))                 return 'migracion';
    if (p.includes('alibaba'))                   return 'alibaba';
    if (p.includes('pedidos-costos'))            return 'pedidos-costos';
    if (p.includes('stock-historico'))           return 'stock-historico';
    if (p.includes('preguntas'))                 return 'preguntas';
    if (p.includes('tienda-admin'))              return 'tienda';
    return '';
  }

  // ── Estado contraído ────────────────────────────────────────
  // Se aplica ANTES de escribir el HTML para que no se vea el sidebar
  // ancho un frame y después salte a angosto.
  const MINI_KEY = 'wz_sidebar_mini';
  function aplicarMini(on) {
    document.documentElement.setAttribute('data-sidebar', on ? 'mini' : 'full');
  }
  let mini = false;
  try { mini = localStorage.getItem(MINI_KEY) === '1'; } catch (e) {}
  aplicarMini(mini);

  const el  = document.getElementById('sidebar');
  const cur = activeKey();
  // Con el sidebar contraído el texto no se ve, así que el title es lo único
  // que queda para saber qué es cada icono.
  const A = k => 'adm-item' + (cur === k ? ' active' : '');

  // ── Bottom nav (mobile) ──────────────────────────────────────
  // Estaba copiado y pegado en 8 páginas, y NO era el mismo copy-paste en
  // todas: había dos listas de 5 ítems distintas (una con Analytics, otra con
  // Publicaciones en su lugar), y en migracion.html y vinculaciones.html
  // ninguno de los 5 ítems se marcaba activo — ni siquiera había un link a la
  // propia página. Acá hay una sola lista, la que ya usaban 5 de las 8
  // páginas, y el estado activo sale de activeKey(), la misma fuente que ya
  // usa el sidebar de escritorio.
  //
  // Es opt-in con data-btm-nav en el <aside>, igual que data-cfg: media
  // docena de páginas (rentabilidad, orden de compra, etc.) usan este script
  // para el sidebar pero no tienen espacio para una segunda barra fija abajo.
  if (el && el.hasAttribute('data-btm-nav')) {
    const BTM = [
      ['dashboard', '/', 'Dashboard', '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'],
      ['despachos', '/despachos.html', 'Despachos', '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'],
      ['preguntas', '/preguntas.html', 'Preguntas', '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'],
      ['cobros', '/cobros.html', 'Cobros', '<path d="M20 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/>'],
      ['analytics', '/analytics.html', 'Analytics', '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'],
    ];
    const nav = document.createElement('nav');
    nav.className = 'adm-btm-nav';
    nav.innerHTML = BTM.map(([key, href, label, path]) => `
      <a href="${href}" class="adm-btm-item${cur === key ? ' active' : ''}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
        <span>${label}</span>
      </a>`).join('');
    document.body.appendChild(nav);
  }

  // Solo el dashboard abre el modal de cuentas ML
  const cfgHtml = (el && el.hasAttribute('data-cfg')) ? `
    <button class="adm-item" id="btn-cfg" style="width:100%;text-align:left">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41"/></svg>
      <span>Configuración</span>
    </button>` : '';

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

    <!-- Lo que espera atención hoy: las dos únicas secciones con contador van
         juntas y arriba. Antes Preguntas vivía sola en un grupo "Clientes" y
         Despachos estaba a seis ítems de distancia. -->
    <div class="adm-group">
      <div class="adm-group-label">Día a día</div>
      <a href="/" class="${A('dashboard')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <span>Dashboard</span>
      </a>
      <a href="/despachos.html" class="${A('despachos')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        <span>Despachos</span>
        <span class="adm-item-badge info" id="nav-desp-badge" style="display:none">0</span>
      </a>
      <a href="/preguntas.html" class="${A('preguntas')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span>Preguntas</span>
        <span class="adm-item-badge" id="nav-preg-badge" style="display:none">0</span>
      </a>
    </div>

    <!-- Plata que entra y control de lo que ML descuenta -->
    <div class="adm-group">
      <div class="adm-group-label">Dinero</div>
      <a href="/cobros.html" class="${A('cobros')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/></svg>
        <span>Cobros</span>
      </a>
      <a href="/rentabilidad.html" class="${A('rentabilidad')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        <span>Rentabilidad</span>
      </a>
      <a href="/verificar-envios.html" class="${A('verificar')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.56.93 6.18 2.45"/></svg>
        <span>Verificar Logística</span>
      </a>
    </div>

    <!-- El circuito completo de reposición, EN EL ORDEN EN QUE SE HACE:
         decidir qué pedir → recibir la mercadería → costear el pedido →
         mirar el histórico que corrige la demanda. Antes estos cuatro pasos
         estaban repartidos entre "Ventas" y "Catálogo" y desordenados. -->
    <div class="adm-group">
      <div class="adm-group-label">Reposición</div>
      <a href="/orden-compra.html" class="${A('orden')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6l1 4H8z"/><path d="M3 6h18l-1.5 13a2 2 0 01-2 1.8H6.5a2 2 0 01-2-1.8z"/><path d="M9 11h6"/></svg>
        <span>Orden de compra</span>
      </a>
      <a href="/alibaba.html" class="${A('alibaba')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
        <span>Carga Alibaba</span>
      </a>
      <a href="/pedidos-costos.html" class="${A('pedidos-costos')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        <span>Costos de Pedidos</span>
      </a>
      <a href="/stock-historico.html" class="${A('stock-historico')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><polyline points="19 9 13 15 9 11 5 15"/></svg>
        <span>Histórico de Stock</span>
      </a>
    </div>

    <!-- Analytics vive acá y no en "Ventas": su propio subtítulo dice
         "Stock & catálogo", y es desde donde arranca la orden de compra. -->
    <div class="adm-group">
      <div class="adm-group-label">Catálogo</div>
      <a href="/publicaciones.html" class="${A('publicaciones')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <span>Publicaciones</span>
      </a>
      <a href="/analytics.html" class="${A('analytics')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
        <span>Analytics</span>
      </a>
      <a href="/vinculaciones.html" class="${A('vinculaciones')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        <span>Vinculaciones</span>
      </a>
      <a href="/migracion.html" class="${A('migracion')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
        <span>Migración</span>
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
    </a>${cfgHtml}
    <a href="/logout" class="adm-item" style="color:var(--red)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <span>Cerrar sesión</span>
    </a>
  </div>

  <button class="adm-toggle" id="adm-toggle" type="button" aria-controls="sidebar">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    <span class="adm-toggle-label">Contraer</span>
  </button>
`;

  if (!el) return;
  el.innerHTML = html;

  // Cada ítem lleva su nombre en title: contraído es lo único que identifica
  // al icono, y expandido no molesta.
  el.querySelectorAll('.adm-item').forEach(a => {
    const t = (a.querySelector('span') || {}).textContent;
    if (t && !a.title) a.title = t.trim();
  });

  const btn = document.getElementById('adm-toggle');
  function pintarBoton() {
    const on = document.documentElement.getAttribute('data-sidebar') === 'mini';
    btn.setAttribute('aria-expanded', String(!on));
    btn.title = on ? 'Expandir el menú' : 'Contraer el menú';
    btn.setAttribute('aria-label', btn.title);
  }
  pintarBoton();

  btn.addEventListener('click', () => {
    mini = !mini;
    aplicarMini(mini);
    try { localStorage.setItem(MINI_KEY, mini ? '1' : '0'); } catch (e) {}
    pintarBoton();
  });

  // ── Escape cierra el selector de cuentas ─────────────────────
  // Cada página tenía su propia copia del toggle del dropdown (#acc-panel),
  // y sólo index.html había agregado el cierre con Escape — en las otras 8
  // el dropdown se quedaba abierto. Se centraliza acá, una sola vez para
  // todas: es un elemento con id fijo, así que no hace falta que cada página
  // reimplemente el mismo handler. classList.remove('open') es inofensivo en
  // las páginas que no usan esa clase (sólo 2 de 9 la tienen).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const panel = document.getElementById('acc-panel');
    if (panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      const accBtn = document.getElementById('acc-btn');
      if (accBtn) accBtn.classList.remove('open');
    }
  });
})();

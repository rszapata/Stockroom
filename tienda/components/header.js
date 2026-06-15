function renderHeader(activePage) {
  const categories = [
    { label: 'Mallas Samsung Watch',  icon: '⌚', href: './catalogo.html?cat=mallas-samsung',       desc: 'Silicona, acero, cuero y más',      img: 'https://http2.mlstatic.com/D_976784-MLA50465063761_062022-O.jpg'   },
    { label: 'Mallas Apple Watch',    icon: '🍎', href: './catalogo.html?cat=mallas-apple',         desc: 'Silicona, acero, cuero y más',      img: 'https://http2.mlstatic.com/D_743216-MLA77957736181_072024-O.jpg'   },
    { label: 'Protectores Samsung',   icon: '🛡️', href: './catalogo.html?cat=protectores-samsung',  desc: 'Cobertores, bumpers y templados',   img: 'https://http2.mlstatic.com/D_684181-MLA95671509283_102025-O.jpg'   },
    { label: 'Protectores Apple',     icon: '🛡️', href: './catalogo.html?cat=protectores-apple',    desc: 'Cobertores, bumpers y templados',   img: 'https://http2.mlstatic.com/D_893824-MLA89529538226_082025-O.webp'  },
    { label: 'Mallas otras marcas',   icon: '🕐', href: './catalogo.html?cat=mallas-otras',         desc: 'Xiaomi, Garmin, Huawei y más',      img: 'https://http2.mlstatic.com/D_816539-MLA52009138647_102022-O.webp'  },
    { label: 'Protectores otras',     icon: '🔰', href: './catalogo.html?cat=protectores-otras',    desc: 'Xiaomi, Garmin, Huawei y más',      img: 'https://http2.mlstatic.com/D_711038-MLA89980426480_082025-O.jpg'   },
    { label: 'Fundas iPhone',         icon: '📱', href: './catalogo.html?cat=fundas-iphone',        desc: 'Magnéticas, cuero y armor',         img: 'https://http2.mlstatic.com/D_992779-MLA95670854681_102025-O.jpg'   },
    { label: 'Fundas Samsung',        icon: '📲', href: './catalogo.html?cat=fundas-samsung',       desc: 'Magnéticas, cuero y armor',         img: 'https://http2.mlstatic.com/D_726751-MLA89354600281_082025-O.jpg'   },
    { label: 'Cables y cargadores',   icon: '🔌', href: './catalogo.html?cat=cables',               desc: '3 en 1, USB-C, MagSafe y más',      img: 'https://http2.mlstatic.com/D_818126-MLA86291259897_062025-O.jpg'   },
    { label: 'Luces para autos',      icon: '🚗', href: './catalogo.html?cat=luces-auto',           desc: 'Kits LED para Honda Civic y más',   img: 'https://http2.mlstatic.com/D_769883-MLA89075801671_072025-O.jpg'   },
  ];

  const dropdownHtml = categories.map(c => `
    <a href="${c.href}" class="dropdown-item" data-cat="${c.href.match(/cat=([^&]+)/)?.[1] || ''}">
      <div class="dropdown-img"><img src="${c.img}" alt="${c.label}" loading="lazy"></div>
      <div class="dropdown-text">
        <p class="dropdown-name">${c.label}</p>
        <p class="dropdown-desc">${c.desc}</p>
      </div>
      <span class="dropdown-arrow">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/>
        </svg>
      </span>
    </a>`).join('') + `
    <div class="dropdown-footer">
      <a href="./catalogo.html" class="dropdown-footer-link">
        Ver catálogo completo
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/>
        </svg>
      </a>
    </div>`;

  // Categorías destacadas para la barra de chips mobile (debajo del buscador):
  // se usan las MISMAS categorías "agrupadas" que se muestran en el hero de PC
  // (Apple Watch / Samsung Watch / Fundas celulares) para que la navegación
  // sea consistente entre escritorio y mobile, evitando mostrar un listado
  // distinto y mucho más largo que termina sintiéndose repetitivo.
  const stripCategories = [
    { label: 'Apple Watch',      href: './catalogo.html?cat=apple-watch'   },
    { label: 'Samsung Watch',    href: './catalogo.html?cat=samsung-watch' },
    { label: 'Fundas celulares', href: './catalogo.html?cat=fundas'        },
    { label: 'Cables y cargadores', href: './catalogo.html?cat=cables'     },
    { label: 'Luces para autos',    href: './catalogo.html?cat=luces-auto' },
  ];

  const catChipsHtml = stripCategories
    .map(c => `<a href="${c.href}" class="cat-chip" data-cat="${c.href.match(/cat=([^&]+)/)?.[1] || ''}">${c.label}</a>`)
    .join('');

  const drawerHtml = `
    <div class="drawer-section">Categorías</div>
    ${categories.map(c => `
      <a href="${c.href}" class="drawer-link drawer-link-cat">
        <span class="drawer-cat-icon">${c.icon}</span>
        <span>
          <span class="drawer-cat-name">${c.label}</span>
          <span class="drawer-cat-desc">${c.desc}</span>
        </span>
        <svg class="drawer-cat-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/>
        </svg>
      </a>`).join('')}
    <div class="drawer-section">Mi cuenta</div>
    <a href="./mi-cuenta.html" class="drawer-link" id="drawer-user-link">Iniciar sesión</a>
    <a href="./mi-cuenta.html?tab=register" class="drawer-link" id="drawer-register-link">Crear cuenta</a>
    <a href="./seguimiento.html" class="drawer-link drawer-link-sub">Seguimiento de pedido</a>
    <div class="drawer-section">Información</div>
    <a href="./quienes-somos.html" class="drawer-link drawer-link-sub">Quiénes somos</a>
    <a href="./contacto.html" class="drawer-link drawer-link-sub">Contacto</a>
    <a href="./preguntas-frecuentes.html" class="drawer-link drawer-link-sub">Preguntas frecuentes</a>
    <a href="./envios-y-plazos.html" class="drawer-link drawer-link-sub">Envíos y plazos</a>
    <a href="./cambios-y-devoluciones.html" class="drawer-link drawer-link-sub">Cambios y devoluciones</a>`;

  return `
    <style>
      /* ============================================================
         FILA 1 — Barra superior oscura
         ============================================================ */
      .header-top {
        background: var(--text);
        color: rgba(255,255,255,0.7);
        font-size: 12px;
        padding: 7px 0;
      }
      .header-top-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 0 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      /* Mensajes rotativos */
      .header-top-promo {
        position: relative;
        min-height: 18px;
        overflow: hidden;
        flex: 1;
      }
      .htp-msg {
        position: absolute;
        left: 0; top: 0;
        width: 100%;
        white-space: nowrap;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.4s ease, transform 0.4s ease;
        pointer-events: none;
        font-size: 12px;
        color: rgba(255,255,255,0.75);
      }
      .htp-msg.active {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .htp-msg strong { color: #fff; font-weight: 700; }
      .htp-msg .htp-icon { margin-right: 5px; }
      .htp-msg a {
        color: #93C5FD;
        text-decoration: none;
        font-weight: 600;
      }
      .htp-msg a:hover { text-decoration: underline; }

      /* Dots navegación */
      .htp-dots {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 10px;
        flex-shrink: 0;
      }
      .htp-dot {
        width: 5px; height: 5px;
        border-radius: 50%;
        background: rgba(255,255,255,0.25);
        cursor: pointer;
        transition: background 0.2s;
      }
      .htp-dot.active { background: rgba(255,255,255,0.75); }

      .header-top-links { display: flex; align-items: center; gap: 20px; }
      .header-top-links a {
        color: rgba(255,255,255,0.55);
        text-decoration: none;
        font-size: 12px;
        transition: color 0.15s;
        white-space: nowrap;
      }
      .header-top-links a:hover { color: #fff; }

      /* ============================================================
         STICKY WRAPPER
         ============================================================ */
      .header-sticky {
        position: sticky;
        top: 0;
        z-index: 1000;
        background: var(--white);
        border-bottom: 1px solid var(--border);
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
      }

      /* ============================================================
         FILA ÚNICA — Logo | Nav | Buscador | Acciones
         ============================================================ */
      .header-main-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 0 24px;
        height: 60px;
        display: flex;
        align-items: center;
        gap: 0;
      }

      /* --- Logo (izquierda) --- */
      .hmi-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        margin-right: 16px;
      }
      .header-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-accent);
        font-size: 18px;
        font-weight: 700;
        color: var(--text);
        letter-spacing: 0.04em;
        text-decoration: none;
        white-space: nowrap;
      }
      .header-logo-img {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .header-logo-img.hidden { display: none; }
      .header-hamburger {
        display: none;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        background: none;
        border: 1px solid var(--border-2);
        border-radius: var(--radius);
        cursor: pointer;
        color: var(--text-2);
        flex-shrink: 0;
      }

      /* --- Nav strip (categorías + links) — junto al logo --- */
      .hmi-nav {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        margin-right: 12px;
      }

      /* Botón Categorías */
      .nav-cat-wrap { position: relative; }
      .nav-cat-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--blue);
        color: #fff;
        padding: 6px 12px;
        border-radius: var(--radius);
        font-family: var(--font-accent);
        font-size: 13px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
        margin-right: 4px;
      }
      .nav-cat-trigger:hover { background: var(--blue-dark); }
      .nav-cat-trigger .cat-chevron { transition: transform 0.2s; flex-shrink: 0; }
      .nav-cat-wrap.open .cat-chevron { transform: rotate(180deg); }

      /* Dropdown */
      .nav-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        background: var(--white);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: 0 12px 32px rgba(0,0,0,0.09);
        padding: 10px;
        display: grid;
        grid-template-columns: repeat(2, 220px);
        gap: 4px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-6px);
        transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
        z-index: 220;
      }
      .nav-cat-wrap.open .nav-dropdown {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      .dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border-radius: var(--radius);
        text-decoration: none;
        transition: background 0.15s;
      }
      .dropdown-item:hover { background: var(--bg); }
      .dropdown-img {
        width: 44px;
        height: 44px;
        border-radius: var(--radius);
        background: var(--bg);
        border: 1px solid var(--border);
        overflow: hidden;
        flex-shrink: 0;
      }
      .dropdown-img img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
      .dropdown-text { flex: 1; min-width: 0; }
      .dropdown-name {
        font-family: var(--font-accent);
        font-size: 13px;
        font-weight: 700;
        color: var(--text);
        margin-bottom: 2px;
      }
      .dropdown-desc { font-size: 12px; color: var(--text-3); line-height: 1.3; }
      /* Flecha que aparece al hover */
      .dropdown-arrow {
        color: var(--blue);
        opacity: 0;
        transform: translateX(-4px);
        transition: opacity 0.15s, transform 0.15s;
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }
      .dropdown-item:hover .dropdown-arrow {
        opacity: 1;
        transform: translateX(0);
      }
      /* Footer del dropdown — Ver catálogo completo */
      .dropdown-footer {
        grid-column: 1 / -1;
        border-top: 1px solid var(--border);
        padding: 8px 6px 4px;
        margin-top: 4px;
      }
      .dropdown-footer-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: var(--blue);
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
        font-family: var(--font-accent);
        padding: 7px 10px;
        border-radius: var(--radius);
        transition: background 0.15s;
      }
      .dropdown-footer-link:hover { background: var(--bg); }

      /* --- Buscador (flex: 1 — ocupa el espacio restante) --- */
      .header-search {
        flex: 1;
        min-width: 0;
        display: flex;
        position: relative;
      }
      .header-search input {
        flex: 1;
        border: 1.5px solid var(--border-2);
        border-right: none;
        border-radius: var(--radius) 0 0 var(--radius);
        padding: 9px 14px;
        font-size: 14px;
        color: var(--text);
        background: var(--white);
        transition: border-color 0.15s, box-shadow 0.15s;
        min-width: 0;
      }
      .header-search input:focus {
        outline: none;
        border-color: var(--blue);
        box-shadow: 0 0 0 3px rgba(52,131,250,0.12);
        position: relative;
        z-index: 1;
      }
      .header-search button {
        background: var(--blue);
        border: 1.5px solid var(--blue);
        border-radius: 0 var(--radius) var(--radius) 0;
        width: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;
      }
      .header-search button:hover { background: var(--blue-dark); border-color: var(--blue-dark); }

      /* --- Acciones (derecha) --- */
      .header-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        margin-left: 12px;
      }
      .header-action-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: var(--radius);
        font-family: var(--font-accent);
        font-size: 13px;
        font-weight: 600;
        color: var(--text-2);
        background: none;
        border: none;
        cursor: pointer;
        text-decoration: none;
        transition: color 0.15s, background 0.15s;
        white-space: nowrap;
        position: relative;
      }
      .header-action-btn:hover { color: var(--blue); background: var(--bg); }

      /* Badge carrito — punto rojo prolijo, contenido dentro del wrapper del ícono */
      .cart-icon-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 19px;
        height: 19px;
      }
      .cart-count {
        position: absolute;
        top: -7px;
        right: -7px;
        background: var(--red);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        min-width: 16px;
        height: 16px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        line-height: 1;
        box-shadow: 0 0 0 2px var(--white);
        pointer-events: none;
        animation: cartPop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes cartPop {
        0%   { transform: scale(0); }
        100% { transform: scale(1); }
      }

      /* ============================================================
         DRAWER MOBILE
         ============================================================ */
      #nav-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.42);
        z-index: 300;
        opacity: 0;
        transition: opacity 0.25s;
      }
      #nav-overlay.visible { display: block; opacity: 1; }

      #nav-drawer {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        width: 288px;
        background: var(--white);
        z-index: 310;
        transform: translateX(-100%);
        transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
      #nav-drawer.open { transform: translateX(0); }

      .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .drawer-logo {
        font-family: var(--font-accent);
        font-size: 16px;
        font-weight: 700;
        color: var(--text);
        text-decoration: none;
      }
      .drawer-close {
        background: none;
        border: none;
        color: var(--text-3);
        cursor: pointer;
        padding: 4px;
        display: flex;
      }
      .drawer-nav { padding: 8px 0; flex: 1; }
      .drawer-section {
        padding: 16px 20px 6px;
        font-family: var(--font-accent);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--text-3);
      }
      .drawer-link {
        display: block;
        padding: 11px 20px;
        font-family: var(--font-accent);
        font-size: 14px;
        font-weight: 600;
        color: var(--text-2);
        border-bottom: 1px solid var(--border);
        text-decoration: none;
        transition: color 0.15s, background 0.15s;
      }
      .drawer-link:hover { color: var(--blue); background: var(--bg); }
      .drawer-link-sub {
        font-weight: 500;
        font-size: 13px;
        color: var(--text-3);
        font-family: var(--font-body);
      }

      /* ============================================================
         RESPONSIVE
         ============================================================ */
      /* Pantallas medianas: esconder labels de Mi cuenta */
      @media (max-width: 1024px) {
        .header-action-btn .btn-label { display: none; }
        .header-action-btn { padding: 6px 8px; }
        .nav-cat-trigger { padding: 6px 10px; }
        /* En tablet los links de top bar se ocultan para dar espacio al mensaje */
        .header-top-links { display: none; }
        .htp-dots { display: none; }
      }

      /* Pantallas chicas: ocultar nav strip, mostrar hamburguesa */
      @media (max-width: 768px) {
        .header-top { display: none; }
        .hmi-nav    { display: none; }

        .header-main-inner {
          height: auto;
          padding: 0 16px;
          flex-wrap: wrap;
          gap: 0;
        }
        /* Fila 1 mobile: hamburger | logo | (flex:1) | cuenta | carrito
           — order:2 mueve acciones antes que el buscador (order:3)
             sin alterar el orden en desktop */
        .hmi-brand {
          height: 52px;
          flex: 1;
          margin-right: 0;
          order: 1;
        }
        .header-actions {
          height: 52px;
          margin-left: 0;
          order: 2;
        }
        /* Fila 2 mobile: buscador a ancho completo */
        .header-search {
          width: 100%;
          flex: none;
          padding-bottom: 10px;
          order: 3;
        }
        .header-hamburger { display: flex; }
      }

      /* ============================================================
         CATEGORY STRIP — Chips horizontales scrolleables (solo mobile)
         ============================================================ */
      .cat-strip {
        display: none; /* oculto en desktop */
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 6px;
        padding: 0 16px 10px;
        border-top: 1px solid var(--border);
        background: var(--white);
        flex-shrink: 0;
      }
      .cat-strip::-webkit-scrollbar { display: none; }
      .cat-chip {
        display: inline-flex;
        align-items: center;
        line-height: 1;
        gap: 5px;
        padding: 8px 13px 7px;
        border-radius: 999px;
        background: var(--bg);
        border: 1.5px solid var(--border);
        font-size: 12px;
        font-family: var(--font-accent);
        font-weight: 600;
        color: var(--text-2);
        white-space: nowrap;
        text-decoration: none;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .cat-chip:active { transform: scale(0.96); }
      .cat-chip.active {
        background: var(--blue);
        color: #fff;
        border-color: var(--blue);
      }
      @media (max-width: 768px) {
        .cat-strip { display: flex; }
      }

      /* ============================================================
         DRAWER — links de categorías visuales
         ============================================================ */
      .drawer-link-cat {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        font-family: var(--font-accent);
        font-size: 14px;
        font-weight: 600;
        color: var(--text-2);
        border-bottom: 1px solid var(--border);
        text-decoration: none;
        transition: color 0.15s, background 0.15s;
      }
      .drawer-link-cat:hover { color: var(--blue); background: var(--bg); }
      .drawer-cat-icon { font-size: 18px; flex-shrink: 0; line-height: 1; }
      .drawer-cat-name { display: block; color: var(--text); font-weight: 700; font-size: 14px; }
      .drawer-cat-desc { display: block; font-size: 12px; color: var(--text-3); font-weight: 400; margin-top: 1px; }
      .drawer-cat-arrow { margin-left: auto; color: var(--text-3); flex-shrink: 0; }
      .drawer-link-cat:hover .drawer-cat-arrow { color: var(--blue); }

      /* ============================================================
         DROPDOWN — Ítem activo (categoría actual)
         ============================================================ */
      .dropdown-item.active {
        background: rgba(52,131,250,0.06);
      }
      .dropdown-item.active .dropdown-name { color: var(--blue); }
      .dropdown-item.active .dropdown-arrow {
        opacity: 1;
        transform: translateX(0);
        color: var(--blue);
      }

      /* ============================================================
         SEARCH AUTOCOMPLETE — Sugerencias en tiempo real
         ============================================================ */
      .search-suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--white);
        border: 1.5px solid var(--blue);
        border-top: none;
        border-radius: 0 0 var(--radius-lg) var(--radius-lg);
        box-shadow: 0 8px 28px rgba(0,0,0,0.10);
        z-index: 250;
        display: none;
        overflow: hidden;
      }
      .search-suggestions.open { display: block; }
      .sug-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        text-decoration: none;
        border-bottom: 1px solid var(--border);
        transition: background 0.1s;
        color: var(--text);
      }
      .sug-item:last-child { border-bottom: none; }
      .sug-item:hover,
      .sug-item.focused { background: var(--bg); }
      .sug-img {
        width: 46px;
        height: 46px;
        border-radius: var(--radius);
        object-fit: contain;
        background: var(--bg);
        border: 1px solid var(--border);
        flex-shrink: 0;
      }
      .sug-img-placeholder {
        width: 46px;
        height: 46px;
        border-radius: var(--radius);
        background: var(--bg);
        border: 1px solid var(--border);
        flex-shrink: 0;
      }
      .sug-info { flex: 1; min-width: 0; }
      .sug-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .sug-price {
        font-size: 12px;
        color: var(--text-3);
        margin-top: 2px;
        font-weight: 500;
      }
      .sug-empty {
        padding: 18px 14px;
        font-size: 13px;
        color: var(--text-3);
        text-align: center;
      }
      .sug-all-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 600;
        font-family: var(--font-accent);
        color: var(--blue);
        text-decoration: none;
        border-top: 1px solid var(--border);
        background: var(--bg);
        transition: background 0.15s;
      }
      .sug-all-link:hover { background: #e9f0ff; }
    </style>

    <!-- ============================================================
         FILA 1 — Top bar con mensajes rotativos
         ============================================================ -->
    <div class="header-top">
      <div class="header-top-inner">

        <!-- Mensajes rotativos orientados a conversión -->
        <div class="header-top-promo" id="htp-container">
          <span class="htp-msg active" id="htp-0">
            <span class="htp-icon">🚚</span>
            <strong>Envío gratis</strong> en compras superiores a $33.000 &nbsp;·&nbsp;
            Todo el país
          </span>
          <span class="htp-msg" id="htp-1">
            <span class="htp-icon">🎁</span>
            Cupón <strong>WEB10</strong> — <strong>10% off</strong> en tu compra &nbsp;·&nbsp;
            <a href="./carrito.html">Aplicar ahora →</a>
          </span>
          <span class="htp-msg" id="htp-2">
            <span class="htp-icon">⭐</span>
            <strong>+2.300 clientes</strong> &nbsp;·&nbsp;
            <strong><span id="header-sold-stat">+8.800</span> ventas</strong> &nbsp;·&nbsp;
            Calificación 4.8
          </span>
          <span class="htp-msg" id="htp-3">
            <span class="htp-icon">🔄</span>
            <strong>Cambios y devoluciones</strong> sin costo &nbsp;·&nbsp;
            <a href="./cambios-y-devoluciones.html">Ver política</a>
          </span>
        </div>

        <!-- Dots de navegación -->
        <div class="htp-dots" id="htp-dots">
          <div class="htp-dot active" data-idx="0"></div>
          <div class="htp-dot" data-idx="1"></div>
          <div class="htp-dot" data-idx="2"></div>
          <div class="htp-dot" data-idx="3"></div>
        </div>

        <nav class="header-top-links">
          <a href="./quienes-somos.html">Quiénes somos</a>
          <a href="./preguntas-frecuentes.html">Ayuda</a>
          <a href="./envios-y-plazos.html">Envíos</a>
          <a href="./contacto.html">Contacto</a>
        </nav>
      </div>
    </div>

    <!-- ============================================================
         HEADER STICKY — Fila única
         ============================================================ -->
    <div class="header-sticky">
      <header>
        <div class="header-main-inner">

          <!-- Hamburger (mobile) + Logo -->
          <div class="hmi-brand">
            <button class="header-hamburger" id="nav-hamburger" aria-label="Menú">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8">
                <line x1="2" y1="4.5"  x2="16" y2="4.5"/>
                <line x1="2" y1="9"    x2="16" y2="9"/>
                <line x1="2" y1="13.5" x2="16" y2="13.5"/>
              </svg>
            </button>
            <a href="./index.html" class="header-logo">
              <img src="./img/logo-header.png" alt="WZ" class="header-logo-img" width="34" height="34" loading="eager" decoding="async" onerror="this.classList.add('hidden')">
              WZMALLAS
            </a>
          </div>

          <!-- Nav strip: solo botón Categorías -->
          <div class="hmi-nav">
            <div class="nav-cat-wrap" id="nav-cat-wrap">
              <button class="nav-cat-trigger" id="nav-cat-trigger" aria-haspopup="true" aria-expanded="false">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="2" y1="3.5"  x2="12" y2="3.5"/>
                  <line x1="2" y1="7"    x2="12" y2="7"/>
                  <line x1="2" y1="10.5" x2="12" y2="10.5"/>
                </svg>
                <span id="nav-cat-label">Categorías</span>
                <svg class="cat-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="2.5 4 5 6.5 7.5 4"/>
                </svg>
              </button>
              <div class="nav-dropdown" id="nav-dropdown" role="menu">
                ${dropdownHtml}
              </div>
            </div>
          </div>

          <!-- Buscador (toma todo el espacio libre) -->
          <div class="header-search">
            <input type="text" id="header-search-input" placeholder="Buscar productos, marcas y más..." aria-label="Buscar" autocomplete="off">
            <button id="header-search-btn" aria-label="Buscar">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2">
                <circle cx="6.5" cy="6.5" r="4.5"/>
                <line x1="10.2" y1="10.2" x2="14" y2="14"/>
              </svg>
            </button>
            <div class="search-suggestions" id="search-suggestions" role="listbox" aria-label="Sugerencias de búsqueda"></div>
          </div>

          <!-- Mi cuenta + Carrito -->
          <div class="header-actions">
            <a href="./mi-cuenta.html" class="header-action-btn" id="header-user-btn" aria-label="Mi cuenta">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" id="header-user-icon">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span class="btn-label" id="header-user-label">Mi cuenta</span>
            </a>
            <a href="./carrito.html" class="header-action-btn" aria-label="Carrito">
              <span class="cart-icon-wrap">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                <span class="cart-count" id="cart-badge" style="display:none">0</span>
              </span>
              <span class="btn-label">Carrito</span>
            </a>
          </div>

        </div>
      </header>
      <!-- Category strip (solo visible en mobile) -->
      <div class="cat-strip" id="cat-strip" role="navigation" aria-label="Categorías">
        ${catChipsHtml}
      </div>
    </div><!-- /header-sticky -->

    <!-- Overlay + Drawer mobile -->
    <div id="nav-overlay"></div>
    <div id="nav-drawer" role="dialog" aria-label="Menú de navegación">
      <div class="drawer-header">
        <a href="./index.html" class="drawer-logo" style="display:flex;align-items:center;gap:8px">
          <img src="./img/logo-header.png" alt="WZ" width="30" height="30" loading="lazy" decoding="async" style="border-radius:50%;object-fit:cover" onerror="this.style.display='none'">
          WZMALLAS
        </a>
        <button class="drawer-close" id="drawer-close-btn" aria-label="Cerrar menú">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
            <line x1="4" y1="4" x2="16" y2="16"/>
            <line x1="16" y1="4" x2="4" y2="16"/>
          </svg>
        </button>
      </div>
      <nav class="drawer-nav">${drawerHtml}</nav>
    </div>

  `;
}

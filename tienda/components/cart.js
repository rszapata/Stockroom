/* Escapa texto para uso seguro dentro de innerHTML */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Normaliza texto para búsqueda: minúsculas y sin acentos */
function wzNormalize(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

/* Distancia de edición (Levenshtein) entre dos strings cortos */
function wzLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prevDiag = tmp;
    }
  }
  return prev[n];
}

/* Coincidencia difusa: tolera errores de tipeo y acentos.
   Cada palabra de la búsqueda debe aparecer (exacta, como substring,
   o con un pequeño error de tipeo) en alguna palabra del texto. */
function wzFuzzyMatch(text, query) {
  const h = wzNormalize(text);
  const q = wzNormalize(query).trim();
  if (!q) return true;
  if (h.includes(q)) return true;
  const hWords = h.split(/\s+/);
  const qWords = q.split(/\s+/).filter(Boolean);
  return qWords.every(qw => hWords.some(hw => {
    if (hw.includes(qw) || qw.includes(hw)) return true;
    const maxDist = qw.length > 4 ? 2 : 1;
    return wzLevenshtein(hw, qw) <= maxDist;
  }));
}

/* Mapa de sinónimos bidireccional. Clave y valores en minúsculas sin acentos. */
const WZ_SYNONYMS = {
  'samsung':     ['galaxy'],
  'galaxy':      ['samsung'],
  'apple watch': ['iwatch', 'smartwatch'],
  'iwatch':      ['apple watch'],
  'malla':       ['correa', 'banda'],
  'correa':      ['malla', 'banda'],
  'banda':       ['malla', 'correa'],
  'funda':       ['case', 'carcasa', 'cover'],
  'case':        ['funda', 'carcasa'],
  'carcasa':     ['funda', 'case'],
  'xiaomi':      ['mi band', 'redmi'],
  'mi band':     ['xiaomi'],
};

/* Expande una query con sus sinónimos. Retorna array de strings a OR-matchear. */
function wzExpandQuery(query) {
  const base = wzNormalize(query).trim();
  const results = new Set([base]);
  for (const [term, syns] of Object.entries(WZ_SYNONYMS)) {
    const normTerm = wzNormalize(term);
    if (base.includes(normTerm)) {
      for (const syn of syns) {
        results.add(base.replace(normTerm, wzNormalize(syn)));
      }
    }
  }
  return [...results];
}

const CART_KEY = 'wz_cart';

const Cart = {
  getItems() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
      return [];
    }
  },

  add(product) {
    const items = this.getItems();
    const existing = items.find(i => i.id === product.id && i.variant === product.variant);
    if (existing) {
      existing.qty += product.qty || 1;
    } else {
      items.push({ ...product, qty: product.qty || 1 });
    }
    this.save(items);
  },

  remove(id) {
    this.save(this.getItems().filter(i => i.id !== id));
  },

  update(id, qty) {
    if (qty <= 0) { this.remove(id); return; }
    const items = this.getItems();
    const item = items.find(i => i.id === id);
    if (item) { item.qty = qty; this.save(items); }
  },

  getTotal() {
    return this.getItems().reduce((sum, i) => sum + i.price * i.qty, 0);
  },

  getCount() {
    return this.getItems().reduce((sum, i) => sum + i.qty, 0);
  },

  clear() {
    this.save([]);
  },

  save(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { count: this.getCount() } }));
  }
};

function initPage(activePage) {
  document.getElementById('header-root').innerHTML = renderHeader(activePage);
  document.getElementById('footer-root').innerHTML = renderFooter();

  // ── Skip link (WCAG 2.4.1 Bypass Blocks) ──────────────────────
  // Primer elemento focusable de la página: permite a usuarios de teclado
  // saltar la navegación e ir directo al contenido. Se inyecta acá para
  // cubrir todas las páginas sin editar cada HTML.
  if (!document.getElementById('skip-to-main')) {
    const main = document.querySelector('main');
    if (main) {
      if (!main.id) main.id = 'main-content';
      main.setAttribute('tabindex', '-1');
      const skip = document.createElement('a');
      skip.id = 'skip-to-main';
      skip.className = 'skip-link';
      skip.href = '#' + main.id;
      skip.textContent = 'Saltar al contenido';
      document.body.insertBefore(skip, document.body.firstChild);
    }
  }

  // ── Cookie Consent — cargar si aún no está ──────────────────────
  // Se inyecta dinámicamente para que todos los initPage lo usen sin
  // agregar <script> individual en cada HTML.
  if (!window.CookieConsent) {
    const _cs = document.createElement('script');
    _cs.src   = './components/cookies.js';
    _cs.onload = () => { if (window.CookieConsent) CookieConsent.init(); };
    document.head.appendChild(_cs);
  } else {
    CookieConsent.init();
  }

  // ── WhatsApp flotante ─────────────────────────────────────────
  // Aparece a los 8s o cuando el usuario scrollea el 40% de la página.
  // No aparece en carrito ni checkout para no distraer.
  // Se inyecta en DOMContentLoaded para garantizar que document.body esté listo.
  (function initWhatsApp() {
    const page = activePage || '';
    if (page === 'carrito' || page === 'checkout') return;
    const inject = () => {
    if (document.getElementById('wz-wa-btn')) return;

    const WA_URL = 'https://wa.me/5492304216009?text=Hola%2C%20te%20escribo%20desde%20la%20web%20de%20WZMALLAS.%20Tengo%20una%20consulta%20sobre';

    // Inyectar estilos
    const style = document.createElement('style');
    style.textContent = `
      #wz-wa-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 999;
        display: flex; align-items: center; gap: 10px;
        background: #25D366; color: #fff;
        border-radius: 50px; padding: 12px 20px 12px 14px;
        box-shadow: 0 4px 20px rgba(37,211,102,0.4);
        text-decoration: none; font-family: var(--font-accent, sans-serif);
        font-size: 14px; font-weight: 600;
        opacity: 0; transform: translateY(16px) scale(0.95);
        transition: opacity 0.35s ease, transform 0.35s ease, box-shadow 0.2s ease;
        pointer-events: none;
      }
      #wz-wa-btn.visible { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      #wz-wa-btn:hover { box-shadow: 0 6px 28px rgba(37,211,102,0.55); transform: translateY(-2px) scale(1); }
      #wz-wa-btn svg { flex-shrink: 0; }
      @media (max-width: 600px) {
        #wz-wa-btn span { display: none; }
        #wz-wa-btn { padding: 14px; border-radius: 50%; }
      }
    `;
    document.head.appendChild(style);

    const btn = document.createElement('a');
    btn.id   = 'wz-wa-btn';
    btn.href = WA_URL;
    btn.target = '_blank';
    btn.rel    = 'noopener noreferrer';
    btn.setAttribute('aria-label', 'Contactar por WhatsApp');
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
      <span>¿Tenés dudas?</span>`;
    document.body.appendChild(btn);

    function show() { btn.classList.add('visible'); }

    // Mostrar al 40% de scroll o después de 8s
    let shown = false;
    function maybeShow() {
      if (shown) return;
      const scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight || 1);
      if (scrollPct >= 0.4) { shown = true; show(); }
    }
    window.addEventListener('scroll', maybeShow, { passive: true });
    setTimeout(() => { if (!shown) { shown = true; show(); } }, 8000);
    }; // fin inject
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject();
    }
  })();

  // ── Newsletter del footer ─────────────────────────────────────
  // El form lo renderiza footer.js; acá enganchamos el submit.
  (function initFooterNewsletter() {
    const form = document.getElementById('footer-news-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';

    const emailEl = document.getElementById('footer-news-email');
    const btn     = document.getElementById('footer-news-btn');
    const msg     = document.getElementById('footer-news-msg');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email   = (emailEl.value || '').trim();
      const website = (form.querySelector('input[name="website"]') || {}).value || '';
      msg.className = 'footer-news-msg';
      msg.textContent = '';

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        msg.classList.add('err');
        msg.textContent = 'Ingresá un email válido.';
        return;
      }

      btn.disabled = true;
      const prevLabel = btn.textContent;
      btn.textContent = 'Enviando…';
      try {
        const r = await fetch('/api/tienda/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, website }),
        });
        if (r.ok) {
          form.reset();
          msg.classList.add('ok');
          msg.textContent = '¡Listo! Te vas a enterar de las novedades. 🎉';
        } else {
          const d = await r.json().catch(() => ({}));
          msg.classList.add('err');
          msg.textContent = d.error || 'No se pudo completar. Probá de nuevo.';
        }
      } catch {
        msg.classList.add('err');
        msg.textContent = 'Error de conexión. Probá de nuevo.';
      } finally {
        btn.disabled = false;
        btn.textContent = prevLabel;
      }
    });
  })();

  // ── Toast "Agregado al carrito" ───────────────────────────────
  // Confirmación visual + acceso directo al carrito al agregar un
  // producto, sin sacar al usuario de la página en la que está navegando
  // (antes la única señal era el texto del botón cambiando a "¡Listo!").
  (function initCartToast() {
    if (window.wzShowCartToast) return; // ya inyectado por otra carga de cart.js

    const inject = () => {
      if (document.getElementById('wz-cart-toast')) return;

      const style = document.createElement('style');
      style.textContent = `
        #wz-cart-toast {
          position: fixed; top: 16px; right: 16px; z-index: 10000;
          display: flex; align-items: center; gap: 12px;
          background: var(--white); color: var(--text);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: 0 12px 40px rgba(0,0,0,0.18);
          padding: 12px 34px 12px 14px;
          max-width: min(360px, calc(100vw - 32px));
          opacity: 0; transform: translateY(-14px);
          transition: opacity 0.25s ease, transform 0.25s ease;
          pointer-events: none;
        }
        #wz-cart-toast.visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
        #wz-cart-toast img {
          width: 44px; height: 44px; object-fit: contain;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--bg); flex-shrink: 0; padding: 4px;
        }
        #wz-cart-toast .wz-ct-body { min-width: 0; flex: 1; }
        #wz-cart-toast .wz-ct-title {
          font-size: 12px; font-weight: 700; color: var(--green);
          display: flex; align-items: center; gap: 4px; margin: 0 0 2px;
        }
        #wz-cart-toast .wz-ct-name {
          font-size: 12px; color: var(--text-2); margin: 0 0 6px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #wz-cart-toast .wz-ct-link {
          font-size: 12px; font-weight: 700; color: var(--blue);
          text-decoration: none;
        }
        #wz-cart-toast .wz-ct-link:hover { text-decoration: underline; }
        #wz-cart-toast .wz-ct-close {
          position: absolute; top: 6px; right: 8px;
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; line-height: 1; color: var(--text-3);
          cursor: pointer; background: none; border: none; border-radius: 50%;
        }
        #wz-cart-toast .wz-ct-close:hover { background: var(--bg); color: var(--text); }
        @media (max-width: 600px) {
          #wz-cart-toast { left: 16px; right: 16px; top: auto; bottom: 90px; max-width: none; }
        }
      `;
      document.head.appendChild(style);

      const toast = document.createElement('div');
      toast.id = 'wz-cart-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `
        <button type="button" class="wz-ct-close" aria-label="Cerrar aviso">×</button>
        <img id="wz-ct-img" src="" alt="" loading="lazy">
        <div class="wz-ct-body">
          <p class="wz-ct-title">✓ Agregado al carrito</p>
          <p class="wz-ct-name" id="wz-ct-name"></p>
          <a class="wz-ct-link" href="./carrito.html">Ver carrito →</a>
        </div>
      `;
      document.body.appendChild(toast);

      let hideTimer = null;
      function hide() { toast.classList.remove('visible'); }
      toast.querySelector('.wz-ct-close').addEventListener('click', () => {
        clearTimeout(hideTimer);
        hide();
      });

      // Expuesta globalmente: wzShowCartToast({ title, img })
      window.wzShowCartToast = function (product) {
        const imgEl  = toast.querySelector('#wz-ct-img');
        const nameEl = toast.querySelector('#wz-ct-name');
        imgEl.src   = (product && product.img)   || '';
        imgEl.alt   = (product && product.title) || '';
        nameEl.textContent = (product && product.title) || '';
        clearTimeout(hideTimer);
        // Reinicia la animación de entrada si ya estaba visible (clics rápidos)
        toast.classList.remove('visible');
        requestAnimationFrame(() => {
          toast.classList.add('visible');
          hideTimer = setTimeout(hide, 4000);
        });
      };
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      inject();
    }
  })();

  // ── Cart badge ────────────────────────────────────────────────
  document.addEventListener('cart:updated', (e) => {
    const badge = document.getElementById('cart-badge');
    if (badge) {
      badge.textContent = e.detail.count;
      badge.style.display = e.detail.count > 0 ? 'flex' : 'none';
    }
  });
  const badge = document.getElementById('cart-badge');
  if (badge) {
    const count = Cart.getCount();
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }

  // ── Drawer mobile ────────────────────────────────────────────
  const hamburger = document.getElementById('nav-hamburger');
  const drawer    = document.getElementById('nav-drawer');
  const overlay   = document.getElementById('nav-overlay');

  function openDrawer() {
    if (drawer)  drawer.classList.add('open');
    if (overlay) overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (drawer)  drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  if (hamburger) hamburger.addEventListener('click', openDrawer);
  if (overlay)   overlay.addEventListener('click', closeDrawer);

  const closeBtn = document.getElementById('drawer-close-btn');
  if (closeBtn)  closeBtn.addEventListener('click', closeDrawer);

  // ── Dropdown categorías ──────────────────────────────────────
  const catWrap    = document.getElementById('nav-cat-wrap');
  const catTrigger = document.getElementById('nav-cat-trigger');
  if (catTrigger && catWrap) {
    // Click (mobile + fallback desktop)
    catTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = catWrap.classList.toggle('open');
      catTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Hover con delay 300ms (solo desktop) — Baymard best practice
    let _hoverTimer;
    const HOVER_OPEN_MS  = 300;
    const HOVER_CLOSE_MS = 150;
    catWrap.addEventListener('mouseenter', () => {
      if (window.innerWidth <= 768) return;
      clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(() => {
        catWrap.classList.add('open');
        catTrigger.setAttribute('aria-expanded', 'true');
      }, HOVER_OPEN_MS);
    });
    catWrap.addEventListener('mouseleave', () => {
      if (window.innerWidth <= 768) return;
      clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(() => {
        catWrap.classList.remove('open');
        catTrigger.setAttribute('aria-expanded', 'false');
      }, HOVER_CLOSE_MS);
    });

    // Cerrar al click afuera o Escape
    document.addEventListener('click', (e) => {
      if (!catWrap.contains(e.target)) {
        catWrap.classList.remove('open');
        catTrigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        catWrap.classList.remove('open');
        catTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Marcar chip activo en el category strip según URL actual ──
  (function markActiveCatChip() {
    const params     = new URLSearchParams(window.location.search);
    const currentCat = params.get('cat');
    if (!currentCat) return;
    document.querySelectorAll('.cat-chip[data-cat]').forEach(chip => {
      if (chip.dataset.cat === currentCat) chip.classList.add('active');
    });
    const activeChip = document.querySelector('.cat-chip.active');
    if (activeChip) {
      activeChip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    }
  })();

  // ── Búsqueda en header ───────────────────────────────────────
  const searchInput = document.getElementById('header-search-input');
  const searchBtn   = document.getElementById('header-search-btn');
  function doSearch() {
    const q = searchInput ? searchInput.value.trim() : '';
    if (q) window.location.href = './catalogo.html?q=' + encodeURIComponent(q);
  }
  if (searchBtn)  searchBtn.addEventListener('click', doSearch);
  if (searchInput) searchInput.addEventListener('keydown', (e) => {
    // Deja que el autocomplete maneje Enter cuando hay un ítem seleccionado
    const sugBox = document.getElementById('search-suggestions');
    if (e.key === 'Enter' && sugBox && sugBox.querySelector('.sug-item.focused')) return;
    if (e.key === 'Enter') doSearch();
  });

  // ── Sesión del usuario ───────────────────────────────────────
  // Verifica si el usuario está logueado y actualiza el header.
  // Se hace de forma async sin bloquear el renderizado inicial.
  function _updateHeaderUser(user) {
    const btn   = document.getElementById('header-user-btn');
    const label = document.getElementById('header-user-label');
    const drawerLink = document.getElementById('drawer-user-link');
    const drawerReg  = document.getElementById('drawer-register-link');

    if (user) {
      const firstName = (user.nombre || 'Mi cuenta').split(' ')[0];
      if (label) label.textContent = 'Hola, ' + firstName;
      if (btn)   btn.title = user.email || '';
      if (drawerLink) { drawerLink.textContent = 'Mis pedidos'; drawerLink.href = './mi-cuenta.html'; }
      if (drawerReg)  { drawerReg.textContent = 'Cerrar sesión'; drawerReg.href = '#'; drawerReg.onclick = async (e) => { e.preventDefault(); await fetch('/api/tienda/auth/logout', { method: 'POST', credentials: 'include' }); location.reload(); }; }
      // Exponer usuario globalmente por si alguna página lo necesita
      window._wzUser = user;
    }
  }

  // Llamar al hook externo si existe (eg. mi-cuenta.html usa esto para actualizar su UI)
  window.wz_onLogin = function(user) { _updateHeaderUser(user); };

  fetch('/api/tienda/me', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .then(user => { if (user) _updateHeaderUser(user); })
    .catch(() => {}); // Silencioso — si falla, el header se muestra como "Mi cuenta"

  // ── Scroll shadow en sticky header ───────────────────────────
  // Cuando el usuario baja, la sombra se intensifica para dar profundidad visual
  const headerSticky = document.querySelector('.header-sticky');
  if (headerSticky) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) {
        headerSticky.style.boxShadow = '0 2px 16px rgba(0,0,0,0.13)';
      } else {
        headerSticky.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
      }
    }, { passive: true });
  }

  // ── Actualizar ventas en top bar y en el panel de beneficios desde la
  // misma API de stats — así ambos lugares siempre muestran el mismo
  // número (antes mostraban cifras distintas y poco consistentes) ────
  const headerSoldStat = document.getElementById('header-sold-stat');
  const valueSoldStat  = document.getElementById('value-sold-stat');
  if (headerSoldStat || valueSoldStat) {
    fetch('/api/tienda/stats')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.total_sold > 0) {
          const n = data.total_sold;
          const formatted = n >= 1000 ? '+' + Math.floor(n / 100) * 100 : String(n);
          if (headerSoldStat) headerSoldStat.textContent = formatted;
          if (valueSoldStat)  valueSoldStat.textContent  = formatted;
        }
      })
      .catch(() => {});
  }

  // ── Marcar categoría activa en dropdown de desktop ─────────────
  (function markActiveDropdownCat() {
    const params     = new URLSearchParams(window.location.search);
    const currentCat = params.get('cat');
    if (!currentCat) return;

    // Resaltar ítem en el dropdown
    document.querySelectorAll('.dropdown-item[data-cat]').forEach(item => {
      if (item.dataset.cat === currentCat) {
        item.classList.add('active');
        // Actualizar etiqueta del trigger con el nombre de la categoría activa
        const nameEl = item.querySelector('.dropdown-name');
        const label  = document.getElementById('nav-cat-label');
        if (nameEl && label) label.textContent = nameEl.textContent;
      }
    });
  })();

  // ── Mensajes rotativos del top bar ───────────────────────────
  (function initTopBarRotator() {
    const TOTAL = 4;
    let current = 0;
    let timer   = null;

    function goTo(idx) {
      // Ocultar actual
      const prevMsg = document.getElementById('htp-' + current);
      if (prevMsg) { prevMsg.classList.remove('active'); }
      const prevDot = document.querySelector('.htp-dot[data-idx="' + current + '"]');
      if (prevDot) prevDot.classList.remove('active');

      current = (idx + TOTAL) % TOTAL;

      // Mostrar nuevo
      const nextMsg = document.getElementById('htp-' + current);
      if (nextMsg) { nextMsg.classList.add('active'); }
      const nextDot = document.querySelector('.htp-dot[data-idx="' + current + '"]');
      if (nextDot) nextDot.classList.add('active');
    }

    function startTimer() {
      timer = setInterval(() => goTo(current + 1), 4500);
    }

    // Dots clickeables
    document.querySelectorAll('.htp-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        clearInterval(timer);
        goTo(parseInt(dot.dataset.idx));
        startTimer(); // reinicia el ciclo desde el nuevo
      });
    });

    // Pausar al hover del container
    const container = document.getElementById('htp-container');
    if (container) {
      container.addEventListener('mouseenter', () => clearInterval(timer));
      container.addEventListener('mouseleave', startTimer);
    }

    startTimer();
  })();

  // ── Search autocomplete ──────────────────────────────────────────
  (function initSearchAutocomplete() {
    const input  = document.getElementById('header-search-input');
    const sugBox = document.getElementById('search-suggestions');
    if (!input || !sugBox) return;

    let _cache   = null;      // productos cargados una sola vez
    let _timer   = null;      // debounce timer
    let _focusIdx = -1;       // ítem con foco por teclado

    // Carga diferida — sólo cuando el usuario empieza a escribir
    async function fetchProducts() {
      if (_cache !== null) return _cache;
      try {
        const r    = await fetch('/api/tienda/productos?limit=9999');
        const data = r.ok ? await r.json() : {};
        _cache = Array.isArray(data) ? data : (data.productos || data.items || []);
      } catch { _cache = []; }
      return _cache;
    }

    function getImg(p) {
      if (p.pictures && p.pictures.length) {
        return p.pictures[0].secure_url || p.pictures[0].url || p.thumbnail || '';
      }
      return p.thumbnail || '';
    }

    function formatPrice(n) {
      return '$' + Math.round(n || 0).toLocaleString('es-AR');
    }

    function renderResults(results, q) {
      _focusIdx = -1;
      if (!results.length) {
        sugBox.innerHTML = `<div class="sug-empty">Sin resultados para "<strong>${esc(q)}</strong>"</div>`;
        sugBox.classList.add('open');
        return;
      }
      const rows = results.map((p, i) => {
        const img   = getImg(p);
        const title = p.title || '';
        const price = p.price || p.precio || 0;
        return `<a href="./producto.html?id=${encodeURIComponent(p.id)}" class="sug-item" data-idx="${i}" role="option">
          ${img
            ? `<img src="${esc(img)}" alt="" class="sug-img" loading="lazy" onerror="this.style.opacity='.2'">`
            : `<div class="sug-img-placeholder"></div>`}
          <div class="sug-info">
            <div class="sug-title">${esc(title)}</div>
            ${price ? `<div class="sug-price">${formatPrice(price)}</div>` : ''}
          </div>
        </a>`;
      }).join('');
      // Enlace "Ver todos los resultados"
      const allHref = `./catalogo.html?q=${encodeURIComponent(q)}`;
      sugBox.innerHTML = rows + `
        <a href="${allHref}" class="sug-all-link">
          Ver todos los resultados de "<strong>${esc(q)}</strong>"
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/>
          </svg>
        </a>`;
      sugBox.classList.add('open');
    }

    function closeSuggestions() {
      sugBox.classList.remove('open');
      sugBox.innerHTML = '';
      _focusIdx = -1;
    }

    async function suggest() {
      const q = input.value.trim();
      if (q.length < 2) { closeSuggestions(); return; }
      const products = await fetchProducts();
      const qs = wzExpandQuery(q);
      const results  = products
        .filter(p => qs.some(qq => wzFuzzyMatch(p.title || '', qq)))
        .slice(0, 6);
      renderResults(results, q);
    }

    // Input con debounce 300 ms (Baymard: no mostrar inmediato)
    input.addEventListener('input', () => {
      clearTimeout(_timer);
      const q = input.value.trim();
      if (q.length < 2) { closeSuggestions(); return; }
      _timer = setTimeout(suggest, 300);
    });

    // Teclado: ↑↓ para navegar, Enter para entrar, Escape para cerrar
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeSuggestions(); input.blur(); return; }
      const items = sugBox.querySelectorAll('.sug-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _focusIdx = Math.min(_focusIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('focused', i === _focusIdx));
        items[_focusIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _focusIdx = Math.max(_focusIdx - 1, -1);
        items.forEach((el, i) => el.classList.toggle('focused', i === _focusIdx));
        if (_focusIdx >= 0) items[_focusIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && _focusIdx >= 0) {
        e.preventDefault();
        window.location.href = items[_focusIdx].getAttribute('href');
      }
    });

    // Mostrar sugerencias al volver a enfocar si ya había texto
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2) suggest();
    });

    // Cerrar al hacer click afuera
    document.addEventListener('click', (e) => {
      if (!input.closest('.header-search').contains(e.target)) closeSuggestions();
    });
  })();

  // ── Categorías admin en el header (carga dinámica) ───────────
  // Inyecta las categorías creadas en el admin al dropdown del header
  // y al drawer mobile, sin bloquear el render inicial.
  (async function loadAdminCategoriesInHeader() {
    try {
      const res  = await fetch('/api/tienda/categorias');
      if (!res.ok) return;
      const data = await res.json();
      const cats = data.categorias || [];
      if (!cats.length) return;

      // ── Dropdown desktop ──────────────────────────────────────
      const dropdown = document.getElementById('nav-dropdown');
      if (dropdown) {
        const footer = dropdown.querySelector('.dropdown-footer');
        const section = document.createElement('div');
        section.style.cssText = 'grid-column:1/-1;border-top:1px solid var(--border);padding:8px 6px 4px;margin-top:4px;';
        section.innerHTML =
          `<p style="font-family:var(--font-accent);font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3);padding:2px 6px 6px;">Nuestros productos</p>` +
          `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;">` +
          cats.map(c => `
            <a href="./catalogo.html?cat=${c.slug}" class="dropdown-item">
              <div class="dropdown-text">
                <p class="dropdown-name">${esc(c.label)}</p>
                <p class="dropdown-desc">${c.productos_activos || 0} productos</p>
              </div>
              <span class="dropdown-arrow"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/></svg></span>
            </a>`).join('') +
          `</div>`;
        if (footer) dropdown.insertBefore(section, footer);
        else dropdown.appendChild(section);
      }

      // ── Drawer mobile ────────────────────────────────────────
      const drawer = document.querySelector('#nav-drawer .drawer-nav');
      if (drawer) {
        const firstSection = drawer.querySelector('.drawer-section');
        if (firstSection) {
          const adminSection = document.createElement('div');
          adminSection.innerHTML =
            `<div class="drawer-section">Nuestros productos</div>` +
            cats.map(c => `
              <a href="./catalogo.html?cat=${c.slug}" class="drawer-link drawer-link-cat">
                <span class="drawer-cat-name">${esc(c.label)}</span>
                <svg class="drawer-cat-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="8 3.5 12 7 8 10.5"/></svg>
              </a>`).join('');
          drawer.insertBefore(adminSection, firstSection);
        }
      }

      // ── Cat-strip mobile (chips scrolleables bajo buscador) ──
      const strip = document.getElementById('cat-strip');
      if (strip) {
        const adminChips = cats.map(c =>
          `<a href="./catalogo.html?cat=${c.slug}" class="cat-chip">${esc(c.label)}</a>`
        ).join('');
        strip.insertAdjacentHTML('afterbegin', adminChips);
      }
    } catch { /* si falla, el header queda con las categorías ML estáticas */ }
  })();
}

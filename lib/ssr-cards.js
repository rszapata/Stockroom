// ── Cards de producto renderizadas server-side (fase 1 de SSR) ──────────
//
// El home y el catálogo arman TODO su grid client-side (fetch a
// /api/tienda/productos + innerHTML) — un bot que no ejecuta JS (o que la
// ejecuta en una segunda pasada, como Googlebot) ve la página vacía, y un
// link-preview (WhatsApp, Facebook) que jamás corre JS no ve nada. Esto
// duplica — a propósito, no por accidente — la lógica de productCardHtml()
// de tienda/components/products.js: mismo criterio que ya usa lib/seo.js
// para wzCleanTitle/categorías ("no vale la pena un require cross-runtime
// por esto solo", ver ese archivo), porque products.js corre código a nivel
// de módulo que asume `document`/`window` y no se puede requerir tal cual
// desde Node. Si products.js cambia el HTML de la card, hay que actualizar
// esto también — hasta ahora la única otra copia (lib/seo.js) lleva el
// mismo trade-off desde hace rato sin problema.
//
// El resultado se inyecta en el contenedor (ej. #bestsellers-track) en el
// lugar de los skeletons; el JS del cliente lo pisa igual con su propio
// fetch apenas carga (mismo innerHTML de siempre) — esto sólo cambia qué
// hay ANTES de que ese JS corra: primer pintado real en vez de skeleton, y
// contenido real para quien no ejecuta JS.

const { mlCat } = require('./ml-item');

const NO_IMG_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
  '<rect width="400" height="400" fill="#eef0f2"/>' +
  '<g fill="none" stroke="#cfd4da" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="90" y="110" width="220" height="180" rx="14"/>' +
  '<circle cx="150" cy="170" r="18"/>' +
  '<path d="M90 250l60-55 45 40 55-65 60 80"/>' +
  '</g></svg>'
);

function _mlVariant(url, sfx) {
  return (url || '').replace(/([-_])[A-Z]\.(webp|jpe?g|png)(\?.*)?$/i, (m, sep, ext, qs) => `${sep}${sfx}.webp${qs || ''}`);
}
function toGridImg(url) { return _mlVariant(url, 'V'); }

function getImg(p) {
  let url = '';
  if (p.thumbnail && p.pictures && p.pictures.length) {
    const m = p.thumbnail.match(/\/D_([^\/]+?)(?:-I\.|_[A-Z]\.)/);
    if (m) {
      const thumbId = m[1];
      const match = p.pictures.find(pic => (pic.secure_url || pic.url || '').includes(thumbId));
      if (match) url = match.secure_url || match.url || '';
    }
  }
  if (!url && p.pictures && p.pictures.length) {
    url = p.pictures[0].secure_url || p.pictures[0].url || p.thumbnail || '';
  }
  if (!url) url = p.thumbnail || '';
  if (!url) return NO_IMG_PLACEHOLDER;
  return toGridImg(url);
}

function getStock(p) {
  if (p.variations && p.variations.length) {
    return p.variations.reduce((s, v) => s + (v.available_quantity || 0), 0);
  }
  return p.available_quantity || 0;
}

function getVariants(p) {
  if (!p.variations || !p.variations.length) return [];
  return [...new Set(
    p.variations
      .filter(v => v.attribute_combinations && v.attribute_combinations.length)
      .map(v => v.attribute_combinations.map(a => a.value_name).join(' / '))
  )];
}

function getTag(p) {
  const stock = getStock(p);
  if (stock === 0) return 'agotado';
  if ((p.sold_quantity || 0) >= 200) return 'bestseller';
  if ((p.sold_quantity || 0) >= 50) return 'destacado';
  return null;
}

function tagLabel(tag) {
  if (!tag || tag === 'agotado') return '';
  const map = { bestseller: 'Bestseller', destacado: 'Destacado', nuevo: 'Nuevo', exclusivo: 'Exclusivo', oferta: 'Oferta' };
  const cls = { bestseller: '', destacado: '', nuevo: 'tag-new', exclusivo: 'tag-new', oferta: 'tag-sale' };
  return `<span class="product-tag ${cls[tag] || ''}">${map[tag] || tag}</span>`;
}

function formatPrice(n) {
  return '$' + Math.round(Number(n)).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function wzDescuento(p) {
  const orig = Number(p.original_price) || 0;
  if (!orig || !p.price || orig <= p.price) return 0;
  const off = Math.round((1 - p.price / orig) * 100);
  return off >= 5 ? off : 0;
}

const WZ_ENVIO_GRATIS_MIN = 33000;

/* Tasa de cuotas: mismo valor default que products.js usa en el cliente
   antes de que resuelva su propio fetch a /api/tienda/cuotas — el cliente
   pisa esta card con la suya (misma tasa hasta que llegue la real), así que
   no hay mismatch visible aunque no consultemos la API acá. */
const WZ_CUOTAS_FALLBACK = { cuotas: 6, tasa: 32.14 };

function cuotasHtml(price, product) {
  if (product && product.wz_solo_transferencia) {
    return `<p class="product-cuotas">Solo transferencia</p>`;
  }
  if (!(price > 10000)) return '';
  const total = price * (1 + WZ_CUOTAS_FALLBACK.tasa / 100);
  const porCuota = total / WZ_CUOTAS_FALLBACK.cuotas;
  return `<p class="product-cuotas">${WZ_CUOTAS_FALLBACK.cuotas} cuotas de ${formatPrice(porCuota)}</p>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Card de producto — mismo HTML/clases que productCardHtml() del cliente
 *  (sin eso, el swap post-hidratación se nota: cambia de tamaño o layout). */
function productCardHtmlSSR(p, wzCleanTitle, opts = {}) {
  const img = getImg(p);
  const stock = getStock(p);
  const variants = getVariants(p);
  const tag = getTag(p);
  const hasShipping = p.wz_envio_gratis || (!p.wz_local && p.price >= WZ_ENVIO_GRATIS_MIN);
  const agotado = stock === 0;
  const cuotas = cuotasHtml(p.price, p);
  const urgBadge = (!agotado && stock > 0 && stock <= 5)
    ? '<span class="product-tag-urg">Últimas unidades</span>' : '';
  const hasVariants = variants.length > 0;
  const imgLoadAttrs = opts.priority ? 'loading="eager" fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';
  // class="ld" ya en el HTML servido: la imagen se pinta apenas llega, sin
  // esperar el onload + la animación de fade de .4s (ver products.js, mismo
  // comentario). Acá importa más todavía: esto es lo que Google indexa y lo
  // que mide PageSpeed antes de que corra una sola línea de JS del cliente.
  const imgClass = opts.priority ? ' class="ld"' : '';
  const imageBadge = (tag && tag !== 'bestseller' && tag !== 'destacado') ? tagLabel(tag) : '';
  const off = wzDescuento(p);
  const offBadge = off ? `<span class="product-tag-off">${off}% OFF</span>` : '';
  const agotadoBadge = agotado ? '<span class="product-tag" style="background:var(--text-3);color:#fff">Agotado</span>' : '';
  const badgesHtml = (offBadge || urgBadge || imageBadge || agotadoBadge)
    ? `<div class="product-badges">${offBadge}${urgBadge}${imageBadge}${agotadoBadge}</div>` : '';
  const anclaHtml = off
    ? `<div class="product-price-row"><span class="product-price-old">${formatPrice(p.original_price)}</span></div>` : '';
  const ratingHtml = `<span class="product-rating" data-rating-for="${esc(p.id)}" data-sold="${p.sold_quantity || 0}"></span>`;
  const addBtn = opts.noBtn ? '' : `<div class="product-agregar-wrap">` + (agotado
    ? `<button class="btn-agregar" disabled>Sin stock</button>`
    : `<button class="btn-agregar"
         data-id="${p.id}"
         data-price="${p.price}"
         data-title="${esc(p.title || '')}"
         data-img="${esc(img)}"
         data-has-variants="${hasVariants ? '1' : '0'}"
         data-stock="${stock}"
         onclick="event.preventDefault();wzAddToCart(this)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/></svg>${hasVariants ? 'Ver opciones' : 'Agregar'}</button>`) + `</div>`;

  return `
    <a href="./producto.html?id=${p.id}" class="product-card${agotado ? ' product-card--agotado' : ''}">
      <div class="product-image-wrap">
        <img src="${esc(img)}" alt="${esc(p.title)}" width="300" height="300" ${imgLoadAttrs}${imgClass} onload="this.classList.add('ld')" onerror="this.onerror=null;this.classList.add('ld');this.alt='';this.style.opacity='.3'">
        ${badgesHtml}
        ${p.wz_local ? '<span class="product-tag-wz">Exclusivo online</span>' : ''}
        <button type="button" class="wz-fav-btn" data-id="${p.id}" aria-label="Agregar a favoritos" aria-pressed="false" onclick="wzToggleFav(this, event)">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
      </div>
      <div class="product-info">
        <p class="product-name">${esc(wzCleanTitle(p.title))}</p>
        ${anclaHtml}
        <p class="product-price">${formatPrice(p.price)}</p>
        ${cuotas}
        ${ratingHtml}
        ${hasShipping ? '<p class="product-shipping">Envío gratis</p>' : ''}
      </div>
      ${addBtn}
    </a>`;
}

/* Mismo criterio de clasificación liviana por título que index.html (ver
   esFunda/esMalla/esProtector ahí) — top 4 por rubro, no un top plano, para
   no repetir siempre la misma categoría en "Más vendidos". */
function _t(p) { return (p.title || '').toLowerCase(); }
function esFunda(p) { return /funda|carcasa|cover/.test(_t(p)); }
function esMalla(p) { return /malla|correa|milanese/.test(_t(p)) && !esFunda(p); }
function esProtector(p) { return /protector|cobertor|bumper|templado|bisel|vidrio/.test(_t(p)) && !esFunda(p); }

function buildHomeBestsellersSSR(productos) {
  const cats = [
    { test: esMalla, label: 'Mallas' },
    { test: esProtector, label: 'Protectores' },
    { test: esFunda, label: 'Fundas' },
  ];
  const usados = new Set();
  const bestsellers = [];
  for (const { test } of cats) {
    const top4 = productos
      .filter(p => test(p) && !usados.has(p.id) && getStock(p) > 0 && (p.sold_quantity || 0) > 0)
      .sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0))
      .slice(0, 4);
    top4.forEach(p => { usados.add(p.id); bestsellers.push(p); });
  }
  return bestsellers;
}

/* Top 12 más vendidos con stock, de una categoría del home (Mallas,
   Protectores, Fundas) o de "Combos" (transversal, ver combos regex). Mismo
   criterio que los fillCarousel() de index.html — no filtra por categoría
   de ML, es la clasificación liviana por título, más laxa. */
function buildHomeCategorySSR(productos, test) {
  return productos
    .filter(p => test(p) && getStock(p) > 0)
    .sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0))
    .slice(0, 12);
}
const esCombo = p => /^combo\b/i.test(p.title || '');

/* Grupos de conveniencia del catálogo — mismo CAT_GROUPS que catalogo.html
   (¡mantener sincronizado si cambia ahí!): un ?cat= "padre" (mallas) agrupa
   varios slugs finos de mlCat() (mallas-samsung/apple/otras). */
const CAT_GROUPS = {
  'apple-watch':   ['mallas-apple', 'protectores-apple'],
  'samsung-watch': ['mallas-samsung', 'protectores-samsung'],
  'fundas':        ['fundas-iphone', 'fundas-samsung'],
  'mallas':        ['mallas-samsung', 'mallas-apple', 'mallas-otras'],
  'protectores':   ['protectores-samsung', 'protectores-apple', 'protectores-otras'],
};

/* Mismo criterio que matchesCategory() en catalogo.html — "combos" es
   transversal (no es un slug de mlCat), productos propios comparan directo
   contra su categoría admin, y el resto matchea por grupo o por slug exacto
   de mlCat(). Reutiliza el mlCat() real (lib/ml-item.js) en vez de portarlo:
   es server-side de los dos lados, no hace falta duplicarlo como sí con
   wzCleanTitle (que sólo existía del lado cliente). */
function matchesCategorySSR(p, catKey) {
  if (catKey === 'combos') return esCombo(p);
  if (p.wz_local) return (p.wz_categoria_fija || 'otros') === catKey;
  if (CAT_GROUPS[catKey]) return CAT_GROUPS[catKey].includes(mlCat(p));
  return mlCat(p) === catKey;
}

/* Grid del catálogo (vista sin filtros de precio/orden/búsqueda — las únicas
   que están permitidas en robots.txt y en el sitemap). Sin categoría = todos
   los productos (incluye sin stock, marcados "Agotado" — igual que el
   cliente). Orden por defecto: más vendidos, primeras 24 (mismo perPage que
   catalogo.html). */
function buildCatalogGridSSR(productos, catKey) {
  let r = catKey ? productos.filter(p => matchesCategorySSR(p, catKey)) : productos.slice();
  r.sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0));
  return r.slice(0, 24);
}

module.exports = {
  productCardHtmlSSR, buildHomeBestsellersSSR, buildHomeCategorySSR, esMalla, esProtector, esFunda, esCombo,
  buildCatalogGridSSR, matchesCategorySSR, getImg, getStock, getVariants,
};

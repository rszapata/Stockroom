// ── Feed de Google Merchant Center ───────────────────────────────────────
//
// Sin esto no hay fichas gratuitas de Shopping (probado: /feed.xml, /merchant.xml,
// /api/tienda/feed daban 404 los cuatro). Formato RSS 2.0 con el namespace de
// Google, una entrada por VARIACIÓN con stock — no por publicación — para que
// cada color/modelo compita como su propia oferta y Google los agrupe con
// item_group_id. Genera desde la base local (getProductCache), no en vivo
// contra ML: si el token de ML falla justo cuando Google rastrea el feed, no
// hay que quedarse sin fichas por eso.
//
// Es más permisivo que buildProductGroupJsonLd de lib/seo.js: ahí sólo se
// arma un ProductGroup cuando la estructura de ejes es inequívoca (para no
// mandar un JSON-LD mal formado a Google). Acá, en cambio, cualquier variación
// con stock entra —con color/tamaño si se puede identificar el eje, sin ellos
// si no— porque no publicar una oferta real es peor que publicarla con menos
// atributos.

const { wzSlug, wzIsColorAttr, wzColorAxisIndex } = require('./seo');

const BASE = 'https://wzmallas.com/tienda/producto.html';
const ENVIO_GRATIS_MIN = 33000;

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* Categoría de Google Shopping. Mismo criterio de título que getCat() en
   products.js: por lo que dice el título, no hay campo custom para esto. */
function googleCategoria(title) {
  const t = String(title || '').toLowerCase();
  const esReloj = /\b(watch|gear|active|amazfit|garmin|vivoactive)\b/.test(t);
  if (/\b(funda|case|carcasa|cover)\b/.test(t) && !esReloj) return '6552';  // Fundas para celular
  if (/\b(protector|vidrio|templado|\bfilm\b|mica)\b/.test(t) && esReloj)  return '201';   // Correas y bandas para reloj (protectores de smartwatch no tienen id propio)
  if (/\b(malla|correa|banda|pulsera)\b/.test(t))                          return '201';   // Correas y bandas para reloj
  if (/\bcargador|cable\b/.test(t))                                       return '2618';  // Cables y adaptadores
  return '';   // sin categoría clara: mejor omitir el atributo que adivinar mal
}

/* Filas de un producto: una por variación con stock, o una sola si no tiene
   variaciones. price siempre es el de lista (p.price) — nunca el de
   transferencia, que desaparejaría el feed con lo que ve el cliente y
   desaprueba el producto (política de Merchant Center). */
function filasDe(p) {
  const pics = Array.isArray(p.pictures) ? p.pictures : [];
  const picById = {};
  pics.forEach(pic => { picById[pic.id] = pic.secure_url || pic.url || ''; });
  const imgDefault = String((pics[0] && (pics[0].secure_url || pics[0].url)) || p.thumbnail || '');
  const precioLista = Number(p.price || 0);
  if (!precioLista) return [];   // sin precio no hay oferta que declarar
  const envioGratis = precioLista >= ENVIO_GRATIS_MIN;
  const catGoogle = googleCategoria(p.title);
  const gCat = catGoogle ? '<g:google_product_category>' + catGoogle + '</g:google_product_category>' : '';

  const comun =
    '<g:brand>WZMALLAS</g:brand>' +
    '<g:condition>new</g:condition>' +
    '<g:identifier_exists>no</g:identifier_exists>' +   // no hay GTIN/MPN en estas publicaciones (verificado en attrs de ML)
    gCat +
    '<g:price>' + precioLista.toFixed(2) + ' ARS</g:price>' +
    (envioGratis ? '<g:shipping><g:country>AR</g:country><g:price>0.00 ARS</g:price></g:shipping>' : '');

  const variations = Array.isArray(p.variations) ? p.variations : [];
  if (!variations.length) {
    const stock = (p.available_quantity || 0) > 0;
    return [
      '<item>' +
        '<g:id>' + escXml(p.id) + '</g:id>' +
        '<title><![CDATA[' + p.title + ']]></title>' +
        '<link>' + escXml(BASE + '?id=' + encodeURIComponent(p.id)) + '</link>' +
        '<g:image_link>' + escXml(imgDefault) + '</g:image_link>' +
        '<g:availability>' + (stock ? 'in_stock' : 'out_of_stock') + '</g:availability>' +
        comun +
      '</item>',
    ];
  }

  const combos0 = variations[0].attribute_combinations || [];
  const dosEjes  = combos0.length === 2 && combos0.every(a => a && a.value_name);
  const colorIdx = dosEjes ? wzColorAxisIndex(combos0)
                 : (combos0.length === 1 && wzIsColorAttr(combos0[0]) ? 0 : -1);
  const modeloIdx = dosEjes ? (colorIdx === 0 ? 1 : 0) : -1;

  const filas = [];
  for (const v of variations) {
    if (!((v.available_quantity || 0) > 0)) continue;
    const combos = v.attribute_combinations || [];
    const picId = (v.picture_ids || [])[0];
    const img = (picId && picById[picId]) || imgDefault;

    let color = null, modelo = null;
    if (dosEjes && combos.length === combos0.length) {
      color  = combos[colorIdx]  && combos[colorIdx].value_name;
      modelo = combos[modeloIdx] && combos[modeloIdx].value_name;
    } else if (colorIdx === 0 && combos.length === 1) {
      color = combos[0] && combos[0].value_name;
    }

    const params = new URLSearchParams({ id: p.id, v: String(v.id) });
    if (modelo) params.set('m', wzSlug(modelo));
    const link = BASE + '?' + params.toString();
    const etiqueta = [color, modelo].filter(Boolean).join(' · ');

    filas.push(
      '<item>' +
        '<g:id>' + escXml(p.id + '-' + v.id) + '</g:id>' +
        '<g:item_group_id>' + escXml(p.id) + '</g:item_group_id>' +
        '<title><![CDATA[' + p.title + (etiqueta ? ' - ' + etiqueta : '') + ']]></title>' +
        '<link>' + escXml(link) + '</link>' +
        '<g:image_link>' + escXml(img) + '</g:image_link>' +
        '<g:availability>in_stock</g:availability>' +
        (color  ? '<g:color>' + escXml(color) + '</g:color>' : '') +
        (modelo ? '<g:size>'  + escXml(modelo) + '</g:size>' : '') +
        comun +
      '</item>'
    );
  }
  return filas;
}

function buildMerchantFeedXml(products) {
  const items = [];
  for (const p of products) {
    if (p.wz_a_pedido) continue;   // "a pedido" sin stock inmediato: no vale de anuncio de Shopping
    try { items.push(...filasDe(p)); } catch (e) { /* una publicación rara no debe tirar abajo el feed entero */ }
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    '<channel>\n' +
    '<title>WZMALLAS</title>\n' +
    '<link>https://wzmallas.com/tienda/</link>\n' +
    '<description>Catálogo de WZMALLAS para Google Merchant Center</description>\n' +
    items.join('\n') + '\n' +
    '</channel>\n</rss>\n';
}

module.exports = { buildMerchantFeedXml };

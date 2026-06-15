// ============================================================
// PRODUCTS — fallback hardcodeado en formato nativo ML
// Estructura idéntica a lo que devuelve GET /items?ids=...
// Cuando /api/tienda/sync corra, cache/items.json reemplaza esto.
// ============================================================
const PRODUCTS = [
  { id:'MLA2225633994', title:"Protector Silicona Para Samsung Watch 8, 40mm/44mm/classic", price:25200, available_quantity:149, sold_quantity:240, thumbnail:'https://http2.mlstatic.com/D_741232-MLA89311135012_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_741232-MLA89311135012_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1482631510', title:"Protector Para Samsung Watch 6. Exclusivo.",                 price:18600, available_quantity:126, sold_quantity:92,  thumbnail:'https://http2.mlstatic.com/D_949802-MLA92469869390_092025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_949802-MLA92469869390_092025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1478696837', title:"Protector De Silicona Para Samsung Watch 7, 40mm/44mm.",     price:22500, available_quantity:81,  sold_quantity:270, thumbnail:'https://http2.mlstatic.com/D_610409-MLA91351614724_092025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_610409-MLA91351614724_092025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA884198485',  title:"Protector Full Para Apple Watch. Cubre Bordes Y Vidrio.",    price:22500, available_quantity:70,  sold_quantity:131, thumbnail:'https://http2.mlstatic.com/D_893824-MLA89529538226_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_893824-MLA89529538226_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1504579473', title:"Protector Silicona Para Xiaomi Redmi Watch 5/3 Active/lite.",price:21500, available_quantity:47,  sold_quantity:90,  thumbnail:'https://http2.mlstatic.com/D_711038-MLA89980426480_082025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_711038-MLA89980426480_082025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA2093096574', title:"Protector De Silicona Para Samsung Watch 7, 40mm/44mm",      price:22500, available_quantity:46,  sold_quantity:34,  thumbnail:'https://http2.mlstatic.com/D_861873-MLA91892428544_092025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_861873-MLA91892428544_092025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1109037161', title:"Protector Diamantes Full Para Apple Watch. Exclusivo.",      price:22550, available_quantity:41,  sold_quantity:153, thumbnail:'https://http2.mlstatic.com/D_984624-MLA78002696023_072024-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_984624-MLA78002696023_072024-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1504325204', title:"Protector Silicona Para Modelos Samsung Active. Exclusivos", price:11661, available_quantity:36,  sold_quantity:15,  thumbnail:'https://http2.mlstatic.com/D_608946-MLA71633683109_092023-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_608946-MLA71633683109_092023-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1109021655', title:"Protector Para Samsung Watch 4 Classic. Cubre Bordes.",      price:13829, available_quantity:35,  sold_quantity:84,  thumbnail:'https://http2.mlstatic.com/D_803979-MLA95670924251_102025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_803979-MLA95670924251_102025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1798476174', title:"Combo Malla Iman Y Protector Compatible Samsung Watch 4/5/6",price:37375, available_quantity:32,  sold_quantity:68,  thumbnail:'https://http2.mlstatic.com/D_996818-MLA81615193852_012025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_996818-MLA81615193852_012025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA2042872320', title:"Combo Malla Iman Y Protector Para Samsung Watch 7, 40/44mm", price:47500, available_quantity:29,  sold_quantity:21,  thumbnail:'https://http2.mlstatic.com/D_996818-MLA81615193852_012025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_996818-MLA81615193852_012025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1109028224', title:"Protector Para Samsung Watch 4, Cubre Pantalla Y Bordes.",   price:21500, available_quantity:28,  sold_quantity:493, thumbnail:'https://http2.mlstatic.com/D_629655-MLA89668587536_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_629655-MLA89668587536_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA2042730696', title:"Combo Malla Acero Y Protector Para Samsung Watch 7, 40/44mm",price:52500, available_quantity:27,  sold_quantity:34,  thumbnail:'https://http2.mlstatic.com/D_685185-MLA83502291785_042025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_685185-MLA83502291785_042025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1504557467', title:"Combo Malla De Acero Y Protector Para Xiaomi 3/5 Active",    price:42500, available_quantity:26,  sold_quantity:82,  thumbnail:'https://http2.mlstatic.com/D_659873-MLA85940363461_062025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_659873-MLA85940363461_062025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1514678583', title:"Combo Para Samsung Watch 8, Malla De Acero Y Protector.",    price:75200, available_quantity:24,  sold_quantity:18,  thumbnail:'https://http2.mlstatic.com/D_667646-MLA89600697154_082025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_667646-MLA89600697154_082025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1172510579', title:"Protector Para Samsung Watch 5, Cubre Pantalla Y Bordes.",   price:19500, available_quantity:21,  sold_quantity:375, thumbnail:'https://http2.mlstatic.com/D_750235-MLA89649163428_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_750235-MLA89649163428_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1485779475', title:"Protector Para Samsung Watch 4/5/6/7 Convierte En Ultra.",   price:35600, available_quantity:20,  sold_quantity:6,   thumbnail:'https://http2.mlstatic.com/D_631290-MLA89477425472_082025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_631290-MLA89477425472_082025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1504580133', title:"Protector De Metal Para Apple Watch Ultra 1/2 49mm",         price:42500, available_quantity:20,  sold_quantity:36,  thumbnail:'https://http2.mlstatic.com/D_944502-MLA85629462512_062025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_944502-MLA85629462512_062025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA899132847',  title:"Protector Exclusivo Para Samsung Watch 3.",                  price:13829, available_quantity:19,  sold_quantity:22,  thumbnail:'https://http2.mlstatic.com/D_684181-MLA95671509283_102025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_684181-MLA95671509283_102025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1384992161', title:"Combo Protector Y Malla De Acero Para Samsung Watch 4/5/6.", price:59526, available_quantity:18,  sold_quantity:24,  thumbnail:'https://http2.mlstatic.com/D_673490-MLA82053335820_022025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_673490-MLA82053335820_022025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1332776859', title:"Combo Malla De Tela Y Protector Compatible Watch 4/5",       price:27500, available_quantity:18,  sold_quantity:2,   thumbnail:'https://http2.mlstatic.com/D_703873-MLA53588762973_022023-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_703873-MLA53588762973_022023-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1449249429', title:"Combo Protector Y Malla Arcoiris Para Samsung Watch 4/5/6",  price:51750, available_quantity:18,  sold_quantity:0,   thumbnail:'https://http2.mlstatic.com/D_815796-MLA78904897292_092024-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_815796-MLA78904897292_092024-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1397523023', title:"Combo Malla Iman Y Protector Para Samsung Watch 4/5/6.",     price:32703, available_quantity:18,  sold_quantity:10,  thumbnail:'https://http2.mlstatic.com/D_810598-MLA78239153892_082024-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_810598-MLA78239153892_082024-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA2225595132', title:"Protector Policarbonato Para Samsung Watch 8 Classic",       price:36500, available_quantity:16,  sold_quantity:56,  thumbnail:'https://http2.mlstatic.com/D_646761-MLA89312122714_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_646761-MLA89312122714_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1489432437', title:"Protector Full Para Apple Watch Serie 10, (42/46mm)",        price:23500, available_quantity:14,  sold_quantity:24,  thumbnail:'https://http2.mlstatic.com/D_748709-MLA89167563747_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_748709-MLA89167563747_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1504491846', title:"Protector De Diamantes Para Samsung Active. Exclusivos.",    price:14576, available_quantity:13,  sold_quantity:19,  thumbnail:'https://http2.mlstatic.com/D_895480-MLA95671639821_102025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_895480-MLA95671639821_102025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1469660343', title:"Combo Malla Velcro Y Protector Para Samsung Watch Ultra",    price:46500, available_quantity:13,  sold_quantity:3,   thumbnail:'https://http2.mlstatic.com/D_927980-MLA81469471750_012025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_927980-MLA81469471750_012025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1987958238', title:"Protector Soft Tpu Para Samsung Watch 7 Ultra.",             price:22500, available_quantity:9,   sold_quantity:28,  thumbnail:'https://http2.mlstatic.com/D_819471-MLA92786257195_092025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_819471-MLA92786257195_092025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1481431099', title:"Combo Malla Y Protector Silicona Para Samsung Watch Ultra.", price:47500, available_quantity:8,   sold_quantity:13,  thumbnail:'https://http2.mlstatic.com/D_854410-MLA82678431636_032025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_854410-MLA82678431636_032025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA2225659700', title:"Protector De Aleacion Aluminio Para Samsung Watch Ultra 7/8",price:43500, available_quantity:7,   sold_quantity:41,  thumbnail:'https://http2.mlstatic.com/D_843908-MLA89308010772_082025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_843908-MLA89308010772_082025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA2109311180', title:"Combo Malla Y Protector Titanio Para Apple Watch Ultra 1/2.",price:122500,available_quantity:6,   sold_quantity:4,   thumbnail:'https://http2.mlstatic.com/D_770406-MLA85629883204_062025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_770406-MLA85629883204_062025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1478762109', title:"Protector Policarbonato + Templado Para Samsung Watch Ultra",price:32900, available_quantity:5,   sold_quantity:9,   thumbnail:'https://http2.mlstatic.com/D_980369-MLA88656876274_072025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_980369-MLA88656876274_072025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA2084618434', title:"Funda Protectora Armor Para Samsung S25",                    price:17500, available_quantity:5,   sold_quantity:1,   thumbnail:'https://http2.mlstatic.com/D_745455-MLA90567233545_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_745455-MLA90567233545_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA2084631136', title:"Funda Protectora Armor Para Samsung S25 Ultra",              price:17500, available_quantity:5,   sold_quantity:1,   thumbnail:'https://http2.mlstatic.com/D_648509-MLA90184778226_082025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_648509-MLA90184778226_082025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA2037413108', title:"Combo Malla Diamante Y Protector Para Samsung Watch 7",      price:49999, available_quantity:4,   sold_quantity:6,   thumbnail:'https://http2.mlstatic.com/D_725828-MLA83335057981_032025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_725828-MLA83335057981_032025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1989028956', title:"Protector Full Para Apple Watch Ultra 49mm.",                price:22500, available_quantity:3,   sold_quantity:6,   thumbnail:'https://http2.mlstatic.com/D_825111-MLA81756524163_012025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_825111-MLA81756524163_012025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1557742047', title:"Protector De Metal Para Apple Watch Serie 10 De 46mm.",      price:42500, available_quantity:3,   sold_quantity:6,   thumbnail:'https://http2.mlstatic.com/D_808140-MLA95140706477_102025-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_808140-MLA95140706477_102025-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1143904256', title:"Protector Bumper Silicona Para Apple Watch Serie 7.",        price:8298,  available_quantity:2,   sold_quantity:19,  thumbnail:'https://http2.mlstatic.com/D_632201-MLA89020937513_072025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_632201-MLA89020937513_072025-O.webp'}], variations:[], category_id:'' },
  { id:'MLA1443909401', title:"Combo Protector Y Templado Para Samsung Watch Smr810, 42mm", price:17250, available_quantity:2,   sold_quantity:10,  thumbnail:'https://http2.mlstatic.com/D_828025-MLA78478092171_082024-O.jpg',  pictures:[{secure_url:'https://http2.mlstatic.com/D_828025-MLA78478092171_082024-O.jpg'}],  variations:[], category_id:'' },
  { id:'MLA1478632379', title:"Protector Policarbonato 360 Para Apple Watch S10",           price:28500, available_quantity:2,   sold_quantity:80,  thumbnail:'https://http2.mlstatic.com/D_903972-MLA91197533944_092025-O.webp', pictures:[{secure_url:'https://http2.mlstatic.com/D_903972-MLA91197533944_092025-O.webp'}], variations:[], category_id:'' },
];

// ============================================================
// HELPERS — leen campos nativos de ML
// Usar SIEMPRE estas funciones, nunca acceder a los campos directamente.
// Así si ML cambia el schema, solo se actualiza acá.
// ============================================================

/** Placeholder neutro para productos sin imagen (ej. productos propios recién
 *  cargados desde WhatsApp, antes de que el admin suba sus fotos). Es clave usar
 *  SIEMPRE este fallback y nunca un string vacío: un <img src=""> hace que el
 *  navegador dispare un request a la URL del documento actual (bug clásico de
 *  HTML), lo cual puede multiplicar requests y volver la carga muy lenta cuando
 *  hay varios productos sin foto en una misma grilla. */
const NO_IMG_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
  '<rect width="400" height="400" fill="#eef0f2"/>' +
  '<g fill="none" stroke="#cfd4da" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="90" y="110" width="220" height="180" rx="14"/>' +
  '<circle cx="150" cy="170" r="18"/>' +
  '<path d="M90 250l60-55 45 40 55-65 60 80"/>' +
  '</g></svg>'
);

/** URL de la imagen principal en alta resolución.
 *  ML asigna el thumbnail a la variante principal del vendedor, pero usa
 *  el sufijo -I. (baja res). Extraemos el ID del thumbnail y buscamos la
 *  versión -O. (alta res) en el array pictures. */
function getImg(p) {
  var url = '';
  if (p.thumbnail && p.pictures && p.pictures.length) {
    // Extraer ID de imagen del thumbnail: entre /D_ y -I. o -O.
    var m = p.thumbnail.match(/\/D_([^\/]+?)(?:-I\.|_[A-Z]\.)/);
    if (m) {
      var thumbId = m[1]; // ej: "715375-MLA54953391667_042023"
      var match = p.pictures.find(pic => {
        var u = pic.secure_url || pic.url || '';
        return u.includes(thumbId);
      });
      if (match) url = match.secure_url || match.url || '';
    }
  }
  // Fallback: primera foto
  if (!url && p.pictures && p.pictures.length) {
    url = p.pictures[0].secure_url || p.pictures[0].url || p.thumbnail || '';
  }
  if (!url) url = p.thumbnail || '';
  // Sin imagen real disponible → placeholder local (nunca string vacío, ver nota arriba)
  if (!url) return NO_IMG_PLACEHOLDER;
  // Downsize a variante media (-V, ~11KB vs ~20KB de -O) para grilla/cards/
  // carrusel/carrito. La galería de la página de producto usa getImgs() en
  // alta resolución (-O), así que no se ve afectada.
  return toGridImg(url);
}

/** Convierte una URL de imagen de ML a la variante media -V (mitad de peso
 *  que -O), ideal para miniaturas. Si no matchea el patrón, devuelve igual. */
function toGridImg(url) {
  return (url || '').replace(/-[OWV]\.(webp|jpg|jpeg|png)(\?.*)?$/i, '-V.$1$2');
}

/** Array de todas las URLs de imágenes */
function getImgs(p) {
  let urls = [];
  if (p.pictures && p.pictures.length) {
    urls = p.pictures.map(pic => pic.secure_url || pic.url).filter(Boolean);
  } else if (p.thumbnail) {
    urls = [p.thumbnail];
  }
  // Nunca devolver vacío: un <img src=""> dispara un request a la URL actual (ver nota en getImg)
  return urls.length ? urls : [NO_IMG_PLACEHOLDER];
}

/** Stock total (suma variantes si existen, o available_quantity raíz) */
function getStock(p) {
  if (p.variations && p.variations.length) {
    return p.variations.reduce((s, v) => s + (v.available_quantity || 0), 0);
  }
  return p.available_quantity || 0;
}

/** Labels de variantes (ej: ["42mm", "44mm / Negro", ...]) */
function getVariants(p) {
  if (!p.variations || !p.variations.length) return [];
  return [...new Set(
    p.variations
      .filter(v => v.attribute_combinations && v.attribute_combinations.length)
      .map(v => v.attribute_combinations.map(a => a.value_name).join(' / '))
  )];
}

/**
 * Devuelve previews por variante: [{ name, img }]
 * Solo incluye variantes que tienen una imagen específica asociada (picture_ids).
 * Útil para mostrar swatches en las tarjetas de producto.
 */
function getVariantPreviews(p) {
  if (!p.variations || !p.variations.length) return [];
  if (!p.pictures || !p.pictures.length)     return [];

  const picById = {};
  p.pictures.forEach(pic => { picById[pic.id] = pic.secure_url || pic.url || ''; });

  const seen = new Set();
  const previews = [];
  for (const v of p.variations) {
    if (!v.attribute_combinations || !v.attribute_combinations.length) continue;
    const name  = v.attribute_combinations.map(a => a.value_name).join(' / ');
    if (seen.has(name)) continue;
    const picId = (v.picture_ids || [])[0];
    const img   = picId ? picById[picId] : '';
    if (!img) continue;
    seen.add(name);
    previews.push({ name, img });
  }
  return previews;
}

/** Categoría tienda derivada del título (sin tocar el item ML) */
function getCat(p) {
  const t = (p.title || '').toLowerCase();
  if (t.includes('apple watch') || t.includes('iwatch'))             return 'apple-watch';
  if (t.includes('samsung')     || t.includes('galaxy watch'))       return 'samsung-watch';
  if (t.includes('funda')       || t.includes('carcasa') ||
      t.includes('cover')       || t.includes('case iphone'))        return 'fundas';
  return 'otras';
}

/** Tag de display derivado de datos ML */
function getTag(p) {
  const stock = getStock(p);
  if (stock === 0)                        return 'agotado';
  if ((p.sold_quantity || 0) >= 200)      return 'bestseller';
  if ((p.sold_quantity || 0) >= 50)       return 'destacado';
  return null;
}

/** Precio formateado en pesos argentinos */
function formatPrice(n) {
  return '$' + Math.round(Number(n)).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// ── Cuotas (con interés real, vía API de MercadoPago) ─────────
// Tasa de 12 cuotas conocida al momento de escribir esto (2026-06):
// 55.39% sobre el monto. Se usa como valor inicial mientras se carga (o si
// falla) la tasa real desde /api/tienda/cuotas, que se cachea 24h en
// localStorage para no pegarle a la API en cada carga de página.
let WZ_CUOTAS_12 = { cuotas: 12, tasa: 55.39 };
try {
  const cached = JSON.parse(localStorage.getItem('wz_cuotas_12') || 'null');
  if (cached && typeof cached.tasa === 'number' && (Date.now() - cached.ts) < 24 * 60 * 60 * 1000) {
    WZ_CUOTAS_12 = cached;
  }
} catch (e) {}
fetch('/api/tienda/cuotas').then(r => r.json()).then(data => {
  const t12 = (data.tasas || []).find(t => t.cuotas === 12);
  if (t12) {
    WZ_CUOTAS_12 = { cuotas: 12, tasa: t12.tasa, ts: Date.now() };
    try { localStorage.setItem('wz_cuotas_12', JSON.stringify(WZ_CUOTAS_12)); } catch (e) {}
  }
}).catch(() => {});

/** "12 cuotas de $X" con el monto real (incluye interés) para productos > $10.000 */
function cuotasHtml(price) {
  if (!(price > 10000)) return '';
  const total    = price * (1 + WZ_CUOTAS_12.tasa / 100);
  const porCuota = total / WZ_CUOTAS_12.cuotas;
  return `<p class="product-cuotas" title="Cuotas con interés. El total final puede variar según el medio de pago.">${WZ_CUOTAS_12.cuotas} cuotas de ${formatPrice(porCuota)}</p>`;
}

/* Escapa texto para uso seguro dentro de innerHTML */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Limpia títulos crudos de ML: colapsa espacios, capitaliza primer letra */
function cleanTitle(t) {
  if (!t) return t;
  return t
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s{2,}/g, ', ')
    .replace(/\s+\./g, '.')
    .trim()
    .replace(/^./, c => c.toUpperCase());
}

/** Badge HTML de tag */
function tagLabel(tag) {
  if (!tag || tag === 'agotado') return '';
  const map = { bestseller: 'Bestseller', destacado: 'Destacado', nuevo: 'Nuevo', exclusivo: 'Exclusivo', oferta: 'Oferta' };
  const cls = { bestseller: '', destacado: '', nuevo: 'tag-new', exclusivo: 'tag-new', oferta: 'tag-sale' };
  return `<span class="product-tag ${cls[tag] || ''}">${map[tag] || tag}</span>`;
}

/**
 * Handler global para los botones "Agregar al carrito" generados con data-* attrs.
 * Se llama desde: onclick="event.preventDefault();wzAddToCart(this)"
 */
function wzAddToCart(btn) {
  // Si el producto tiene variantes, llevar al producto para seleccionarlas
  if (btn.dataset.hasVariants === '1') {
    window.location.href = './producto.html?id=' + btn.dataset.id;
    return;
  }
  const id    = btn.dataset.id;
  const price = parseFloat(btn.dataset.price);
  const title = btn.dataset.title;
  const img   = btn.dataset.img;
  Cart.add({ id, title, price, img, variant: null });
  if (typeof window.wzShowCartToast === 'function') window.wzShowCartToast({ title, img });
  const orig = btn.textContent.trim();
  btn.textContent = '¡Listo! ✓';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = orig;
    btn.disabled = false;
  }, 1500);
}

/** HTML de los swatches de variantes para una tarjeta de producto */
function variantPreviewsHtml(previews, defaultImg, max = 4) {
  if (!previews.length) return '';
  const visible = previews.slice(0, max);
  const extra   = previews.length - visible.length;
  const dataDef = (defaultImg || '').replace(/"/g, '&quot;');

  const thumbs = visible.map((v, i) => `
    <span class="variant-thumb${i === 0 ? ' active' : ''}"
          data-img="${(v.img || '').replace(/"/g, '&quot;')}"
          title="${(v.name || '').replace(/"/g, '&quot;')}"
          onmouseenter="event.preventDefault();wzPreviewVariant(this)"
          onclick="event.preventDefault();event.stopPropagation();wzPreviewVariant(this)">
      <img src="${esc(v.img)}" alt="${esc(v.name || '')}" loading="lazy">
    </span>`).join('');

  const more = extra > 0
    ? `<span class="variant-thumb-more" title="${extra} variante${extra !== 1 ? 's' : ''} más">+${extra}</span>`
    : '';

  return `<div class="variant-previews" data-default-img="${dataDef}"
                onmouseleave="wzResetMainImg(this)">${thumbs}${more}</div>`;
}

/**
 * Hover sobre un swatch → cambia la imagen principal de la tarjeta.
 * Busca el <img> dentro del .product-image-wrap más cercano (mismo card).
 */
function wzPreviewVariant(swatch) {
  const card = swatch.closest('.product-card, .product-list-item');
  if (!card) return;
  const mainImg = card.querySelector('.product-image-wrap img, .list-img-wrap img');
  if (!mainImg) return;
  const newSrc = swatch.dataset.img;
  if (newSrc && mainImg.src !== newSrc) mainImg.src = newSrc;

  // Marcar el swatch activo
  swatch.parentElement.querySelectorAll('.variant-thumb')
    .forEach(t => t.classList.toggle('active', t === swatch));
}

/** Al sacar el mouse del strip, restaura la imagen original */
function wzResetMainImg(stripEl) {
  const card = stripEl.closest('.product-card, .product-list-item');
  if (!card) return;
  const mainImg = card.querySelector('.product-image-wrap img, .list-img-wrap img');
  const def     = stripEl.dataset.defaultImg;
  if (mainImg && def && mainImg.src !== def) mainImg.src = def;
  // Restaurar el swatch activo al primero
  const thumbs = stripEl.querySelectorAll('.variant-thumb');
  thumbs.forEach((t, i) => t.classList.toggle('active', i === 0));
}

/** HTML de tarjeta de producto.
 *  @param {object} p - producto
 *  @param {object} opts - { priority: boolean } — si true, usa loading="eager" + fetchpriority="high"
 *                                                  (para productos above-the-fold en home/catalogo)
 */
function productCardHtml(p, opts = {}) {
  const img      = getImg(p);
  const stock    = getStock(p);
  const variants = getVariants(p);
  const previews = getVariantPreviews(p);
  const tag      = getTag(p);
  const shipping = (p.wz_envio_gratis || (!p.wz_local && p.price >= 33000)) ? '<p class="product-shipping">Envío gratis</p>' : '';
  const agotado  = stock === 0;
  const cuotas   = cuotasHtml(p.price);
  const urgency  = (!agotado && stock > 0 && stock <= 5) ? `<p class="product-urgency">¡Últimas ${stock} unidades!</p>` : '';

  const variantsTxt = variants.length
    ? `${variants.length} variante${variants.length !== 1 ? 's' : ''}`
    : '';

  const hasVariants = variants.length > 0;

  // Atributos de carga: 'eager' + fetchpriority='high' para los primeros (visibles sin scroll)
  const imgLoadAttrs = opts.priority
    ? 'loading="eager" fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';

  // Si tiene variantes → botón lleva al producto para elegir; si no → agrega directo
  const addBtn = agotado
    ? `<button class="btn-primary btn-sm" style="margin-top:8px;width:100%" disabled>Sin stock</button>`
    : `<button class="btn-primary btn-sm" style="margin-top:8px;width:100%"
         data-id="${p.id}"
         data-price="${p.price}"
         data-title="${esc(p.title || '')}"
         data-img="${esc(img)}"
         data-has-variants="${hasVariants ? '1' : '0'}"
         onclick="event.preventDefault();wzAddToCart(this)">
         ${hasVariants ? 'Ver opciones' : 'Agregar al carrito'}
       </button>`;

  return `
    <a href="./producto.html?id=${p.id}" class="product-card${agotado ? ' product-card--agotado' : ''}">
      <div class="product-image-wrap">
        <img src="${esc(img)}" alt="${esc(p.title)}" width="300" height="300" ${imgLoadAttrs} onerror="this.onerror=null;this.alt='';this.style.opacity='.3'">
        ${tagLabel(tag)}
        ${agotado ? '<span class="product-tag" style="background:var(--text-3);color:#fff">Agotado</span>' : ''}
        ${p.wz_local ? '<span class="product-tag-wz">Venta directa WZ</span>' : ''}
        ${variantPreviewsHtml(previews, img)}
      </div>
      <div class="product-info">
        <p class="product-name">${esc(cleanTitle(p.title))}</p>
        ${variantsTxt ? `<p class="product-meta">${variantsTxt}</p>` : ''}
        <p class="product-price">${formatPrice(p.price)}</p>
        ${cuotas}
        ${shipping}
        ${urgency}
        ${addBtn}
      </div>
    </a>
  `;
}

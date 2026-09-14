// ── SEO de productos: meta description + JSON-LD (schema.org/Product) ──
// Funciones puras (sin estado de módulo): reciben el producto y devuelven
// el texto/objeto listo para inyectar en el HTML de la PDP.

function buildProductMetaDescription(p) {
  const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const d = clean(p.wz_descripcion || p.plain_text || p.descripcion || '');
  if (d.length >= 50) return d.slice(0, 500);
  const title = (clean(p.title) || 'Producto').replace(/[.\s]+$/, ''); // sin punto/espacio final
  return `${title}. Comprá en WZMALLAS, tienda oficial: envío a todo el país, garantía y devolución en 10 días. Pagá con Mercado Pago en cuotas o por transferencia.`.slice(0, 500);
}

function buildProductJsonLd(p, id, host, description) {
  const pics = Array.isArray(p.pictures) ? p.pictures : [];
  let img = (pics[0] && (pics[0].secure_url || pics[0].url)) || p.thumbnail || '';
  img = String(img).replace(/^http:\/\//, 'https://');
  // Dominio canónico fijo: el sitio público siempre es wzmallas.com (el host del
  // request puede ser localhost/IP en acceso directo y no debe filtrarse al schema).
  const url = 'https://wzmallas.com/tienda/producto.html?id=' + encodeURIComponent(id);
  const inStock = (p.available_quantity || 0) > 0;
  return {
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:        p.title || '',
    description: description || buildProductMetaDescription(p),
    image:       img,
    sku:         id,
    brand:       { '@type': 'Brand', name: 'WZMALLAS' },
    offers: {
      '@type':        'Offer',
      url,
      priceCurrency:  'ARS',
      price:          p.price || 0,
      itemCondition:  'https://schema.org/NewCondition',
      availability:   inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller:         { '@type': 'Organization', name: 'WZMALLAS' },
      // Devolución: 10 días, AR, flete de regreso a cargo de WZMALLAS (Art. 34 Ley 24.240).
      hasMerchantReturnPolicy: {
        '@type':              'MerchantReturnPolicy',
        applicableCountry:    'AR',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays:   10,
        returnMethod:         'https://schema.org/ReturnByMail',
        returnFees:           'https://schema.org/FreeReturn'
      },
      // Envío gratis (oferta destacada >$33.000), 0-1 día prep + 2-7 días tránsito.
      shippingDetails: {
        '@type':             'OfferShippingDetails',
        shippingRate:        { '@type': 'MonetaryAmount', value: 0, currency: 'ARS' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'AR' },
        deliveryTime: {
          '@type':      'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime:  { '@type': 'QuantitativeValue', minValue: 2, maxValue: 7, unitCode: 'DAY' }
        }
      }
    }
  };
}



// ── <title> de la ficha ────────────────────────────────────────────────
//
// El título del <title> era el de Mercado Libre tal cual: Title Case de
// marketplace, punto final y relleno de SEO ("Compatible Con Relojes"). Medido
// sobre 40 fichas, 23 pasaban los 60 caracteres, así que Google las cortaba —y
// como 6 arrancaban con las mismas cuatro palabras ("Malla Para Samsung
// Watch"), lo que las diferenciaba quedaba justo después del corte.
//
// Es el mismo cleanTitle que ya usa el H1 en products.js, portado acá para que
// el título y el encabezado digan lo mismo, más un presupuesto de caracteres.

const WZ_TITLE_LOWER = new Set([
  'para','de','del','la','el','los','las','con','sin','y','en','a','o','al','tu','tus','más','mas',
  'malla','mallas','correa','banda','funda','fundas','protector','protectores','reloj','relojes',
  'celular','celulares','silicona','cuero','acero','metal','vidrio','templado','pantalla','bordes',
  'piedras','strass','exclusiva','exclusivo','exclusivas','exclusivos','combo','compatible','cubre',
  'magnética','magnético','magnetica','magnetico','inoxidable','deportiva','deportivo','diseño',
  'costura','cargador','carga','imán','iman','tela','transparente','resistente','colores','modelos','unidades',
]);

/* Relleno que ML pide para su propio buscador y que en una lista de resultados
   de Google sólo gasta caracteres antes del corte. Se saca SÓLO si el título no
   entra en el presupuesto: los que ya entran se dejan como están. */
const WZ_TITLE_RELLENO = [
  [/\bcompatibles?\s+con\s+relojes?\b/gi, ''],
  [/\bcompatibles?\s+con\b/gi,            ''],
  [/\bpara\s+relojes?\b/gi,               'para'],
  [/\bapto\s+para\b/gi,                   'para'],
];

/* Presupuesto: Google corta alrededor de los 60 caracteres y el sufijo de marca
   se lleva 11 (" · WZMALLAS"). */
const WZ_TITLE_MAX = 49;

function wzCleanTitle(t) {
  if (!t) return '';
  let s = String(t)
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s{2,}/g, ', ')
    .replace(/\s+\./g, '.')
    .replace(/\s*\|\s*/g, ' · ')
    .trim()
    .replace(/[.\s]+$/, '');
  // Baja el Title Case de marketplace, salvo la primera palabra y las que
  // abren oración.
  s = s.replace(/(\S+)/g, (w, _m, off) => {
    if (off === 0) return w;
    let i = off - 1;
    while (i >= 0 && s[i] === ' ') i--;
    if (i >= 0 && s[i] === '.') return w;
    const bare = w.replace(/[.,·]+$/, '');
    return WZ_TITLE_LOWER.has(bare.toLowerCase()) && /^[A-ZÁÉÍÓÚÑ]/.test(bare)
      ? w.charAt(0).toLowerCase() + w.slice(1)
      : w;
  });
  return s.replace(/^./, c => c.toUpperCase());
}

function buildProductTitle(rawTitle) {
  let s = wzCleanTitle(rawTitle) || 'Producto';
  if (s.length > WZ_TITLE_MAX) {
    for (const [re, con] of WZ_TITLE_RELLENO) s = s.replace(re, con);
    s = s.replace(/\s{2,}/g, ' ').trim().replace(/^./, c => c.toUpperCase());
  }
  // Si sigue sin entrar hay que cortar, y dónde se corta cambia mucho cómo se
  // lee. Por orden de preferencia: el final de una oración, después una coma,
  // y recién al final un espacio cualquiera. Partir una palabra al medio no es
  // opción.
  if (s.length > WZ_TITLE_MAX) {
    const MIN = 25;   // por debajo de esto el título deja de decir qué es
    let corte = -1;
    for (const re of [/\.(?=\s|$)/g, /,(?=\s|$)/g]) {
      let m;
      while ((m = re.exec(s)) && m.index <= WZ_TITLE_MAX) corte = m.index;
      if (corte >= MIN) break;
      corte = -1;
    }
    if (corte < MIN) corte = s.lastIndexOf(' ', WZ_TITLE_MAX);
    s = (corte >= MIN ? s.slice(0, corte) : s.slice(0, WZ_TITLE_MAX));
  }
  /* Un título que termina en conector ("…para Apple Watch, la") se lee como si
     faltara algo. Se van cayendo hasta que cierre en una palabra con contenido. */
  const COLGANTE = /[\s,.·-]*\b(la|el|los|las|de|del|con|sin|y|o|a|al|en|para|su|tu|mejor)\s*$/i;
  s = s.replace(/[\s,.·-]+$/, '');
  while (COLGANTE.test(s)) s = s.replace(COLGANTE, '').replace(/[\s,.·-]+$/, '');
  return s;
}

// ── ProductGroup + hasVariant ────────────────────────────────────────────
//
// El Product plano de arriba describe UNA oferta. Una ficha con variantes
// (MLA1564733165 tiene 12: cuatro modelos de iPhone × tres colores) es en
// realidad hasta doce ofertas, y con un solo Product Google sólo puede indexar
// una. El patrón que documenta Google para esto es ProductGroup + hasVariant.
//
// Sólo se resuelve la estructura de UN eje, o de DOS ejes donde uno es color:
// es el caso de casi todo el catálogo (color+modelo en fundas, color+ancho en
// mallas, o un solo eje cuando no hay color). Un atributo combinado en un solo
// campo de texto ("Color y Medida": "Marrón / 20mm" en un único value_name) es
// ambiguo para separar de forma confiable — se deja para más adelante y esa
// ficha sigue con el Product plano, que ya funciona.

function wzIsColorAttr(a) {
  return !!(a && (String(a.id || '').toUpperCase() === 'COLOR' || /color/i.test(a.name || '')));
}

/* Algunas publicaciones de ML traen el BAND_WIDTH (ancho de la malla) con
   basura de carga — "38404.1 cm", "4244454.9 cm" — ningún ancho real de
   correa pasa los ~10cm. Se descarta el atributo en vez de dejarlo pasar
   al JSON-LD, donde Google lo indexaría tal cual. Mismo criterio que el
   sanitizado client-side en producto.html (ver render()). */
function wzSanitizeCombos(combos) {
  return (combos || []).filter(a => {
    if (!a || a.id !== 'BAND_WIDTH') return true;
    const n = a.values && a.values[0] && a.values[0].struct && a.values[0].struct.number;
    return !(typeof n === 'number' && n > 10);
  });
}

/* Mismo criterio que colorIdx en producto.html: entre dos ejes, cuál hace de
   color. Server y cliente tienen que elegir siempre el mismo, porque el
   cliente decide qué variante mostrar por defecto con esta misma regla. */
function wzColorAxisIndex(combos) {
  if (!combos || combos.length < 2) return 0;
  return (wzIsColorAttr(combos[1]) && !wzIsColorAttr(combos[0])) ? 1 : 0;
}

function wzSlug(s) {
  return String(s || '')
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* Arma el ProductGroup para una publicación con variaciones. Devuelve null si
   la estructura no es una de las dos que se resuelven sin ambigüedad (ver
   arriba); el que llama debe caer al Product plano en ese caso. */
function buildProductGroupJsonLd(p, id, host, description) {
  const variations = (Array.isArray(p.variations) ? p.variations : []).map(v => ({
    ...v,
    attribute_combinations: wzSanitizeCombos(v.attribute_combinations),
  }));
  if (!variations.length) return null;

  const combos0 = variations[0].attribute_combinations || [];
  if (combos0.length < 1 || combos0.length > 2) return null;
  if (combos0.some(a => !a || !a.value_name)) return null;

  const dosEjes  = combos0.length === 2;
  const colorIdx = dosEjes ? wzColorAxisIndex(combos0) : (wzIsColorAttr(combos0[0]) ? 0 : -1);
  // Un solo eje y ES color (p.ej. una malla que sólo varía en color, sin
  // medida): no hay eje de búsqueda que valga la pena indexar por separado.
  // Se deja para el Product plano en vez de armar un grupo sin sentido.
  if (!dosEjes && colorIdx === 0) return null;
  const modeloIdx = dosEjes ? (colorIdx === 0 ? 1 : 0) : 0;

  const base = 'https://wzmallas.com/tienda/producto.html?id=' + encodeURIComponent(id);
  const pics = Array.isArray(p.pictures) ? p.pictures : [];
  const picById = {};
  pics.forEach(pic => { picById[pic.id] = pic.secure_url || pic.url || ''; });
  const imgDefault = String((pics[0] && (pics[0].secure_url || pics[0].url)) || p.thumbnail || '')
    .replace(/^http:\/\//, 'https://');
  const nombreBase = buildProductTitle(p.title);

  const hasVariant = [];
  for (const v of variations) {
    if (!((v.available_quantity || 0) > 0)) continue;        // sin stock no entra
    const combos = v.attribute_combinations || [];
    if (combos.length !== combos0.length) continue;           // variación irregular

    const valorColor  = dosEjes ? combos[colorIdx].value_name  : null;
    const valorModelo = combos[modeloIdx].value_name;
    const picId = (v.picture_ids || [])[0];
    const img   = String((picId && picById[picId]) || imgDefault).replace(/^http:\/\//, 'https://');

    const offerUrl = base + '&m=' + encodeURIComponent(wzSlug(valorModelo)) + '&v=' + encodeURIComponent(v.id);
    const etiqueta = [valorColor, valorModelo].filter(Boolean).join(' · ');

    const entry = {
      '@type':               'Product',
      sku:                   id + '-' + v.id,
      name:                  nombreBase + (etiqueta ? ' — ' + etiqueta : ''),
      image:                 img,
      inProductGroupWithID:  id,
      offers: {
        '@type':        'Offer',
        url:            offerUrl,
        priceCurrency:  'ARS',
        price:          p.price || 0,
        itemCondition:  'https://schema.org/NewCondition',
        availability:   'https://schema.org/InStock',
        seller:         { '@type': 'Organization', name: 'WZMALLAS' },
      },
    };
    if (valorColor)  entry.color = valorColor;
    if (valorModelo) entry.model = valorModelo;
    hasVariant.push(entry);
  }
  if (!hasVariant.length) return null;   // las 12 sin stock a la vez: no hay grupo que ofrecer

  const variesBy = dosEjes
    ? ['https://schema.org/color', 'https://schema.org/model']
    : ['https://schema.org/model'];

  const grupo = {
    '@context':       'https://schema.org',
    '@type':          'ProductGroup',
    '@id':            base + '#grupo',
    productGroupID:   id,
    name:             nombreBase,
    description:      description || buildProductMetaDescription(p),
    url:              base,
    brand:            { '@type': 'Brand', name: 'WZMALLAS' },
    variesBy,
    hasVariant,
  };
  return grupo;
}

/* Resuelve un slug de ?m= a su valor real de modelo, si existe en la
   publicación. Sirve para validar la canónica: un slug que no matchea a ningún
   modelo no debe fijar una canónica distinta a la del producto base. */
function resolveModelSlug(p, slug) {
  if (!slug) return null;
  const variations = (Array.isArray(p.variations) ? p.variations : []).map(v => ({
    ...v,
    attribute_combinations: wzSanitizeCombos(v.attribute_combinations),
  }));
  if (!variations.length) return null;
  const combos0 = variations[0].attribute_combinations || [];
  if (combos0.length < 1 || combos0.length > 2) return null;
  const dosEjes  = combos0.length === 2;
  const colorIdx = dosEjes ? wzColorAxisIndex(combos0) : (wzIsColorAttr(combos0[0]) ? 0 : -1);
  if (!dosEjes && colorIdx === 0) return null;
  const modeloIdx = dosEjes ? (colorIdx === 0 ? 1 : 0) : 0;
  for (const v of variations) {
    const combos = v.attribute_combinations || [];
    const val = combos[modeloIdx] && combos[modeloIdx].value_name;
    if (val && wzSlug(val) === slug) return val;
  }
  return null;
}

// ── Miga de pan ───────────────────────────────────────────────────────
//
// Mismo criterio que getCat() en components/products.js (por título, sin
// campo custom), portado acá para no depender del cliente en el HTML
// server-side. Si products.js cambia el criterio de categorización, hay que
// actualizar las dos copias — no vale la pena un require cross-runtime por
// esto solo.
const WZ_CAT_LABELS = {
  'fundas':        'Fundas',
  'apple-watch':   'Apple Watch',
  'samsung-watch': 'Samsung Watch',
};

function wzGetCatSSR(p) {
  const t = String(p.title || '').toLowerCase();
  const esFunda = /\b(funda|case|carcasa|cover)\b/.test(t);
  const esReloj = /\b(watch|gear|active|amazfit|garmin|vivoactive)\b/.test(t);
  if (esFunda && !esReloj)                                     return 'fundas';
  if (t.includes('apple watch') || t.includes('iwatch'))       return 'apple-watch';
  if (t.includes('samsung')     || t.includes('galaxy watch')) return 'samsung-watch';
  if (esFunda)                                                 return 'fundas';
  return null;   // "otras": no tiene página de categoría propia, no vale de miga
}

/* BreadcrumbList: Inicio › Categoría › Producto. Sin el escalón de categoría si
   no matchea ninguna de las que tienen página propia (ver seo-catalogo.js). */
function buildBreadcrumbJsonLd(p, tituloLimpio) {
  const items = [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: 'https://wzmallas.com/tienda/' },
  ];
  const cat = wzGetCatSSR(p);
  if (cat && WZ_CAT_LABELS[cat]) {
    items.push({
      '@type':  'ListItem',
      position: items.length + 1,
      name:     WZ_CAT_LABELS[cat],
      item:     'https://wzmallas.com/tienda/catalogo.html?cat=' + encodeURIComponent(cat),
    });
  }
  items.push({ '@type': 'ListItem', position: items.length + 1, name: tituloLimpio });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

module.exports = {
  buildProductMetaDescription, buildProductJsonLd, buildProductTitle, wzCleanTitle,
  buildProductGroupJsonLd, resolveModelSlug, wzSlug, wzIsColorAttr, wzColorAxisIndex,
  buildBreadcrumbJsonLd,
};

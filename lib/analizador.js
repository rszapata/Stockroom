// ── Analizador de publicaciones ────────────────────────────────────────
//
// Diagnostica cada publicación de ML cruzando VISITAS con VENTAS del mismo
// período. La métrica que manda es la conversión (ventas/visitas), no el
// `health` de ML: sobre 205 publicaciones nuestras la correlación entre
// health y ventas dio 0.009 — nula. El health queda como semáforo de
// completitud, nada más.
//
// Por qué no usa cache/items.json: ese cache está transformado para la
// tienda (filtra status=active, deduplica vinculaciones cross-account y
// agrupa por family_id) — 920 publicaciones reales colapsan a 385. El
// analizador necesita exactamente la granularidad que ese cache destruye:
// una fila por publicación de ML.

const CATS = [
  [/funda|carcasa|cover/i,                              'fundas'],
  [/protector|cobertor|bumper|templado|bisel|vidrio/i,  'protectores'],
  [/malla|correa|milanese/i,                            'mallas'],
  [/cable|cargador/i,                                   'cables'],
];

function categoriaDe(titulo) {
  const t = String(titulo || '');
  // Orden importa: "funda" gana sobre "malla" en títulos que traen ambas.
  for (const [re, nombre] of CATS) if (re.test(t)) return nombre;
  return 'otros';
}

/* Miniatura para la tabla: la variante -I de ML pesa ~3KB contra ~36KB de la
   original, y en una lista de 600 filas esa diferencia es la carga entera. */
function miniatura(pictures) {
  const p = (pictures || [])[0];
  const url = p && (p.secure_url || p.url);
  if (!url) return '';
  return url.replace(/([-_])[A-Z]\.(webp|jpe?g|png)(\?.*)?$/i, (m, sep, ext, qs) => `${sep}I.webp${qs || ''}`);
}

/** Trae los IDs de publicaciones de una cuenta para un estado dado. */
async function idsDeCuenta(mlGet, acct, userId, estado) {
  const ids = [];
  let offset = 0, total = Infinity;
  while (offset < total && offset < 5000) {
    const r = await mlGet(acct, `/users/${userId}/items/search?status=${estado}&limit=50&offset=${offset}`);
    total = (r && r.paging && r.paging.total != null) ? r.paging.total : 0;
    const page = (r && r.results) || [];
    if (!page.length) break;
    ids.push(...page);
    offset += 50;
  }
  return ids;
}

/** Unidades vendidas por item_id en los últimos `dias`, sumando TODAS las cuentas. */
async function ventasPorItem(mlGet, cuentas, dias) {
  const ventas = {};
  const desde = new Date(Date.now() - dias * 86400 * 1000).toISOString().replace('Z', '-00:00');
  for (const { acct, userId } of cuentas) {
    let offset = 0, total = Infinity;
    while (offset < total && offset < 5000) {
      const r = await mlGet(acct,
        `/orders/search?seller=${userId}&order.status=paid` +
        `&order.date_created.from=${encodeURIComponent(desde)}&sort=date_desc&limit=50&offset=${offset}`);
      total = (r && r.paging && r.paging.total != null) ? r.paging.total : 0;
      const results = (r && r.results) || [];
      if (!results.length) break;
      for (const ord of results) {
        for (const oi of (ord.order_items || [])) {
          const id = oi.item && oi.item.id;
          if (id) ventas[id] = (ventas[id] || 0) + (oi.quantity || 0);
        }
      }
      offset += 50;
    }
  }
  return ventas;
}

function mediana(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentil(nums, p) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/* Umbrales de referencia, sacados del propio catálogo.
   ⚠ La conversión de referencia se calcula SOLO sobre las publicaciones que
   vendieron. Antes se usaba la mediana de todas las que tenían tráfico y,
   como el 79% no vende, esa mediana daba 0% — con el corte en cero todo
   pasaba el filtro de "buena conversión" y 186 publicaciones sin una sola
   venta terminaban marcadas como "estrella, no tocar". */
// Mínimo de publicaciones con venta para que la mediana de una categoría sea
// creíble; por debajo se usa la global.
const MIN_MUESTRA_CAT = 8;

function calcularReferencias(filas) {
  const vendedoras = filas.filter(f => f.ventas > 0 && f.visitas > 0 && f.conversion != null);
  const convs = vendedoras.map(f => f.conversion);
  const global = {
    convRef:  mediana(convs)         || 3,
    convPiso: percentil(convs, 0.25) || 1.5,
  };

  /* Referencia POR CATEGORÍA: los rubros convierten distinto por naturaleza
     (acá las fundas dan 1,48% de mediana contra 5,38% de las mallas). Medir
     todo contra un número global marcaría "en problemas" a todas las fundas
     por el solo hecho de competir en un rubro más duro, y escondería a la
     funda que realmente anda mal frente a sus pares. */
  const porCat = {};
  for (const f of vendedoras) (porCat[f.categoria] ||= []).push(f.conversion);
  const categorias = {};
  for (const [cat, arr] of Object.entries(porCat)) {
    categorias[cat] = (arr.length >= MIN_MUESTRA_CAT)
      ? { convRef: mediana(arr), convPiso: percentil(arr, 0.25), muestra: arr.length, propia: true }
      : { ...global, muestra: arr.length, propia: false };
  }

  return {
    ...global,
    categorias,
    // Con menos de esto, la muestra es demasiado chica para juzgar conversión:
    // 2 visitas y 0 ventas no dice nada.
    visJuzgar: Math.max(15, percentil(filas.map(f => f.visitas), 0.75)),
    visMin: 3,
    vendedoras: vendedoras.length,
  };
}

/** Referencia que le corresponde a una fila: la de su categoría si es creíble. */
function refDe(f, ref) {
  const c = ref.categorias && ref.categorias[f.categoria];
  return (c && c.propia) ? c : { convRef: ref.convRef, convPiso: ref.convPiso };
}

/* Clasificación orientada a ACCIÓN: el nombre del grupo es lo que hay que
   hacer, no una categoría abstracta. Cada publicación cae en uno solo. */
function clasificar(f, ref) {
  const conv = f.conversion || 0;
  const { convRef, convPiso } = refDe(f, ref);

  if (f.visitas < ref.visMin) {
    return { estado: 'sin-trafico', accion: 'Nadie la ve: revisar título, atributos y categoría' };
  }
  if (f.ventas === 0 && f.visitas >= ref.visJuzgar) {
    return { estado: 'rechazo', accion: 'La ven y no compran: precio, fotos o descripción' };
  }
  if (f.ventas === 0) {
    return { estado: 'flojo', accion: 'Poco tráfico y sin ventas: rehacer o pausar' };
  }
  if (conv >= convRef && f.visitas < ref.visJuzgar) {
    return { estado: 'exposicion', accion: 'Convierte bien pero casi no la ven: más exposición' };
  }
  if (conv < convPiso && f.visitas >= ref.visJuzgar) {
    return { estado: 'conversion', accion: 'Tiene tráfico y convierte por debajo del catálogo' };
  }
  return { estado: 'funcionan', accion: 'Anda bien: no tocar' };
}

/* Plata estimada que deja sobre la mesa cada mes.
   Para las que tienen tráfico el cálculo se apoya en datos reales (visitas y
   precio son ciertos); lo único que se asume es que podrían convertir como la
   mediana de las que sí venden. Para las de poca exposición no se inventa un
   techo de visitas: se muestra cuánto vale cada visita que no está recibiendo. */
function potencial(f, ref) {
  const conv = f.conversion || 0;
  const { convRef } = refDe(f, ref);
  if (f.visitas >= ref.visJuzgar && conv < convRef) {
    const ventasPotenciales = f.visitas * (convRef - conv) / 100;
    return { plataEnJuego: Math.round(ventasPotenciales * (f.precio || 0)), valorVisita: null };
  }
  if (f.estado === 'exposicion') {
    return { plataEnJuego: null, valorVisita: Math.round(conv / 100 * (f.precio || 0)) };
  }
  return { plataEnJuego: null, valorVisita: null };
}

/**
 * Corre el análisis completo.
 * @param {function} mlGet    (acct, path) => json — autenticado por cuenta
 * @param {Array}    cuentas  [{ acct, userId, label }]
 * @param {object}   opts     { estado:'active'|'paused', dias:30, onProgress }
 */
async function analizar(mlGet, cuentas, opts = {}) {
  const estado = opts.estado === 'paused' ? 'paused' : 'active';
  const dias   = Math.min(120, Math.max(7, opts.dias || 30));
  const prog   = opts.onProgress || (() => {});

  prog({ fase: 'ventas', detalle: `Órdenes de los últimos ${dias} días` });
  const ventas = await ventasPorItem(mlGet, cuentas, dias);

  // 1) IDs + detalle de cada publicación (lotes de 20, formato nativo de ML)
  const items = [];
  for (const c of cuentas) {
    prog({ fase: 'catalogo', detalle: `Publicaciones de ${c.label}` });
    const ids = await idsDeCuenta(mlGet, c.acct, c.userId, estado);
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20);
      try {
        const det = await mlGet(c.acct, `/items?ids=${lote.join(',')}&attributes=id,title,price,health,status,sold_quantity,available_quantity,pictures,listing_type_id,shipping,permalink,category_id`);
        for (const e of (Array.isArray(det) ? det : [])) {
          if (e.code === 200 && e.body) items.push({ ...e.body, _acct: c });
        }
      } catch (err) { /* lote caído: seguimos con el resto */ }
      prog({ fase: 'catalogo', detalle: `${items.length} publicaciones`, hechas: items.length });
    }
  }

  // 2) Visitas por publicación — el bulk /visits/items acepta 1 id por request
  //    (probado: con más devuelve 400), así que va de a una con throttle. Los
  //    100ms son para no comerse el rate limit de ML en catálogos de ~900
  //    publicaciones; sin esto la corrida entera son 900 requests sin pausa.
  const PAUSA_MS = 100;
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const filas = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let visitas = 0;
    try {
      const v = await mlGet(it._acct.acct, `/items/${it.id}/visits/time_window?last=${dias}&unit=day`);
      visitas = (v && v.total_visits) || 0;
    } catch (err) { /* sin visitas: queda en 0 */ }
    if (i < items.length - 1) await dormir(PAUSA_MS);
    const vendidas = ventas[it.id] || 0;
    filas.push({
      id: it.id,
      titulo: it.title || '',
      cuenta: it._acct.label,
      categoria: categoriaDe(it.title),
      precio: it.price || 0,
      visitas,
      ventas: vendidas,
      conversion: visitas ? +(vendidas / visitas * 100).toFixed(2) : null,
      health: (typeof it.health === 'number') ? it.health : null,
      fotos: (it.pictures || []).length,
      thumb: miniatura(it.pictures),
      stock: it.available_quantity || 0,
      tipo: it.listing_type_id || '',
      envioGratis: !!(it.shipping && it.shipping.free_shipping),
      permalink: it.permalink || '',
    });
    if (i % 10 === 0) prog({ fase: 'visitas', hechas: i + 1, total: items.length });
  }

  // 3) Diagnóstico: umbrales propios del catálogo → grupo de acción → plata
  const ref = calcularReferencias(filas);
  for (const f of filas) {
    Object.assign(f, clasificar(f, ref));
    Object.assign(f, potencial(f, ref));
    // Transversal: puede necesitar completar la ficha además de lo anterior.
    f.fichaIncompleta = (f.health != null && f.health < 0.7);
  }

  // 4) Resumen por categoría — conversión agregada, no promedio de promedios
  const porCategoria = {};
  for (const f of filas) {
    const c = (porCategoria[f.categoria] ||= { categoria: f.categoria, publicaciones: 0, visitas: 0, ventas: 0 });
    c.publicaciones++; c.visitas += f.visitas; c.ventas += f.ventas;
  }
  const resumen = Object.values(porCategoria)
    .map(c => ({ ...c, conversion: c.visitas ? +(c.ventas / c.visitas * 100).toFixed(2) : null }))
    .sort((a, b) => b.visitas - a.visitas);

  return {
    ok: true,
    estado, dias,
    generado: new Date().toISOString(),
    totales: {
      publicaciones: filas.length,
      visitas: filas.reduce((s, f) => s + f.visitas, 0),
      ventas:  filas.reduce((s, f) => s + f.ventas, 0),
      medianaVisitas: mediana(filas.map(f => f.visitas)),
      conversionReferencia: ref.convRef,
      conversionPiso: ref.convPiso,
      visitasParaJuzgar: ref.visJuzgar,
      publicacionesQueVenden: ref.vendedoras,
      plataEnJuegoTotal: filas.reduce((s2, f) => s2 + (f.plataEnJuego || 0), 0),
    },
    resumen,
    filas,
  };
}

module.exports = { analizar, categoriaDe, clasificar, calcularReferencias, refDe, potencial, mediana, percentil, miniatura };

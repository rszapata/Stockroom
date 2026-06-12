// ── Helpers puros para "productos propios" (no-ML) ──

const PRODUCTO_PROPIO_PREFIX = 'WZ-LOC-';
const CATEGORIAS_PROPIAS = ['celulares', 'smartwatches', 'consolas', 'tablets', 'accesorios', 'otros'];

function generarIdProductoPropio() {
  return PRODUCTO_PROPIO_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esIdProductoPropio(id) {
  return typeof id === 'string' && id.startsWith(PRODUCTO_PROPIO_PREFIX);
}

/** Convierte un registro de tienda_productos_propios al "shape" de ítem ML, para mezclar en el catálogo. */
function localProductoToItem(lp) {
  const imagenes = Array.isArray(lp.imagenes) ? lp.imagenes.filter(Boolean) : [];
  const urls = [lp.imagen_portada_url, ...imagenes].filter(Boolean);
  const pictures = urls.map((url, i) => ({ id: `${lp.id}-img${i}`, secure_url: url, url }));
  const variantes = Array.isArray(lp.variantes) ? lp.variantes.filter(Boolean) : [];

  // Price + stock: use variants if defined, otherwise fall back to product-level fields
  let price = Number(lp.precio_ars) || 0;
  let available_quantity = lp.stock_estado === 'disponible' ? 1 : 0;
  if (variantes.length > 0) {
    const withStock = variantes.filter(v => v.stock !== 'agotado');
    const priceSource = withStock.length > 0 ? withStock : variantes;
    const prices = priceSource.map(v => Number(v.precio_ars) || 0).filter(p => p > 0);
    if (prices.length) price = Math.min(...prices);
    available_quantity = withStock.length > 0 ? 1 : 0;
  }

  const out = {
    id: lp.id,
    title: lp.titulo,
    price,
    available_quantity,
    sold_quantity: 0,
    status: lp.activo ? 'active' : 'paused',
    thumbnail: urls[0] || '',
    pictures,
    variations: [],
    attributes: [],
    category_id: '',
    permalink: '',
    wz_categoria_fija: lp.categoria || 'otros',
    wz_descripcion:    lp.descripcion || '',
    wz_imagen_portada: lp.imagen_portada_url || '',
    wz_destacado:      !!lp.destacado,
    wz_local:          true,
    wz_condicion:      lp.condicion || 'nuevo',
    wz_marca:          lp.marca || '',
    wz_envio_gratis:   !!lp.envio_gratis,
    wz_costo_envio:    lp.costo_envio != null ? Number(lp.costo_envio) : null,
    wz_dias_envio:     lp.dias_envio  || '',
    wz_a_pedido:       !!lp.a_pedido,
  };
  if (variantes.length > 0) out.wz_variantes = variantes;
  if (lp.video_url) {
    out.wz_video = { url: lp.video_url, fuente: lp.video_fuente || null, thumbnail: lp.video_thumb_url || null };
  }
  return out;
}

/** Calcula precio final en ARS a partir de precio en USD + margen% + cotización. Redondea a entero. */
function calcularPrecioArs(precioUsd, margenPct, cotizacion) {
  const usd = Number(precioUsd) || 0;
  const mg  = Number(margenPct)  || 0;
  const cot = Number(cotizacion) || 0;
  const final = usd * (1 + mg / 100) * cot;
  return Math.round(final);
}

const _cleanTxt = (s, max) => {
  const v = String(s == null ? '' : s).replace(/<script[\s\S]*?<\/script>/gi, '').trim().slice(0, max);
  return v || null;
};
const _cleanNum = (n) => {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return isNaN(v) || v < 0 ? null : v;
};

/** Arma el subconjunto de campos válidos a partir de un body crudo (create/update). */
function _buildProductoPropioFields(data, { partial }) {
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(data, k);

  if (!partial || has('titulo'))      fields.titulo      = _cleanTxt(data.titulo, 200);
  if (!partial || has('descripcion')) fields.descripcion = _cleanTxt(data.descripcion, 5000);
  if (!partial || has('marca'))       fields.marca       = _cleanTxt(data.marca, 60);
  if (!partial || has('categoria')) {
    const c = String(data.categoria || '').trim().toLowerCase();
    fields.categoria = CATEGORIAS_PROPIAS.includes(c) ? c : 'otros';
  }
  if (!partial || has('condicion')) {
    const c = String(data.condicion || '').trim().toLowerCase();
    const CONDS = ['nuevo', 'usado', 'cpo'];
    fields.condicion = CONDS.includes(c) ? c : 'nuevo';
  }
  if (!partial || has('stock_estado')) {
    const s = String(data.stock_estado || '').trim().toLowerCase();
    fields.stock_estado = s === 'agotado' ? 'agotado' : 'disponible';
  }
  if (!partial || has('imagen_portada_url')) fields.imagen_portada_url = _cleanTxt(data.imagen_portada_url, 1000);
  if (!partial || has('imagenes')) {
    const arr = Array.isArray(data.imagenes) ? data.imagenes : [];
    fields.imagenes = arr.map(u => _cleanTxt(u, 1000)).filter(Boolean).slice(0, 10);
  }
  if (!partial || has('video_url'))       fields.video_url       = _cleanTxt(data.video_url, 1000);
  if (!partial || has('video_fuente'))    fields.video_fuente    = _cleanTxt(data.video_fuente, 30);
  if (!partial || has('video_thumb_url')) fields.video_thumb_url = _cleanTxt(data.video_thumb_url, 1000);
  if (!partial || has('notas_admin'))     fields.notas_admin     = _cleanTxt(data.notas_admin, 2000);
  if (!partial || has('destacado'))       fields.destacado       = !!data.destacado;
  if (!partial || has('activo'))          fields.activo          = data.activo === undefined ? true : !!data.activo;
  if (!partial || has('a_pedido'))       fields.a_pedido        = !!data.a_pedido;
  if (!partial || has('origen')) {
    const o = String(data.origen || '').trim().toLowerCase();
    fields.origen = o === 'whatsapp' ? 'whatsapp' : 'manual';
  }
  if (!partial || has('variantes')) {
    const arr = Array.isArray(data.variantes) ? data.variantes : [];
    const CONDS_V = ['nuevo', 'cpo', 'usado'];
    fields.variantes = arr.map((v, idx) => ({
      id: (typeof v.id === 'string' && v.id.startsWith('v_')) ? v.id : `v_${Date.now()}_${idx}`,
      nombre: String(v.nombre || '').trim().slice(0, 200),
      precio_usd: v.precio_usd != null ? (parseFloat(v.precio_usd) || null) : null,
      precio_ars: parseFloat(v.precio_ars) || 0,
      stock: v.stock === 'agotado' ? 'agotado' : 'disponible',
      condicion: CONDS_V.includes(v.condicion) ? v.condicion : 'nuevo',
      colores: Array.isArray(v.colores)
        ? v.colores.map(c => String(c).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
        : [],
    })).filter(v => v.nombre).slice(0, 30);
  }

  // Precio: USD + margen% + cotización → ARS (todo calculado server-side
  // para evitar inconsistencias). Si llega precio_ars explícito sin los
  // tres componentes, se respeta tal cual (carga 100% manual en pesos).
  const precioUsd     = has('precio_usd')     ? _cleanNum(data.precio_usd)     : undefined;
  const margenPct     = has('margen_pct')     ? _cleanNum(data.margen_pct)     : undefined;
  const cotizacionUsd = has('cotizacion_usd') ? _cleanNum(data.cotizacion_usd) : undefined;
  if (precioUsd     !== undefined) fields.precio_usd     = precioUsd;
  if (margenPct     !== undefined) fields.margen_pct     = margenPct;
  if (cotizacionUsd !== undefined) fields.cotizacion_usd = cotizacionUsd;
  if (precioUsd != null && cotizacionUsd != null) {
    fields.precio_ars = calcularPrecioArs(precioUsd, margenPct || 0, cotizacionUsd);
  } else if (has('precio_ars')) {
    fields.precio_ars = _cleanNum(data.precio_ars) || 0;
  }

  return fields;
}

function _serializeProductoPropio(lp) {
  return {
    id: lp.id, titulo: lp.titulo, descripcion: lp.descripcion || '',
    marca: lp.marca || '', categoria: lp.categoria, condicion: lp.condicion,
    precio_usd: lp.precio_usd != null ? Number(lp.precio_usd) : null,
    margen_pct: lp.margen_pct != null ? Number(lp.margen_pct) : null,
    cotizacion_usd: lp.cotizacion_usd != null ? Number(lp.cotizacion_usd) : null,
    precio_ars: Number(lp.precio_ars) || 0,
    stock_estado: lp.stock_estado,
    imagen_portada_url: lp.imagen_portada_url || '',
    imagenes: Array.isArray(lp.imagenes) ? lp.imagenes : [],
    variantes: Array.isArray(lp.variantes) ? lp.variantes : [],
    video_url: lp.video_url || '', video_fuente: lp.video_fuente || '', video_thumb_url: lp.video_thumb_url || '',
    destacado: !!lp.destacado, activo: !!lp.activo, a_pedido: !!lp.a_pedido,
    notas_admin: lp.notas_admin || '', origen: lp.origen || 'manual',
    creado_en: lp.creado_en, actualizado_en: lp.actualizado_en,
  };
}

module.exports = {
  PRODUCTO_PROPIO_PREFIX, CATEGORIAS_PROPIAS,
  generarIdProductoPropio, esIdProductoPropio, localProductoToItem, calcularPrecioArs,
  _cleanTxt, _cleanNum, _buildProductoPropioFields, _serializeProductoPropio,
};

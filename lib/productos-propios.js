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

module.exports = {
  PRODUCTO_PROPIO_PREFIX, CATEGORIAS_PROPIAS,
  generarIdProductoPropio, esIdProductoPropio, localProductoToItem, calcularPrecioArs,
};

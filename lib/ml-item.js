// ── Helpers puros para items de MercadoLibre (stock/categoría/imagen/overrides) ──

function mlStock(item) {
  if (item.variations && item.variations.length)
    return item.variations.reduce((s, v) => s + (v.available_quantity || 0), 0);
  return item.available_quantity || 0;
}

function mlCat(item) {
  // Productos propios (no-ML) llevan su propia categoría fija, elegida
  // por el admin al cargarlos — no tiene sentido inferirla del título.
  if (item.wz_categoria_fija) return item.wz_categoria_fija;
  const t = (item.title || '').toLowerCase();
  const has = (...words) => words.some(w => t.includes(w));

  // ── Detectar dispositivo ─────────────────────────────────────
  const isAppleWatch = has('apple watch', 'iwatch');

  const isSamsungWatch = !isAppleWatch && (
    has('samsung', 'galaxy watch', 'gear s', 'gear classic', 'gear sport') ||
    has('watch 3', 'watch 4', 'watch 5', 'watch 6', 'watch 7', 'watch 8') ||
    has('smr810', 'smr860', 'r810', 'r860') ||
    (has('watch ultra') && !has('apple'))
  );

  const isOtrasWatch = has(
    'xiaomi', 'amazfit', 'huawei', 'garmin',
    'redmi watch', 'redmi 3', 'redmi 4', 'redmi 5 active',
    'amazfit bip', 'amazfit gtr', 'vivoactive', 'fenix'
  );

  const isSamsungPhone = has('s25', 's26', 's24', 's23', 's22', 's21', 's20',
    'a55', 'a54', 'a35', 'note 20', 'note 10') ||
    (has('samsung s') && !isSamsungWatch) ||
    (has('galaxy s') && !isSamsungWatch);

  const isIphone = has('iphone', 'magsafe');

  // ── Detectar tipo de producto ─────────────────────────────────
  const isMalla     = has('malla', 'correa', 'milanese') && !has('funda', 'carcasa');
  const isProtector = has('protector', 'cobertor', 'bumper', 'templado', 'bisel', 'vidrio');
  const isFunda     = has('funda', 'carcasa', 'cover');
  const isCable     = has('cable', 'cargador');
  const isLuces     = has('kit tuning') || (has('tuning') && has('honda', 'civic'));

  // ── Clasificar ────────────────────────────────────────────────
  if (isCable)  return 'cables';
  if (isLuces)  return 'luces-auto';

  if (isMalla && isSamsungWatch) return 'mallas-samsung';
  if (isMalla && isAppleWatch)   return 'mallas-apple';
  if (isMalla && isOtrasWatch)   return 'mallas-otras';
  if (isMalla)                   return 'mallas-otras'; // genéricas 20/22mm

  if (isProtector && isSamsungWatch) return 'protectores-samsung';
  if (isProtector && isAppleWatch)   return 'protectores-apple';
  if (isProtector && isOtrasWatch)   return 'protectores-otras';
  if (isProtector)                   return 'accesorios';

  if (isFunda && isIphone)       return 'fundas-iphone';
  if (isFunda && isSamsungPhone) return 'fundas-samsung';
  if (isFunda && has('samsung')) return 'fundas-samsung';
  if (isFunda)                   return 'accesorios';

  return 'accesorios';
}

function mlImg(item) {
  if (item.pictures && item.pictures.length)
    return item.pictures[0].secure_url || item.pictures[0].url || item.thumbnail || '';
  return item.thumbnail || '';
}

// ── Aplica la capa de personalización propia (overrides) sobre ─
// un ítem consolidado de ML. Es ADITIVA y no destructiva: nunca
// modifica el cache de ML, solo agrega/reemplaza campos en la
// copia que se envía al cliente. Ver tabla tienda_producto_overrides
// (db/queries.js) — sobrevive a los re-syncs porque vive aparte.
function applyProductOverride(item, ov) {
  if (!ov) return item;
  const out = { ...item };
  if (ov.titulo_custom)       out.title              = ov.titulo_custom;
  if (ov.descripcion_custom)  out.wz_descripcion     = ov.descripcion_custom;
  if (ov.imagen_portada_url)  out.wz_imagen_portada  = ov.imagen_portada_url;
  if (ov.video_url) {
    out.wz_video = {
      url:       ov.video_url,
      fuente:    ov.video_fuente   || null,
      thumbnail: ov.video_thumb_url || null,
    };
  }
  out.wz_destacado = !!ov.destacado;
  return out;
}

module.exports = { mlStock, mlCat, mlImg, applyProductOverride };

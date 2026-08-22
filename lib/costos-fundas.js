/* ──────────────────────────────────────────────────────────────
 * costos-fundas.js — Clasificador de costo de fundas (para rentabilidad)
 *
 * Espeja la lógica de `genera_orden_compra.py` (COSTOS_USD + clasificar +
 * costo_unit). Se usa SOLO para PRE-LLENAR el costo sugerido por publicación
 * en el dashboard de rentabilidad; el costo final lo confirma/edita el dueño
 * y se persiste por título (costos-publicacion.json) → no se "inventan" costos.
 *
 * ⚠️ Si cambian los costos en genera_orden_compra.py, actualizar acá también.
 * ────────────────────────────────────────────────────────────── */

// Costos FOB conocidos en USD por línea de funda (mirror de genera_orden_compra.py)
const COSTOS_USD = {
  con_costura:   1.51,   // iPhone con costura
  samsung_s_cu:  1.51,   // Samsung premium / cuero (S22-S25 Ultra)
  s25_magnetica: 1.60,   // S25 magnética
  iphone17_mag:  1.33,   // iPhone 17 magnética/magsafe
  magsafe:       0.85,   // iPhone MagSafe u otras fundas
};

const PATRONES_NO_FUNDA = [
  'vidrio templado', 'vidrio protector', 'film protector',
  'protector pantalla', 'protector de pantalla', 'cubre pantalla', 'cubrepantalla',
  'protector lente', 'protector de lente', 'protector camara', 'protector de cámara',
  'protector watch', 'protector para watch', 'protector para samsung watch',
  'protector para apple watch', 'protector reloj', 'protector para reloj',
  'cargador', 'cable', 'auricular', 'auriculares',
  'soporte', 'tripode', 'trípode', 'malla', 'pulsera', 'correa',
  'lente', 'palo selfie', 'powerbank', 'power bank',
  'watch', 'reloj',
];
const PATRONES_FUNDA = [
  'funda', 'case', 'carcasa',
  'magsafe', 'magnét', 'magnet',
  'con costura', 'silicona', 'silicone',
];

function esFunda(titulo) {
  const t = String(titulo || '').toLowerCase();
  if (PATRONES_NO_FUNDA.some(p => t.includes(p))) return false;
  if (PATRONES_FUNDA.some(p => t.includes(p))) return true;
  if (t.includes('s22') && t.includes('s23')) return true;
  if (t.includes('s25') && (t.includes('ultra') || t.includes('premi'))) return true;
  return false;
}

// Devuelve la clave de costo (mirror de clasificar() en el .py)
function clasificar(titulo) {
  const t = String(titulo || '').toLowerCase();
  if (t.includes('con costura') && (t.includes('iphone') || t.includes('17'))) return 'con_costura';
  if (t.includes('s22 s23 s24')) return 'samsung_s_cu';
  if (t.includes('s25') && (t.includes('premium') || t.includes('premi'))) return 'samsung_s_cu';
  if (t.includes('s25') && t.includes('magnét')) return 's25_magnetica';
  if (t.includes('17') && (t.includes('magnét') || t.includes('magsafe'))) return 'iphone17_mag';
  return 'magsafe';
}

// ¿El título es un PACK de 2+ fundas? (PKT: ... + ...) → el costo es N×
function unidadesEnTitulo(titulo) {
  const t = String(titulo || '');
  if (/^\s*pkt:/i.test(t) || t.includes(' + ')) {
    return Math.max(2, (t.split(' + ').length));
  }
  return 1;
}

/**
 * Costo unitario ARS sugerido para un título de funda.
 * @returns {{ costo:number, tipo:string, unidades:number, confiable:boolean }} | null si no es funda
 *  confiable=false cuando cayó al default 'magsafe' o es un pack (revisar a mano).
 */
function costoSugerido(titulo, tc = 1532, fleteUnit = 1928) {
  if (!esFunda(titulo)) return null;
  const tipo = clasificar(titulo);
  const unidades = unidadesEnTitulo(titulo);
  const costoLinea = Math.round(COSTOS_USD[tipo] * tc + fleteUnit);
  // "confiable" = clasificación explícita y no-pack. El default magsafe puede ser
  // una Samsung premium mal detectada → se marca para revisión.
  const t = String(titulo || '').toLowerCase();
  const explicito = tipo !== 'magsafe' || t.includes('magsafe') || (t.includes('iphone') && t.includes('magnét'));
  return {
    tipo,
    unidades,
    costo: costoLinea * unidades,
    confiable: explicito && unidades === 1,
  };
}

module.exports = { COSTOS_USD, esFunda, clasificar, unidadesEnTitulo, costoSugerido };

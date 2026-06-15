// ── Helpers puros para matcheo de variantes y formato de notificaciones ──

function _normalizeStr(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

function _varKeysAll(v) {
  const combos = (v.attribute_combinations || []).slice()
    .sort((a, b) => _normalizeStr(a.id || a.name).localeCompare(_normalizeStr(b.id || b.name)));
  if (!combos.length) return [];
  const keyByName = combos.map(c => _normalizeStr(c.id || c.name) + '=' + _normalizeStr(c.value_name || c.value_id)).join('|');
  const keyById   = combos.map(c => _normalizeStr(c.id || c.name) + '=' + _normalizeStr(c.value_id  || c.value_name)).join('|');
  return keyByName === keyById ? [keyByName] : [keyByName, keyById];
}

// Clave de variante a partir de los variation_attributes de una ORDEN de ML
// (formato [{name, value_name}]). Produce la misma forma "name=value|..."
// que _varKeysAll (variante keyByName), para poder matchear una venta con la
// variante equivalente del item vinculado de la otra cuenta.
function _varKeyFromOrderAttrs(attrs) {
  const combos = (attrs || []).slice()
    .sort((a, b) => _normalizeStr(a.id || a.name).localeCompare(_normalizeStr(b.id || b.name)));
  if (!combos.length) return '';
  return combos.map(c => _normalizeStr(c.id || c.name) + '=' + _normalizeStr(c.value_name || c.value_id)).join('|');
}

// Etiqueta legible desde variation_attributes de una orden: "Negro / S23 Ultra"
function _varLabelFromOrderAttrs(attrs) {
  return (attrs || []).map(c => c.value_name || c.value_id || c.name).filter(Boolean).join(' / ');
}

// Etiqueta legible de una variante: "Talle S / Color Rojo"
function _varLabel(v) {
  const combos = v.attribute_combinations || [];
  return combos.map(c => c.value_name || c.value_id || c.name || c.id).filter(Boolean).join(' / ') || ('var_' + v.id);
}

function _fmtVarDelta(d) {
  if (!d?.attrKey) return '';
  return d.attrKey.split('|').map(p => {
    const eq = p.indexOf('=');
    const val = (eq === -1 ? p : p.slice(eq + 1)).trim();
    // Title-case por palabra. Usa (inicio|espacio)+caracter para no romper
    // con tildes (\b\w fallaba: "marrón" → "MarróN").
    return val.replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());
  }).join(' · ');
}

// Nombre corto de cuenta: la parte después del último " — " o " - "
const _shortAcct = l => (l || '').split(/\s[—-]\s/).pop().trim() || l;

// Mensaje claro cuando se toca un botón de un ajuste que ya no está pendiente
// (típico: el comprador canceló y el stock se reequilibró → auto-resolved).
function _adjStaleMsg(adj) {
  if (!adj) return '⚠️ Este ajuste ya no existe.';
  const name = adj.groupName ? `<b>${adj.groupName}</b>\n` : '';
  switch (adj.status) {
    case 'applied':       return `✅ ${name}Ya estaba sincronizado.`;
    case 'auto-resolved': return `↩️ ${name}La venta se canceló o el stock se reequilibró solo — no había nada que ajustar.`;
    case 'dismissed':     return `✕ ${name}Ya estaba descartado.`;
    case 'error':         return `⚠️ ${name}El último intento falló. Revisá el stock manualmente.`;
    default:              return `⚠️ ${name}Este ajuste ya fue procesado.`;
  }
}

// Extrae un texto de error legible — nunca "undefined".
const _errMsg = e => (e && e.message) || (typeof e === 'string' ? e : '') || 'error desconocido';

module.exports = {
  _normalizeStr, _varKeysAll, _varKeyFromOrderAttrs, _varLabelFromOrderAttrs, _varLabel, _fmtVarDelta, _shortAcct, _adjStaleMsg, _errMsg,
};

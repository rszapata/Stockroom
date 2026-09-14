// ── Persistencia simple en archivos JSON (vinculaciones, preguntas TG, offset TG) ──
const fs   = require('fs');
const path = require('path');

// Escritura atómica: escribe en un archivo temporal y lo renombra encima del
// destino. `rename` es atómico a nivel de sistema de archivos (mismo
// filesystem), así que un crash a mitad de escritura nunca deja el archivo
// original truncado o corrupto — en el peor caso queda el .tmp huérfano.
function atomicWriteFileSync(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

const PENDING_PATH    = path.join(__dirname, '..', 'vinculaciones-pending.json');
const VINC_LOG_PATH   = path.join(__dirname, '..', 'vinculaciones-log.json');
const HISTORICO_PATH  = path.join(__dirname, '..', 'vinculaciones-historico.ndjson');
const VENTAS_PATH     = path.join(__dirname, '..', 'vinculaciones-ventas.json');
const NOTIFIED_Q_PATH = path.join(__dirname, '..', 'telegram-notified-questions.json');
const TG_OFFSET_PATH  = path.join(__dirname, '..', '.tg-offset');
const ALIBABA_MAPPING_PATH = path.join(__dirname, '..', 'alibaba-mapping.json');
const PEDIDOS_COSTOS_PATH  = path.join(__dirname, '..', 'pedidos-costos.json');
const ALIBABA_HIST_PATH    = path.join(__dirname, '..', 'alibaba-historial.json');
const VARIANTES_HIST_PATH  = path.join(__dirname, '..', 'variantes-historial.json');
const BANNER_FOTOS_PATH    = path.join(__dirname, '..', 'banner-fotos.json');
const ALIBABA_RECIBOS_DIR  = path.join(__dirname, '..', 'alibaba-recibos');

// ── Vinculaciones: ajustes pendientes ─────────
function loadPendingAdjustments() {
  try {
    if (fs.existsSync(PENDING_PATH)) return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
  } catch(e) {}
  return [];
}
function savePendingAdjustments(list) {
  try { atomicWriteFileSync(PENDING_PATH, JSON.stringify(list, null, 2)); } catch(e) {}
}

// ── Vinculaciones: log de cambios ──────────────
function loadVincLog() {
  try { if (fs.existsSync(VINC_LOG_PATH)) return JSON.parse(fs.readFileSync(VINC_LOG_PATH, 'utf8')); } catch(e) {}
  return [];
}
function appendVincLog(entry) {
  try {
    const log = loadVincLog();
    log.unshift({ id: 'log_' + Date.now(), ts: new Date().toISOString(), ...entry });
    // Al pasar de 300, la cola (lo más viejo) NO se pierde: se vuelca al histórico
    // liviano (append-only ndjson) antes de recortar.
    if (log.length > 300) {
      const dropped = log.splice(300);
      appendHistorico(dropped);
    }
    atomicWriteFileSync(VINC_LOG_PATH, JSON.stringify(log, null, 2));
  } catch(e) { console.log('[vinc-log] Error al guardar:', e.message); }
}

// ── Vinculaciones: histórico liviano (append-only ndjson) ──────
// Un registro por línea. Nunca se carga entero para escribir (solo se appendea),
// así que es barato aunque crezca mucho. Guarda un resumen mínimo del evento.
function appendHistorico(records) {
  try {
    const arr = Array.isArray(records) ? records : [records];
    if (!arr.length) return;
    const lines = arr.map(r => JSON.stringify(_slimHistorico(r))).join('\n') + '\n';
    fs.appendFileSync(HISTORICO_PATH, lines);
  } catch(e) { console.log('[vinc-historico] Error al guardar:', e.message); }
}

// Achica un registro (entrada de log o ajuste) a lo esencial para el histórico.
function _slimHistorico(r) {
  const deltas = (r.variantDeltas || []).map(d =>
    (d.label || d.attrKey || '') + (d.from != null && d.to != null ? ` ${d.from}→${d.to}` : (d.delta != null ? ` ${d.delta > 0 ? '−' : '+'}${Math.abs(d.delta)}` : ''))
  ).join(', ');
  return {
    ts: r.ts || r.appliedAt || r.createdAt || new Date().toISOString(),
    action: r.action || r.status || 'log',
    group: r.groupName || r.group || '',
    src: r.source || (r.autoApplied ? 'auto' : ''),
    items: r.itemsApplied != null ? r.itemsApplied : (r.changes ? r.changes.length : undefined),
    deltas: deltas || undefined,
    adjId: r.adjId || r.id || undefined,
  };
}

// Lee las últimas `limit` líneas del histórico (más nuevo primero).
function readHistorico(limit = 200) {
  try {
    if (!fs.existsSync(HISTORICO_PATH)) return [];
    const lines = fs.readFileSync(HISTORICO_PATH, 'utf8').split('\n').filter(Boolean);
    const tail = lines.slice(-limit).reverse();
    return tail.map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(Boolean);
  } catch(e) { return []; }
}

// ── Vinculaciones: poda del store pesado de ajustes ────────────
// Mueve al histórico liviano (y elimina del store activo) los ajustes YA
// resueltos más viejos que su ventana de retención. Los 'pending' NUNCA se tocan.
// Retención diferenciada: los 'auto-resolved' son ruido (se resolvieron solos,
// no se revierten nunca) → 14 días; los demás resueltos → `days` (revertibles).
function pruneAdjustments(days = 60) {
  try {
    const list = loadPendingAdjustments();
    if (!list.length) return 0;
    const DAY = 24 * 60 * 60 * 1000;
    const cutoffMain = Date.now() - days * DAY;
    const cutoffNoise = Date.now() - 14 * DAY;
    const keep = [], archive = [];
    for (const adj of list) {
      const resolved = adj.status && adj.status !== 'pending';
      const ts = Date.parse(adj.appliedAt || adj.dismissedAt || adj.revertedAt || adj.createdAt || '') || 0;
      const cutoff = adj.status === 'auto-resolved' ? cutoffNoise : cutoffMain;
      if (resolved && ts && ts < cutoff) archive.push(adj);
      else keep.push(adj);
    }
    if (!archive.length) return 0;
    appendHistorico(archive.map(a => ({
      ts: a.appliedAt || a.dismissedAt || a.revertedAt || a.createdAt,
      action: a.status, group: a.groupName, src: a.autoApplied ? 'auto' : (a.source || ''),
      items: a.changes ? a.changes.length : undefined, adjId: a.id, archivedFrom: 'pending',
    })));
    savePendingAdjustments(keep);
    return archive.length;
  } catch(e) { console.log('[vinc-prune] Error:', e.message); return 0; }
}

// ── Vinculaciones: registro de ventas (sale-driven sync) ──────
// Ledger de ventas de items vinculados detectadas vía API de órdenes de ML.
// Cada entrada: { orderId, accountId, itemId, groupId, varId, attrKey, label,
//   qty, saleStatus: 'paid'|'cancelled', synced: bool, cancelSynced: bool,
//   detectedAt, ... }. Permite: (a) sugerir bajar stock en la cuenta vinculada
// cuando hay venta, (b) sugerir subirlo si la venta se cancela antes de despachar.
function loadVentasLedger() {
  try { if (fs.existsSync(VENTAS_PATH)) return JSON.parse(fs.readFileSync(VENTAS_PATH, 'utf8')); } catch(e) {}
  return [];
}
function saveVentasLedger(list) {
  try { atomicWriteFileSync(VENTAS_PATH, JSON.stringify(list, null, 2)); } catch(e) {}
}

// ── Persistencia de preguntas ya notificadas ──────────────────
function loadNotifiedQuestions() {
  try { if (fs.existsSync(NOTIFIED_Q_PATH)) return JSON.parse(fs.readFileSync(NOTIFIED_Q_PATH, 'utf8')); } catch(e) {}
  return {};
}
function saveNotifiedQuestions(obj) {
  try { atomicWriteFileSync(NOTIFIED_Q_PATH, JSON.stringify(obj)); } catch(e) {}
}

// ── Offset de polling de Telegram ──────────────────────────────
function loadTgOffset() {
  try {
    const v = parseInt(fs.readFileSync(TG_OFFSET_PATH, 'utf8').trim(), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}
function saveTgOffset(offset) {
  try { atomicWriteFileSync(TG_OFFSET_PATH, String(offset)); } catch {}
}

// ── Mapeo de productos Alibaba ─────────────────────────────────
function loadAlibabaMapping() {
  try { return JSON.parse(fs.readFileSync(ALIBABA_MAPPING_PATH, 'utf8')); }
  catch { return { mappings: [] }; }
}
function saveAlibabaMapping(data) {
  atomicWriteFileSync(ALIBABA_MAPPING_PATH, JSON.stringify(data, null, 2));
}

// ── Pedidos con costo puesto (recibo + flete + impuestos) ──────
//    Estado runtime: se carga a mano y no se versiona (ver .gitignore
//    y las exclusiones de deploy.sh).
function loadPedidosCostos() {
  try { return JSON.parse(fs.readFileSync(PEDIDOS_COSTOS_PATH, 'utf8')); }
  catch { return { pedidos: [] }; }
}
// ── Alibaba: historial de cargas de stock ─────────────────────
//    Estado runtime (como los ledgers de vinculaciones): NO se versiona ni
//    se sube en el deploy — ver .gitignore y las exclusiones de deploy.sh.
//    Antes vivía en localStorage del navegador y se perdía al cambiar de
//    equipo o de URL (localStorage es por origen), justo cuando hacía falta
//    para revertir una carga mal hecha.
const ALIBABA_HIST_MAX = 300;

function loadAlibabaHistorial() {
  try {
    const d = JSON.parse(fs.readFileSync(ALIBABA_HIST_PATH, 'utf8'));
    return Array.isArray(d?.entradas) ? d.entradas : [];
  } catch { return []; }
}
function saveAlibabaHistorial(entradas) {
  try {
    atomicWriteFileSync(ALIBABA_HIST_PATH,
      JSON.stringify({ entradas: entradas.slice(0, ALIBABA_HIST_MAX) }, null, 2));
  } catch(e) { console.warn('[alibaba-hist] no se pudo guardar:', e.message); }
}

// ── Historial de variantes creadas desde el panel ──────────────
//    Estado runtime: NO se versiona ni se sube en el deploy (ver .gitignore
//    y las exclusiones de deploy.sh). Guarda qué variantes se crearon en cada
//    publicación para poder revisarlas y deshacerlas después.
const VARIANTES_HIST_MAX = 200;

function loadVariantesHistorial() {
  try {
    const d = JSON.parse(fs.readFileSync(VARIANTES_HIST_PATH, 'utf8'));
    return Array.isArray(d && d.entradas) ? d.entradas : [];
  } catch { return []; }
}
function saveVariantesHistorial(entradas) {
  try {
    atomicWriteFileSync(VARIANTES_HIST_PATH,
      JSON.stringify({ entradas: entradas.slice(0, VARIANTES_HIST_MAX) }, null, 2));
  } catch (e) { console.warn('[variantes-hist] no se pudo guardar:', e.message); }
}

// ── Curaduría de fotos del banner de categoría ────────────────
//    { fundas: ['url1','url2'], mallas: [...] }. Si una categoría NO figura
//    acá, el banner elige solo (mejor puntuadas, sin repetir producto). En
//    cuanto el dueño elige aunque sea una, manda su elección.
//    Estado runtime: excluido del deploy y de git.
function loadBannerFotos() {
  try {
    const d = JSON.parse(fs.readFileSync(BANNER_FOTOS_PATH, 'utf8'));
    return (d && typeof d === 'object') ? d : {};
  } catch { return {}; }
}
function saveBannerFotos(data) {
  try { atomicWriteFileSync(BANNER_FOTOS_PATH, JSON.stringify(data, null, 2)); }
  catch (e) { console.warn('[banner-fotos] no se pudo guardar:', e.message); }
}

function savePedidosCostos(data) {
  atomicWriteFileSync(PEDIDOS_COSTOS_PATH, JSON.stringify(data, null, 2));
}

// ── Configuración de autenticación admin ───────────────────────
function loadAuthConfig(authPath) {
  try {
    if (fs.existsSync(authPath)) return JSON.parse(fs.readFileSync(authPath, 'utf8'));
  } catch(e) { console.error('  ✗ auth.json inválido:', e.message); }
  return null;
}

module.exports = {
  PENDING_PATH, VINC_LOG_PATH, VENTAS_PATH, NOTIFIED_Q_PATH, TG_OFFSET_PATH, ALIBABA_MAPPING_PATH,
  atomicWriteFileSync,
  loadPendingAdjustments, savePendingAdjustments,
  loadVincLog, appendVincLog,
  appendHistorico, readHistorico, pruneAdjustments,
  HISTORICO_PATH,
  loadVentasLedger, saveVentasLedger,
  loadNotifiedQuestions, saveNotifiedQuestions,
  loadTgOffset, saveTgOffset,
  loadAlibabaMapping, saveAlibabaMapping,
  loadAlibabaHistorial, saveAlibabaHistorial, ALIBABA_HIST_PATH, ALIBABA_RECIBOS_DIR,
  loadVariantesHistorial, saveVariantesHistorial, VARIANTES_HIST_PATH,
  loadBannerFotos, saveBannerFotos, BANNER_FOTOS_PATH,
  loadPedidosCostos, savePedidosCostos, PEDIDOS_COSTOS_PATH,
  loadAuthConfig,
};

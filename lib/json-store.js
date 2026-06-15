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
const VENTAS_PATH     = path.join(__dirname, '..', 'vinculaciones-ventas.json');
const NOTIFIED_Q_PATH = path.join(__dirname, '..', 'telegram-notified-questions.json');
const TG_OFFSET_PATH  = path.join(__dirname, '..', '.tg-offset');
const ALIBABA_MAPPING_PATH = path.join(__dirname, '..', 'alibaba-mapping.json');

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
    if (log.length > 300) log.splice(300);
    atomicWriteFileSync(VINC_LOG_PATH, JSON.stringify(log, null, 2));
  } catch(e) { console.log('[vinc-log] Error al guardar:', e.message); }
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
  loadVentasLedger, saveVentasLedger,
  loadNotifiedQuestions, saveNotifiedQuestions,
  loadTgOffset, saveTgOffset,
  loadAlibabaMapping, saveAlibabaMapping,
  loadAuthConfig,
};

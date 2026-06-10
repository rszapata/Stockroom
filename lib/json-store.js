// ── Persistencia simple en archivos JSON (vinculaciones, preguntas TG, offset TG) ──
const fs   = require('fs');
const path = require('path');

const PENDING_PATH    = path.join(__dirname, '..', 'vinculaciones-pending.json');
const VINC_LOG_PATH   = path.join(__dirname, '..', 'vinculaciones-log.json');
const NOTIFIED_Q_PATH = path.join(__dirname, '..', 'telegram-notified-questions.json');
const TG_OFFSET_PATH  = path.join(__dirname, '..', '.tg-offset');

// ── Vinculaciones: ajustes pendientes ─────────
function loadPendingAdjustments() {
  try {
    if (fs.existsSync(PENDING_PATH)) return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
  } catch(e) {}
  return [];
}
function savePendingAdjustments(list) {
  try { fs.writeFileSync(PENDING_PATH, JSON.stringify(list, null, 2)); } catch(e) {}
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
    fs.writeFileSync(VINC_LOG_PATH, JSON.stringify(log, null, 2));
  } catch(e) { console.log('[vinc-log] Error al guardar:', e.message); }
}

// ── Persistencia de preguntas ya notificadas ──────────────────
function loadNotifiedQuestions() {
  try { if (fs.existsSync(NOTIFIED_Q_PATH)) return JSON.parse(fs.readFileSync(NOTIFIED_Q_PATH, 'utf8')); } catch(e) {}
  return {};
}
function saveNotifiedQuestions(obj) {
  try { fs.writeFileSync(NOTIFIED_Q_PATH, JSON.stringify(obj)); } catch(e) {}
}

// ── Offset de polling de Telegram ──────────────────────────────
function loadTgOffset() {
  try {
    const v = parseInt(fs.readFileSync(TG_OFFSET_PATH, 'utf8').trim(), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}
function saveTgOffset(offset) {
  try { fs.writeFileSync(TG_OFFSET_PATH, String(offset)); } catch {}
}

module.exports = {
  PENDING_PATH, VINC_LOG_PATH, NOTIFIED_Q_PATH, TG_OFFSET_PATH,
  loadPendingAdjustments, savePendingAdjustments,
  loadVincLog, appendVincLog,
  loadNotifiedQuestions, saveNotifiedQuestions,
  loadTgOffset, saveTgOffset,
};

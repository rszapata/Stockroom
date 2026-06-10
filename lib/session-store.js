// ── Persistencia de sesiones admin en disco ────────────────────
// Sobrevive reinicios de PM2/Node. Solo guardamos sid→exp (sin datos sensibles extras).
const fs = require('fs');
const { writeJsonAtomic } = require('./files');

function loadSessions(filePath) {
  const out = {};
  try {
    if (!fs.existsSync(filePath)) return out;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) {
      if (v.exp && v.exp > now) out[k] = v;
    }
  } catch(e) { console.warn('  ⚠ No se pudieron restaurar sesiones admin:', e.message); }
  return out;
}

function saveSessions(filePath, sessionsObj) {
  try {
    writeJsonAtomic(filePath, sessionsObj);
  } catch(e) { console.warn('  ⚠ Error guardando sesiones:', e.message); }
}

module.exports = { loadSessions, saveSessions };

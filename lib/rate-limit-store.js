// ── Rate-limit persistence (survives PM2 restarts) ──────────────────────────
const fs = require('fs');
const { writeJsonAtomic } = require('./files');

function loadRateLimits(filePath) {
  const out = { login: {}, contact: {}, orden: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const now = Date.now();
    // login: { ip: { count, since } } — window 15 min
    if (raw.login) {
      for (const [ip, entry] of Object.entries(raw.login)) {
        if (now - entry.since < 15 * 60 * 1000) out.login[ip] = entry;
      }
    }
    // contact: { ip: [timestamps...] } — window 1 h
    if (raw.contact) {
      for (const [ip, ts] of Object.entries(raw.contact)) {
        const valid = ts.filter(t => now - t < 3600 * 1000);
        if (valid.length) out.contact[ip] = valid;
      }
    }
    // orden: { ip: [timestamps...] } — window 1 h
    if (raw.orden) {
      for (const [ip, ts] of Object.entries(raw.orden)) {
        const valid = ts.filter(t => now - t < 3600 * 1000);
        if (valid.length) out.orden[ip] = valid;
      }
    }
  } catch { /* archivo no existe en primer arranque — OK */ }
  return out;
}

function saveRateLimits(filePath, { login, contact, orden }) {
  try {
    const out = { login, contact, orden, saved_at: new Date().toISOString() };
    writeJsonAtomic(filePath, out);
  } catch(e) { console.error('[rate-limit] Save error:', e.message); }
}

module.exports = { loadRateLimits, saveRateLimits };

// ── Log de auditoría admin ─────────────────────────────────────
// Registra cambios críticos del panel (precio, stock, alta/baja de
// productos, cupones) en un archivo append-only: quién (IP), qué y cuándo.
const fs   = require('fs');
const path = require('path');
const { getClientIP } = require('./auth-utils');

const AUDIT_LOG_FILE = path.join(__dirname, '..', 'audit.log');

function auditLog(req, action, target, details) {
  try {
    const entry = { ts: new Date().toISOString(), ip: getClientIP(req) || 'unknown', action, target, details };
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

module.exports = { AUDIT_LOG_FILE, auditLog };

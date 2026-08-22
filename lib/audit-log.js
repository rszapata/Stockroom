// ── Log de auditoría admin ─────────────────────────────────────
// Registra cambios críticos del panel (precio, stock, alta/baja de
// productos, cupones) en un archivo append-only: quién, qué y cuándo.
//
// `quien` lo estampa server.js en req._quien antes de cada request. Con más de
// una persona con acceso al panel la IP no alcanza para saber quién hizo qué:
// todos entran por el mismo túnel de Cloudflare. Cuando la identidad viene de
// Access, queda el email verificado por la firma de Cloudflare.
const fs   = require('fs');
const path = require('path');
const { getClientIP } = require('./auth-utils');

const AUDIT_LOG_FILE = path.join(__dirname, '..', 'audit.log');

function auditLog(req, action, target, details) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      quien: (req && req._quien) || 'desconocido',
      ip: getClientIP(req) || 'unknown',
      action, target, details,
    };
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

module.exports = { AUDIT_LOG_FILE, auditLog };

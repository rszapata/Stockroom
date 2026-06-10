// ── Helpers puros de auth/cookies/crypto ──
const crypto = require('crypto');

// ¿La conexión usa HTTPS? Detectamos por si viene de cloudflared (x-forwarded-proto)
// o si HTTPS=true está seteado en el entorno. Se evalúa por request, no en startup.
function isSecureConnection(req) {
  return process.env.HTTPS === 'true'
    || (req.headers['x-forwarded-proto'] || '').startsWith('https')
    || (req.headers['cf-visitor'] || '').includes('https');
}
function cookieSecure(req) {
  return isSecureConnection(req) ? '; Secure' : '';
}

function hashPassword(password, salt) {
  // pbkdf2Sync: 100k iteraciones, output 64 bytes, SHA-512
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function makeSid() { return crypto.randomBytes(32).toString('hex'); }

function timingSafeEqStr(a, b) {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// cloudflared inyecta CF-Connecting-IP con la IP real del visitante.
// Como el server bindea 127.0.0.1, solo cloudflared (o el mismo equipo) puede llegar acá,
// así que confiar en este header es seguro.
function getClientIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  // Acceso directo (localhost desde el mismo equipo)
  const ra = req.socket && req.socket.remoteAddress;
  return ra ? ra.replace(/^::ffff:/, '') : '';
}

module.exports = {
  isSecureConnection, cookieSecure, hashPassword, makeSid,
  timingSafeEqStr, parseCookies, getClientIP,
};

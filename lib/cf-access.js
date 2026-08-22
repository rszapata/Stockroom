// ── Cloudflare Access — verificación del JWT del borde ────────────
//
// Cuando una aplicación está detrás de Cloudflare Access, Cloudflare autentica
// al visitante (Google, en nuestro caso) ANTES de reenviar la request al túnel,
// y le inyecta un JWT firmado en el header `Cf-Access-Jwt-Assertion`.
//
// Verificar ese JWT acá es lo que hace segura la exposición del panel:
//
//   · El hostname NO alcanza como credencial. Cualquiera en la LAN puede mandar
//     `Host: stockroom.znrapp.com` a 192.168.0.103:3000 y saltarse Cloudflare.
//     La firma, en cambio, no se puede falsificar sin la clave privada de CF.
//   · Tampoco alcanza `CF-Connecting-IP`: es un header como cualquier otro y el
//     server bindea 0.0.0.0. Por eso la confianza se apoya en la firma, no en
//     headers informativos.
//
// Sin dependencias nuevas: Node 18 importa JWK directo con crypto.createPublicKey.
// (jose y jsonwebtoken están en node_modules pero sólo como dependencias
// transitivas de firebase-admin — un npm install podría dejarnos sin ellas.)
//
// Config en auth.json (que está gitignoreado y excluido del deploy):
//
//   "cf_access": {
//     "team_domain": "TU-EQUIPO.cloudflareaccess.com",
//     "aud": "<Application Audience Tag de la app en Access>",
//     "allowed_emails": ["znrodrigo23@gmail.com"]
//   }
//
const crypto = require('crypto');
const https  = require('https');

let _cfg      = null;
let _certs    = { keys: null, exp: 0 };
let _avisado  = false;

function configurar(cfg) {
  const c = cfg && cfg.cf_access;
  if (!c || !c.team_domain || !c.aud) { _cfg = null; return; }
  _cfg = {
    team:   String(c.team_domain).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    aud:    String(c.aud),
    emails: new Set((c.allowed_emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean)),
  };
  if (!_cfg.emails.size) {
    console.warn('[cf-access] allowed_emails está vacío: nadie va a poder entrar por Access');
  }
}

function estaConfigurado() { return !!_cfg; }
function emailsPermitidos() { return _cfg ? [..._cfg.emails] : []; }

// Las claves rotan, así que se cachean una hora y se recargan solas.
function traerCerts() {
  return new Promise((resolve, reject) => {
    const url = `https://${_cfg.team}/cdn-cgi/access/certs`;
    https.get(url, { timeout: 8000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`certs HTTP ${res.statusCode}`));
        try {
          const j = JSON.parse(body);
          if (!Array.isArray(j.keys) || !j.keys.length) return reject(new Error('certs sin keys'));
          resolve(j.keys);
        } catch (e) { reject(new Error('certs ilegibles: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('certs timeout')); });
  });
}

async function claves() {
  const ahora = Date.now();
  if (_certs.keys && ahora < _certs.exp) return _certs.keys;
  const keys = await traerCerts();
  _certs = { keys, exp: ahora + 3600e3 };
  return keys;
}

// El handler del server es síncrono, así que las claves se mantienen frescas en
// memoria con un timer y la verificación no necesita esperar red. Si todavía no
// se cargaron, verificarSync() falla cerrado (no autentica) y dispara la carga.
let _cargando = false;
function refrescar() {
  if (!_cfg || _cargando) return;
  _cargando = true;
  traerCerts()
    .then(keys => { _certs = { keys, exp: Date.now() + 3600e3 };
                    console.log(`  ✓ [cf-access] ${keys.length} clave(s) de ${_cfg.team}`); })
    .catch(e => console.error('[cf-access] No se pudieron traer las claves:', e.message))
    .finally(() => { _cargando = false; });
}

function precargar() {
  if (!_cfg) return;
  refrescar();
  const t = setInterval(refrescar, 3600e3);
  if (t.unref) t.unref();
}

const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verifica el JWT de Access.
 * Devuelve { email, sub } si la firma, el emisor, la audiencia, la vigencia y
 * la lista blanca dan bien. Devuelve null en cualquier otro caso.
 * Nunca lanza: si algo falla, no autentica y listo.
 */
function _verificar(token, keys) {
  if (!_cfg || !token || !keys) return null;
  try {
    const partes = String(token).split('.');
    if (partes.length !== 3) return null;
    const [h64, p64, s64] = partes;

    const header = JSON.parse(b64u(h64).toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;

    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${h64}.${p64}`),
      { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING },
      b64u(s64)
    );
    if (!ok) return null;

    const cl = JSON.parse(b64u(p64).toString('utf8'));
    const ahora = Math.floor(Date.now() / 1000);
    if (!cl.exp || cl.exp <= ahora) return null;
    if (cl.nbf && cl.nbf > ahora + 60) return null;
    if (cl.iss !== `https://${_cfg.team}`) return null;

    const aud = Array.isArray(cl.aud) ? cl.aud : [cl.aud];
    if (!aud.includes(_cfg.aud)) return null;

    const email = String(cl.email || '').trim().toLowerCase();
    if (!email || !_cfg.emails.has(email)) {
      // Access lo dejó pasar pero no está en nuestra lista: se registra, porque
      // significa que la política de Cloudflare quedó más laxa que la de acá.
      console.warn('[cf-access] Rechazado por lista blanca local:', email || '(sin email)');
      return null;
    }
    return { email, sub: cl.sub || null };
  } catch (e) {
    if (!_avisado) { _avisado = true; console.error('[cf-access] Error verificando:', e.message); }
    return null;
  }
}

/** Versión síncrona, la que usa el handler. Falla cerrado si no hay claves. */
function verificarSync(token) {
  if (!_cfg || !token) return null;
  if (!_certs.keys || Date.now() >= _certs.exp) { refrescar(); if (!_certs.keys) return null; }
  return _verificar(token, _certs.keys);
}

/** Versión async: espera a tener las claves. Se usa en pruebas. */
async function verificar(token) {
  if (!_cfg || !token) return null;
  let keys;
  try { keys = await claves(); } catch (e) { return null; }
  return _verificar(token, keys);
}

module.exports = {
  configurar, estaConfigurado, emailsPermitidos,
  precargar, verificar, verificarSync,
};

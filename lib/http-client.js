// ── Helpers HTTP de bajo nivel para llamadas a APIs externas ──
const https = require('https');

// Sin esto, una conexión TCP colgada (DNS hiccup, server lento, etc.) deja la
// Promise pending para siempre → handler bloqueado → el cap de sockets del
// agent HTTPS de Node se agota → toda nueva request a ese host queda en cola
// → el server "deja de responder" hasta reinicio.
//
// Aplicar SIEMPRE a cualquier https.request() destinado a una API externa.
const HTTP_TIMEOUT_MS = 25000; // 25s — ML/MP a veces son lentos pero no tanto
function applyHttpTimeout(req, label = 'http') {
  req.setTimeout(HTTP_TIMEOUT_MS, () => {
    req.destroy(new Error(`${label} timeout (${HTTP_TIMEOUT_MS}ms)`));
  });
  return req;
}

// ── HTTP helper genérico (para APIs externas como Correo Argentino) ───────────
function httpsRequestJson(url, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type'  : 'application/json',
      'User-Agent'    : 'Stockroom/1.0',
      ...extraHeaders,
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    };
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method, headers },
      res2 => {
        let b = '';
        res2.on('data', c => b += c);
        res2.on('end', () => {
          try {
            const d = JSON.parse(b);
            if (res2.statusCode >= 400) {
              const err = new Error(d.message || d.error || b);
              err.status  = res2.statusCode;
              err.body    = d;
              reject(err);
            } else resolve(d);
          } catch(e) {
            const err  = new Error('JSON parse error');
            err.status = res2.statusCode;
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { HTTP_TIMEOUT_MS, applyHttpTimeout, httpsRequestJson };

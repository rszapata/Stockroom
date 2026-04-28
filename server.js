// ══════════════════════════════════════════════════════════════
//  STOCKROOM — Servidor proxy + Analytics
//  
//  Uso: node server.js
//  Luego abrí: http://localhost:3000
// ══════════════════════════════════════════════════════════════

const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const url      = require('url');
const os       = require('os');
const { spawn } = require('child_process');

const PORT    = parseInt(process.env.PORT) || 3000;
// Bind to 127.0.0.1 by default — only the local machine (and cloudflared) can reach it.
// To expose on LAN for dev: set BIND=0.0.0.0
const BIND    = process.env.BIND || '0.0.0.0';
const ML_BASE = 'api.mercadolibre.com';

// ── Config ────────────────────────────────────────────────────
let fullConfig = {};   // todo config.json
let config     = {};   // cuenta activa (puntero al objeto dentro de accounts[])
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch(e) { fullConfig = {}; }
  }
  if (fullConfig.accounts && fullConfig.accounts.length) {
    const activeId = fullConfig.active || fullConfig.accounts[0].id;
    config = fullConfig.accounts.find(a => a.id === activeId) || fullConfig.accounts[0];
  } else {
    // formato plano legado
    config = fullConfig;
  }
}

function saveConfig() {
  if (fullConfig.accounts) {
    // Actualizar la cuenta activa dentro del array
    const idx = fullConfig.accounts.findIndex(a => a.id === config.id);
    if (idx !== -1) fullConfig.accounts[idx] = config;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
}

loadConfig();

// ── App token (client_credentials) para endpoints públicos ───
let _appToken = null;
let _appTokenExpiry = 0;

async function getAppToken() {
  if (_appToken && Date.now() < _appTokenExpiry) return _appToken;
  const { client_id, client_secret } = config;
  if (!client_id || !client_secret) return null;
  return new Promise(resolve => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id,
      client_secret,
    }).toString();
    const req = https.request({
      hostname: 'api.mercadolibre.com', path: '/oauth/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.access_token) {
            _appToken = j.access_token;
            _appTokenExpiry = Date.now() + ((j.expires_in || 21600) - 300) * 1000;
            console.log('  ✓ App token obtenido');
            resolve(_appToken);
          } else {
            console.log('  ✗ App token error:', data);
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// Invalidar app token al cambiar de cuenta
function resetAppToken() { _appToken = null; _appTokenExpiry = 0; }

// ── Auto-renovación de token ──────────────────────────────────
async function refreshAccessToken() {
  const { client_id, client_secret, refresh_token } = config;
  if (!client_id || !client_secret || !refresh_token) return false;
  return new Promise(resolve => {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      client_id,
      client_secret,
      refresh_token,
    }).toString();
    const req = https.request({
      hostname: 'api.mercadolibre.com',
      path:     '/oauth/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            config.access_token  = json.access_token;
            config.refresh_token = json.refresh_token || config.refresh_token;
            saveConfig();
            console.log('  ✓ Token renovado automáticamente');
            resolve(true);
          } else {
            console.log('  ✗ No se pudo renovar token:', data);
            resolve(false);
          }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ── MIME types ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function cors(res) {
  // Same-origin only — no cross-origin access from other sites
  res.setHeader('Access-Control-Allow-Origin', 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Apply security headers on every response
function securityHeaders(res, isHtml) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // ANTICACHE  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (isHtml) {
    // CSP: only allow resources from same origin + MercadoLibre images + Google Fonts
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https://*.mlstatic.com http://*.mlstatic.com https://mlstatic.com; " +
      "connect-src 'self' https://api.mercadolibre.com; " +
      "frame-src https://www.google.com https://maps.google.com https://*.google.com; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self' https://auth.mercadolibre.com.ar https://auth.mercadolibre.com"
    );
  }
}

// ── Proxy path whitelist ──────────────────────────────────────
// Only these ML API paths are allowed through the proxy endpoints.
// This prevents SSRF and abuse of your OAuth tokens.
const ALLOWED_PROXY_PATTERNS = [
  /^\/users\/[^/?]+\/?$/,                            // GET user info
  /^\/users\/[^/]+\/items\/search(\?|$)/,            // GET list items
  /^\/items(\/[^/]+)?(\/[^/]+)?(\?|$)/,              // GET/POST/PUT items & subresources
  /^\/items\/[^/]+\/description(\?|$)/,              // description
  /^\/items\/[^/]+\/pictures(\?|$)/,                 // pictures
  /^\/pictures\/items\/upload(\?|$)/,                // upload pics
  /^\/categories(\/[^/]+)?(\/attributes)?(\?|$)/,    // categories + attributes
  /^\/category_predictor\/predict(\?|$)/,            // category prediction
  /^\/sites\/[^/]+(\/.*)?(\?|$)/,                    // site metadata
  /^\/orders\/search(\?|$)/,                         // orders
  /^\/orders\/[^/]+(\?|$)/,                          // single order
  /^\/shipments\/[^/]+(\?|$)/,                       // shipment info
  /^\/questions\/search(\?|$)/,                      // questions
  /^\/questions\/[^/]+(\?|$)/,                       // single question / answer
  /^\/answers(\?|$)/,                                // post answer to question
  /^\/myfeeds(\?|$)/,                                // feeds
  /^\/user-products\/[^/]+(\?|$)/,                   // GET user product (modelo nuevo de variantes)
];

function isProxyPathAllowed(mlPath) {
  return ALLOWED_PROXY_PATTERNS.some(rx => rx.test(mlPath));
}

// ── ML API helpers (server-side) ─────────────────────────────
function mlGet(mlPath, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode;
            err.body = d;
            reject(err);
          } else resolve(d);
        } catch(e) {
          const err = new Error('JSON parse error');
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
function mlPut(mlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: ML_BASE, path: mlPath, method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode;
            err.body = d;
            reject(err);
          } else resolve(d);
        } catch(e) {
          const err = new Error('JSON parse error');
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Refresh de token por cuenta ──────────────────────────────
// Evita refrescos concurrentes para la misma cuenta
const _refreshInFlight = new Map();
async function refreshAccountToken(acct) {
  if (!acct) return false;
  if (_refreshInFlight.has(acct.id)) return _refreshInFlight.get(acct.id);
  const client_id = acct.client_id || config.client_id;
  const client_secret = acct.client_secret || config.client_secret;
  const refresh_token = acct.refresh_token;
  if (!client_id || !client_secret || !refresh_token) return false;
  const p = new Promise(resolve => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id, client_secret, refresh_token,
    }).toString();
    const req = https.request({
      hostname: 'api.mercadolibre.com',
      path: '/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const tok = JSON.parse(data);
          if (tok.access_token) {
            acct.access_token = tok.access_token;
            if (tok.refresh_token) acct.refresh_token = tok.refresh_token;
            // Persistir en fullConfig.accounts (si el acct viene de ahi, ya lo mutamos por referencia)
            try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2)); } catch(e) {}
            console.log(`  ✓ Token renovado para cuenta "${acct.label || acct.id}"`);
            resolve(true);
          } else {
            console.log(`  ✗ No se pudo renovar token de "${acct.label || acct.id}":`, data);
            resolve(false);
          }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
  _refreshInFlight.set(acct.id, p);
  try { return await p; }
  finally { _refreshInFlight.delete(acct.id); }
}

// Wrappers que auto-refrescan y reintentan una vez ante 401
async function mlGetAuth(acct, mlPath) {
  try {
    return await mlGet(mlPath, acct.access_token);
  } catch(e) {
    if (e.status === 401 || e.status === 403) {
      const ok = await refreshAccountToken(acct);
      if (ok) return await mlGet(mlPath, acct.access_token);
    }
    throw e;
  }
}
async function mlPutAuth(acct, mlPath, body) {
  try {
    return await mlPut(mlPath, body, acct.access_token);
  } catch(e) {
    if (e.status === 401 || e.status === 403) {
      const ok = await refreshAccountToken(acct);
      if (ok) return await mlPut(mlPath, body, acct.access_token);
    }
    throw e;
  }
}

function mlPost(mlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: ML_BASE, path: mlPath, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode; err.body = d; reject(err);
          } else resolve(d);
        } catch(e) { const err = new Error('JSON parse error'); err.status = res.statusCode; reject(err); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
async function mlPostAuth(acct, mlPath, body) {
  try {
    return await mlPost(mlPath, body, acct.access_token);
  } catch(e) {
    if (e.status === 401 || e.status === 403) {
      const ok = await refreshAccountToken(acct);
      if (ok) return await mlPost(mlPath, body, acct.access_token);
    }
    throw e;
  }
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Multipart parser ──────────────────────────────────────────
function parseMultipart(body, boundary) {
  const parts = {};
  const sep   = Buffer.from('--' + boundary);
  let start   = 0;

  while (true) {
    const idx  = body.indexOf(sep, start);
    if (idx === -1) break;
    const next = body.indexOf(sep, idx + sep.length);
    if (next === -1) break;

    const part      = body.slice(idx + sep.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = next; continue; }

    const headerStr = part.slice(0, headerEnd).toString();
    const content   = part.slice(headerEnd + 4, part.length - 2);
    const nameM     = headerStr.match(/name="([^"]+)"/);
    const fileM     = headerStr.match(/filename="([^"]+)"/);
    if (!nameM) { start = next; continue; }

    parts[nameM[1]] = fileM
      ? { filename: fileM[1], data: content }
      : content.toString().trim();
    start = next;
  }
  return parts;
}

// ── Intercambiar código OAuth por tokens ──────────────────────
function exchangeCode(code, res, asJson = false) {
  const { client_id, client_secret } = config;
  const rUri = config.redirect_uri || 'http://localhost:3000/oauth/callback';
  if (!client_id || !client_secret) {
    if (asJson) return json(res, 400, { error: 'client_id / client_secret no configurados' });
    res.writeHead(400); res.end('client_id / client_secret no configurados'); return;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id, client_secret, code,
    redirect_uri: rUri,
  }).toString();

  const tokenReq = https.request({
    hostname: 'api.mercadolibre.com', path: '/oauth/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, tokenRes => {
    let data = '';
    tokenRes.on('data', c => data += c);
    tokenRes.on('end', () => {
      try {
        const tk = JSON.parse(data);
        if (!tk.access_token) {
          if (asJson) return json(res, 400, { error: tk.message || 'No se obtuvo token', detail: tk });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
            <style>body{background:#0c0c0e;color:#ff4747;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}</style>
            </head><body><div style="font-size:20px">✗ Error al obtener token</div>
            <pre style="color:#8888a0;font-size:11px;max-width:500px;overflow:auto">${JSON.stringify(tk, null, 2)}</pre>
            <a href="/" style="color:#e8ff47;font-size:12px">← Volver</a></body></html>`);
          return;
        }

        config.access_token  = tk.access_token;
        config.refresh_token = tk.refresh_token;
        config.user_id       = String(tk.user_id);
        resetAppToken();
        saveConfig();
        console.log(`  ✓ OAuth completado — user_id: ${tk.user_id}`);

        if (asJson) return json(res, 200, { ok: true, user_id: tk.user_id });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
          <style>
            *{box-sizing:border-box;margin:0;padding:0}
            body{background:#0c0c0e;color:#e8e8f0;font-family:'Space Mono',monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}
            .ok{color:#47ff8a;font-size:22px}
            .uid{background:#1c1c20;border:1px solid #2a2a30;padding:10px 20px;font-size:12px;color:#8888a0}
            .uid span{color:#e8ff47}
            a{color:#e8ff47;font-size:11px;letter-spacing:.1em;text-decoration:none;border:1px solid rgba(232,255,71,.3);padding:8px 18px;margin-top:8px}
            a:hover{background:rgba(232,255,71,.08)}
          </style>
          </head><body>
            <div class="ok">✓ Cuenta conectada exitosamente</div>
            <div class="uid">User ID: <span>${tk.user_id}</span></div>
            <a href="/">← IR AL DASHBOARD</a>
          </body></html>`);
      } catch(e) {
        if (asJson) return json(res, 500, { error: 'Error al parsear respuesta: ' + e.message });
        res.writeHead(500); res.end('Error al parsear respuesta: ' + e.message);
      }
    });
  });
  tokenReq.on('error', e => {
    if (asJson) return json(res, 502, { error: e.message });
    res.writeHead(502); res.end(e.message);
  });
  tokenReq.write(body);
  tokenReq.end();
}

// ── Auth (password + sesión) ──────────────────────────────────
const crypto = require('crypto');
const AUTH_PATH = path.join(__dirname, 'auth.json');
let AUTH_CFG = null;
try {
  if (fs.existsSync(AUTH_PATH)) AUTH_CFG = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
} catch(e) { console.error('  ✗ auth.json inválido:', e.message); }

const AUTH_ENABLED = !!(AUTH_CFG && AUTH_CFG.password && AUTH_CFG.password !== 'PONE_UNA_CONTRASEÑA_LARGA_ACA');
if (!AUTH_ENABLED) {
  console.log('  ⚠ AUTH DESHABILITADA — auth.json ausente o sin contraseña. NO exponer este servidor.');
}

const SESSIONS = new Map(); // sid -> { exp }
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

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
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  // Bypass: si la request viene de una IP confiable (red local del usuario)
  if (isTrustedIP(req)) return true;
  const sid = parseCookies(req).sr_sid;
  if (!sid) return false;
  const s = SESSIONS.get(sid);
  if (!s) return false;
  if (Date.now() > s.exp) { SESSIONS.delete(sid); return false; }
  return true;
}

// IPs confiables — leídas de auth.json (trusted_ips: [...])
// Si la request viene de una de estas, no se pide password.
const TRUSTED_IPS = new Set(
  Array.isArray(AUTH_CFG && AUTH_CFG.trusted_ips) ? AUTH_CFG.trusted_ips : []
);
function getClientIP(req) {
  // cloudflared inyecta CF-Connecting-IP con la IP real del visitante.
  // Como el server bindea 127.0.0.1, solo cloudflared (o el mismo equipo) puede llegar acá,
  // así que confiar en este header es seguro.
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  // Acceso directo (localhost desde el mismo equipo)
  const ra = req.socket && req.socket.remoteAddress;
  return ra ? ra.replace(/^::ffff:/, '') : '';
}
function isTrustedIP(req) {
  const ip = getClientIP(req);
  if (!ip) return false;
  // Acceso desde el mismo equipo siempre es de confianza
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return TRUSTED_IPS.has(ip);
}
// Paths que no requieren auth
const AUTH_EXEMPT = new Set([
  '/login', '/login.html', '/logout',
  '/sw.js', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/icon.svg',
  '/oauth/callback',
]);
function isAuthExempt(pathname) {
  return AUTH_EXEMPT.has(pathname);
}

// Limpieza periódica de sesiones expiradas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of SESSIONS) if (now > v.exp) SESSIONS.delete(k);
}, 60 * 60 * 1000);

// ── Servidor ──────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Security headers on every response
  const isHtml = pathname === '/' || pathname.endsWith('.html');
  securityHeaders(res, isHtml);

  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Block path traversal in static file paths
  if (pathname.includes('..') || pathname.includes('\0')) {
    json(res, 400, { error: 'invalid_path' });
    return;
  }

  // ── Login / Logout ──────────────────────────────────────────
  if (pathname === '/login' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch(e) {}
      if (!AUTH_ENABLED) return json(res, 500, { error: 'auth_not_configured' });
      if (!timingSafeEqStr(body.password || '', AUTH_CFG.password)) {
        // pequeño delay anti-bruteforce
        return setTimeout(() => json(res, 401, { error: 'invalid_password' }), 800);
      }
      const sid = makeSid();
      SESSIONS.set(sid, { exp: Date.now() + SESSION_TTL });
      res.setHeader('Set-Cookie', `sr_sid=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_TTL/1000}; SameSite=Lax`);
      json(res, 200, { ok: true });
    });
    return;
  }
  if (pathname === '/logout') {
    const sid = parseCookies(req).sr_sid;
    if (sid) SESSIONS.delete(sid);
    res.setHeader('Set-Cookie', `sr_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    res.writeHead(302, { Location: '/login.html' });
    res.end();
    return;
  }

  // ── Auth gate ───────────────────────────────────────────────
  if (AUTH_ENABLED && !isAuthExempt(pathname) && !isAuthed(req)) {
    if (pathname.startsWith('/api') || pathname.startsWith('/api-as') || pathname.startsWith('/api-public')) {
      return json(res, 401, { error: 'auth_required' });
    }
    res.writeHead(302, { Location: '/login.html' });
    res.end();
    return;
  }

  // ── /api-public/* → proxy ML con app token (client_credentials) ──
  if (pathname.startsWith('/api-public/')) {
    const mlPath = pathname.replace('/api-public/', '/') + (parsed.search || '');
    if (!isProxyPathAllowed(mlPath)) { json(res, 403, { error: 'path_not_allowed', path: mlPath }); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      // Intentar app token (client_credentials); si falla, usar access_token del usuario
      const tok = (await getAppToken()) || config.access_token || '';
      const opts = {
        hostname: ML_BASE, path: mlPath, method: req.method,
        headers: {
          'User-Agent': 'Stockroom/1.0',
          'Content-Type': 'application/json',
          ...(tok ? { 'Authorization': `Bearer ${tok}` } : {})
        }
      };
      const bodyBuf = Buffer.concat(chunks);
      if (bodyBuf.length > 0) opts.headers['Content-Length'] = bodyBuf.length;
      const pReq = https.request(opts, pRes => {
        let b = '';
        pRes.on('data', c => b += c);
        pRes.on('end', () => {
          res.writeHead(pRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(b);
        });
      });
      pReq.on('error', e => json(res, 502, { error: 'proxy_error', message: e.message }));
      if (bodyBuf.length > 0) pReq.write(bodyBuf);
      pReq.end();
    });
    return;
  }

  // ── /api-as/{accountId}/* → proxy ML con token de cuenta específica ──
  const asMatch = pathname.match(/^\/api-as\/([^/]+)\/(.*)/);
  if (asMatch) {
    const acctId = asMatch[1];
    const mlPath = '/' + asMatch[2] + (parsed.search || '');
    if (!isProxyPathAllowed(mlPath)) { json(res, 403, { error: 'path_not_allowed', path: mlPath }); return; }
    const acct   = (fullConfig.accounts || []).find(a => a.id === acctId);
    if (!acct) { json(res, 404, { error: 'Cuenta no encontrada: ' + acctId }); return; }
    const opts  = {
      hostname: ML_BASE, path: mlPath, method: req.method,
      headers: { 'Content-Type': req.headers['content-type'] || 'application/json', 'User-Agent': 'Stockroom/1.0' }
    };
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const doProxy = (token, retrying) => {
        opts.headers['Authorization'] = `Bearer ${token}`;
        if (bodyBuf.length > 0) opts.headers['Content-Length'] = bodyBuf.length;
        const pReq = https.request(opts, pRes => {
          let b = '';
          pRes.on('data', c => b += c);
          pRes.on('end', async () => {
            // Auto-refresh si 401/403 y no estamos reintentando
            if ((pRes.statusCode === 401 || pRes.statusCode === 403) && !retrying) {
              const ok = await refreshAccountToken(acct);
              if (ok) { doProxy(acct.access_token || '', true); return; }
            }
            res.writeHead(pRes.statusCode, { 'Content-Type': pRes.headers['content-type'] || 'application/json' });
            res.end(b);
          });
        });
        pReq.on('error', e => json(res, 502, { error: 'proxy_error', message: e.message }));
        if (bodyBuf.length > 0) pReq.write(bodyBuf);
        pReq.end();
      };
      doProxy(acct.access_token || '', false);
    });
    return;
  }

  // ── /api/* → proxy ML ──────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const mlPath = pathname.replace('/api/', '/') + (parsed.search || '');
    if (!isProxyPathAllowed(mlPath)) { json(res, 403, { error: 'path_not_allowed', path: mlPath }); return; }
    const token  = config.access_token || '';
    const opts   = {
      hostname: ML_BASE, path: mlPath, method: req.method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': req.headers['content-type'] || 'application/json', 'User-Agent': 'Stockroom/1.0' }
    };
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const doProxy = (token, retrying) => {
        opts.headers['Authorization'] = `Bearer ${token}`;
        if (bodyBuf.length > 0) opts.headers['Content-Length'] = bodyBuf.length;
        const pReq = https.request(opts, pRes => {
          let b = '';
          pRes.on('data', c => b += c);
          pRes.on('end', async () => {
            if (pRes.statusCode === 401 && !retrying) {
              console.log('  Token expirado, renovando...');
              const ok = await refreshAccessToken();
              if (ok) { doProxy(config.access_token, true); return; }
            }
            res.writeHead(pRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(b);
          });
        });
        pReq.on('error', e => json(res, 502, { error: 'proxy_error', message: e.message }));
        if (bodyBuf.length > 0) pReq.write(bodyBuf);
        pReq.end();
      };
      doProxy(config.access_token || '', false);
    });
    return;
  }

  // ── Resolver redirect URI de la cuenta activa ──────────────
  function getRedirectUri() {
    return config.redirect_uri || 'http://localhost:3000/oauth/callback';
  }

  // ── /oauth/start → redirige a ML para autorizar ──────────────
  if (pathname === '/oauth/start' && req.method === 'GET') {
    const clientId    = config.client_id || '';
    const rUri        = getRedirectUri();
    const isExternal  = !rUri.includes('localhost');
    if (!clientId) { res.writeHead(400); res.end('client_id no configurado'); return; }
    const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(rUri)}`;

    if (isExternal) {
      // Redirect URI es externa (webhook.site, etc.) — mostrar página con instrucciones
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{background:#0c0c0e;color:#e8e8f0;font-family:'Space Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:18px;padding:30px}
          .title{color:#e8ff47;font-size:18px;letter-spacing:.15em}
          .steps{background:#141416;border:1px solid #2a2a30;padding:20px 24px;max-width:560px;font-size:12px;line-height:2;color:#8888a0}
          .steps b{color:#e8e8f0}
          .steps code{background:#1c1c20;padding:2px 6px;color:#47ffe8;font-size:11px}
          a.go{display:inline-block;color:#0c0c0e;background:#e8ff47;font-size:11px;letter-spacing:.12em;text-decoration:none;padding:10px 24px;font-weight:700;margin-top:4px}
          a.go:hover{background:#d4eb3a}
          .form-wrap{background:#141416;border:1px solid #2a2a30;padding:20px 24px;max-width:560px;width:100%}
          .form-wrap label{display:block;color:#55556a;font-size:10px;letter-spacing:.12em;margin-bottom:6px}
          .form-wrap input{width:100%;background:#1c1c20;border:1px solid #2a2a30;color:#e8e8f0;font-family:'Space Mono',monospace;font-size:12px;padding:10px 12px;outline:none}
          .form-wrap input:focus{border-color:#e8ff47}
          .form-wrap button{width:100%;margin-top:10px;background:#47ff8a;color:#0c0c0e;border:none;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.12em;padding:10px;cursor:pointer;font-weight:700}
          .form-wrap button:hover{background:#3de07a}
          .acct{color:#e8ff47;font-size:11px;margin-bottom:4px}
        </style>
      </head><body>
        <div class="title">CONECTAR CUENTA</div>
        <div class="acct">Cuenta activa: ${config.label || config.id || '—'}</div>
        <div class="steps">
          <b>Paso 1:</b> Hacé click en el botón de abajo para autorizar en MercadoLibre<br>
          <b>Paso 2:</b> Autorizá la aplicación en ML<br>
          <b>Paso 3:</b> ML te redirige a webhook.site — copiá el parámetro <code>code</code> de la URL<br>
          <small style="color:#55556a">(Es el valor después de <code>?code=</code>, empieza con <code>TG-</code>)</small><br>
          <b>Paso 4:</b> Pegá el código acá abajo
        </div>
        <a class="go" href="${authUrl}" target="_blank">ABRIR AUTORIZACIÓN DE ML ↗</a>
        <div class="form-wrap">
          <label>CÓDIGO DE AUTORIZACIÓN</label>
          <input type="text" id="auth-code" placeholder="TG-xxxxxxxx-xxxxxxxx-xxxxxxxxx">
          <button onclick="sendCode()">CONECTAR</button>
          <div id="result" style="margin-top:10px;font-size:11px;min-height:20px"></div>
        </div>
        <a href="/" style="color:#55556a;font-size:10px;text-decoration:none;letter-spacing:.1em">← VOLVER</a>
        <script>
          async function sendCode() {
            const code = document.getElementById('auth-code').value.trim();
            const res  = document.getElementById('result');
            if (!code) { res.style.color='#ff9547'; res.textContent='Pegá el código primero'; return; }
            res.style.color='#8888a0'; res.textContent='Intercambiando código por token…';
            try {
              const r = await fetch('/oauth/exchange?code=' + encodeURIComponent(code));
              const data = await r.json();
              if (data.ok) {
                res.style.color='#47ff8a';
                res.textContent='Cuenta conectada — User ID: ' + data.user_id;
                setTimeout(() => window.location.href = '/', 1500);
              } else {
                res.style.color='#ff4747';
                res.textContent='Error: ' + (data.error || JSON.stringify(data));
              }
            } catch(e) { res.style.color='#ff4747'; res.textContent='Error: ' + e.message; }
          }
          // Enter key
          document.getElementById('auth-code').addEventListener('keydown', e => { if(e.key==='Enter') sendCode(); });
        </script>
      </body></html>`);
    } else {
      // Redirect URI es localhost — flujo clásico directo
      res.writeHead(302, { Location: authUrl });
      res.end();
    }
    return;
  }

  // ── /oauth/callback → intercambia code automáticamente (redirect localhost) ──
  if (pathname === '/oauth/callback' && req.method === 'GET') {
    const code = parsed.query.code;
    const err  = parsed.query.error;
    if (err || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>body{background:#0c0c0e;color:#ff4747;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}</style>
        </head><body><div style="font-size:20px">✗ Autorización rechazada</div>
        <div style="color:#8888a0;font-size:13px">${err || 'No se recibió el código'}</div>
        <a href="/" style="color:#e8ff47;font-size:12px;margin-top:10px">← Volver</a></body></html>`);
      return;
    }
    // Intercambiar directamente
    exchangeCode(code, res);
    return;
  }

  // ── /oauth/exchange → intercambia code manualmente (redirect externo) ──
  if (pathname === '/oauth/exchange' && req.method === 'GET') {
    const code = parsed.query.code;
    if (!code) { json(res, 400, { error: 'Falta el parámetro code' }); return; }
    exchangeCode(code, res, true);
    return;
  }

  // ── /accounts GET → lista de cuentas ──────────────────────
  if (pathname === '/accounts' && req.method === 'GET') {
    const accounts = (fullConfig.accounts || [config]).map(a => ({
      id:         a.id     || 'default',
      label:      a.label  || a.seller_name || a.user_id || 'Cuenta',
      user_id:    a.user_id || '',
      has_token:  !!a.access_token,
      active:     a.id === (fullConfig.active || 'default') || (!fullConfig.accounts),
    }));
    json(res, 200, { accounts, active: fullConfig.active || 'default' });
    return;
  }

  // ── /accounts/rename POST → renombrar cuenta ──────────────
  if (pathname === '/accounts/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id, label } = JSON.parse(body);
        if (!fullConfig.accounts) { json(res, 400, { error: 'No hay cuentas configuradas' }); return; }
        const acct = fullConfig.accounts.find(a => a.id === id);
        if (!acct) { json(res, 404, { error: 'Cuenta no encontrada' }); return; }
        acct.label = label.trim();
        saveConfig();
        if (config.id === id) config.label = acct.label;
        json(res, 200, { ok: true });
      } catch(e) { json(res, 400, { error: 'invalid_json' }); }
    });
    return;
  }

  // ── /accounts/switch POST → cambiar cuenta activa ──────────
  if (pathname === '/accounts/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body);
        if (!fullConfig.accounts) { json(res, 400, { error: 'No hay cuentas configuradas' }); return; }
        const found = fullConfig.accounts.find(a => a.id === id);
        if (!found) { json(res, 404, { error: 'Cuenta no encontrada' }); return; }
        fullConfig.active = id;
        config = found;
        resetAppToken();
        saveConfig();
        console.log(`  ✓ Cuenta activa: ${found.label || id} (user_id: ${found.user_id || '—'})`);
        json(res, 200, { ok: true, id, label: found.label || id, has_token: !!found.access_token });
      } catch(e) { json(res, 400, { error: 'invalid_json' }); }
    });
    return;
  }

  // ── /config GET ────────────────────────────────────────────
  if (pathname === '/config' && req.method === 'GET') {
    json(res, 200, { user_id: config.user_id || '', vel_threshold: config.vel_threshold || 5, has_token: !!config.access_token });
    return;
  }

  // ── /config POST ───────────────────────────────────────────
  if (pathname === '/config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        Object.assign(config, data);
        saveConfig();
        json(res, 200, { ok: true });
      } catch(e) { json(res, 400, { error: 'invalid_json' }); }
    });
    return;
  }

  // ── /config/export GET → descarga el config.json completo ──
  if (pathname === '/config/export' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="stockroom-config.json"',
    });
    res.end(JSON.stringify(fullConfig, null, 2));
    return;
  }

  // ── /config/import POST → reemplaza el config.json entero ─
  // Body: JSON con la misma estructura que config.json (formato accounts[] o plano legado)
  if (pathname === '/config/import' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length > 256 * 1024) { json(res, 413, { error: 'archivo demasiado grande' }); return; }
        const data = JSON.parse(raw);
        // Validación mínima: debe tener accounts[] con al menos uno, o ser una cuenta plana con client_id
        let normalized;
        if (data && Array.isArray(data.accounts) && data.accounts.length) {
          for (const a of data.accounts) {
            if (!a.id) { json(res, 400, { error: 'cada cuenta necesita un "id"' }); return; }
          }
          normalized = { accounts: data.accounts, active: data.active || data.accounts[0].id };
        } else if (data && (data.client_id || data.access_token || data.user_id)) {
          // Cuenta plana → la envolvemos
          const id = data.id || 'imported';
          normalized = {
            accounts: [{ id, label: data.label || data.seller_name || id, ...data }],
            active: id,
          };
        } else {
          json(res, 400, { error: 'formato de config.json inválido' });
          return;
        }
        // Backup del archivo anterior antes de sobrescribir
        if (fs.existsSync(CONFIG_PATH)) {
          try {
            const backupPath = CONFIG_PATH + '.bak';
            fs.copyFileSync(CONFIG_PATH, backupPath);
          } catch(e) { /* no-op */ }
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
        loadConfig();
        resetAppToken();
        console.log(`  ✓ config.json importado — ${normalized.accounts.length} cuenta(s), activa: ${normalized.active}`);
        json(res, 200, { ok: true, accounts: normalized.accounts.length, active: normalized.active });
      } catch(e) {
        json(res, 400, { error: 'JSON inválido: ' + e.message });
      }
    });
    return;
  }

  // ── /cobro POST ────────────────────────────────────────────
  // Recibe multipart: campo "file" (xlsx) + "periodo" (1/2/3) + "modo" (fundas|otros)
  if (pathname === '/cobro' && req.method === 'POST') {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) { json(res, 400, { error: 'No boundary' }); return; }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body  = Buffer.concat(chunks);
      const parts = parseMultipart(body, bm[1]);

      const fileData = parts['file'];
      const periodo  = String(parts['periodo'] || '').trim();
      const modo     = String(parts['modo']    || 'fundas').trim();

      if (!fileData?.data) { json(res, 400, { error: 'Archivo no recibido' }); return; }

      // Guardar xlsx de entrada temporalmente
      const tmpIn  = path.join(os.tmpdir(), `ml_in_${Date.now()}.xlsx`);
      const tmpOut = path.join(os.tmpdir(), `cobro_${Date.now()}.xlsx`);
      fs.writeFileSync(tmpIn, fileData.data);

      const scriptPath = path.join(__dirname, 'genera_cobro.py');
      if (!fs.existsSync(scriptPath)) {
        try { fs.unlinkSync(tmpIn); } catch(e) {}
        json(res, 500, { error: 'No se encontró genera_cobro.py en la carpeta del servidor' });
        return;
      }

      const args = [scriptPath, tmpIn, '--output', tmpOut, '--modo', modo];
      if (['1','2','3'].includes(periodo)) args.push('--periodo', periodo);

      // Windows usa 'py -3.12' (Python Launcher), Linux/Mac usa 'python3'
      const PYTHON = process.platform === 'win32' ? 'py' : 'python3';
      const PYTHON_ARGS = process.platform === 'win32' ? ['-3.12'] : [];
      const py = spawn(PYTHON, [...PYTHON_ARGS, ...args]);
      let stdout = '', stderr = '';
      py.stdout.on('data', d => stdout += d);
      py.stderr.on('data', d => stderr += d);

      py.on('close', code => {
        try { fs.unlinkSync(tmpIn); } catch(e) {}

        if (code !== 0) {
          json(res, 500, { error: 'Error ejecutando el script', detail: stderr.slice(-800) });
          return;
        }
        if (!fs.existsSync(tmpOut)) {
          json(res, 500, { error: 'El script no generó el archivo', detail: stdout });
          return;
        }

        // Parsear resumen JSON del stdout
        let resumen = {};
        try {
          const clean = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const idx = clean.indexOf('RESUMEN_JSON:');
          if (idx !== -1) {
            const jsonStr = clean.slice(idx + 'RESUMEN_JSON:'.length).split('\n')[0].trim();
            resumen = JSON.parse(jsonStr);
          } else {
            console.log('RESUMEN_JSON not found in stdout');
          }
        } catch(e) { console.log('Resumen parse error:', e.message); }

        const xlsxB64 = fs.readFileSync(tmpOut).toString('base64');
        try { fs.unlinkSync(tmpOut); } catch(e) {}

        json(res, 200, { ok: true, file_b64: xlsxB64, resumen, stdout });
      });
    });
    return;
  }

  // ── /orden-compra POST → genera Excel de orden de compra ──────
  if (pathname === '/orden-compra' && req.method === 'POST') {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) { json(res, 400, { error: 'No boundary' }); return; }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body  = Buffer.concat(chunks);
      const parts = parseMultipart(body, bm[1]);

      const fileData = parts['file'];
      const tc       = parseFloat(parts['tc']    || '1421');
      const flete    = parseFloat(parts['flete'] || '800000');
      const units    = parseInt(parts['units']   || '415');
      const vendMin  = parseInt(parts['vendidos_min'] || '5');
      const stockMax = parseInt(parts['stock_max']    || '7');
      const allProds = String(parts['all_products'] || '') === '1' || String(parts['all_products'] || '') === 'true';

      if (!fileData?.data) { json(res, 400, { error: 'CSV no recibido' }); return; }

      const tmpIn  = path.join(os.tmpdir(), `inv_${Date.now()}.csv`);
      const tmpOut = path.join(os.tmpdir(), `orden_${Date.now()}.xlsx`);
      fs.writeFileSync(tmpIn, fileData.data);

      const scriptPath = path.join(__dirname, 'genera_orden_compra.py');
      if (!fs.existsSync(scriptPath)) {
        try { fs.unlinkSync(tmpIn); } catch(e) {}
        json(res, 500, { error: 'No se encontró genera_orden_compra.py' });
        return;
      }

      const PYTHON      = process.platform === 'win32' ? 'py' : 'python3';
      const PYTHON_ARGS = process.platform === 'win32' ? ['-3.12'] : [];
      const args = [scriptPath, tmpIn, '--output', tmpOut, '--tc', String(tc), '--flete', String(flete), '--units', String(units),
        '--vendidos-min', String(vendMin), '--stock-max', String(stockMax)];
      if (allProds) args.push('--all-products');
      const py   = spawn(PYTHON, [...PYTHON_ARGS, ...args]);
      let stdout = '', stderr = '';
      py.stdout.on('data', d => stdout += d);
      py.stderr.on('data', d => stderr += d);

      py.on('close', code => {
        try { fs.unlinkSync(tmpIn); } catch(e) {}
        if (code !== 0) {
          console.error('\n[orden-compra] ERROR Python:\n', stderr);
          json(res, 500, { error: 'Error ejecutando script', detail: stderr.slice(-800) }); return;
        }
        if (!fs.existsSync(tmpOut)) {
          console.error('\n[orden-compra] Script no generó archivo. stdout:\n', stdout);
          json(res, 500, { error: 'Script no generó archivo', detail: stdout }); return;
        }

        let resumen = {};
        try {
          const idx = stdout.indexOf('RESUMEN_JSON:');
          if (idx !== -1) resumen = JSON.parse(stdout.slice(idx + 13).split('\n')[0].trim());
        } catch(e) {}

        const xlsxB64 = fs.readFileSync(tmpOut).toString('base64');
        try { fs.unlinkSync(tmpOut); } catch(e) {}
        json(res, 200, { ok: true, file_b64: xlsxB64, resumen });
      });
    });
    return;
  }

  // ── /flex-debug GET → diagnóstico de envíos flex ──
  if (pathname === '/flex-debug' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }

    const mlPath = `/orders/search?seller=${userId}&shipping.status=ready_to_ship&order.status=paid&sort=date_desc&limit=50`;
    const opts = {
      hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${config.access_token}`, 'Content-Type': 'application/json' }
    };
    const pReq = https.request(opts, pRes => {
      let body = '';
      pRes.on('data', c => body += c);
      pRes.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const orders = data.results || [];
          const debug = [];

          for (const order of orders) {
            const shipId = order.shipping?.id;
            if (!shipId) { debug.push({ order_id: order.id, shipId: null }); continue; }

            await new Promise(resolve => {
              const sOpts = {
                hostname: ML_BASE, path: `/shipments/${shipId}`, method: 'GET',
                headers: { 'Authorization': `Bearer ${config.access_token}` }
              };
              const sReq = https.request(sOpts, sRes => {
                let sb = '';
                sRes.on('data', c => sb += c);
                sRes.on('end', () => {
                  try {
                    const ship = JSON.parse(sb);
                    debug.push({
                      order_id: order.id,
                      order_date: order.date_created,
                      ship_id: shipId,
                      ship_status: ship.status,
                      ship_substatus: ship.substatus,
                      ship_date_created: ship.date_created,
                      ship_last_updated: ship.last_updated,
                      logistic_mode: ship.logistic?.mode,
                      logistic_type: ship.logistic?.type,
                      handling_limit: ship.lead_time?.estimated_handling_limit?.date,
                      delivery_estimate: ship.lead_time?.estimated_delivery_time?.date,
                      status_history: ship.status_history,
                      tags: ship.tags,
                    });
                  } catch (e) { debug.push({ order_id: order.id, ship_id: shipId, error: e.message }); }
                  resolve();
                });
              });
              sReq.on('error', e => { debug.push({ order_id: order.id, ship_id: shipId, net_error: e.message }); resolve(); });
              sReq.end();
            });
          }

          json(res, 200, { total_orders: orders.length, total_paging: data.paging, shipments: debug });
        } catch (e) { json(res, 500, { error: e.message, raw: body.slice(0, 500) }); }
      });
    });
    pReq.on('error', e => json(res, 502, { error: e.message }));
    pReq.end();
    return;
  }

  // ── Helper: determinar si un shipment es Flex ─────────────────
  // "Prioritario a domicilio" = Flex;  "Retiro en sucursal" / "Estándar" = NO flex
  // Comparamos por shipping_option.name (más confiable que logistic que puede ser null)
  function isFlexShipment(ship) {
    const name   = (ship.shipping_option?.name || '').toLowerCase();
    const mode   = (ship.logistic?.mode || ship.mode || '').toLowerCase();
    const ltype  = (ship.logistic?.type || '').toLowerCase();
    // Flex: "prioritario a domicilio", mode me2 + NO es retiro en sucursal/correo
    const isRetiro  = name.includes('retiro') || name.includes('sucursal');
    const isCorreo  = name.includes('correo') || name.includes('normal a domicilio');
    if (isRetiro || isCorreo) return false;
    return name.includes('prioritario') || name.includes('flex') ||
           ltype.includes('flex') || ltype.includes('xd_drop_off') ||
           (mode === 'me2' && !isRetiro && !isCorreo);
  }

  // ── Helper: fetch un shipment de ML → Promise<object> ──────────
  function fetchShipment(shipId) {
    return new Promise((resolve, reject) => {
      const sOpts = {
        hostname: ML_BASE, path: `/shipments/${shipId}`, method: 'GET',
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      };
      const sReq = https.request(sOpts, sRes => {
        let sb = '';
        sRes.on('data', c => sb += c);
        sRes.on('end', () => { try { resolve(JSON.parse(sb)); } catch(e) { reject(e); } });
      });
      sReq.on('error', reject);
      sReq.end();
    });
  }

  // ── Helper: descargar etiquetas oficiales de ML como PDF buffer ─
  function fetchMLLabels(shipmentIds) {
    return new Promise((resolve, reject) => {
      const ids = shipmentIds.join(',');
      const labelsPath = `/shipment_labels?shipment_ids=${ids}&response_type=pdf`;
      console.log(`[flex] Descargando etiquetas ML: ${labelsPath}`);
      const opts = {
        hostname: ML_BASE, path: labelsPath, method: 'GET',
        headers: { 'Authorization': `Bearer ${config.access_token}` }
      };
      const req = https.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(new Error(`ML shipment_labels HTTP ${res.statusCode}: ${buf.toString().slice(0, 500)}`));
          } else {
            resolve(buf);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  // ── /flex-pdf GET → etiquetas oficiales ML de envíos Flex ready_to_ship ──
  if (pathname === '/flex-pdf' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }

    const mlPath = `/orders/search?seller=${userId}&shipping.status=ready_to_ship&order.status=paid&sort=date_desc&limit=50`;
    console.log(`[flex-pdf] Consultando ML: ${mlPath}`);

    const opts = {
      hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${config.access_token}`, 'Content-Type': 'application/json' }
    };

    const pReq = https.request(opts, pRes => {
      let body = '';
      pRes.on('data', c => body += c);
      pRes.on('end', async () => {
        try {
          const data   = JSON.parse(body);
          const orders = data.results || [];
          console.log(`[flex-pdf] Ordenes ready_to_ship: ${orders.length}`);

          if (!orders.length) {
            json(res, 200, { ok: true, count: 0, message: 'No hay ordenes ready_to_ship pendientes' });
            return;
          }

          // Filtrar solo envíos Flex
          const flexShipIds = [];
          for (const order of orders) {
            const shipId = order.shipping?.id;
            if (!shipId) continue;
            try {
              const ship = await fetchShipment(shipId);
              const name = ship.shipping_option?.name || '';
              const flex = isFlexShipment(ship);
              console.log(`[flex-pdf] Envio ${shipId} "${name}" → flex=${flex}`);
              if (flex) flexShipIds.push(shipId);
            } catch(e) { console.log(`[flex-pdf] Error fetch shipment ${shipId}: ${e.message}`); }
          }

          if (!flexShipIds.length) {
            json(res, 200, { ok: true, count: 0, message: 'No hay envios Flex listos para despachar (todos son correo/sucursal)' });
            return;
          }

          // Descargar etiquetas oficiales de ML
          console.log(`[flex-pdf] ${flexShipIds.length} envios Flex encontrados: ${flexShipIds.join(', ')}`);
          const pdfBuf = await fetchMLLabels(flexShipIds);
          const pdfB64 = pdfBuf.toString('base64');
          json(res, 200, { ok: true, count: flexShipIds.length, pdf_b64: pdfB64 });

        } catch(e) {
          json(res, 500, { error: 'Error procesando envios', detail: e.message });
        }
      });
    });
    pReq.on('error', e => json(res, 502, { error: e.message }));
    pReq.end();
    return;
  }

  // ── /flex-pdf-todos GET → etiquetas oficiales ML de TODOS los Flex de hoy ──
  if (pathname === '/flex-pdf-todos' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }

    // Buscar ordenes de los ultimos 15 dias (flex de hoy puede ser una orden vieja)
    const now = new Date();
    const localNow  = new Date(now.getTime() - 3 * 3600000); // Argentina = UTC-3
    const today = localNow.toISOString().slice(0, 10);
    const from15 = new Date(localNow.getTime() - 15 * 86400000);
    const fromStr = from15.toISOString().slice(0, 10) + 'T00:00:00.000-0300';
    const toStr   = `${today}T23:59:59.000-0300`;
    const mlPath = `/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(fromStr)}&order.date_created.to=${encodeURIComponent(toStr)}&sort=date_desc&limit=50`;
    console.log(`[flex-pdf-todos] Consultando ML: ${mlPath}`);

    const opts = {
      hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${config.access_token}`, 'Content-Type': 'application/json' }
    };

    const pReq = https.request(opts, pRes => {
      let body = '';
      pRes.on('data', c => body += c);
      pRes.on('end', async () => {
        try {
          const data   = JSON.parse(body);
          const orders = data.results || [];
          console.log(`[flex-pdf-todos] Ordenes recibidas: ${orders.length}`);

          if (!orders.length) {
            json(res, 200, { ok: true, count: 0, message: `No hay ordenes en los ultimos 15 dias` });
            return;
          }

          // Filtrar Flex cuya entrega estimada sea hoy
          const flexShipIds = [];
          for (const order of orders) {
            const shipId = order.shipping?.id;
            if (!shipId) continue;
            try {
              const ship = await fetchShipment(shipId);
              const name = ship.shipping_option?.name || '';
              const flex = isFlexShipment(ship);

              // Verificar fecha de hoy solo por delivery estimate (corte 12:00hs Argentina)
              const deliveryDay = (ship.shipping_option?.estimated_delivery_time?.date || '').slice(0, 10);
              const esDeHoy = deliveryDay === today;

              console.log(`[flex-pdf-todos] Envio ${shipId} "${name}" → flex=${flex} deliveryDay=${deliveryDay} esDeHoy=${esDeHoy}`);
              if (flex && esDeHoy) flexShipIds.push(shipId);
            } catch(e) { console.log(`[flex-pdf-todos] Error fetch shipment ${shipId}: ${e.message}`); }
          }

          if (!flexShipIds.length) {
            json(res, 200, { ok: true, count: 0, message: `No hay envios Flex para hoy (${today})` });
            return;
          }

          console.log(`[flex-pdf-todos] ${flexShipIds.length} envios Flex de hoy: ${flexShipIds.join(', ')}`);
          const pdfBuf = await fetchMLLabels(flexShipIds);
          const pdfB64 = pdfBuf.toString('base64');
          json(res, 200, { ok: true, count: flexShipIds.length, pdf_b64: pdfB64 });

        } catch(e) {
          json(res, 500, { error: 'Error procesando envios', detail: e.message });
        }
      });
    });
    pReq.on('error', e => json(res, 502, { error: e.message }));
    pReq.end();
    return;
  }

  // ── /despachos-hoy GET → órdenes ready_to_ship (para armar paquetes) ──
  if (pathname === '/despachos-hoy' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }

    const mlPath = `/orders/search?seller=${userId}&shipping.status=ready_to_ship&order.status=paid&sort=date_desc&limit=50`;
    console.log(`[despachos-hoy] Consultando ML: ${mlPath}`);

    const opts = {
      hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${config.access_token}`, 'Content-Type': 'application/json' }
    };
    const pReq = https.request(opts, pRes => {
      let body = '';
      pRes.on('data', c => body += c);
      pRes.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (pRes.statusCode !== 200) {
            json(res, 502, { error: `ML API error ${pRes.statusCode}`, detail: body.slice(0, 300) });
            return;
          }

          // Substatuses que indican "ya despachado / en camino" — filtrarlos
          const DISPATCHED_SUBSTATUS = new Set([
            'picked_up', 'dropped_off', 'in_hub', 'in_packing_list',
            'shipped', 'delivered', 'not_delivered', 'cancelled',
            'returning_to_sender', 'returned', 'forwarded_to_third',
          ]);
          // Substatuses VÁLIDOS para "para despachar" (ready_to_print, printed, etc.)
          const PENDING_SUBSTATUS = new Set([
            'ready_to_print', 'printed', 'stale', 'regenerating', 'invoice_pending',
          ]);

          // Verificar en paralelo el estado real del shipment (la flag a nivel order
          // a veces queda desactualizada — el shipment endpoint es la fuente de verdad)
          const rawOrders = data.results || [];
          const shipmentStatus = {};
          await Promise.all(rawOrders.map(async (o) => {
            const sid = o.shipping?.id;
            if (!sid) return;
            try {
              const sh = await mlGet('/shipments/' + sid, config.access_token);
              shipmentStatus[sid] = { status: sh.status, substatus: sh.substatus };
            } catch(e) { /* si falla, caemos al status del order */ }
          }));

          // Filtrar a las que realmente están pendientes de despachar
          const validOrders = rawOrders.filter(o => {
            const sid = o.shipping?.id;
            const sh = sid ? shipmentStatus[sid] : null;
            const status = sh?.status ?? o.shipping?.status;
            const substatus = sh?.substatus ?? o.shipping?.substatus;
            if (status !== 'ready_to_ship') {
              console.log(`[despachos-hoy] Filtrado ${o.id}: status=${status}, sub=${substatus}`);
              return false;
            }
            if (substatus && DISPATCHED_SUBSTATUS.has(substatus)) {
              console.log(`[despachos-hoy] Filtrado ${o.id} ya despachado: substatus=${substatus}`);
              return false;
            }
            // Si el substatus es null/desconocido pero status=ready_to_ship → keep
            if (substatus && !PENDING_SUBSTATUS.has(substatus)) {
              console.log(`[despachos-hoy] Substatus desconocido ${o.id}: ${substatus} (lo dejo pasar)`);
            }
            return true;
          });

          // Collect unique item IDs to fetch pictures (sólo de las órdenes válidas)
          const itemIds = new Set();
          for (const o of validOrders) {
            for (const i of (o.order_items || [])) {
              if (i.item?.id) itemIds.add(i.item.id);
            }
          }

          // Fetch item details to get variant pictures
          const itemCache = {};
          await Promise.all([...itemIds].map(async (itemId) => {
            try {
              const itemData = await mlGet('/items/' + itemId, config.access_token);
              itemCache[itemId] = itemData;
            } catch(e) { console.log(`[despachos-hoy] Error fetch item ${itemId}: ${e.message}`); }
          }));

          const orders = validOrders.map(o => {
            const sid = o.shipping?.id;
            const sh = sid ? shipmentStatus[sid] : null;
            return ({
            id: o.id,
            date_created: o.date_created,
            buyer: o.buyer?.nickname || o.buyer?.id || '—',
            shipping_id: o.shipping?.id || null,
            shipping_status: sh?.status ?? o.shipping?.status ?? null,
            shipping_substatus: sh?.substatus ?? o.shipping?.substatus ?? null,
            items: (o.order_items || []).map(i => {
              const itemId = i.item?.id;
              const varId  = i.item?.variation_id;
              let picture  = null;

              if (itemId && itemCache[itemId]) {
                const full = itemCache[itemId];
                const pics = full.pictures || [];
                // Find picture for the specific variation
                if (varId && full.variations) {
                  const variation = full.variations.find(v => v.id === varId);
                  if (variation && variation.picture_ids?.length && pics.length) {
                    const pic = pics.find(p => p.id === variation.picture_ids[0]);
                    if (pic) picture = pic.secure_url || pic.url;
                  }
                }
                // Fallback: first picture or thumbnail
                if (!picture && pics.length) picture = pics[0].secure_url || pics[0].url;
                if (!picture) picture = full.thumbnail;
              }

              return {
                title: i.item?.title || '—',
                quantity: i.quantity,
                variation_attributes: i.item?.variation_attributes || [],
                picture,
              };
            }),
          });
          });
          json(res, 200, { ok: true, orders, count: orders.length, totalRaw: rawOrders.length, filtered: rawOrders.length - validOrders.length });
        } catch(e) {
          json(res, 500, { error: 'Error parseando respuesta ML', detail: e.message });
        }
      });
    });
    pReq.on('error', e => json(res, 502, { error: e.message }));
    pReq.end();
    return;
  }

  // ── /ventas-hoy GET → órdenes pagadas de hoy con totales ────────
  if (pathname === '/ventas-hoy' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }

    const now = new Date();
    const localNow  = new Date(now.getTime() - 3 * 3600000); // Argentina = UTC-3
    const today = localNow.toISOString().slice(0, 10);
    const fromStr = `${today}T00:00:00.000-0300`;
    const toStr   = `${today}T23:59:59.000-0300`;
    const mlPath = `/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(fromStr)}&order.date_created.to=${encodeURIComponent(toStr)}&sort=date_desc&limit=50`;
    console.log(`[ventas-hoy] Consultando ML: ${mlPath}`);

    const opts = {
      hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${config.access_token}`, 'Content-Type': 'application/json' }
    };
    const pReq = https.request(opts, pRes => {
      let body = '';
      pRes.on('data', c => body += c);
      pRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (pRes.statusCode !== 200) {
            json(res, 502, { error: `ML API error ${pRes.statusCode}`, detail: body.slice(0, 300) });
            return;
          }
          const orders = (data.results || []).map(o => ({
            id: o.id,
            date_created: o.date_created,
            total_amount: o.total_amount || 0,
            buyer: o.buyer?.nickname || o.buyer?.id || '—',
            shipping_id: o.shipping?.id || null,
            shipping_status: o.shipping?.status || null,
            items: (o.order_items || []).map(i => ({
              title: i.item?.title || '—',
              quantity: i.quantity,
              unit_price: i.unit_price,
              variation_attributes: i.item?.variation_attributes || [],
            })),
          }));
          const total_ventas = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
          json(res, 200, { ok: true, today, orders, total_ventas, count: orders.length });
        } catch(e) {
          json(res, 500, { error: 'Error parseando respuesta ML', detail: e.message });
        }
      });
    });
    pReq.on('error', e => json(res, 502, { error: e.message }));
    pReq.end();
    return;
  }

  // ── /upload-picture POST → proxy multipart a ML ──────────────
  if (pathname === '/upload-picture' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || 'multipart/form-data';
      const opts = {
        hostname: ML_BASE, path: '/pictures/items/upload', method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.access_token}`,
          'Content-Type': ct,
          'Content-Length': bodyBuf.length,
          'User-Agent': 'Stockroom/1.0'
        }
      };
      const pReq = https.request(opts, pRes => {
        let b = '';
        pRes.on('data', c => b += c);
        pRes.on('end', () => {
          res.writeHead(pRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(b);
        });
      });
      pReq.on('error', e => json(res, 502, { error: e.message }));
      pReq.write(bodyBuf);
      pReq.end();
    });
    return;
  }

  // ── /vinculaciones GET — leer grupos de vinculación ─────────
  if (pathname === '/vinculaciones' && req.method === 'GET') {
    const fp = path.join(__dirname, 'vinculaciones.json');
    if (!fs.existsSync(fp)) { json(res, 200, { groups: [] }); return; }
    try { json(res, 200, JSON.parse(fs.readFileSync(fp, 'utf8'))); }
    catch(e) { json(res, 200, { groups: [] }); }
    return;
  }

  // ── /vinculaciones POST — guardar grupos de vinculación ────
  if (pathname === '/vinculaciones' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        fs.writeFileSync(path.join(__dirname, 'vinculaciones.json'), JSON.stringify(data, null, 2));
        json(res, 200, { ok: true });
      } catch(e) { json(res, 400, { error: 'invalid_json' }); }
    });
    return;
  }

  // ── /vinculaciones/sync POST — sincronizar stock entre cuentas ──
  if (pathname === '/vinculaciones/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { group, sourceItemId } = JSON.parse(body);
        // group = { id, name, items: [{accountId, itemId, label}] }
        // sourceItemId (optional): if set, use that item's stock as target; otherwise use minimum
        // 1) Leer stock real de cada item (incluyendo variaciones)
        const results = [];
        for (const it of group.items) {
          const acct = (fullConfig.accounts || []).find(a => a.id === it.accountId);
          if (!acct || !acct.access_token) { results.push({ ...it, error: 'sin_token' }); continue; }
          try {
            const data = await mlGetAuth(acct, '/items/' + it.itemId);
            const variations = data.variations || [];
            const hasVariations = variations.length > 0;
            // Stock total = suma de variaciones si las tiene, sino available_quantity
            let realStock;
            if (hasVariations) {
              realStock = variations.reduce((sum, v) => sum + (v.available_quantity || 0), 0);
            } else {
              realStock = data.available_quantity || 0;
            }
            results.push({ ...it, realStock, status: data.status, hasVariations, variations });
          } catch(e) { results.push({ ...it, error: e.message }); }
        }
        // 2) Determinar stock objetivo
        const valid = results.filter(r => !r.error && typeof r.realStock === 'number');
        if (!valid.length) { json(res, 200, { ok: false, error: 'No se pudo leer stock de ningún item', results }); return; }
        let targetStock;
        if (sourceItemId) {
          const src = valid.find(r => r.itemId === sourceItemId);
          if (!src) { json(res, 200, { ok: false, error: 'Item fuente no encontrado o sin stock', results }); return; }
          targetStock = src.realStock;
        } else {
          targetStock = Math.min(...valid.map(r => r.realStock));
        }
        // Helpers: claves canonicas de una variacion (matcheables entre cuentas).
        // Devuelve multiples claves para tolerar diferencias entre cuentas (value_id vs value_name, mayusculas, etc).
        function normalizeStr(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
        function varKeysAll(v) {
          const combos = (v.attribute_combinations || []).slice()
            .sort((a,b) => normalizeStr(a.id || a.name).localeCompare(normalizeStr(b.id || b.name)));
          if (!combos.length) return [];
          // Clave A: por value_name (mas consistente entre cuentas con variantes custom)
          const keyByName = combos.map(c =>
            normalizeStr(c.id || c.name) + '=' + normalizeStr(c.value_name || c.value_id)
          ).join('|');
          // Clave B: por value_id (mas consistente entre cuentas con catalogo ML)
          const keyById = combos.map(c =>
            normalizeStr(c.id || c.name) + '=' + normalizeStr(c.value_id || c.value_name)
          ).join('|');
          return keyByName === keyById ? [keyByName] : [keyByName, keyById];
        }
        // Item fuente (si se especifico sourceItemId) para matcheo por variante
        const srcItem = sourceItemId ? valid.find(r => r.itemId === sourceItemId) : null;
        const srcVarMap = {};
        if (srcItem && srcItem.hasVariations && srcItem.variations && srcItem.variations.length) {
          srcItem.variations.forEach(v => {
            const qty = v.available_quantity || 0;
            varKeysAll(v).forEach(k => { if (k) srcVarMap[k] = qty; });
          });
        }
        // 3) Actualizar items con stock distinto al objetivo
        const updates = [];
        for (const it of valid) {
          // Saltear el item fuente
          if (sourceItemId && it.itemId === sourceItemId) continue;
          const acct = (fullConfig.accounts || []).find(a => a.id === it.accountId);
          try {
            if (it.hasVariations && it.variations && it.variations.length) {
              let newVariations;
              let matchMethod = 'proportional';
              const hasSrcMap = Object.keys(srcVarMap).length > 0;
              let matchedCount = 0;
              if (hasSrcMap) {
                // Matchear variante-por-variante con el item fuente (por attribute_combinations)
                newVariations = it.variations.map(v => {
                  const keys = varKeysAll(v);
                  let qty = null;
                  for (const k of keys) {
                    if (k && Object.prototype.hasOwnProperty.call(srcVarMap, k)) {
                      qty = srcVarMap[k]; break;
                    }
                  }
                  if (qty !== null) { matchedCount++; return { id: v.id, available_quantity: Math.max(qty, 0) }; }
                  return { id: v.id, available_quantity: Math.max(v.available_quantity || 0, 0) };
                });
                matchMethod = matchedCount > 0 ? 'variants-by-attr' : 'no-match';
                if (matchedCount === 0) {
                  // La fuente tiene variantes pero ninguna matchea — no podemos mapear 1:1
                  updates.push({
                    itemId: it.itemId, from: it.realStock, to: it.realStock, ok: false,
                    error: 'variantes no coinciden con la fuente (atributos distintos)'
                  });
                  continue;
                }
              } else {
                // Sin fuente con variantes (sync al minimo): distribucion proporcional
                const oldTotal = it.realStock || 1;
                newVariations = it.variations.map(v => {
                  const oldQty = v.available_quantity || 0;
                  let newQty;
                  if (it.realStock === 0) {
                    newQty = Math.floor(targetStock / it.variations.length);
                  } else {
                    newQty = Math.round((oldQty / oldTotal) * targetStock);
                  }
                  return { id: v.id, available_quantity: Math.max(newQty, 0) };
                });
                const sum = newVariations.reduce((s, v) => s + v.available_quantity, 0);
                if (sum !== targetStock && newVariations.length) {
                  newVariations[0].available_quantity += (targetStock - sum);
                  if (newVariations[0].available_quantity < 0) newVariations[0].available_quantity = 0;
                }
              }
              const newTotal = newVariations.reduce((s, v) => s + v.available_quantity, 0);
              // Si ya coincide variante-por-variante con la fuente, no hay nada que actualizar
              if (newTotal === it.realStock && it.variations.every(v => {
                const nv = newVariations.find(x => x.id === v.id);
                return nv && nv.available_quantity === (v.available_quantity || 0);
              })) continue;
              await mlPutAuth(acct, '/items/' + it.itemId, { variations: newVariations });
              updates.push({ itemId: it.itemId, from: it.realStock, to: newTotal, ok: true, method: 'variations:' + matchMethod });
            } else {
              // Item simple sin variaciones
              if (it.realStock === targetStock) continue;
              await mlPutAuth(acct, '/items/' + it.itemId, { available_quantity: targetStock });
              updates.push({ itemId: it.itemId, from: it.realStock, to: targetStock, ok: true });
            }
          } catch(e) {
            updates.push({ itemId: it.itemId, from: it.realStock, to: targetStock, ok: false, error: e.message });
          }
        }
        json(res, 200, { ok: true, targetStock, updates, results });
      } catch(e) { json(res, 400, { error: 'invalid_json', detail: e.message }); }
    });
    return;
  }

  // ── /flex-cost-debug GET — diagnóstico: dumpea todo lo relacionado al envío ──
  // Uso: /flex-cost-debug?orderId=2000012653817757   (o ?shippingId=...)
  if (pathname === '/flex-cost-debug' && req.method === 'GET') {
    (async () => {
      try {
        const orderId = parsed.query.orderId;
        const shippingIdQ = parsed.query.shippingId;
        const acctIdQ = parsed.query.accountId;
        const acct = acctIdQ
          ? (fullConfig.accounts || []).find(a => a.id === acctIdQ)
          : config;
        if (!acct || !acct.access_token) { json(res, 400, { error: 'sin token para la cuenta' }); return; }

        const out = { _meta: { account: acct.id || acct.user_id, orderId, shippingIdQ } };
        let shippingId = shippingIdQ;

        if (orderId) {
          // 1) Probar como order_id directo
          try {
            const order = await mlGetAuth(acct, '/orders/' + orderId);
            out.order = order;
            shippingId = shippingId || order.shipping?.id;
          } catch(e) { out.order_error = e.message; }

          // 2) Si no anduvo, probar como pack_id (formato largo 2000...)
          if (!shippingId) {
            try {
              const pack = await mlGetAuth(acct, '/packs/' + orderId);
              out.pack = pack;
              const ords = pack.orders || [];
              if (ords.length) {
                // El pack referencia las orders, traemos la primera
                const firstOrderId = ords[0].id;
                try {
                  const order = await mlGetAuth(acct, '/orders/' + firstOrderId);
                  out.order = order;
                  shippingId = order.shipping?.id;
                } catch(e2) { out.order_via_pack_error = e2.message; }
              }
            } catch(e) { out.pack_error = e.message; }
          }

          // 3) Si tampoco, buscar el pack/order via /orders/search?pack_id=
          if (!shippingId && acct.user_id) {
            try {
              const search = await mlGetAuth(acct,
                '/orders/search?seller=' + acct.user_id + '&pack_id=' + orderId);
              out.search_by_pack = { results_count: (search.results || []).length };
              if (search.results && search.results.length) {
                out.order = search.results[0];
                shippingId = search.results[0].shipping?.id;
              }
            } catch(e) { out.search_error = e.message; }
          }
        }

        if (!shippingId) {
          json(res, 200, { ...out, error: 'no se pudo obtener shipping_id — probá con otro accountId o pegá el shipping_id directo via ?shippingId=' });
          return;
        }

        const tries = [
          ['shipment',         '/shipments/' + shippingId],
          ['lead_time',        '/shipments/' + shippingId + '/lead_time'],
          ['costs',            '/shipments/' + shippingId + '/costs'],
          ['cost_components',  '/shipments/' + shippingId + '/cost_components'],
          ['items',            '/shipments/' + shippingId + '/items'],
          ['carrier',          '/shipments/' + shippingId + '/carrier'],
          ['sla',              '/shipments/' + shippingId + '/sla'],
        ];
        for (const [key, p] of tries) {
          try { out[key] = await mlGetAuth(acct, p); }
          catch(e) { out[key + '_error'] = e.message; }
        }

        json(res, 200, out);
      } catch(e) {
        json(res, 500, { error: e.message });
      }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  //  FLEX COST — calcular costo de envíos Flex por período
  //  Tarifas (provistas por el usuario):
  //    CABA         = 4490
  //    GBA cercano  = 6490
  //    GBA lejano   = 8490
  //  Mapeo CP → zona persistido en flex_zones.json: { "1629": "gba_lejos", ... }
  // ══════════════════════════════════════════════════════════════════
  const FLEX_TARIFFS = { caba: 4490, gba_cerca: 6490, gba_lejos: 8490 };
  const FLEX_ZONES_PATH = path.join(__dirname, 'flex_zones.json');

  function loadFlexZones() {
    try {
      if (fs.existsSync(FLEX_ZONES_PATH)) return JSON.parse(fs.readFileSync(FLEX_ZONES_PATH, 'utf8'));
    } catch(e) {}
    return {};
  }
  function saveFlexZones(map) {
    fs.writeFileSync(FLEX_ZONES_PATH, JSON.stringify(map, null, 2));
  }
  // Auto-clasifica CABA por formato de CP. Devuelve null si no se puede inferir.
  function autoZoneForCp(cp) {
    if (!cp) return null;
    const s = String(cp).trim().toUpperCase();
    if (/^C\d{4}/.test(s)) return 'caba';
    // CABA legacy numérico: 1000-1499
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= 1000 && n <= 1499) return 'caba';
    }
    return null;
  }

  // ── GET /flex-zones — devuelve el mapa CP → zona ──
  if (pathname === '/flex-zones' && req.method === 'GET') {
    json(res, 200, { zones: loadFlexZones(), tariffs: FLEX_TARIFFS });
    return;
  }

  // ── POST /flex-zones — guarda asignaciones { cp: zone, ... } o una sola { cp, zone } ──
  if (pathname === '/flex-zones' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const map = loadFlexZones();
        const validZones = new Set(['caba', 'gba_cerca', 'gba_lejos', 'sin_zona', '']);
        if (data.cp && data.zone !== undefined) {
          if (!validZones.has(data.zone)) { json(res, 400, { error: 'zone inválida' }); return; }
          if (data.zone === '') delete map[String(data.cp)];
          else map[String(data.cp)] = data.zone;
        } else if (data.zones && typeof data.zones === 'object') {
          for (const [cp, z] of Object.entries(data.zones)) {
            if (!validZones.has(z)) continue;
            if (z === '') delete map[String(cp)];
            else map[String(cp)] = z;
          }
        } else { json(res, 400, { error: 'body inválido' }); return; }
        saveFlexZones(map);
        json(res, 200, { ok: true, count: Object.keys(map).length });
      } catch(e) { json(res, 500, { error: e.message }); }
    });
    return;
  }

  // ── POST /flex-cost-excel — calcula costo Flex parseando el Excel ML ──
  // Multipart: file (xlsx) + periodo (1|2|3|"")
  if (pathname === '/flex-cost-excel' && req.method === 'POST') {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) { json(res, 400, { error: 'No boundary' }); return; }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const parts = parseMultipart(body, bm[1]);
      const fileData = parts['file'];
      const periodo = String(parts['periodo'] || '').trim();
      if (!fileData?.data) { json(res, 400, { error: 'Archivo no recibido' }); return; }

      const tmpIn = path.join(os.tmpdir(), `flex_in_${Date.now()}.xlsx`);
      fs.writeFileSync(tmpIn, fileData.data);

      const scriptPath = path.join(__dirname, 'flex_cost.py');
      if (!fs.existsSync(scriptPath)) {
        try { fs.unlinkSync(tmpIn); } catch(e) {}
        json(res, 500, { error: 'No se encontró flex_cost.py' });
        return;
      }

      const args = [scriptPath, tmpIn, '--zones', FLEX_ZONES_PATH];
      if (['1','2','3'].includes(periodo)) { args.push('--periodo', periodo); }

      const PYTHON = process.platform === 'win32' ? 'py' : 'python3';
      const PYTHON_ARGS = process.platform === 'win32' ? ['-3.12'] : [];
      const py = spawn(PYTHON, [...PYTHON_ARGS, ...args]);
      let stdout = '', stderr = '';
      py.stdout.on('data', d => stdout += d);
      py.stderr.on('data', d => stderr += d);
      py.on('close', code => {
        try { fs.unlinkSync(tmpIn); } catch(e) {}
        if (code !== 0) {
          json(res, 500, { error: 'Error ejecutando script', detail: stderr.slice(-800) });
          return;
        }
        try {
          const clean = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const idx = clean.indexOf('FLEX_JSON:');
          if (idx === -1) {
            json(res, 500, { error: 'Script no devolvió FLEX_JSON', detail: stdout.slice(-800) });
            return;
          }
          const jsonStr = clean.slice(idx + 'FLEX_JSON:'.length).split('\n')[0].trim();
          const result = JSON.parse(jsonStr);
          json(res, 200, result);
        } catch(e) {
          json(res, 500, { error: 'Error parseando salida', detail: e.message });
        }
      });
    });
    return;
  }

  // ── GET /flex-cost?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=all|<id> ──
  // Calcula gasto Flex sumando tarifas según CP de cada envío en el período.
  if (pathname === '/flex-cost' && req.method === 'GET') {
    (async () => {
      try {
        const fromQ = parsed.query.from;
        const toQ = parsed.query.to;
        const acctIdQ = parsed.query.accountId || 'all';
        if (!fromQ || !toQ) { json(res, 400, { error: 'from/to requeridos (YYYY-MM-DD)' }); return; }

        const fromISO = new Date(fromQ + 'T00:00:00.000-03:00').toISOString();
        const toISO   = new Date(toQ   + 'T23:59:59.999-03:00').toISOString();

        const allAccounts = fullConfig.accounts || (config.access_token ? [config] : []);
        const targetAccts = acctIdQ === 'all'
          ? allAccounts.filter(a => a.access_token && a.user_id)
          : allAccounts.filter(a => a.id === acctIdQ && a.access_token && a.user_id);
        if (!targetAccts.length) { json(res, 400, { error: 'sin cuentas válidas' }); return; }

        const zonesMap = loadFlexZones();
        const breakdown = {}; // cp → { count, sample_address, zone, accounts:Set }
        const unmapped = {};  // cp → { count, sample_address, accounts:Set }
        const perAccount = {};
        let flexShipmentsTotal = 0;
        let totalCost = 0;
        const errors = [];

        for (const acct of targetAccts) {
          perAccount[acct.id] = { label: acct.label || acct.id, count: 0, cost: 0 };
          // Paginar orders del período
          const collectedShipIds = new Set();
          let offset = 0;
          const LIMIT = 50;
          const MAX_ORDERS = 1000;
          while (offset < MAX_ORDERS) {
            const mlPath = `/orders/search?seller=${acct.user_id}` +
              `&order.date_created.from=${encodeURIComponent(fromISO)}` +
              `&order.date_created.to=${encodeURIComponent(toISO)}` +
              `&sort=date_desc&limit=${LIMIT}&offset=${offset}`;
            let data;
            try { data = await mlGetAuth(acct, mlPath); }
            catch(e) { errors.push({ account: acct.id, stage: 'orders_search', error: e.message }); break; }
            const results = data.results || [];
            for (const o of results) {
              if (o.shipping && o.shipping.id) collectedShipIds.add(o.shipping.id);
            }
            if (results.length < LIMIT) break;
            offset += LIMIT;
          }

          // Fetch shipments en paralelo (chunks de 8 para no estresar la API)
          const shipIds = Array.from(collectedShipIds);
          const CHUNK = 8;
          for (let i = 0; i < shipIds.length; i += CHUNK) {
            const chunk = shipIds.slice(i, i + CHUNK);
            const results = await Promise.all(chunk.map(sid =>
              mlGetAuth(acct, '/shipments/' + sid).catch(e => ({ _err: e.message, _sid: sid }))
            ));
            for (const sh of results) {
              if (sh._err) { errors.push({ account: acct.id, stage: 'shipment', sid: sh._sid, error: sh._err }); continue; }
              if (sh.logistic_type !== 'self_service') continue; // sólo Flex
              // Excluir cancelados/devueltos
              const status = sh.status;
              const sub = sh.substatus;
              if (status === 'cancelled' || sub === 'cancelled' || sub === 'returned' || sub === 'returning_to_sender') continue;

              flexShipmentsTotal++;
              perAccount[acct.id].count++;

              const recv = sh.receiver_address || {};
              const cp = String(recv.zip_code || '').trim();
              const addrSample = [recv.address_line, recv.neighborhood?.name, recv.city?.name, recv.state?.name].filter(Boolean).join(' · ');

              let zone = zonesMap[cp] || autoZoneForCp(cp);
              if (zone && FLEX_TARIFFS[zone]) {
                const cost = FLEX_TARIFFS[zone];
                totalCost += cost;
                perAccount[acct.id].cost += cost;
                if (!breakdown[cp]) breakdown[cp] = { count: 0, sample_address: addrSample, zone, accounts: new Set() };
                breakdown[cp].count++;
                breakdown[cp].accounts.add(acct.id);
              } else {
                if (!unmapped[cp]) unmapped[cp] = { count: 0, sample_address: addrSample, accounts: new Set() };
                unmapped[cp].count++;
                unmapped[cp].accounts.add(acct.id);
              }
            }
          }
        }

        // Serialize Sets
        const breakdownArr = Object.entries(breakdown).map(([cp, v]) => ({
          cp, count: v.count, zone: v.zone, tariff: FLEX_TARIFFS[v.zone],
          subtotal: v.count * FLEX_TARIFFS[v.zone],
          sample_address: v.sample_address, accounts: Array.from(v.accounts),
        })).sort((a,b) => b.subtotal - a.subtotal);
        const unmappedArr = Object.entries(unmapped).map(([cp, v]) => ({
          cp, count: v.count, sample_address: v.sample_address, accounts: Array.from(v.accounts),
          auto_suggest: autoZoneForCp(cp),
        })).sort((a,b) => b.count - a.count);

        json(res, 200, {
          ok: true, from: fromQ, to: toQ, accountId: acctIdQ,
          tariffs: FLEX_TARIFFS,
          flex_shipments: flexShipmentsTotal,
          mapped_count: breakdownArr.reduce((a,r) => a + r.count, 0),
          unmapped_count: unmappedArr.reduce((a,r) => a + r.count, 0),
          total_cost: totalCost,
          breakdown: breakdownArr,
          unmapped: unmappedArr,
          per_account: perAccount,
          errors: errors.slice(0, 20),
        });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return;
  }

  // ── /vinculaciones/check-orders POST — revisar ventas recientes y ajustar ──
  // Body: { dryRun?: boolean }  — si dryRun=true, sólo detecta y devuelve propuestas sin aplicar.
  if (pathname === '/vinculaciones/check-orders' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        let bodyData = {};
        try { bodyData = body ? JSON.parse(body) : {}; } catch(e) {}
        const dryRun = !!bodyData.dryRun;
        const fp = path.join(__dirname, 'vinculaciones.json');
        const vinc = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : { groups: [] };
        if (!vinc.groups || !vinc.groups.length) { json(res, 200, { ok: true, msg: 'No hay grupos', synced: 0, dryRun }); return; }

        // Build a map: itemId → group for fast lookup
        const itemToGroup = {};
        for (const g of vinc.groups) {
          for (const it of g.items) {
            itemToGroup[it.itemId] = g;
          }
        }

        // Check recent orders (last 2h) for each account
        const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const allAccounts = fullConfig.accounts || [];
        const groupsToSync = new Set();

        for (const acct of allAccounts) {
          if (!acct.access_token || !acct.user_id) continue;
          try {
            const mlPath = `/orders/search?seller=${acct.user_id}&order.status=paid&order.date_created.from=${encodeURIComponent(since)}&sort=date_desc&limit=50`;
            const data = await mlGetAuth(acct, mlPath);
            const orders = data.results || [];
            for (const o of orders) {
              for (const oi of (o.order_items || [])) {
                const iid = oi.item && oi.item.id;
                if (iid && itemToGroup[iid]) {
                  groupsToSync.add(itemToGroup[iid].id);
                }
              }
            }
          } catch(e) { console.log(`[vinc] Error checking orders for ${acct.id}:`, e.message); }
        }

        // Sync each group that had sales
        const syncResults = [];
        for (const gid of groupsToSync) {
          const g = vinc.groups.find(x => x.id === gid);
          if (!g) continue;
          // Read all stocks (handling variations)
          const stocks = [];
          for (const it of g.items) {
            const acct = allAccounts.find(a => a.id === it.accountId);
            if (!acct || !acct.access_token) continue;
            try {
              const d = await mlGetAuth(acct, '/items/' + it.itemId);
              const vars = d.variations || [];
              const hasVars = vars.length > 0;
              const stock = hasVars
                ? vars.reduce((sum, v) => sum + (v.available_quantity || 0), 0)
                : (d.available_quantity || 0);
              stocks.push({ ...it, stock, hasVars, variations: vars });
            } catch(e) { /* skip */ }
          }
          if (!stocks.length) continue;
          const minStock = Math.min(...stocks.map(s => s.stock));
          for (const s of stocks) {
            if (s.stock > minStock) {
              const acct = allAccounts.find(a => a.id === s.accountId);
              try {
                if (!dryRun) {
                  if (s.hasVars && s.variations && s.variations.length) {
                    const oldTotal = s.stock || 1;
                    const newVars = s.variations.map(v => {
                      const oldQty = v.available_quantity || 0;
                      let newQty = oldTotal === 0
                        ? Math.floor(minStock / s.variations.length)
                        : Math.round((oldQty / oldTotal) * minStock);
                      return { id: v.id, available_quantity: Math.max(newQty, 0) };
                    });
                    const sum = newVars.reduce((a, v) => a + v.available_quantity, 0);
                    if (sum !== minStock && newVars.length) {
                      newVars[0].available_quantity += (minStock - sum);
                      if (newVars[0].available_quantity < 0) newVars[0].available_quantity = 0;
                    }
                    await mlPutAuth(acct, '/items/' + s.itemId, { variations: newVars });
                  } else {
                    await mlPutAuth(acct, '/items/' + s.itemId, { available_quantity: minStock });
                  }
                }
                syncResults.push({
                  group: g.name, groupId: g.id,
                  accountId: s.accountId, acctLabel: s.acctLabel || s.accountId,
                  item: s.itemId, title: s.title || '', thumb: s.thumb || '',
                  from: s.stock, to: minStock, hasVars: !!s.hasVars,
                });
              } catch(e) { /* skip */ }
            }
          }
        }

        json(res, 200, { ok: true, dryRun, groupsChecked: groupsToSync.size, synced: syncResults.length, details: syncResults });
      } catch(e) { json(res, 500, { error: e.message }); }
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════
  //  MULTI-CUENTA: despachos + etiquetas de TODAS las cuentas
  // ══════════════════════════════════════════════════════════════

  // ── Helper: fetch etiquetas con token de cuenta específica ────
  function fetchMLLabelsAuth(acct, shipmentIds, responseType) {
    return new Promise((resolve, reject) => {
      const ids = shipmentIds.join(',');
      const labelsPath = `/shipment_labels?shipment_ids=${ids}&response_type=${responseType || 'pdf'}`;
      const opts = {
        hostname: ML_BASE, path: labelsPath, method: 'GET',
        headers: { 'Authorization': `Bearer ${acct.access_token}`, 'User-Agent': 'Stockroom/1.0' }
      };
      const req = https.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200)
            return reject(new Error(`ML labels HTTP ${res.statusCode}: ${buf.toString().slice(0, 400)}`));
          resolve(buf);
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  // ── Helper compartido: obtener despachos pendientes de una cuenta ──
  async function getDespachosPendientes(acct) {
    // Refrescar token si es necesario
    try { await refreshAccountToken(acct); } catch(e) { /* continúa con token actual */ }

    const DISPATCHED = new Set(['picked_up','dropped_off','in_hub','in_packing_list',
      'shipped','delivered','not_delivered','cancelled','returning_to_sender','returned','forwarded_to_third']);

    const mlPath = `/orders/search?seller=${acct.user_id}&shipping.status=ready_to_ship&order.status=paid&sort=date_desc&limit=50`;
    const data = await mlGetAuth(acct, mlPath);
    const rawOrders = data.results || [];

    // Verificar estado real del shipment en paralelo
    const shipmentStatus = {};
    await Promise.all(rawOrders.map(async o => {
      const sid = o.shipping?.id;
      if (!sid) return;
      try {
        const sh = await mlGetAuth(acct, '/shipments/' + sid);
        shipmentStatus[sid] = { status: sh.status, substatus: sh.substatus, logistic_type: sh.logistic_type };
      } catch(e) {}
    }));

    const validOrders = rawOrders.filter(o => {
      const sid = o.shipping?.id;
      const sh = sid ? shipmentStatus[sid] : null;
      const status = sh?.status ?? o.shipping?.status;
      const substatus = sh?.substatus ?? o.shipping?.substatus;
      if (status !== 'ready_to_ship') return false;
      if (substatus && DISPATCHED.has(substatus)) return false;
      return true;
    });

    // Fetch fotos de items
    const itemIds = new Set();
    for (const o of validOrders) for (const i of (o.order_items || [])) if (i.item?.id) itemIds.add(i.item.id);
    const itemCache = {};
    await Promise.all([...itemIds].map(async id => {
      try { itemCache[id] = await mlGetAuth(acct, '/items/' + id); } catch(e) {}
    }));

    const orders = validOrders.map(o => {
      const sid = o.shipping?.id;
      const sh = sid ? shipmentStatus[sid] : null;
      const isFlex = sh ? (sh.logistic_type === 'self_service') : false;
      return {
        id: o.id,
        date_created: o.date_created,
        buyer: o.buyer?.nickname || o.buyer?.id || '—',
        shipping_id: sid || null,
        shipping_status: sh?.status ?? o.shipping?.status ?? null,
        shipping_substatus: sh?.substatus ?? o.shipping?.substatus ?? null,
        is_flex: isFlex,
        items: (o.order_items || []).map(i => {
          const itemId = i.item?.id;
          const varId  = i.item?.variation_id;
          let picture  = null;
          if (itemId && itemCache[itemId]) {
            const full = itemCache[itemId];
            const pics = full.pictures || [];
            if (varId && full.variations) {
              const variation = full.variations.find(v => v.id === varId);
              if (variation?.picture_ids?.length) {
                const pic = pics.find(p => p.id === variation.picture_ids[0]);
                if (pic) picture = pic.secure_url || pic.url;
              }
            }
            if (!picture && pics.length) picture = pics[0].secure_url || pics[0].url;
            if (!picture) picture = full.thumbnail;
          }
          return { title: i.item?.title || '—', quantity: i.quantity,
            variation_attributes: i.item?.variation_attributes || [], picture };
        }),
      };
    });
    return { orders, filtered: rawOrders.length - validOrders.length };
  }

  // ── GET /despachos-hoy-all → despachos de TODAS las cuentas ──
  if (pathname === '/despachos-hoy-all' && req.method === 'GET') {
    (async () => {
      try {
        const allAccounts = (fullConfig.accounts || []).filter(a => a.access_token && a.user_id);
        if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

        const results = await Promise.all(allAccounts.map(async acct => {
          try {
            const { orders, filtered } = await getDespachosPendientes(acct);
            return { accountId: acct.id, label: acct.label || acct.id, ok: true, orders, filtered };
          } catch(e) {
            return { accountId: acct.id, label: acct.label || acct.id, ok: false, error: e.message, orders: [], filtered: 0 };
          }
        }));

        const totalOrders = results.reduce((s, r) => s + r.orders.length, 0);
        const totalUnits  = results.reduce((s, r) => s + r.orders.reduce((a, o) => a + o.items.reduce((b, i) => b + (i.quantity||0), 0), 0), 0);
        json(res, 200, { ok: true, accounts: results, totalOrders, totalUnits });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return;
  }

  // ── GET /flex-pdf-all?responseType=pdf|zpl2 → etiquetas Flex de todas las cuentas ──
  if (pathname === '/flex-pdf-all' && req.method === 'GET') {
    (async () => {
      try {
        const responseType = parsed.query.responseType || 'pdf';
        const allAccounts  = (fullConfig.accounts || []).filter(a => a.access_token && a.user_id);
        if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

        const results = await Promise.all(allAccounts.map(async acct => {
          try {
            await refreshAccountToken(acct);
            const { orders } = await getDespachosPendientes(acct);
            const flexShipIds = orders.filter(o => o.is_flex && o.shipping_id).map(o => o.shipping_id);
            if (!flexShipIds.length) return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: 0, data_b64: null };
            const buf = await fetchMLLabelsAuth(acct, flexShipIds, responseType);
            return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: flexShipIds.length, data_b64: buf.toString('base64') };
          } catch(e) {
            return { accountId: acct.id, label: acct.label || acct.id, ok: false, count: 0, error: e.message, data_b64: null };
          }
        }));

        const total = results.reduce((s, r) => s + r.count, 0);
        json(res, 200, { ok: true, responseType, total, accounts: results });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════
  //  PREGUNTAS MULTI-CUENTA
  // ══════════════════════════════════════════════════════════════

  // ── GET /preguntas-all → preguntas sin responder de todas las cuentas ──
  if (pathname === '/preguntas-all' && req.method === 'GET') {
    (async () => {
      try {
        const allAccounts = (fullConfig.accounts || []).filter(a => a.access_token && a.user_id);
        if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

        const results = await Promise.all(allAccounts.map(async acct => {
          try {
            await refreshAccountToken(acct);
            const data = await mlGetAuth(acct,
              `/questions/search?seller_id=${acct.user_id}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=DESC`);
            const questions = data.questions || [];

            // Fetch info de items únicos en paralelo
            const itemIds = [...new Set(questions.map(q => q.item_id).filter(Boolean))];
            const itemCache = {};
            await Promise.all(itemIds.map(async id => {
              try {
                const item = await mlGetAuth(acct, `/items/${id}?attributes=id,title,thumbnail`);
                itemCache[id] = { title: item.title || id, thumb: item.thumbnail || null };
              } catch(e) { itemCache[id] = { title: id, thumb: null }; }
            }));

            const enriched = questions.map(q => ({
              id: q.id,
              text: q.text,
              date_created: q.date_created,
              item_id: q.item_id,
              item_title: itemCache[q.item_id]?.title || q.item_id || '—',
              item_thumb: itemCache[q.item_id]?.thumb || null,
              buyer_id: q.from?.id || null,
            }));

            return { accountId: acct.id, label: acct.label || acct.id, ok: true, questions: enriched };
          } catch(e) {
            return { accountId: acct.id, label: acct.label || acct.id, ok: false, error: e.message, questions: [] };
          }
        }));

        const total = results.reduce((s, r) => s + r.questions.length, 0);
        json(res, 200, { ok: true, accounts: results, total });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return;
  }

  // ── POST /preguntas-responder → responder una pregunta ──────
  if (pathname === '/preguntas-responder' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { accountId, question_id, text } = JSON.parse(body);
        if (!accountId || !question_id || !text?.trim())
          { json(res, 400, { error: 'Faltan parámetros: accountId, question_id, text' }); return; }

        const acct = (fullConfig.accounts || []).find(a => a.id === accountId);
        if (!acct) { json(res, 404, { error: 'Cuenta no encontrada' }); return; }

        await refreshAccountToken(acct);
        const result = await mlPostAuth(acct, '/answers', { question_id, text: text.trim() });
        json(res, 200, { ok: true, answer: result });
      } catch(e) {
        json(res, e.status || 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  // ── Archivos estáticos ──────────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;

  // Block sensitive files by basename (case-insensitive)
  const basename = path.basename(filePath).toLowerCase();
  const BLOCKED_FILES = new Set([
    'server.js', 'config.json', 'tokens.json', 'accounts.json', 'vinculaciones.json',
    'package.json', 'package-lock.json', '.env', '.env.local', '.env.production',
    'readme.md', 'security_setup.md',
  ]);
  if (BLOCKED_FILES.has(basename) || basename.startsWith('.') || basename.endsWith('.env')) {
    res.writeHead(404); res.end('Not found'); return;
  }

  // Block sensitive directories
  const lowPath = filePath.toLowerCase().replace(/\\/g, '/');
  const BLOCKED_DIRS = ['/memory/', '/node_modules/', '/.git/', '/data/', '/backup/'];
  if (BLOCKED_DIRS.some(d => lowPath.includes(d))) {
    res.writeHead(404); res.end('Not found'); return;
  }

  // Only serve files with known extensions
  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) { res.writeHead(404); res.end('Not found'); return; }

  // Resolve path and ensure it stays inside __dirname (defense in depth vs traversal)
  const resolved = path.resolve(__dirname, '.' + filePath);
  if (!resolved.startsWith(path.resolve(__dirname) + path.sep) && resolved !== path.resolve(__dirname, 'index.html')) {
    res.writeHead(404); res.end('Not found'); return;
  }

  if (!fs.existsSync(resolved)) { res.writeHead(404); res.end('Not found'); return; }

  const mime = MIME[ext];
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(resolved).pipe(res);
});

// ── Auto-refresh proactivo — renueva token cada 4 horas ──────
const TOKEN_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 horas (tokens ML duran 6h)

async function proactiveRefresh() {
  if (!config.refresh_token) return;
  console.log('  ⟳ Auto-refresh proactivo...');
  const ok = await refreshAccessToken();
  if (!ok) console.log('  ✗ Falló el refresh proactivo — se reintentará en la próxima request 401');
}

// Refresh al arrancar si ya hay un token (por si estaba expirado)
setTimeout(() => {
  if (config.access_token && config.refresh_token) {
    console.log('  ⟳ Refresh inicial al arrancar...');
    refreshAccessToken();
  }
}, 3000);

// Timer periódico
setInterval(proactiveRefresh, TOKEN_REFRESH_INTERVAL);


server.listen(PORT, BIND, () => {
  const acct = config.label || config.id || '—';
  const lanMsg = BIND === '0.0.0.0' ? 'expuesto en LAN' : 'solo localhost (seguro)';
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   STOCKROOM — servidor iniciado               │');
  console.log(`  │   http://localhost:${PORT}                     │`);
  console.log(`  │   Bind: ${BIND.padEnd(16)} ${lanMsg.padEnd(18)}│`);
  console.log('  │                                              │');
  console.log(`  │   Cuenta activa: ${acct.padEnd(28)}│`);
  console.log('  │   Ctrl+C para detener                        │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
});

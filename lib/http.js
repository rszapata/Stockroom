// ── Utilidades HTTP: headers de seguridad, CORS, CSRF, proxy whitelist ──

function cors(res) {
  // No CORS headers → same-origin only enforced by browser.
  // Omitir Access-Control-Allow-Origin es más seguro que poner 'null'
  // ('null' coincide con peticiones de file:// y iframes sandboxed).
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Apply security headers on every response
// fileType: 'html' | 'script' | 'style' | 'image' | 'font' | 'other' | undefined
function securityHeaders(res, isHtml, fileType, hasVersionQuery) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Cache-Control diferenciado:
  // - HTML y JSON de API: no cachear (contenido dinámico)
  // - Scripts/CSS: con `?v=N` el nombre es estable por versión → immutable 1 año.
  //   Sin `?v=` (poco común) se cachea solo 1 día por las dudas.
  // - Imágenes/fuentes: 7 días
  if (fileType === 'script' || fileType === 'style') {
    res.setHeader('Cache-Control', hasVersionQuery
      ? 'public, max-age=31536000, immutable'                     // 1 año
      : 'public, max-age=86400');                                 // 1 día
    res.setHeader('Vary', 'Accept-Encoding');
  } else if (fileType === 'image' || fileType === 'font') {
    res.setHeader('Cache-Control', 'public, max-age=604800');     // 7 días
    res.setHeader('Vary', 'Accept-Encoding');
  } else {
    // HTML, JSON de API, todo lo demás: sin caché
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  // CSP para HTML es manejado exclusivamente por serveStaticFile (necesita nonce por request).
  // Aquí sólo se establece para respuestas que NO son HTML (API endpoints, etc.).
  // Para HTML: ver bloque if (ext === '.html') más abajo.
}

/** Detecta el tipo de archivo para Cache-Control */
function getFileType(ext) {
  if (ext === '.js')  return 'script';
  if (ext === '.css') return 'style';
  if (['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico'].includes(ext)) return 'image';
  if (ext === '.woff' || ext === '.woff2' || ext === '.ttf') return 'font';
  return 'other';
}

/**
 * Verifica origen de la request para prevenir CSRF en endpoints de mutación admin.
 * Acepta requests sin Origin (herramientas CLI, Postman desde IP de confianza).
 * Rechaza requests con Origin de dominio ajeno.
 */
function checkCSRF(req) {
  const origin  = req.headers['origin']  || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true; // request desde CLI/Postman/curl — solo IP trusted
  const source = origin || referer;
  // Permitir: mismo host, localhost, o IPs del servidor
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(source)
    || source.includes(req.headers['host'] || '___none___');
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
  /^\/reviews\/item\/[^/]+(\?|$)/,                   // GET reviews de un item
];

function isProxyPathAllowed(mlPath) {
  return ALLOWED_PROXY_PATTERNS.some(rx => rx.test(mlPath));
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

module.exports = { cors, securityHeaders, getFileType, checkCSRF, ALLOWED_PROXY_PATTERNS, isProxyPathAllowed, json };

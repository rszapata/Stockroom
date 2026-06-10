// ── Caché DNS en proceso ──────────────────────────────────────
// Node NO cachea DNS: cada request HTTP re-resuelve el hostname contra el
// DNS del ISP. Bajo ráfagas (el check de vinculaciones hace ~34 lookups en
// paralelo) el resolver del ISP tiene hipos y devuelve EAI_AGAIN → timeouts.
// Esta caché resuelve una vez por hostname (TTL 5 min) y, si el DNS falla,
// reutiliza la última IP buena conocida. Parchea dns.lookup global, así todas
// las llamadas (ML, MP, Telegram, Correo) se benefician sin tocar cada sitio.
const dns = require('dns');

const _dnsOrigLookup = dns.lookup.bind(dns);
const _dnsCache = new Map(); // key: `host|family|all` -> { result:[args], expiry }
const DNS_TTL_MS = 5 * 60 * 1000;

dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  options = options || (typeof options === 'number' ? { family: options } : {});
  const family = (typeof options === 'object' ? options.family : options) || 0;
  const all = !!(options && options.all);
  const key = `${hostname}|${family}|${all ? 1 : 0}`;
  const hit = _dnsCache.get(key);
  if (hit && Date.now() < hit.expiry) {
    return process.nextTick(() => callback(null, ...hit.result));
  }
  return _dnsOrigLookup(hostname, options, (err, ...args) => {
    if (!err && args[0]) {
      _dnsCache.set(key, { result: args, expiry: Date.now() + DNS_TTL_MS });
      return callback(null, ...args);
    }
    // Resolución falló (EAI_AGAIN, etc.): usar la última IP buena si existe,
    // aunque haya expirado — mucho mejor que tirar la request.
    if (err && hit) {
      console.warn(`[dns] ${hostname} falló (${err.code || err.message}); usando IP cacheada`);
      return callback(null, ...hit.result);
    }
    return callback(err, ...args);
  });
};

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
const zlib     = require('zlib');
const { spawn } = require('child_process');
const sharp    = require('sharp');
const db       = require('./db/queries');
const { migrateProductsFromCache } = require('./db/migrate-products-fn');
const { writeJsonAtomic, detectImageExt, detectVideoExt, parseMultipart, MIME } = require('./lib/files');
const { cors, securityHeaders, getFileType, checkCSRF, ALLOWED_PROXY_PATTERNS, isProxyPathAllowed, json } = require('./lib/http');
const { commonPrefix } = require('./lib/strings');
const { parsePdfRows, parseReceiptRows, parseContractRows } = require('./lib/pdf-parsers');
const { extractVariantName, mergeFamilyGroup, consolidateItems } = require('./lib/products');
const { formatDeliveryEstimate, friendlyShippingName } = require('./lib/shipping');
const { readBody, readBodyWithLimit } = require('./lib/http-body');
const { isSecureConnection, cookieSecure, hashPassword, makeSid, timingSafeEqStr, parseCookies, getClientIP } = require('./lib/auth-utils');
const { mlStock, mlCat, mlImg, applyProductOverride } = require('./lib/ml-item');
const { PRODUCTO_PROPIO_PREFIX, CATEGORIAS_PROPIAS, generarIdProductoPropio, esIdProductoPropio, localProductoToItem, calcularPrecioArs, _cleanTxt, _cleanNum, _buildProductoPropioFields, _serializeProductoPropio } = require('./lib/productos-propios');
const { decodeAscii85, extractPdfText, decodePdfString, extractStringsFromStream, parseValueString, parseSinergiaTable } = require('./lib/pdf-extract');
const { RESUMEN_DIR, RESUMEN_INDEX, loadResumenIndex, saveResumenIndex } = require('./lib/resumenes');
const { emailConfirmacionOrden, generarCuponFidelidad, emailPagoConfirmado, emailEnvioTracking, emailArrepentimientoConfirmacion, emailPedidoEntregado, emailPedidoCancelado, emailPedidoReembolsado, emailCarritoAbandonado } = require('./lib/email-templates');
const { _normalizeStr, _varKeysAll, _varLabel, _fmtVarDelta, _shortAcct, _adjStaleMsg, _errMsg } = require('./lib/variant-helpers');
const { loadPendingAdjustments, savePendingAdjustments, loadVincLog, appendVincLog, loadNotifiedQuestions, saveNotifiedQuestions, loadTgOffset, saveTgOffset, loadAlibabaMapping, saveAlibabaMapping, loadAuthConfig, atomicWriteFileSync } = require('./lib/json-store');
const { loadSessions, saveSessions } = require('./lib/session-store');
const { loadRateLimits, saveRateLimits } = require('./lib/rate-limit-store');
const { tgRequest } = require('./lib/telegram');
const { stripeApiCall } = require('./lib/stripe');
const { mpVerifyWebhookSignature } = require('./lib/mp-webhook');
const { HTTP_TIMEOUT_MS, applyHttpTimeout, httpsRequestJson } = require('./lib/http-client');
const { mlOauthToken, mlGet, mlPut, mlPost } = require('./lib/ml-api');
const { auditLog } = require('./lib/audit-log');
const { sendEmail: sendEmailWith } = require('./lib/email-sender');
const { mpCreatePreference, mpGetPaymentById, mpSearchPaymentByExternalRef, mpGetInstallments } = require('./lib/mercadopago');
const { _detectarMarca, _parsePrecioUsd, _sugerirCategoriaPropia, parseListaProveedorWhatsApp } = require('./lib/whatsapp-parser');

require('./lib/dns-cache');

// ── Route modules (Fase 4 — extracted from server.js) ────────────
const handlePdfResumenes   = require('./routes/pdf-resumenes');
const _mkHandlePreguntas   = require('./routes/preguntas');
const _mkHandleBackup      = require('./routes/backup');
const _mkHandleAlibaba     = require('./routes/alibaba');
const _mkHandleVinculaciones = require('./routes/vinculaciones');
const _mkHandleFlex        = require('./routes/flex');
const _mkHandleDespachos   = require('./routes/despachos');

const PORT    = parseInt(process.env.PORT) || 3000;
// Bind to 127.0.0.1 by default — only the local machine (and cloudflared) can reach it.
// To expose on LAN for dev: set BIND=0.0.0.0
const BIND    = process.env.BIND || '0.0.0.0';
const ML_BASE = 'api.mercadolibre.com';

// ── Config ────────────────────────────────────────────────────
let fullConfig = {};   // todo config.json
let config     = {};   // cuenta activa (puntero al objeto dentro de accounts[])
const CONFIG_PATH  = path.join(__dirname, 'config.json');
const TIENDA_DIR   = path.resolve(__dirname, '..', 'tienda');
const ORDENES_PATH          = path.join(__dirname, 'ordenes.json');
const TIENDA_USERS_PATH     = path.join(__dirname, 'tienda-users.json');

// ── .env loader (sin dependencias externas) ───────────────────
// Lee pares KEY=VALUE ignorando comentarios y líneas vacías.
// Las credenciales sensibles van en Stockroom/.env (ya en .gitignore).
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.log('[.env] No encontrado:', envPath);
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  let loaded = 0;
  lines.forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) return;
    const key = m[1];
    const val = m[2].trim().replace(/^["']|["']$/g, ''); // quitar comillas opcionales
    if (!(key in process.env)) {
      process.env[key] = val;
      loaded++;
    }
  });
  console.log(`[.env] Cargadas ${loaded} variables desde ${envPath}`);
})();

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
  atomicWriteFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2));
}

loadConfig();

// ── App token (client_credentials) para endpoints públicos ───
let _appToken = null;
let _appTokenExpiry = 0;

async function getAppToken() {
  if (_appToken && Date.now() < _appTokenExpiry) return _appToken;
  const { client_id, client_secret } = config;
  if (!client_id || !client_secret) return null;
  try {
    const j = await mlOauthToken({ grant_type: 'client_credentials', client_id, client_secret });
    if (j.access_token) {
      _appToken = j.access_token;
      _appTokenExpiry = Date.now() + ((j.expires_in || 21600) - 300) * 1000;
      console.log('  ✓ App token obtenido');
      return _appToken;
    } else {
      console.log('  ✗ App token error:', JSON.stringify(j));
      return null;
    }
  } catch(e) { return null; }
}

// Invalidar app token al cambiar de cuenta
function resetAppToken() { _appToken = null; _appTokenExpiry = 0; }

// ── Auto-renovación de token ──────────────────────────────────
async function refreshAccessToken() {
  const { client_id, client_secret, refresh_token } = config;
  if (!client_id || !client_secret || !refresh_token) return false;
  try {
    const json = await mlOauthToken({ grant_type: 'refresh_token', client_id, client_secret, refresh_token });
    if (json.access_token) {
      config.access_token  = json.access_token;
      config.refresh_token = json.refresh_token || config.refresh_token;
      // Persistir expiración para evitar renovaciones innecesarias al reiniciar
      config.token_expiry  = Date.now() + ((json.expires_in || 21600) - 300) * 1000;
      saveConfig();
      console.log('  ✓ Token renovado automáticamente');
      return true;
    } else {
      console.log('  ✗ No se pudo renovar token:', JSON.stringify(json));
      return false;
    }
  } catch(e) { return false; }
}

// ── Persistencia de órdenes — PostgreSQL (migración completa) ─
// Las funciones JSON se mantienen solo como lectura de emergencia.
// TODO: eliminar cuando el sistema esté estable en producción.
function getOrdenesJSON() {
  try { return JSON.parse(fs.readFileSync(ORDENES_PATH, 'utf8')); }
  catch { return []; }
}

// Parsea el texto extraído de un PDF de Alibaba.
// Detecta automáticamente el formato:
//   · Recibo (Receipt_*.pdf): texto embebido, header "ItemQuantityUnit priceAmount"
//     → columnas mergeadas sin espacios: "N.00USD X.XXXXUSD X.XX" por item
//   · Contrato/OCR (TA_CONTRACT_*.pdf): tabla "USD X.XXXX /Pieces" por variante
// Retorna [{name, qty, raw}]
// ── Tienda Users — Auth de compradores ───────────────────────
//
// Almacenamiento: PostgreSQL (tabla users)
// Sesiones:       PostgreSQL (tabla tienda_sessions) — persisten al reiniciar
//                 Fallback en memoria si la DB no está disponible.
// Hashing:        crypto.pbkdf2Sync — 100k iteraciones SHA-512 (nativo, sin npm)
// Cookie:         wz_sid — HttpOnly, SameSite=Lax, Secure, 30 días
//
const TIENDA_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días

// Fallback en memoria para cuando la DB no responde
const _sessionFallback = new Map(); // wz_sid → { user_id, email, nombre, exp }

// JSON fallbacks (por si la DB no está disponible)
function getTiendaUsers() {
  try { return JSON.parse(fs.readFileSync(TIENDA_USERS_PATH, 'utf8')); }
  catch { return []; }
}
function saveTiendaUsers(users) {
  atomicWriteFileSync(TIENDA_USERS_PATH, JSON.stringify(users, null, 2));
}
async function getTiendaUserFromReq(req) {
  const sid = parseCookies(req).wz_sid;
  if (!sid) return null;
  try {
    const s = await db.getSession(sid);
    if (s) return s;
  } catch (_) {
    // DB no disponible — intentar fallback en memoria
    const s = _sessionFallback.get(sid);
    if (s) {
      if (Date.now() > s.exp) { _sessionFallback.delete(sid); return null; }
      return s;
    }
  }
  return null;
}
async function setTiendaSession(sid, data) {
  _sessionFallback.set(sid, data); // siempre actualizar fallback
  try { await db.createSession(sid, data); } catch (_) {}
}
async function deleteTiendaSession(sid) {
  _sessionFallback.delete(sid);
  try { await db.deleteSession(sid); } catch (_) {}
}
// Limpieza periódica de sesiones expiradas (cada hora)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _sessionFallback) if (now > v.exp) _sessionFallback.delete(k);
  db.cleanExpiredSessions().catch(() => {});
}, 60 * 60 * 1000);

// ── Email transaccional ───────────────────────────────────────
//
// Configuración en config.json (opcional — si no está, los emails se omiten silenciosamente):
// "email": {
//   "provider": "resend",          ← "resend" | "brevo" (Brevo usa igual endpoint de Resend-compatible)
//   "api_key":  "re_XXXXXX",
//   "from":     "WZMALLAS <noreply@wzmallas.com.ar>",
//   "admin_email": "contacto@wzmallas.com.ar"
// }
//
// Resend: https://resend.com — free 3000 emails/mes, sin NPM
// Brevo:  https://brevo.com  — free 300 emails/día
//
function sendEmail(opts) {
  return sendEmailWith(fullConfig.email, opts);
}


// ── MercadoPago Checkout — crear preferencia de pago ─────────

/**
 * Resuelve qué token de MP usar:
 *  1. config.mp_access_token  (recomendado: específico para checkout)
 *  2. config.access_token     (fallback: el de ML — solo funciona si la app tiene scope checkout)
 *
 * Modo sandbox vs producción: se controla con el flag explícito `config.mp_sandbox`.
 * (Antes detectábamos por prefijo "TEST-", pero MP unificó el formato y ya no es confiable.)
 */
function getMpToken() {
  return config.mp_access_token || config.access_token || null;
}

// Variante async: si no hay mp_access_token dedicado, el fallback es el token de ML,
// que expira cada ~6 h. Refrescarlo ANTES de llamar a MP evita los 401 intermitentes
// en polling, creación de preferencias y webhooks.
async function getMpTokenFresh() {
  if (config.mp_access_token) return config.mp_access_token;
  try { await refreshAccountToken(config); } catch (e) {}
  return config.access_token || null;
}

// ── Tasas de cuotas de MP ─────────────────────────────────────
// Las tasas de interés por cantidad de cuotas no dependen del monto, así que
// se cachean en memoria y se refrescan cada 12h. Se consultan con un monto
// de referencia (100.000) y un medio de pago genérico (master).
let _cuotasCache = { tasas: [], actualizado: 0 };
const CUOTAS_CACHE_MS = 12 * 60 * 60 * 1000;

async function getCuotasTasas() {
  const now = Date.now();
  if (_cuotasCache.tasas.length && (now - _cuotasCache.actualizado) < CUOTAS_CACHE_MS) {
    return _cuotasCache.tasas;
  }
  try {
    const accessToken = await getMpTokenFresh();
    if (!accessToken) return _cuotasCache.tasas;
    const data = await mpGetInstallments(100000, 'master', accessToken);
    const payerCosts = (data[0] && data[0].payer_costs) || [];
    const tasas = payerCosts.map(pc => ({ cuotas: pc.installments, tasa: pc.installment_rate }));
    if (tasas.length) _cuotasCache = { tasas, actualizado: now };
    return _cuotasCache.tasas;
  } catch (e) {
    console.error('[cuotas] Error obteniendo tasas de MP:', e.message);
    return _cuotasCache.tasas;
  }
}

/**
 * Verifica la firma x-signature de un webhook de MercadoPago.
 * Formato MP: "ts=<timestamp>,v1=<hmac>" + header x-request-id.
 * Manifest oficial: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * (cada parte se incluye solo si está presente).
 *
 * Si no hay secret configurado (config.mp_webhook_secret), devuelve true
 * (opt-in: la validación se activa al configurar el secret en config.json,
 * se obtiene en MP Panel → Tu aplicación → Webhooks → Clave secreta).
 */
// ── Stripe helpers ────────────────────────────────────────────
function getStripeConfig() {
  return fullConfig.stripe || {};
}

// ── Cupones — almacenados en Stockroom/tienda-cupones.json ────────
// (el checkout valida los cupones contra este archivo, vía getCupones())
const CUPONES_PATH = path.join(__dirname, 'tienda-cupones.json');

// Cupón trazable del soft launch (Fase 2): se reparte solo a clientes
// recurrentes de ML. El dashboard cuenta sus usos para medir el alcance.
const SOFT_LAUNCH_COUPON = 'BIENVENIDA10';

function getCupones() {
  try {
    const raw = JSON.parse(fs.readFileSync(CUPONES_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    // Cupones por defecto si no existe el archivo
    return [
      { code: 'WEB10',      type: 'percent', value: 10, label: '10% off — cupón web',           active: true },
      { code: 'WZMALLAS15', type: 'percent', value: 15, label: '15% off — descuento especial',  active: true },
      { code: 'ENVIO',      type: 'freeship', value: 0, label: 'Envío gratis',                  active: true },
    ];
  }
}

function saveCupones(list) {
  atomicWriteFileSync(CUPONES_PATH, JSON.stringify(list, null, 2));
}

// ── Guardar cupón de fidelidad para que sea válido en el checkout ──
async function guardarCuponFidelidad(ordenId) {
  const codigo = generarCuponFidelidad(ordenId);
  try {
    const list = getCupones();
    if (!list.find(c => c.code === codigo)) {
      list.push({
        code:      codigo,
        type:      'percent',
        value:     10,
        label:     `Cupón de fidelidad - Orden #${String(ordenId).slice(-8).toUpperCase()}`,
        active:    true,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
      saveCupones(list);
    }
    return codigo;
  } catch(e) {
    console.error('[mailer] Error guardando cupón fidelidad:', e.message);
    return codigo; // lo devolvemos igual aunque falle el guardado
  }
}

function isMpSandbox() {
  return config.mp_sandbox === true;
}

/** Resuelve la URL base de la tienda (para back_urls de MP). Respeta proxies (cloudflared). */
function getPublicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host  = req.headers['x-forwarded-host']  || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

/**
 * Polling de pagos MP — busca órdenes pendientes y consulta su estado en MP.
 * Actualiza ordenes.json y notifica por Telegram si cambió a approved/rejected.
 *
 * Solución pragmática: corre en local sin necesidad de exponer un webhook público.
 * Cuando la tienda esté en un servidor accesible, conviene migrar a webhook real.
 */
let _pollingInProgress = false;
async function pollPendingPayments() {
  if (_pollingInProgress) return { skipped: 'already_running' };
  _pollingInProgress = true;

  try {
    const accessToken = await getMpTokenFresh();
    if (!accessToken) return { error: 'no_mp_token' };

    const pending = await db.getOrdenesPendientesPago();

    if (pending.length === 0) {
      return { ok: true, checked: 0, updated: 0 };
    }

    let updated = 0;

    for (const orden of pending) {
      try {
        const pago = await mpSearchPaymentByExternalRef(orden.id, accessToken);
        if (!pago) continue; // El usuario todavía no inició el pago

        // Mapear estado de MP a estado de la orden (en español)
        let newStatus = orden.status; // 'pendiente_pago'
        if (pago.status === 'approved' || pago.status === 'authorized') newStatus = 'pagado';
        else if (pago.status === 'rejected' || pago.status === 'cancelled') newStatus = 'rechazado';
        else if (pago.status === 'refunded' || pago.status === 'charged_back') newStatus = 'reembolsado';
        // 'in_process'/'pending' → no cambia (sigue 'pendiente_pago')

        if (newStatus !== orden.status) {
          await db.updateOrdenStatus(orden.id, newStatus, {
            mp_payment_id:     pago.id,
            mp_payment_status: pago.status,
            mp_payment_amount: pago.transaction_amount,
            mp_payment_method: pago.payment_method_id,
          });
          updated++;

          const total   = orden.total ? `$${Number(orden.total).toLocaleString('es-AR')}` : '—';
          const cliente = orden.datos?.nombre || orden.datos?.email || 'Cliente';
          if (newStatus === 'pagado') {
            tgSend(`💰 <b>Pago aprobado</b> — ${total}\nOrden: <code>${orden.id}</code>\nCliente: ${cliente}\nMP payment: <code>${pago.id}</code>`).catch(()=>{});
            console.log(`  ✓ [polling] Orden ${orden.id}: pendiente_pago → pagado ($${pago.transaction_amount})`);
            // Notificación de stock por Telegram
            sendVentaTiendaNotification(orden).catch(() => {});
            // Email de pago confirmado al comprador (async)
            const emailPago = orden.datos?.email || orden.cliente?.email;
            if (emailPago) {
              sendEmail({
                to: emailPago,
                subject: `💳 Pago recibido · Orden #${String(orden.id).slice(-8).toUpperCase()} · WZMALLAS`,
                html: emailPagoConfirmado({ ...orden, total: pago.transaction_amount || orden.total }),
              }).then(r => {
                if (r.ok) console.log(`  ✓ [email] Pago confirmado enviado a ${emailPago}`);
                else if (!r.skipped) console.warn(`  ⚠ [email] Error enviando pago confirmado:`, r.error);
              });
            }
          } else if (newStatus === 'rechazado') {
            tgSend(`❌ <b>Pago rechazado</b>\nOrden: <code>${orden.id}</code>\nCliente: ${cliente}\nMotivo: ${pago.status_detail || '—'}`).catch(()=>{});
            console.log(`  ✗ [polling] Orden ${orden.id}: pendiente_pago → rechazado (${pago.status_detail})`);
          } else if (newStatus === 'reembolsado') {
            tgSend(`↩️ <b>Pago reembolsado</b>\nOrden: <code>${orden.id}</code>`).catch(()=>{});
          }
        } else {
          // Status sin cambio, pero guardar el mp_payment_id si es la primera vez
          if (!orden.mp_payment_id) {
            await db.updateOrdenStatus(orden.id, orden.status, {
              mp_payment_id:     pago.id,
              mp_payment_status: pago.status,
            });
          }
        }
      } catch(e) {
        // 401 = token inválido para TODAS las órdenes — cortar el loop y dejar
        // que el circuit breaker de afuera lo maneje (antes se logueaba una vez
        // por orden cada 30s sin abrir nunca el circuito).
        if (e.message && (e.message.includes('401') || e.message.toLowerCase().includes('invalid access token'))) throw e;
        console.warn(`  ⚠ [polling] Error orden ${orden.id}: ${e.message}`);
      }
    }

    return { ok: true, checked: pending.length, updated };

  } finally {
    _pollingInProgress = false;
  }
}

// Arranca el polling automático (cada 30s) con circuit breaker:
// Si el token MP falla, se silencia por 15 min para no saturar el event loop.
const POLLING_INTERVAL_MS = 30 * 1000;
let _mpCircuitOpenUntil = 0;
let _mpCircuitAlerted   = false;
setInterval(() => {
  if (Date.now() < _mpCircuitOpenUntil) return; // circuit abierto, saltear silenciosamente
  pollPendingPayments().catch(e => {
    const is401 = e.message && (e.message.includes('401') || e.message.includes('invalid access token'));
    if (is401) {
      _mpCircuitOpenUntil = Date.now() + 15 * 60 * 1000; // silenciar 15 min
      if (!_mpCircuitAlerted) {
        _mpCircuitAlerted = true;
        console.error('[polling] ⚠ Token MP inválido — polling pausado 15 min. Regenerarlo en https://www.mercadopago.com.ar/developers/panel/applications');
        tgSend('⚠️ <b>Token de MercadoPago inválido</b>\nEl polling de pagos está pausado y el checkout puede estar fallando.\nRevisar credenciales en el panel de MP.').catch(()=>{});
      }
    } else {
      console.error('[polling] uncaught:', e.message);
    }
  });
}, POLLING_INTERVAL_MS);
console.log(`✓ [MP] Polling de pagos pendientes activo (cada ${POLLING_INTERVAL_MS / 1000}s)`);

// ── Refresh de token por cuenta ──────────────────────────────
// Evita refrescos concurrentes para la misma cuenta
const _refreshInFlight = new Map();
// Caché en memoria de expiración por cuenta (se inicializa con token_expiry del config al arrancar)
const _acctTokenExpiry = new Map();
async function refreshAccountToken(acct) {
  if (!acct) return false;
  // Saltar si el token sigue vigente (verificar memoria primero, luego config persistido)
  const knownExpiry = _acctTokenExpiry.get(acct.id) || acct.token_expiry || 0;
  if (Date.now() < knownExpiry) return true;
  if (_refreshInFlight.has(acct.id)) return _refreshInFlight.get(acct.id);
  const client_id = acct.client_id || config.client_id;
  const client_secret = acct.client_secret || config.client_secret;
  const refresh_token = acct.refresh_token;
  if (!client_id || !client_secret || !refresh_token) return false;
  const p = mlOauthToken({ grant_type: 'refresh_token', client_id, client_secret, refresh_token })
    .then(tok => {
      if (tok.access_token) {
        acct.access_token = tok.access_token;
        if (tok.refresh_token) acct.refresh_token = tok.refresh_token;
        // Guardar expiración en memoria y en config para evitar renovaciones innecesarias
        const expiry = Date.now() + ((tok.expires_in || 21600) - 300) * 1000;
        _acctTokenExpiry.set(acct.id, expiry);
        acct.token_expiry = expiry;
        // Persistir en fullConfig.accounts (si el acct viene de ahi, ya lo mutamos por referencia)
        try { atomicWriteFileSync(CONFIG_PATH, JSON.stringify(fullConfig, null, 2)); } catch(e) {}
        console.log(`  ✓ Token renovado para cuenta "${acct.label || acct.id}"`);
        return true;
      } else {
        console.log(`  ✗ No se pudo renovar token de "${acct.label || acct.id}":`, JSON.stringify(tok));
        return false;
      }
    })
    .catch(() => false);
  _refreshInFlight.set(acct.id, p);
  try { return await p; }
  finally { _refreshInFlight.delete(acct.id); }
}

// Wrappers que auto-refrescan y reintentan una vez ante 401
async function mlGetAuth(acct, mlPath) {
  try {
    return await mlGet(mlPath, acct.access_token);
  } catch(e) {
    // ML a veces devuelve 400 con "Oops! Something went wrong" en vez de 401
    // cuando el token está vencido — forzar refresh igual
    const isOops = typeof e.message === 'string' &&
      (e.message.includes('Oops') || e.message.toLowerCase().includes('invalid_token'));
    if (e.status === 401 || e.status === 403 || (e.status === 400 && isOops)) {
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

// PUT con verificación: si el PUT falla por timeout/red/5xx (NO por 4xx),
// ML muy probablemente igual aplicó el cambio aunque la respuesta tardó y el
// socket expiró. Reconsulta el item con un GET y, si el stock total coincide
// con lo esperado, lo da por aplicado. Evita el "hizo el cambio pero figura
// como fallido". Devuelve { applied:true, recovered:bool }.
async function mlPutVerified(acct, itemId, putBody, expectedTotal) {
  try {
    await mlPutAuth(acct, '/items/' + itemId, putBody);
    return { applied: true, recovered: false };
  } catch(e) {
    // 4xx = rechazo real de ML (datos inválidos, permisos) → no es recuperable
    if (e.status && e.status >= 400 && e.status < 500) throw e;
    // timeout / 5xx / error de red → verificar si igual se aplicó
    if (expectedTotal == null) throw e;
    try {
      const data = await mlGetAuth(acct, '/items/' + itemId);
      const vars = data.variations || [];
      const total = vars.length
        ? vars.reduce((s, v) => s + (v.available_quantity || 0), 0)
        : (data.available_quantity || 0);
      if (total === expectedTotal) {
        console.log(`  ↻ [tg] PUT de ${itemId} expiró pero el cambio SÍ se aplicó (verificado: ${total} u.)`);
        return { applied: true, recovered: true };
      }
    } catch(_) { /* la verificación también falló → propagar el error original */ }
    throw e;
  }
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

// ── Correo Argentino — cache de autenticación ────────────────
let _caAuth = null; // { token, customerId, base, expiry }

async function getCorreoAuth() {
  if (_caAuth && Date.now() < _caAuth.expiry) return _caAuth;
  const ca = fullConfig.correo_argentino || {};
  // Credenciales: primero config.json, luego variables de entorno (.env)
  const email    = ca.email    || process.env.CA_EMAIL    || null;
  const password = ca.password || process.env.CA_PASSWORD || null;
  if (!email || !password) return null;

  const base = (ca.production
    ? 'https://api.correoargentino.com.ar'
    : 'https://apitest.correoargentino.com.ar') + '/micorreo/v1';

  try {
    // Paso 1: Bearer token via Basic Auth — POST /token sin body
    const basicCred = Buffer.from(`${email}:${password}`).toString('base64');
    console.log(`[correo] Auth intent: URL ${base}/token, email="${email}", credential="${basicCred.slice(0, 20)}..."`);
    const tokenRes  = await httpsRequestJson(`${base}/token`, 'POST', null, {
      'Authorization': `Basic ${basicCred}`,
    });
    const token = tokenRes.token || tokenRes.access_token || tokenRes.accessToken;
    if (!token) throw new Error('No se obtuvo token de Correo Argentino');

    // Paso 2: customerId — usar el de config/env o buscar vía /users/validate
    let customerId = ca.customer_id || process.env.CA_CUSTOMER_ID || null;
    if (!customerId) {
      const vRes = await httpsRequestJson(`${base}/users/validate`, 'POST',
        { email, password },
        { 'Authorization': `Bearer ${token}` }
      );
      customerId = vRes.customerId || vRes.customer_id || vRes.id || null;
    }

    // El token de MiCorreo dura varias horas; caché de 50 min es seguro
    _caAuth = { token, customerId, base, expiry: Date.now() + 50 * 60 * 1000 };
    console.log('[correo] Auth OK — customerId:', customerId);
    return _caAuth;
  } catch(e) {
    console.error('[correo] Auth error:', e.message, e.status || '');
    _caAuth = null;
    return null;
  }
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
const AUTH_CFG = loadAuthConfig(AUTH_PATH);

// Auth se desactiva si:
//   - auth.json no existe / está corrupto
//   - no hay password (o quedó el placeholder)
//   - hay un flag explícito "enabled": false (uso temporal, conserva la password
//     en el archivo para reactivar después)
const AUTH_ENABLED = !!(
  AUTH_CFG &&
  AUTH_CFG.enabled !== false &&
  AUTH_CFG.password &&
  AUTH_CFG.password !== 'PONE_UNA_CONTRASEÑA_LARGA_ACA'
);
if (!AUTH_ENABLED) {
  const reason = !AUTH_CFG
    ? 'auth.json ausente'
    : AUTH_CFG.enabled === false
      ? 'enabled: false en auth.json (override explícito)'
      : 'sin contraseña configurada';
  console.log(`  ⚠ AUTH DESHABILITADA (${reason}). NO exponer este servidor a internet.`);
}

const SESSIONS = new Map(); // sid -> { exp }

// ── Persistencia de sesiones en disco ────────────────────────
// Sobrevive reinicios de PM2/Node. Solo guardamos sid→exp (sin datos sensibles extras).
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
(function _loadSessions() {
  const restored = loadSessions(SESSIONS_FILE);
  let loaded = 0;
  for (const [k, v] of Object.entries(restored)) { SESSIONS.set(k, v); loaded++; }
  if (loaded) console.log(`  ✓ Sesiones admin restauradas: ${loaded}`);
})();
let _sessionSaveTimer = null;
function _saveSessions() {
  clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(() => {
    const now = Date.now();
    const out = {};
    for (const [k, v] of SESSIONS) if (v.exp > now) out[k] = v;
    saveSessions(SESSIONS_FILE, out);
  }, 500); // debounce 500ms para no escribir en cada request
}

const _loginAttempts = new Map(); // ip -> { count, since } — rate limiting login
const _reviewsCache = new Map(); // `${itemId}_${offset}_${limit}` -> { data, expiry }
let _statsCache = null;          // { data, expiry } — global stats agregadas
let _statsRefreshRunning = false;
async function _refreshStatsCache() {
  if (_statsRefreshRunning) return;
  _statsRefreshRunning = true;
  try {
    const products = getProductCache();
    const top = [...products]
      .filter(p => (p.sold_quantity || 0) > 0 && /^ML[A-Z]\d+$/.test(p.id))
      .sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0))
      .slice(0, 40);
    let totalReviews = 0, weightedRatingSum = 0, totalSold = 0, productsWithReviews = 0;
    const CONCURRENCY = 5;
    for (let i = 0; i < top.length; i += CONCURRENCY) {
      const batch = top.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (p) => {
        totalSold += (p.sold_quantity || 0);
        try {
          // Intentar con la cuenta activa; si falla por permisos (403) probar las demás
          let r;
          const allAccts = (fullConfig.accounts || [config]);
          for (const acct of allAccts) {
            try { r = await mlGetAuth(acct, `/reviews/item/${p.id}?offset=0&limit=1`); break; }
            catch(e2) { if (e2.status !== 403) throw e2; /* 403 = sin permiso, probar otra */ }
          }
          if (!r) return;
          const cnt = r.paging?.total || 0;
          const avg = r.rating_average || 0;
          if (cnt > 0 && avg > 0) { totalReviews += cnt; weightedRatingSum += avg * cnt; productsWithReviews++; }
        } catch(e) { /* ignorar item con error */ }
      }));
    }
    const avgRating = totalReviews > 0 ? +(weightedRatingSum / totalReviews).toFixed(1) : 0;
    const data = { rating_average: avgRating, total_reviews: totalReviews, total_sold: totalSold,
      products_sampled: top.length, products_with_reviews: productsWithReviews, generated_at: new Date().toISOString() };
    _statsCache = { data, expiry: Date.now() + 6 * 60 * 60 * 1000 };
    console.log(`[tienda/stats] bg refresh: avg=${avgRating} reviews=${totalReviews} sold=${totalSold}`);
  } catch(e) {
    console.error('[tienda/stats] Error en bg refresh:', e.message);
  } finally {
    _statsRefreshRunning = false;
  }
}
const _contactRateLimit = new Map(); // ip -> [timestamp1, timestamp2...]
const _newsletterRL     = new Map(); // ip -> [timestamp1, timestamp2...] — máx 5 altas/hora
const _ordenRateLimit   = new Map(); // ip -> [timestamp1, timestamp2...] — máx 10 órdenes/hora
const _tiendaLoginRL    = new Map(); // ip -> { count, since } — rate limit login tienda clientes
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

// ── Rate-limit persistence (survives PM2 restarts) ──────────────────────────
const RATE_LIMIT_FILE = path.join(__dirname, 'rate_limits.json');
let _rlSaveTimer = null;

function _loadRateLimits() {
  const { login, contact, orden } = loadRateLimits(RATE_LIMIT_FILE);
  for (const [ip, entry] of Object.entries(login)) _loginAttempts.set(ip, entry);
  for (const [ip, ts] of Object.entries(contact)) _contactRateLimit.set(ip, ts);
  for (const [ip, ts] of Object.entries(orden)) _ordenRateLimit.set(ip, ts);
  if (Object.keys(login).length || Object.keys(contact).length || Object.keys(orden).length) {
    console.log(`[rate-limit] Loaded from disk: login=${_loginAttempts.size} contact=${_contactRateLimit.size} orden=${_ordenRateLimit.size}`);
  }
}

function _saveRateLimits() {
  // Debounce: espera 200 ms antes de escribir (agrupa ráfagas)
  if (_rlSaveTimer) return;
  _rlSaveTimer = setTimeout(() => {
    _rlSaveTimer = null;
    saveRateLimits(RATE_LIMIT_FILE, {
      login:   Object.fromEntries(_loginAttempts),
      contact: Object.fromEntries(_contactRateLimit),
      orden:   Object.fromEntries(_ordenRateLimit),
    });
  }, 200);
}

// Limpiar entradas expiradas + flush periódico cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _loginAttempts)   { if (now - e.since > 15 * 60 * 1000) _loginAttempts.delete(ip); }
  for (const [ip, ts] of _contactRateLimit) { const v = ts.filter(t => now - t < 3600 * 1000); if (!v.length) _contactRateLimit.delete(ip); else _contactRateLimit.set(ip, v); }
  for (const [ip, ts] of _ordenRateLimit)   { const v = ts.filter(t => now - t < 3600 * 1000); if (!v.length) _ordenRateLimit.delete(ip); else _ordenRateLimit.set(ip, v); }
  _saveRateLimits();
}, 5 * 60 * 1000);

_loadRateLimits(); // cargar al inicio

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
function isTrustedIP(req) {
  const ip = getClientIP(req);
  if (!ip) return false;
  // Mismo equipo — siempre de confianza
  if (ip === '127.0.0.1' || ip === '::1') return true;
  // IP explícita en lista blanca de auth.json
  if (TRUSTED_IPS.has(ip)) return true;
  // Red local — si trust_local_network: true en auth.json, toda la LAN entra sin password.
  // Seguro para uso doméstico; desactivar si el servidor está en una red compartida.
  if (AUTH_CFG && AUTH_CFG.trust_local_network) {
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip)) return true;
  }
  return false;
}
// Paths que no requieren auth
const AUTH_EXEMPT = new Set([
  '/login', '/login.html', '/logout',
  '/sw.js', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/icon.svg',
  '/oauth/callback',
]);
function isAuthExempt(pathname) {
  return AUTH_EXEMPT.has(pathname)
    || pathname === '/tienda'
    || pathname.startsWith('/tienda/')
    // Archivos estáticos subidos (imágenes de productos propios, videos)
    || pathname.startsWith('/uploads/')
    // /api/tienda/* es público — EXCEPTO /sync y /admin/* (requieren auth del admin)
    || (pathname.startsWith('/api/tienda/')
        && pathname !== '/api/tienda/sync'
        && !pathname.startsWith('/api/tienda/admin/'));
}

// Limpieza periódica de sesiones expiradas + persistencia
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of SESSIONS) { if (now > v.exp) { SESSIONS.delete(k); changed = true; } }
  if (changed) _saveSessions();
}, 60 * 60 * 1000);

// ── Cache en memoria para el JSON de productos (evita leer disco en cada request) ─
// Se invalida automáticamente 30s después de la última escritura (sync).
// La función getProductCache se declara aquí (scope global) para no recrearla
// en cada request handler.
let _productCache     = null;
let _productCacheTime = 0;
const PRODUCT_CACHE_TTL = 30 * 1000; // 30 segundos

function getProductCache() {
  const now = Date.now();
  if (_productCache && now - _productCacheTime < PRODUCT_CACHE_TTL) {
    return _productCache;
  }
  const candidates = [
    path.join(__dirname, 'cache', 'items.json'),
    path.join(__dirname, 'items.json'),
  ];
  let items = [];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw))       { items = raw;       break; }
      if (Array.isArray(raw.items)) { items = raw.items; break; }
    } catch { /* siguiente candidato */ }
  }
  // Producto de prueba — solo habilitado con TEST_PRODUCT=true (nunca en producción)
  if (process.env.TEST_PRODUCT === 'true') {
    items = [{
      id: 'WZ-TEST-PAGO',
      title: '⚡ Producto de prueba — pago $1 (testing MercadoPago)',
      price: 1,
      available_quantity: 999,
      sold_quantity: 0,
      thumbnail: 'https://http2.mlstatic.com/D_984624-MLA78002696023_072024-O.webp',
      pictures: [{
        id: 'wz-test-img',
        secure_url: 'https://http2.mlstatic.com/D_984624-MLA78002696023_072024-O.webp',
        url: 'https://http2.mlstatic.com/D_984624-MLA78002696023_072024-O.webp',
      }],
      variations: [], category_id: '', attributes: [],
    }, ...items];
  }
  _productCache     = items;
  _productCacheTime = now;
  return items;
}

// Invalidar cache de productos al hacer sync
function invalidateProductCache() {
  _productCache     = null;
  _productCacheTime = 0;
}

// Helpers para leer campos nativos de ML (usados en varios endpoints de tienda)
// ═════════════════════════════════════════════════════════════════
//  PRODUCTOS PROPIOS (no-ML) — alta manual / importación WhatsApp
//  Permiten cargar productos que el proveedor ofrece pero que NO
//  están publicados en MercadoLibre (celulares, consolas, etc.).
//  Se modelan como "ítems" compatibles con el resto del catálogo
//  (mismo shape que un item de ML) para reusar listado/detalle/
//  buscador/orden/paginación sin duplicar lógica.
// ═════════════════════════════════════════════════════════════════
// ── Instanciar routers (ctx definido aquí, después de todas las funciones) ──
// ctx expone las funciones de server.js que los routers necesitan.
// fullConfig/config/lastVincCheck son getters para capturar el valor actual.
const _routerCtx = {
  mlGetAuth, mlPutAuth, mlPostAuth, refreshAccountToken,
  fullConfig: () => fullConfig, config: () => config,
  getProductCache, invalidateProductCache,
  checkStockChanges, buildVariantChangesFromMismatches,
  getLastVincCheck: () => lastVincCheck,
};
const _preguntasRouter    = _mkHandlePreguntas(_routerCtx);
const _backupRouter       = _mkHandleBackup(_routerCtx);
const _alibabaRouter      = _mkHandleAlibaba(_routerCtx);
const _vincRouter         = _mkHandleVinculaciones(_routerCtx);
const _flexRouter         = _mkHandleFlex(_routerCtx);
const _despachosRouter    = _mkHandleDespachos(_routerCtx);

// ── Servidor ──────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Security headers on every response
  const ext_   = path.extname(pathname).toLowerCase();
  const isHtml = pathname === '/' || ext_ === '.html';
  securityHeaders(res, isHtml, getFileType(ext_), !!parsed.query.v);

  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Cloudflare isolation: solo /tienda/ es público en internet ─
  // Detectar tráfico público con tres señales (cualquiera es suficiente):
  //  1. cf-connecting-ip → request pasó por el Cloudflare Tunnel
  //  2. x-forwarded-for  → proxy/LB delante del servidor
  //  3. Host wzmallas.com → petición usando el dominio público (incluso desde LAN con
  //     split-DNS local: el celular en la misma red que ve wzmallas.com → local IP
  //     pero sigue usando el Host: wzmallas.com, por eso se lo atrapa aquí).
  // El panel de stockroom sólo es accesible usando la IP local directamente (ej: 192.168.0.57:3000).
  const viaCloudflare = !!(
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']  ||
    /wzmallas\.com/i.test(req.headers['host'] || '')
  );
  if (viaCloudflare) {
    const isPublic =
      pathname === '/' ||
      pathname === '/tienda' ||
      pathname.startsWith('/tienda/') ||
      pathname.startsWith('/api/tienda/') ||
      // Archivos estáticos subidos (imágenes y videos de productos propios)
      pathname.startsWith('/uploads/productos-propios/') ||
      pathname.startsWith('/uploads/videos/') ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml';
    if (!isPublic) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // Redirigir raíz a la tienda
    if (pathname === '/') {
      res.writeHead(302, { 'Location': '/tienda/' });
      res.end();
      return;
    }
  }

  // ── robots.txt ─────────────────────────────────────────────────
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end([
      'User-agent: *',
      'Allow: /tienda/',
      'Disallow: /api/', 'Disallow: /api-as/', 'Disallow: /api-public/',
      'Disallow: /login', 'Disallow: /analytics.html', 'Disallow: /cobros.html',
      'Disallow: /despachos.html', 'Disallow: /publicaciones.html',
      'Disallow: /vinculaciones.html', 'Disallow: /migracion.html',
      'Disallow: /tienda-admin.html', 'Disallow: /tienda-ordenes.html',
      '', 'Sitemap: https://wzmallas.com/sitemap.xml',
    ].join('\n'));
    return;
  }

  // ── sitemap.xml dinámico ───────────────────────────────────────
  // Se sirve también en /tienda/sitemap.xml (alias) porque la propiedad
  // verificada en Google Search Console está scopeada a /tienda/, y GSC
  // exige que el sitemap quede dentro del path de la propiedad verificada.
  if (pathname === '/sitemap.xml' || pathname === '/tienda/sitemap.xml') {
    (async () => {
      try {
        const products = getProductCache();
        const base = 'https://wzmallas.com/tienda';
        const now  = new Date().toISOString().slice(0, 10);
        const staticUrls = [
          { loc: base + '/',              priority: '1.0', freq: 'daily'   },
          { loc: base + '/catalogo.html', priority: '0.9', freq: 'daily'   },
        ];
        const productUrls = products.slice(0, 2000).map(p => ({
          loc: `${base}/producto.html?id=${encodeURIComponent(p.id)}`,
          priority: (p.sold_quantity || 0) > 50 ? '0.8' : '0.6',
          freq: 'weekly',
        }));
        const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...[...staticUrls, ...productUrls].map(u =>
            `  <url><loc>${u.loc}</loc><lastmod>${now}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`
          ), '</urlset>'].join('\n');
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        res.end(xml);
      } catch(e) { res.writeHead(500); res.end('Error'); }
    })();
    return;
  }

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

      // Rate limiting: máx 10 intentos fallidos por IP en 15 minutos
      const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const now = Date.now();
      const WINDOW = 15 * 60 * 1000;
      const MAX_ATTEMPTS = 10;
      const entry = _loginAttempts.get(clientIp) || { count: 0, since: now };
      if (now - entry.since > WINDOW) { entry.count = 0; entry.since = now; }
      if (entry.count >= MAX_ATTEMPTS) {
        const wait = Math.ceil((WINDOW - (now - entry.since)) / 60000);
        return setTimeout(() => json(res, 429, { error: `Demasiados intentos. Esperá ${wait} min.` }), 1000);
      }

      if (!timingSafeEqStr(body.password || '', AUTH_CFG.password)) {
        entry.count++;
        _loginAttempts.set(clientIp, entry);
        _saveRateLimits();
        // pequeño delay anti-bruteforce
        return setTimeout(() => json(res, 401, { error: 'invalid_password' }), 800);
      }
      // Login exitoso: resetear contador
      _loginAttempts.delete(clientIp);
      _saveRateLimits();
      const sid = makeSid();
      SESSIONS.set(sid, { exp: Date.now() + SESSION_TTL });
      _saveSessions();
      res.setHeader('Set-Cookie', `sr_sid=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_TTL/1000}; SameSite=Strict${cookieSecure(req)}`);
      json(res, 200, { ok: true });
    });
    return;
  }
  if (pathname === '/logout') {
    const sid = parseCookies(req).sr_sid;
    if (sid) { SESSIONS.delete(sid); _saveSessions(); }
    res.setHeader('Set-Cookie', `sr_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${cookieSecure(req)}`);
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

  // ══════════════════════════════════════════════════════════════
  // RUTAS API TIENDA WEB  (/api/tienda/*)
  // Estas rutas van ANTES del proxy ML para que no sean interceptadas.
  // ══════════════════════════════════════════════════════════════
  if (pathname.startsWith('/api/tienda/')) {
    res.setHeader('Content-Type', 'application/json');

    // getProductCache, mlStock, mlCat, mlImg → definidos en scope global (arriba del server)

    // ── GET /api/tienda/productos ────────────────────────────
    if (pathname === '/api/tienda/productos' && req.method === 'GET') {
      (async () => { try {
      const params  = new URL(req.url, 'http://localhost').searchParams;

      // Aplicar capa de personalización (overrides admin Tienda):
      // oculta los productos marcados "oculto" y mergea título/descripción/
      // imagen de portada/video/destacado custom sobre el ítem de ML.
      let overridesMap = {};
      try { overridesMap = await db.getAllProductOverrides(); } catch {}
      let productos = getProductCache()
        .filter(p => !(overridesMap[p.id] && overridesMap[p.id].oculto))
        .map(p => applyProductOverride(p, overridesMap[p.id]));

      // Mezclar productos propios (no-ML, alta manual / proveedor) — solo
      // los activos se muestran al público. Conviven con el catálogo de ML
      // porque tienen el mismo "shape" de ítem (ver localProductoToItem).
      try {
        const propios = await db.getProductosPropios({ soloActivos: true });
        productos = productos.concat(propios.map(localProductoToItem));
      } catch {}

      // Filtro por categoría tienda — mlCat() usa wz_categoria_fija para productos propios
      // y regex sobre título para productos de ML
      const cat = params.get('cat');
      if (cat) productos = productos.filter(p => mlCat(p) === cat);

      // Búsqueda semántica — sinónimos + fuzzy matching
      const q = params.get('q');
      if (q) {
        const SINONIMOS = {
          'pulsera':     ['malla','correa'],
          'correa':      ['malla'],
          'banda':       ['malla','correa'],
          'reloj':       ['watch','smartwatch'],
          'smartwatch':  ['watch'],
          'iwatch':      ['apple watch'],
          'serie':       ['series'],
          'funda':       ['carcasa','cover','protector'],
          'carcasa':     ['funda','cover'],
          'cover':       ['funda','carcasa'],
          'vidrio':      ['templado','protector'],
          'screen':      ['protector','templado'],
          'templado':    ['vidrio','protector pantalla'],
          'bumper':      ['protector','bordes'],
          'cuero':       ['cuero','leather'],
          'silicona':    ['silicona','goma','rubber'],
          'milanese':    ['iman','imán','metal','acero'],
          'iman':        ['milanese','metal','acero'],
          'acero':       ['metal','inoxidable','milanese'],
          'nylon':       ['tela','sport','deportiva'],
          'sport':       ['deportiva','nylon'],
          'iphone':      ['iphone','magsafe'],
          'magsafe':     ['iphone','magsafe'],
          'samsung':     ['samsung','galaxy'],
          'galaxy':      ['samsung'],
          'xiaomi':      ['xiaomi','redmi'],
          'redmi':       ['xiaomi'],
          'huawei':      ['huawei','honor'],
          'garmin':      ['garmin','vivoactive'],
        };
        // Expandir la query con sinónimos
        const lq    = q.toLowerCase().trim();
        const words = lq.split(/\s+/);
        const expanded = new Set(words);
        words.forEach(w => { (SINONIMOS[w] || []).forEach(s => s.split(' ').forEach(sw => expanded.add(sw))); });
        const terms = [...expanded];
        // Score: cuántos términos aparecen en el título
        const scored = productos.map(p => {
          const title = (p.title || '').toLowerCase();
          const hits  = terms.filter(t => title.includes(t)).length;
          // Bonus si el título incluye la query original completa
          const exact = title.includes(lq) ? 2 : 0;
          return { p, score: hits + exact };
        }).filter(x => x.score > 0);
        scored.sort((a, b) => b.score - a.score);
        productos = scored.map(x => x.p);
      }

      // Filtro por precio
      const precioMin = parseFloat(params.get('precio_min'));
      const precioMax = parseFloat(params.get('precio_max'));
      if (!isNaN(precioMin)) productos = productos.filter(p => (p.price || 0) >= precioMin);
      if (!isNaN(precioMax)) productos = productos.filter(p => (p.price || 0) <= precioMax);

      // Orden — usa campos nativos ML
      const orden = params.get('orden') || params.get('sort') || '';
      if (orden === 'precio_asc'  || orden === 'precio-asc')
        productos = [...productos].sort((a, b) => (a.price || 0) - (b.price || 0));
      else if (orden === 'precio_desc' || orden === 'precio-desc')
        productos = [...productos].sort((a, b) => (b.price || 0) - (a.price || 0));
      else if (orden === 'vendidos' || orden === 'bestsellers')
        productos = [...productos].sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0));

      // Paginación
      const limit = parseInt(params.get('limit')) || 50;
      const page  = parseInt(params.get('page'))  || 1;
      const total = productos.length;
      const paged = productos.slice((page - 1) * limit, page * limit);

      // Filtrar campos sensibles y campos pesados/no usados por el listado
      // antes de enviar al cliente público. El detalle completo (PDP) usa
      // /api/tienda/productos/:id, que no pasa por este recorte.
      const STRIP_FIELDS = ['seller_address','seller_contact','geolocation','coverage_areas',
        'seller_id','official_store_id','inventory_id','user_product_id','warnings',
        'deal_ids','differential_pricing','item_relations','non_mercado_pago_payment_methods',
        'attributes','sale_terms','tags','channels','health','catalog_listing',
        'seller_custom_field','international_delivery_mode','automatic_relist',
        'parent_item_id','domain_id','catalog_product_id','sub_status','warranty',
        'listing_source','start_time','stop_time','end_time','expiration_time',
        'date_created','last_updated','buying_mode','listing_type_id','site_id',
        'family_name','condition','location','shipping','descriptions','video_id',
        'accepts_mercadopago','thumbnail_id','base_price','original_price','currency_id'];
      const safePaged = paged.map(p => {
        const out = { ...p };
        for (const f of STRIP_FIELDS) delete out[f];
        return out;
      });

      res.writeHead(200);
      res.end(JSON.stringify({ productos: safePaged, total, page, limit }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── GET /api/tienda/cuotas  (público) ────────────────────
    // Tasas de interés por cantidad de cuotas, según la cuenta real de MP
    // (cacheadas ~12h). El frontend las usa para mostrar "X cuotas de $Y"
    // con el monto real (incluyendo interés), no como referencia falsa.
    if (pathname === '/api/tienda/cuotas' && req.method === 'GET') {
      (async () => {
        const tasas = await getCuotasTasas();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tasas }));
      })();
      return;
    }

    // ── GET /api/tienda/categorias  (público) ────────────────
    // Devuelve las categorías activas para la tienda pública (sin auth).
    // Equivale al GET de /api/tienda/admin/categorias pero accesible sin sesión.
    if (pathname === '/api/tienda/categorias' && req.method === 'GET') {
      (async () => { try {
        const [cats, counts] = await Promise.all([
          db.getCategorias(),
          db.countProductosByCategoria(),
        ]);
        const data = cats
          .filter(c => c.activa)
          .map(c => ({
            id: c.id, slug: c.slug, label: c.label, emoji: c.emoji || '',
            orden: c.orden,
            productos_activos: (counts[c.slug] || {}).activos || 0,
          }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ categorias: data }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } })();
      return;
    }

    // ── GET /api/tienda/productos/:id/descripcion ─────────────
    // Devuelve la descripción plain_text de ML (cacheada 24h en memoria)
    if (pathname.match(/^\/api\/tienda\/productos\/[^/]+\/descripcion$/) && req.method === 'GET') {
      const itemId = pathname.split('/')[4];
      (async () => {
        try {
          const raw = await mlGetAuth(config, `/items/${itemId}/description`);
          const txt = (raw.plain_text || raw.text || '').trim();
          res.writeHead(200);
          res.end(JSON.stringify({ descripcion: txt }));
        } catch(e) {
          res.writeHead(200);
          res.end(JSON.stringify({ descripcion: '' }));
        }
      })();
      return;
    }

    // ── GET /api/tienda/productos/:id ────────────────────────
    if (pathname.match(/^\/api\/tienda\/productos\/[^/]+$/) && req.method === 'GET') {
      const id    = pathname.split('/').pop();
      (async () => { try {
      // Producto propio (no-ML) — vive en su propia tabla
      if (esIdProductoPropio(id)) {
        const lp = await db.getProductoPropioById(id);
        if (!lp || !lp.activo) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Producto no encontrado' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ producto: localProductoToItem(lp) }));
        return;
      }
      const todos = getProductCache();
      const prod  = todos.find(p => p.id === id);
      if (!prod) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Producto no encontrado' }));
        return;
      }
      let ov = null;
      try { ov = await db.getProductOverride(id); } catch {}
      if (ov && ov.oculto) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Producto no encontrado' }));
        return;
      }
      const safeProd = applyProductOverride(prod, ov);
      res.writeHead(200);
      res.end(JSON.stringify({ producto: safeProd }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── GET /api/tienda/categorias ───────────────────────────
    if (pathname === '/api/tienda/categorias' && req.method === 'GET') {
      (async () => {
      let todos = getProductCache();
      try {
        const propios = await db.getProductosPropios({ soloActivos: true });
        todos = todos.concat(propios.map(localProductoToItem));
      } catch {}
      const cats  = {};
      todos.forEach(item => {
        const key = mlCat(item);
        if (!cats[key]) cats[key] = { nombre: key, img: mlImg(item), count: 0 };
        cats[key].count++;
      });
      res.writeHead(200);
      res.end(JSON.stringify({ categorias: Object.values(cats) }));
      })();
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // ADMIN — Productos ABM (capa de personalización / overrides)
    // Estas rutas no filtran campos sensibles porque solo las usa
    // el panel admin (localhost-only, ver server config de estáticos).
    // ══════════════════════════════════════════════════════════════

    // ── GET /api/tienda/admin/productos ──────────────────────
    // Lista combinada: cache de ML + overrides propios. Para la
    // tabla del ABM — incluye filtros simples y paginación.
    if (pathname === '/api/tienda/admin/productos' && req.method === 'GET') {
      (async () => { try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const overridesMap = await db.getAllProductOverrides();

        let productos = getProductCache().map(p => {
          const ov = overridesMap[p.id] || null;
          return {
            id:                 p.id,
            title:              p.title,
            price:              p.price,
            available_quantity: p.available_quantity,
            sold_quantity:      p.sold_quantity,
            status:             p.status,
            thumbnail:          mlImg(p),
            categoria:          mlCat(p),
            override: ov ? {
              titulo_custom:      ov.titulo_custom      || '',
              descripcion_custom: ov.descripcion_custom || '',
              imagen_portada_url: ov.imagen_portada_url || '',
              video_url:          ov.video_url          || '',
              video_fuente:       ov.video_fuente       || '',
              video_thumb_url:    ov.video_thumb_url    || '',
              destacado:          !!ov.destacado,
              oculto:             !!ov.oculto,
              notas_admin:        ov.notas_admin        || '',
            } : null,
          };
        });

        const q = (params.get('q') || '').trim().toLowerCase();
        if (q) productos = productos.filter(p =>
          p.id.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));

        const filtro = params.get('filtro');
        if (filtro === 'destacados')      productos = productos.filter(p => p.override?.destacado);
        else if (filtro === 'ocultos')        productos = productos.filter(p => p.override?.oculto);
        else if (filtro === 'personalizados') productos = productos.filter(p => p.override);
        else if (filtro === 'con_video')      productos = productos.filter(p => p.override?.video_url);

        const limit = parseInt(params.get('limit')) || 50;
        const page  = parseInt(params.get('page'))  || 1;
        const total = productos.length;
        const paged = productos.slice((page - 1) * limit, page * limit);

        res.writeHead(200);
        res.end(JSON.stringify({ productos: paged, total, page, limit }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── GET /api/tienda/admin/productos/:id ───────────────────
    // Detalle: ítem completo de ML + su override (si existe).
    if (pathname.match(/^\/api\/tienda\/admin\/productos\/[^/]+$/) && req.method === 'GET') {
      const id = pathname.split('/').pop();
      (async () => { try {
        const prod = getProductCache().find(p => p.id === id);
        if (!prod) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Producto no encontrado' }));
          return;
        }
        const ov = await db.getProductOverride(id);
        res.writeHead(200);
        res.end(JSON.stringify({ producto: prod, override: ov || null }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── PUT /api/tienda/admin/productos/:id ───────────────────
    // Guarda/actualiza los overrides. Body JSON con cualquier
    // subconjunto de los campos personalizables.
    if (pathname.match(/^\/api\/tienda\/admin\/productos\/[^/]+$/) && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      readBody(req).then(async (raw) => { try {
        const prod = getProductCache().find(p => p.id === id);
        if (!prod) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Producto no encontrado' }));
          return;
        }
        let data;
        try { data = JSON.parse(raw); } catch { data = {}; }

        const clean = (s, max) => {
          const v = String(s == null ? '' : s).replace(/<script[\s\S]*?<\/script>/gi, '').trim().slice(0, max);
          return v || null;
        };
        const fields = {};
        if (data.titulo_custom      !== undefined) fields.titulo_custom      = clean(data.titulo_custom, 200);
        if (data.descripcion_custom !== undefined) fields.descripcion_custom = clean(data.descripcion_custom, 5000);
        if (data.imagen_portada_url !== undefined) fields.imagen_portada_url = clean(data.imagen_portada_url, 1000);
        if (data.video_url          !== undefined) fields.video_url          = clean(data.video_url, 1000);
        if (data.video_fuente       !== undefined) fields.video_fuente       = clean(data.video_fuente, 30);
        if (data.video_thumb_url    !== undefined) fields.video_thumb_url    = clean(data.video_thumb_url, 1000);
        if (data.notas_admin        !== undefined) fields.notas_admin        = clean(data.notas_admin, 2000);
        if (data.destacado          !== undefined) fields.destacado          = !!data.destacado;
        if (data.oculto             !== undefined) fields.oculto             = !!data.oculto;

        const saved = await db.setProductOverride(id, fields);
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, override: saved }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: 'bad_request', message: e.message }));
      });
      return;
    }

    // ── DELETE /api/tienda/admin/productos/:id/override ───────
    // Borra toda la personalización — el producto vuelve a verse
    // tal cual viene de ML.
    if (pathname.match(/^\/api\/tienda\/admin\/productos\/[^/]+\/override$/) && req.method === 'DELETE') {
      const id = pathname.split('/')[5];
      (async () => { try {
        const ov = await db.getProductOverride(id);
        if (ov?.video_fuente === 'upload' && ov.video_url) {
          try { fs.unlinkSync(path.join(__dirname, ov.video_url.replace(/^\//, ''))); } catch {}
        }
        await db.deleteProductOverride(id);
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── POST /api/tienda/admin/productos/:id/video ────────────
    // Asigna un video al producto. 3 fuentes posibles:
    //   · Link de YouTube         → { fuente:'youtube',    url }
    //   · Link de Alibaba/AliEx.  → { fuente:'alibaba'|'aliexpress', url }
    //   · Subida de archivo propio → multipart con campo "file" (mp4/webm/mov/m4v)
    //     se guarda en Stockroom/uploads/videos/ y se sirve en /uploads/videos/<archivo>
    if (pathname.match(/^\/api\/tienda\/admin\/productos\/[^/]+\/video$/) && req.method === 'POST') {
      const id = pathname.split('/')[5];
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/multipart\/form-data;\s*boundary=(.+)/i);

      (async () => {
        try {
          const prod = getProductCache().find(p => p.id === id);
          if (!prod) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Producto no encontrado' }));
            return;
          }

          let fields;

          if (bm) {
            // ── Subida de archivo propio (leído como buffer binario) ──
            const MAX_BYTES = 80 * 1024 * 1024; // 80MB
            const body = await new Promise((resolve, reject) => {
              const chunks = [];
              let size = 0;
              req.on('data', c => {
                size += c.length;
                if (size > MAX_BYTES) {
                  req.destroy();
                  return reject(Object.assign(new Error('Archivo demasiado grande (máx 80MB)'), { status: 413 }));
                }
                chunks.push(c);
              });
              req.on('end',   () => resolve(Buffer.concat(chunks)));
              req.on('error', reject);
            });
            const parts = parseMultipart(body, bm[1]);
            const file  = parts['file'];
            if (!file?.data) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Archivo no recibido (campo "file")' }));
              return;
            }
            const ext = detectVideoExt(file.data);
            if (!ext) {
              res.writeHead(415);
              res.end(JSON.stringify({ error: 'El archivo no es un video válido (mp4, webm o mov)' }));
              return;
            }
            const dir = path.join(__dirname, 'uploads', 'videos');
            fs.mkdirSync(dir, { recursive: true });
            // Borrar archivo anterior propio (si lo había) antes de guardar el nuevo
            try {
              const prevOv = await db.getProductOverride(id);
              if (prevOv?.video_fuente === 'upload' && prevOv.video_url) {
                try { fs.unlinkSync(path.join(__dirname, prevOv.video_url.replace(/^\//, ''))); } catch {}
              }
            } catch {}
            const fname = `${id}_${Date.now()}${ext}`;
            fs.writeFileSync(path.join(dir, fname), file.data);
            fields = {
              video_url:       `/uploads/videos/${fname}`,
              video_fuente:    'upload',
              video_thumb_url: null,
            };
          } else {
            // ── Link externo (YouTube / Alibaba / AliExpress) ──
            const raw = await readBody(req);
            let data; try { data = JSON.parse(raw); } catch { data = {}; }
            const url    = String(data.url    || '').trim();
            const fuente = String(data.fuente || '').trim().toLowerCase();
            if (!url) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Falta "url"' }));
              return;
            }
            if (!['youtube', 'alibaba', 'aliexpress'].includes(fuente)) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Fuente inválida — usá youtube, alibaba o aliexpress' }));
              return;
            }
            fields = {
              video_url:       url.slice(0, 1000),
              video_fuente:    fuente,
              video_thumb_url: String(data.thumb_url || '').trim().slice(0, 1000) || null,
            };
          }

          const saved = await db.setProductOverride(id, fields);
          invalidateProductCache();
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, override: saved }));
        } catch (e) {
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
        }
      })();
      return;
    }

    // ── DELETE /api/tienda/admin/productos/:id/video ──────────
    // Quita el video asignado (y borra el archivo si era subido).
    if (pathname.match(/^\/api\/tienda\/admin\/productos\/[^/]+\/video$/) && req.method === 'DELETE') {
      const id = pathname.split('/')[5];
      (async () => { try {
        const ov = await db.getProductOverride(id);
        if (ov?.video_fuente === 'upload' && ov.video_url) {
          try { fs.unlinkSync(path.join(__dirname, ov.video_url.replace(/^\//, ''))); } catch {}
        }
        const saved = await db.setProductOverride(id, { video_url: null, video_fuente: null, video_thumb_url: null });
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, override: saved }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // ADMIN — Productos propios (alta de productos que NO están en
    // MercadoLibre: celulares/consolas/smartwatches del proveedor,
    // o cualquier otra cosa que el admin quiera cargar a mano).
    // Viven en tienda_productos_propios, con ID sintético WZ-LOC-…
    // y se mezclan de forma aditiva con el catálogo de ML (ver
    // localProductoToItem + merge en /api/tienda/productos).
    // ══════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════
    //  CATEGORÍAS  /api/tienda/admin/categorias
    // ══════════════════════════════════════════════════════════

    // GET /api/tienda/admin/categorias  — lista completa + conteo productos
    if (pathname === '/api/tienda/admin/categorias' && req.method === 'GET') {
      (async () => { try {
        const [cats, counts] = await Promise.all([
          db.getCategorias(),
          db.countProductosByCategoria(),
        ]);
        const data = cats.map(c => ({
          ...c,
          productos_total:  (counts[c.slug] || {}).total  || 0,
          productos_activos: (counts[c.slug] || {}).activos || 0,
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ categorias: data }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } })();
      return;
    }

    // POST /api/tienda/admin/categorias  — crear
    if (pathname === '/api/tienda/admin/categorias' && req.method === 'POST') {
      readBody(req).then(async (raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const label = String(data.label || '').trim().slice(0, 120);
        if (!label) { res.writeHead(400); res.end(JSON.stringify({ error: 'Falta label' })); return; }
        // Auto-generate slug if not provided
        let slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
        if (!slug) slug = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        if (!slug) { res.writeHead(400); res.end(JSON.stringify({ error: 'No se pudo generar un slug' })); return; }
        const existing = await db.getCategoriaBySlug(slug);
        if (existing) { res.writeHead(409); res.end(JSON.stringify({ error: 'Ya existe una categoría con ese slug' })); return; }
        const emoji       = String(data.emoji || '📦').slice(0, 10);
        const descripcion = String(data.descripcion || '').trim().slice(0, 500);
        const cats        = await db.getCategorias();
        const orden       = cats.length + 1;
        const cat         = await db.createCategoria({ slug, label, emoji, descripcion, orden });
        res.writeHead(201); res.end(JSON.stringify({ ok: true, categoria: cat }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } });
      return;
    }

    // PUT /api/tienda/admin/categorias/reorder  — reordenar
    if (pathname === '/api/tienda/admin/categorias/reorder' && req.method === 'PUT') {
      readBody(req).then(async (raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const ids = Array.isArray(data.ids) ? data.ids.map(Number).filter(Boolean) : [];
        if (!ids.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'Falta ids[]' })); return; }
        await db.reorderCategorias(ids);
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } });
      return;
    }

    // PUT /api/tienda/admin/categorias/:id  — actualizar
    if (pathname.match(/^\/api\/tienda\/admin\/categorias\/\d+$/) && req.method === 'PUT') {
      const id = parseInt(pathname.split('/').pop());
      readBody(req).then(async (raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const cat = await db.getCategoriaById(id);
        if (!cat) { res.writeHead(404); res.end(JSON.stringify({ error: 'Categoría no encontrada' })); return; }
        const fields = {};
        if (data.label       !== undefined) fields.label       = String(data.label).trim().slice(0, 120);
        if (data.emoji       !== undefined) fields.emoji       = String(data.emoji).slice(0, 10);
        if (data.descripcion !== undefined) fields.descripcion = String(data.descripcion).trim().slice(0, 500);
        if (data.activa      !== undefined) fields.activa      = !!data.activa;
        if (!fields.label && data.label !== undefined) { res.writeHead(400); res.end(JSON.stringify({ error: 'El label no puede quedar vacío' })); return; }
        const updated = await db.updateCategoria(id, fields);
        res.writeHead(200); res.end(JSON.stringify({ ok: true, categoria: updated }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } });
      return;
    }

    // DELETE /api/tienda/admin/categorias/:id  — eliminar (solo si sin productos)
    if (pathname.match(/^\/api\/tienda\/admin\/categorias\/\d+$/) && req.method === 'DELETE') {
      const id = parseInt(pathname.split('/').pop());
      (async () => { try {
        const cat = await db.getCategoriaById(id);
        if (!cat) { res.writeHead(404); res.end(JSON.stringify({ error: 'Categoría no encontrada' })); return; }
        const counts = await db.countProductosByCategoria();
        const n = (counts[cat.slug] || {}).total || 0;
        if (n > 0) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: `No se puede eliminar: tiene ${n} producto${n !== 1 ? 's' : ''}. Reasignalos primero.` }));
          return;
        }
        await db.deleteCategoria(id);
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      } })();
      return;
    }

    // ── GET /api/tienda/admin/productos-propios ───────────────
    // Lista todos los productos propios (manuales + importados).
    if (pathname === '/api/tienda/admin/productos-propios' && req.method === 'GET') {
      (async () => { try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        let lista = (await db.getProductosPropios({})).map(_serializeProductoPropio);

        const q = (params.get('q') || '').trim().toLowerCase();
        if (q) lista = lista.filter(p =>
          p.id.toLowerCase().includes(q) || p.titulo.toLowerCase().includes(q) || (p.marca || '').toLowerCase().includes(q));

        const filtro = params.get('filtro');
        if (filtro === 'activos')        lista = lista.filter(p => p.activo);
        else if (filtro === 'pausados')  lista = lista.filter(p => !p.activo);
        else if (filtro === 'destacados') lista = lista.filter(p => p.destacado);
        else if (filtro === 'agotados')  lista = lista.filter(p => p.stock_estado === 'agotado');

        const categoria = params.get('categoria');
        if (categoria) lista = lista.filter(p => p.categoria === categoria);

        const limit = parseInt(params.get('limit')) || 50;
        const page  = parseInt(params.get('page'))  || 1;
        const total = lista.length;
        const paged = lista.slice((page - 1) * limit, page * limit);

        const cats = (await db.getCategorias({ soloActivas: true })).map(c => ({ slug: c.slug, label: c.label, emoji: c.emoji }));
        res.writeHead(200);
        res.end(JSON.stringify({ productos: paged, total, page, limit, categorias: cats }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── POST /api/tienda/admin/productos-propios/parse-whatsapp ─
    // Interpreta un bloque de texto pegado de WhatsApp (lista de
    // precios del proveedor) y devuelve "borradores" para revisar
    // y editar antes de publicar — NO crea nada todavía.
    if (pathname === '/api/tienda/admin/productos-propios/parse-whatsapp' && req.method === 'POST') {
      readBody(req).then((raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const texto = String(data.texto || '').slice(0, 20000);
        if (!texto.trim()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Falta "texto"' }));
          return;
        }
        const borradores = parseListaProveedorWhatsApp(texto);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, borradores, total: borradores.length }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: 'bad_request', message: e.message }));
      });
      return;
    }

    // ── PUT /api/tienda/admin/productos-propios/bulk-cotizacion ──
    // Recalcula el precio_ars de todos los productos que tienen
    // precio_usd + margen_pct + cotizacion_usd, aplicando la nueva
    // cotización. Body: { cotizacion_usd: number }.
    if (pathname === '/api/tienda/admin/productos-propios/bulk-cotizacion' && req.method === 'PUT') {
      readBody(req).then(async (raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const cot = parseFloat(data.cotizacion_usd);
        if (!cot || cot < 100) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'cotizacion_usd debe ser >= 100 (ejemplo: 1200)' }));
          return;
        }
        const result = await db.pool.query(
          `UPDATE tienda_productos_propios
              SET cotizacion_usd = $1,
                  precio_ars     = ROUND((precio_usd * (1 + margen_pct / 100.0) * $1)::numeric, 0),
                  actualizado_en = NOW()
            WHERE precio_usd   IS NOT NULL
              AND margen_pct   IS NOT NULL
              AND cotizacion_usd IS NOT NULL
            RETURNING id, titulo, precio_ars`,
          [cot]
        );
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, updated: result.rowCount, cotizacion_usd: cot }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } });
      return;
    }

    // ── POST /api/tienda/admin/productos-propios/imagen ───────
    // Sube un archivo de imagen propio (multipart, campo "file") y
    // devuelve la URL pública donde quedó guardado — el admin la usa
    // luego como "imagen_portada_url" o la agrega al array "imagenes".
    // (No crea ni edita ningún producto — solo sube el archivo.)
    if (pathname === '/api/tienda/admin/productos-propios/imagen' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/multipart\/form-data;\s*boundary=(.+)/i);
      if (!bm) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Se espera multipart/form-data con campo "file"' }));
        return;
      }
      (async () => {
        try {
          const MAX_BYTES = 15 * 1024 * 1024; // 15MB
          const body = await new Promise((resolve, reject) => {
            const chunks = []; let size = 0;
            req.on('data', c => {
              size += c.length;
              if (size > MAX_BYTES) {
                req.destroy();
                return reject(Object.assign(new Error('Archivo demasiado grande (máx 15MB)'), { status: 413 }));
              }
              chunks.push(c);
            });
            req.on('end',   () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });
          const parts = parseMultipart(body, bm[1]);
          const file  = parts['file'];
          if (!file?.data) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Archivo no recibido (campo "file")' }));
            return;
          }
          const realExt = detectImageExt(file.data);
          if (!realExt) {
            res.writeHead(415);
            res.end(JSON.stringify({ error: 'El archivo no es una imagen válida (jpg, png, webp o gif)' }));
            return;
          }
          const ext = realExt;
          const dir = path.join(__dirname, 'uploads', 'productos-propios');
          fs.mkdirSync(dir, { recursive: true });
          const fname = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          // Comprimir/redimensionar (excepto .gif, que puede ser animado y sharp lo aplanaría)
          let outData = file.data;
          if (ext !== '.gif') {
            try {
              const img = sharp(file.data).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
              if (ext === '.png')      outData = await img.png({ compressionLevel: 9 }).toBuffer();
              else if (ext === '.webp') outData = await img.webp({ quality: 82 }).toBuffer();
              else                      outData = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
            } catch {
              outData = file.data; // si falla la compresión, guardamos el original
            }
          }
          fs.writeFileSync(path.join(dir, fname), outData);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, url: `/uploads/productos-propios/${fname}` }));
        } catch (e) {
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
        }
      })();
      return;
    }

    // ── POST /api/tienda/admin/productos-propios/video ────────
    // Sube un archivo de video (multipart, campo "file") y devuelve
    // la URL pública — se guarda en uploads/videos/ igual que los
    // videos de productos ML.  Acepta mp4/webm/mov/m4v.
    if (pathname === '/api/tienda/admin/productos-propios/video' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/multipart\/form-data;\s*boundary=(.+)/i);
      if (!bm) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Se espera multipart/form-data con campo "file"' }));
        return;
      }
      (async () => {
        try {
          const MAX_BYTES = 200 * 1024 * 1024; // 200MB
          const body = await new Promise((resolve, reject) => {
            const chunks = []; let size = 0;
            req.on('data', c => {
              size += c.length;
              if (size > MAX_BYTES) {
                req.destroy();
                return reject(Object.assign(new Error('Archivo demasiado grande (máx 200MB)'), { status: 413 }));
              }
              chunks.push(c);
            });
            req.on('end',   () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });
          const parts = parseMultipart(body, bm[1]);
          const file  = parts['file'];
          if (!file?.data) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Archivo no recibido (campo "file")' }));
            return;
          }
          const ext = detectVideoExt(file.data);
          if (!ext) {
            res.writeHead(415);
            res.end(JSON.stringify({ error: 'El archivo no es un video válido (mp4, webm o mov)' }));
            return;
          }
          const dir = path.join(__dirname, 'uploads', 'videos');
          fs.mkdirSync(dir, { recursive: true });
          const fname = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          fs.writeFileSync(path.join(dir, fname), file.data);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, url: `/uploads/videos/${fname}` }));
        } catch (e) {
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
        }
      })();
      return;
    }

    // ── POST /api/tienda/admin/productos-propios ──────────────
    // Crea un producto propio nuevo (alta manual o publicación de
    // un borrador detectado por el parser de WhatsApp).
    if (pathname === '/api/tienda/admin/productos-propios' && req.method === 'POST') {
      readBody(req).then(async (raw) => { try {
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const titulo = _cleanTxt(data.titulo, 200);
        if (!titulo) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Falta "titulo"' }));
          return;
        }
        const fields = _buildProductoPropioFields(data, { partial: false });
        fields.titulo = titulo;
        const id = generarIdProductoPropio();
        const creado = await db.createProductoPropio(id, fields);
        auditLog(req, 'producto_propio_create', id, {
          titulo, precio_usd: fields.precio_usd, precio_ars: fields.precio_ars, stock_estado: fields.stock_estado,
        });
        invalidateProductCache();
        res.writeHead(201);
        res.end(JSON.stringify({ ok: true, producto: _serializeProductoPropio(creado) }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: 'bad_request', message: e.message }));
      });
      return;
    }

    // ── GET /api/tienda/admin/productos-propios/:id ───────────
    if (pathname.match(/^\/api\/tienda\/admin\/productos-propios\/[^/]+$/) && req.method === 'GET') {
      const id = pathname.split('/').pop();
      (async () => { try {
        const lp = await db.getProductoPropioById(id);
        if (!lp) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Producto no encontrado' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ producto: _serializeProductoPropio(lp) }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── PUT /api/tienda/admin/productos-propios/:id ───────────
    // Edición parcial — solo pisa los campos presentes en el body.
    if (pathname.match(/^\/api\/tienda\/admin\/productos-propios\/[^/]+$/) && req.method === 'PUT') {
      const id = pathname.split('/').pop();
      readBody(req).then(async (raw) => { try {
        const lp = await db.getProductoPropioById(id);
        if (!lp) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Producto no encontrado' }));
          return;
        }
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        if (Object.prototype.hasOwnProperty.call(data, 'titulo') && !_cleanTxt(data.titulo, 200)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'El título no puede quedar vacío' }));
          return;
        }
        const fields = _buildProductoPropioFields(data, { partial: true });

        // Auditoría: registrar cambios en precio/stock/estado de un producto propio
        const _watch = ['precio_usd', 'precio_ars', 'stock_estado', 'activo'];
        const _changes = {};
        for (const k of _watch) {
          if (Object.prototype.hasOwnProperty.call(fields, k) && fields[k] !== lp[k]) {
            _changes[k] = { antes: lp[k], despues: fields[k] };
          }
        }
        if (Object.prototype.hasOwnProperty.call(fields, 'variantes')) {
          _changes.variantes = { antes: lp.variantes, despues: fields.variantes };
        }
        if (Object.keys(_changes).length) {
          auditLog(req, 'producto_propio_update', id, { titulo: lp.titulo, cambios: _changes });
        }

        const saved = await db.updateProductoPropio(id, fields);
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, producto: _serializeProductoPropio(saved) }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: 'bad_request', message: e.message }));
      });
      return;
    }

    // ── DELETE /api/tienda/admin/productos-propios/:id ────────
    // Borrado definitivo (también limpia imágenes/video subidos al servidor).
    if (pathname.match(/^\/api\/tienda\/admin\/productos-propios\/[^/]+$/) && req.method === 'DELETE') {
      const id = pathname.split('/').pop();
      (async () => { try {
        // Soft delete: el producto queda marcado como eliminado/inactivo pero
        // permanece en la DB (junto con sus archivos) por si hay que restaurarlo.
        const lp = await db.getProductoPropioById(id);
        await db.deleteProductoPropio(id);
        auditLog(req, 'producto_propio_delete', id, { titulo: lp?.titulo });
        invalidateProductCache();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      } })();
      return;
    }

    // ── POST /api/tienda/carrito-abandonado ───────────────────
    // Se llama al completar el paso 1 del checkout (nombre+email).
    // Guarda un snapshot del carrito para poder recordárselo por email
    // si el usuario abandona sin completar la compra.
    if (pathname === '/api/tienda/carrito-abandonado' && req.method === 'POST') {
      readBody(req).then(async (rawBody) => {
        try {
          const data  = JSON.parse(rawBody);
          const email = String(data.email  || '').trim();
          const nombre = String(data.nombre || '').trim().slice(0, 200);
          const items  = Array.isArray(data.items) ? data.items.slice(0, 50) : [];
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !items.length) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'email e items son obligatorios' }));
            return;
          }
          const total = items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.qty) || 1), 0);
          await db.upsertCarritoAbandonado({ email, nombre, items, total });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
        }
      });
      return;
    }

    // ── GET /api/tienda/carrito-abandonado/:token ─────────────
    // Usado por carrito.html para restaurar el carrito desde el
    // deep-link del email "tu carrito te espera".
    if (pathname.startsWith('/api/tienda/carrito-abandonado/') && req.method === 'GET') {
      const token = pathname.split('/').pop();
      db.getCarritoAbandonadoPorToken(token).then(carrito => {
        if (!carrito) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No encontrado' }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, items: carrito.items }));
      }).catch(e => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      });
      return;
    }

    // ── POST /api/tienda/orden ───────────────────────────────
    if (pathname === '/api/tienda/orden' && req.method === 'POST') {
      // Rate limit: máx 10 órdenes por IP por hora (anti-spam)
      const _rlIp  = getClientIP(req) || 'unknown';
      const _rlNow = Date.now();
      if (!_ordenRateLimit.has(_rlIp)) _ordenRateLimit.set(_rlIp, []);
      const _rlHits = _ordenRateLimit.get(_rlIp).filter(t => _rlNow - t < 3600 * 1000);
      if (_rlHits.length >= 10) {
        res.writeHead(429);
        res.end(JSON.stringify({ error: 'Demasiadas órdenes desde esta IP. Intentá en 1 hora.' }));
        return;
      }
      _rlHits.push(_rlNow);
      _ordenRateLimit.set(_rlIp, _rlHits);
      _saveRateLimits();

      readBody(req).then(async (rawBody) => {
        try {
          const data  = JSON.parse(rawBody);

          // ── Validación de precios (server-side) ───────────────────────────
          // Compara los precios del carrito contra los precios reales en DB.
          // Tolerancia: 1% para absorber diferencias de redondeo.
          // Si un producto no está en DB se omite (graceful — productos nuevos).
          const orderItems = Array.isArray(data.items) ? data.items : [];

          // Sanitizar primero, validar después
          const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, 500);
          if (data.datos) {
            for (const k of ['nombre','telefono','direccion','piso','ciudad','provincia','cp']) {
              if (data.datos[k] !== undefined) data.datos[k] = stripHtml(data.datos[k]);
            }
          }

          // Validación básica
          if (orderItems.length === 0) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'El carrito está vacío' }));
            return;
          }
          const emailVal  = String(data.datos?.email  || '').trim();
          const nombreVal = String(data.datos?.nombre || '').trim();
          if (!emailVal || !nombreVal) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Nombre y email son obligatorios' }));
            return;
          }

          const mlIds      = [...new Set(orderItems.map(i => i.id).filter(Boolean))];
          if (mlIds.length > 0) {
            const priceMap = await db.getProductPricesForOrder(mlIds);
            for (const item of orderItems) {
              const prod = priceMap[item.id];
              if (!prod || !prod.all_prices.length) continue; // no en DB → skip
              const submittedPrice = parseFloat(item.price) || 0;
              // Verificar que el precio enviado coincide con alguno de los precios válidos (±1%)
              const isValid = prod.all_prices.some(validPrice => {
                if (validPrice <= 0) return false;
                return Math.abs(submittedPrice - validPrice) / validPrice <= 0.01;
              });
              if (!isValid) {
                const validList = prod.all_prices.map(p => `$${Math.round(p).toLocaleString('es-AR')}`).join(', ');
                console.warn(`  ✗ [precio] ${item.id}: enviado $${submittedPrice}, válidos: ${validList}`);
                res.writeHead(400);
                res.end(JSON.stringify({
                  error: 'precio_invalido',
                  message: `El precio del producto "${item.title || item.id}" no es válido. Actualizá la página e intentá de nuevo.`,
                }));
                return;
              }
            }
          }
          // ── Fin validación de precios ──────────────────────────────────────

          // ── Recalcular total server-side (cupón + descuento 5% por transferencia) ──
          // qty se clampa a [1, 99]: un qty negativo restaría plata del total.
          const sanQty = it => Math.min(99, Math.max(1, parseInt(it.qty) || 1));
          for (const it of orderItems) it.qty = sanQty(it);
          const subtotalCalc = orderItems.reduce((acc, it) => acc + Math.max(0, parseFloat(it.price) || 0) * it.qty, 0);

          let cuponDescuentoCalc = 0;
          const cuponCode = data.pago?.cupon;
          if (cuponCode) {
            const cupon = getCupones().find(c => c.code === cuponCode && c.active !== false);
            if (cupon && (cupon.type === 'percent' || cupon.type === 'fixed')) {
              const base = cupon.categoria
                ? orderItems.reduce((s, i) => (i.categoria || '') === cupon.categoria ? s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1) : s, 0)
                : subtotalCalc;
              cuponDescuentoCalc = cupon.type === 'percent'
                ? Math.round(base * cupon.value / 100)
                : Math.min(cupon.value, base);
              if (cupon.max_descuento > 0) cuponDescuentoCalc = Math.min(cuponDescuentoCalc, cupon.max_descuento);
            }
          }

          // El precio de envío viene del cliente — clampear a >= 0 (un valor negativo
          // descontaría del total). Se muta data.envio.precio para que createOrden y
          // todo lo downstream persistan el valor sano. La validación contra
          // cotización real queda como mejora pendiente (ver plan 3.1).
          if (data.envio) data.envio.precio = Math.max(0, parseFloat(data.envio.precio) || 0);
          const envioCalc    = data.envio?.precio || 0;
          const esTransferencia = data.pago?.metodo === 'transferencia';
          const descuentoCalc = esTransferencia ? Math.round((subtotalCalc - cuponDescuentoCalc) * 0.05) : 0;
          if (data.pago) {
            data.pago.descuento_transferencia = descuentoCalc;
            if (cuponDescuentoCalc > 0) {
              data.pago.cupon = cuponCode;
              data.pago.descuento_cupon = cuponDescuentoCalc;
            } else {
              delete data.pago.cupon;
              delete data.pago.descuento_cupon;
            }
          }
          data.total = subtotalCalc - cuponDescuentoCalc - descuentoCalc + envioCalc;
          // ── Fin recálculo de total ──────────────────────────────────────────

          const orden = await db.createOrden(data);
          console.log(`  ✓ [tienda] Nueva orden: ${orden.id}`);

          // Marcar el carrito abandonado de este email como recuperado
          // (si había uno pendiente, no se le manda el recordatorio)
          if (emailVal) db.marcarCarritoRecuperado(emailVal).catch(() => {});

          // Guardar cupón de fidelidad (async)
          guardarCuponFidelidad(orden.id).then(cod =>
            console.log(`  ✓ [fidelidad] Cupón ${cod} generado para orden ${orden.id}`)
          ).catch(() => {});

          // Email de confirmación al comprador (async, no bloquea la respuesta)
          const emailCliente = orden.datos?.email || orden.cliente?.email;
          if (emailCliente) {
            sendEmail({
              to:      emailCliente,
              subject: `✅ Pedido confirmado #${String(orden.id).slice(-8).toUpperCase()} · WZMALLAS`,
              html:    emailConfirmacionOrden(orden),
            }).then(r => {
              if (r.ok) console.log(`  ✓ [email] Confirmación enviada a ${emailCliente}`);
              else if (!r.skipped) console.warn(`  ⚠ [email] No se pudo enviar a ${emailCliente}`);
            });
          }

          // Notificación Telegram al admin (async)
          const items   = orden.items || [];
          const total   = orden.total || items.reduce((s,i) => s + (i.price||0)*(i.qty||1), 0);
          const fmtARS  = n => '$' + Number(n||0).toLocaleString('es-AR',{minimumFractionDigits:0});
          tgSend(
            `🛍️ <b>Nueva orden</b> — ${fmtARS(total)}\n` +
            `ID: <code>${orden.id}</code>\n` +
            `Cliente: ${orden.cliente?.nombre || '—'} (${emailCliente || '—'})\n` +
            `Items: ${items.length} producto(s)\n` +
            `Pago: ${orden.pago?.metodo || '—'} · Envío: ${orden.envio?.metodo || '—'}`
          ).catch(() => {});

          res.writeHead(201);
          res.end(JSON.stringify({ orden_id: orden.id, status: 'pendiente' }));
        } catch(e) {
          const status = e.status === 413 ? 413 : 400;
          res.writeHead(status);
          res.end(JSON.stringify({ error: status === 413 ? 'Cuerpo de la solicitud demasiado grande' : 'Body inválido' }));
        }
      }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // ── POST /api/tienda/contacto ────────────────────────────
    // Form público de contacto. Anti-spam: honeypot + rate limit por IP (en memoria).
    if (pathname === '/api/tienda/contacto' && req.method === 'POST') {
      readBody(req).then((rawBody) => {
        try {
          const data = JSON.parse(rawBody);

          // Honeypot — campo invisible que solo bots completan
          if (data.website && String(data.website).trim().length > 0) {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true })); // pretender éxito
            console.log('[contacto] honeypot triggered, message ignored');
            return;
          }

          // Rate limit: 3 mensajes por IP por hora
          // Usar getClientIP para detectar la IP real detrás de cloudflared
          const ip = getClientIP(req) || 'unknown';
          const now = Date.now();
          if (!_contactRateLimit.has(ip)) _contactRateLimit.set(ip, []);
          const recent = _contactRateLimit.get(ip).filter(t => now - t < 3600 * 1000);
          if (recent.length >= 3) {
            res.writeHead(429);
            res.end(JSON.stringify({ error: 'Demasiados mensajes desde esta IP. Probá en 1 hora.' }));
            return;
          }
          recent.push(now);
          _contactRateLimit.set(ip, recent);
          _saveRateLimits();

          // Validación básica
          const nombre  = String(data.nombre  || '').trim().slice(0, 120);
          const email   = String(data.email   || '').trim().slice(0, 200);
          const asunto  = String(data.asunto  || '').trim().slice(0, 200);
          const mensaje = String(data.mensaje || '').trim().slice(0, 4000);
          if (!nombre || !email || !mensaje) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Nombre, email y mensaje son obligatorios' }));
            return;
          }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Email inválido' }));
            return;
          }

          // Guardar en contactos.json
          const contactosPath = path.join(__dirname, 'contactos.json');
          let contactos = [];
          try { contactos = JSON.parse(fs.readFileSync(contactosPath, 'utf8')); } catch {}
          const contacto = {
            id      : Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            fecha   : new Date().toISOString(),
            nombre, email, asunto, mensaje,
            ip,
            user_agent: req.headers['user-agent'] || '',
          };
          contactos.push(contacto);
          fs.writeFileSync(contactosPath, JSON.stringify(contactos, null, 2));

          // Notificar al admin por Telegram
          tgSend(
            `📩 <b>Nuevo contacto</b>\n` +
            `<b>De:</b> ${nombre} (${email})\n` +
            (asunto ? `<b>Asunto:</b> ${asunto}\n` : '') +
            `\n${mensaje.slice(0, 600)}${mensaje.length > 600 ? '...' : ''}`
          ).catch(()=>{});

          console.log(`  ✓ [tienda/contacto] Nuevo mensaje de ${email}`);
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true, id: contacto.id }));

        } catch(e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Body inválido' }));
        }
      }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // ── POST /api/tienda/newsletter ──────────────────────────
    // Alta de suscriptor desde el formulario del footer.
    if (pathname === '/api/tienda/newsletter' && req.method === 'POST') {
      readBody(req).then(async (rawBody) => {
        try {
          const data = JSON.parse(rawBody);

          // Honeypot — campo invisible que solo bots completan
          if (data.website && String(data.website).trim().length > 0) {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true })); // pretender éxito
            console.log('[newsletter] honeypot triggered, ignored');
            return;
          }

          // Rate limit: 5 altas por IP por hora
          const ip  = getClientIP(req) || 'unknown';
          const now = Date.now();
          if (!_newsletterRL.has(ip)) _newsletterRL.set(ip, []);
          const recent = _newsletterRL.get(ip).filter(t => now - t < 3600 * 1000);
          if (recent.length >= 5) {
            res.writeHead(429);
            res.end(JSON.stringify({ error: 'Demasiados intentos. Probá en 1 hora.' }));
            return;
          }
          recent.push(now);
          _newsletterRL.set(ip, recent);

          // Validación de email
          const email = String(data.email || '').trim().toLowerCase().slice(0, 200);
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Email inválido' }));
            return;
          }

          // Upsert: si ya existe y estaba dado de baja, reactivar; si no, ignorar.
          await db.pool.query(
            `INSERT INTO newsletter_subscribers (email, source, status)
             VALUES ($1, 'footer', 'subscribed')
             ON CONFLICT (email) DO UPDATE
               SET status     = 'subscribed',
                   updated_at = NOW()
               WHERE newsletter_subscribers.status <> 'subscribed'`,
            [email]
          );

          console.log(`  ✓ [tienda/newsletter] Alta/reactivación: ${email}`);
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true }));

        } catch (e) {
          console.error('[newsletter] error:', e.message);
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No se pudo procesar la suscripción' }));
        }
      }).catch(e => {
        res.writeHead(e.status || 400);
        res.end(JSON.stringify({ error: e.message }));
      });
      return;
    }

    // ── POST /api/tienda/arrepentimiento ─────────────────────
    // Formulario público de arrepentimiento de compra (Art. 34 Ley 24.240)
    if (pathname === '/api/tienda/arrepentimiento' && req.method === 'POST') {
      readBody(req).then(rawBody => {
        try {
          const { nombre, email, pedido, telefono, tipo, motivo } = JSON.parse(rawBody || '{}');
          if (!nombre || !email || !pedido || !tipo)
            throw Object.assign(new Error('Faltan campos requeridos'), { status: 400 });

          const ticket = 'ARR-' + Date.now().toString(36).toUpperCase().slice(-6);
          const ts = new Date().toISOString();
          console.log(`[arrepentimiento] ${ticket} — ${email} — pedido ${pedido} — tipo: ${tipo}`);

          // Notificar por email si está configurado
          sendEmail({
            to: fullConfig.email_admin || fullConfig.gmail_user,
            subject: `⚠️ Arrepentimiento ${ticket} — Pedido ${pedido}`,
            text: `Ticket: ${ticket}\nFecha: ${ts}\nNombre: ${nombre}\nEmail: ${email}\nTeléfono: ${telefono || '-'}\nPedido: ${pedido}\nTipo: ${tipo}\nMotivo: ${motivo || '-'}`,
          }).catch(() => {});

          // Confirmación al comprador
          sendEmail({
            to: email,
            subject: `Recibimos tu solicitud · Ticket ${ticket} · WZMALLAS`,
            html: emailArrepentimientoConfirmacion({ nombre, pedido, ticket, tipo }),
          }).catch(() => {});

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, ticket }));
        } catch(e) {
          res.writeHead(e.status || 400);
          res.end(JSON.stringify({ error: e.message }));
        }
      }).catch(() => { res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' })); });
      return;
    }

    // ── POST /api/tienda/sync ─────────────────────────────────
    // Requiere auth admin. Pagina todos los items activos de todas
    // las cuentas ML y guarda el JSON nativo de ML en cache/items.json.
    // Sin transformaciones: lo que devuelve ML es lo que se guarda.
    if (pathname === '/api/tienda/sync' && req.method === 'POST') {
      (async () => {
        try {
          const accounts = (fullConfig.accounts && fullConfig.accounts.length)
            ? fullConfig.accounts
            : (config.access_token ? [config] : []);
          if (!accounts.length) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'No hay cuentas ML configuradas' }));
            return;
          }

          const allItems    = [];
          const errors      = [];
          const perAcctItems = {}; // acct.id → items[] (para cachés individuales)

          for (const acct of accounts) {
            if (!acct.access_token) continue;
            const acctItems = [];
            try {
              const me     = await mlGetAuth(acct, '/users/me');
              const userId = me.id;
              console.log(`  → [tienda/sync] cuenta ${acct.label || acct.id} (ML user ${userId})`);

              // Paginación: traer todos los IDs de items activos
              const allIds   = [];
              let offset     = 0;
              const PER_PAGE = 50;
              let mlTotal    = Infinity;
              while (offset < mlTotal) {
                const r = await mlGetAuth(acct,
                  `/users/${userId}/items/search?status=active&limit=${PER_PAGE}&offset=${offset}`
                );
                mlTotal = (r.paging && r.paging.total != null) ? r.paging.total : 0;
                const ids = r.results || [];
                if (!ids.length) break;
                allIds.push(...ids);
                offset += PER_PAGE;
              }
              console.log(`     ${allIds.length} items activos encontrados`);

              // Detalles en lotes de 20 — se guarda el body tal cual viene de ML
              const BATCH = 20;
              for (let i = 0; i < allIds.length; i += BATCH) {
                const batch = allIds.slice(i, i + BATCH);
                try {
                  const details = await mlGetAuth(acct, `/items?ids=${batch.join(',')}`);
                  for (const entry of (Array.isArray(details) ? details : [])) {
                    if (entry.code === 200 && entry.body) {
                      allItems.push(entry.body);
                      acctItems.push(entry.body);
                    }
                  }
                } catch (bErr) {
                  errors.push(`[${acct.id}] batch ${i}: ${bErr.message}`);
                }
              }
            } catch (aErr) {
              errors.push(`[${acct.id || acct.label}] ${aErr.message}`);
            }
            if (acctItems.length > 0) perAcctItems[acct.id] = acctItems;
          }

          // 1) Dedup por id (mismo id podría aparecer dos veces si dos accounts tienen
          //    la misma publicación — es raro pero por las dudas)
          const seen    = new Set();
          const deduped = allItems.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id); return true;
          });

          // 2) Consolidar: dedup cross-account vía vinculaciones (preferir WZ)
          //    + agrupar items con mismo family_id en uno solo con variations[]
          let vinculaciones = null;
          try {
            const vincFp = path.join(__dirname, 'vinculaciones.json');
            if (fs.existsSync(vincFp)) {
              vinculaciones = JSON.parse(fs.readFileSync(vincFp, 'utf8'));
            }
          } catch(e) { console.warn('  ⚠ vinculaciones.json no leído:', e.message); }

          const consolidated = consolidateItems(deduped, vinculaciones);

          // Guardar — formato nativo ML (compatible con tienda)
          const cacheDir  = path.join(__dirname, 'cache');
          const cachePath = path.join(cacheDir, 'items.json');
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(cachePath, JSON.stringify(consolidated, null, 2));

          console.log(`  ✓ [tienda/sync] ${deduped.length} → ${consolidated.length} items en cache/items.json`);
          invalidateProductCache(); // Forzar re-lectura en el próximo request

          // Guardar también un cache por cuenta (para Alibaba y otras vistas por cuenta)
          for (const [acctId, items] of Object.entries(perAcctItems)) {
            const acctPath = path.join(cacheDir, `items-${acctId}.json`);
            fs.writeFileSync(acctPath, JSON.stringify(items, null, 2));
            console.log(`  ✓ [tienda/sync] ${items.length} items en cache/items-${acctId}.json`);
          }

          // Migrar productos actualizados a la DB en background (no bloquea la respuesta)
          migrateProductsFromCache().then(stats => {
            console.log(`  ✓ [tienda/sync] DB: +${stats.inserted} nuevos, ~${stats.updated} actualizados`);
          }).catch(e => {
            console.warn('  ⚠ [tienda/sync] Error al migrar a DB (precios pueden estar desactualizados):', e.message);
          });

          res.writeHead(200);
          res.end(JSON.stringify({
            ok:           true,
            total:        consolidated.length,
            total_raw:    deduped.length,
            consolidated: deduped.length - consolidated.length,
            updated_at:   new Date().toISOString(),
            errors:       errors.length ? errors : undefined,
          }));
        } catch (e) {
          console.error('[tienda/sync] Error inesperado:', e.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
      return;
    }

    // ── POST /api/tienda/sync/stock ───────────────────────────
    // Actualización LIVIANA: solo refresca available_quantity,
    // sold_quantity, price y status desde ML — sin volver a descargar
    // fotos, descripciones ni atributos completos. Reaprovecha los
    // caches por cuenta (cache/items-<acct>.json) generados por el
    // último /api/tienda/sync, pide a ML solo los campos de stock
    // (payload mucho más chico → mucho más rápido) y vuelve a
    // consolidar en memoria (sin llamadas a la API) antes de guardar
    // cache/items.json. Pensada para correr seguido sin saturar nada.
    if (pathname === '/api/tienda/sync/stock' && req.method === 'POST') {
      (async () => {
        try {
          const accounts = (fullConfig.accounts && fullConfig.accounts.length)
            ? fullConfig.accounts
            : (config.access_token ? [config] : []);
          if (!accounts.length) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'No hay cuentas ML configuradas' }));
            return;
          }

          const cacheDir = path.join(__dirname, 'cache');
          const errors   = [];
          const allRawItems = [];
          let totalChecked = 0, totalUpdated = 0;

          for (const acct of accounts) {
            if (!acct.access_token) continue;

            const acctPath = path.join(cacheDir, `items-${acct.id}.json`);
            let acctItems;
            try {
              acctItems = JSON.parse(fs.readFileSync(acctPath, 'utf8'));
              if (!Array.isArray(acctItems)) throw new Error('formato inválido');
            } catch {
              errors.push(`[${acct.label || acct.id}] sin cache previo — corré "Sincronizar todo" primero`);
              continue;
            }

            const byId = new Map(acctItems.map(it => [it.id, it]));
            const ids  = [...byId.keys()];
            const BATCH = 20;

            for (let i = 0; i < ids.length; i += BATCH) {
              const batch = ids.slice(i, i + BATCH);
              try {
                // attributes acotados → ML devuelve un payload mucho más chico
                const details = await mlGetAuth(acct,
                  `/items?ids=${batch.join(',')}&attributes=id,available_quantity,sold_quantity,price,status,variations`
                );
                for (const entry of (Array.isArray(details) ? details : [])) {
                  totalChecked++;
                  if (entry.code !== 200 || !entry.body) continue;
                  const fresh  = entry.body;
                  const cached = byId.get(fresh.id);
                  if (!cached) continue;

                  cached.available_quantity = fresh.available_quantity;
                  cached.sold_quantity      = fresh.sold_quantity;
                  cached.price              = fresh.price;
                  cached.status             = fresh.status;

                  // Variaciones nativas de ML (una publicación, varios SKU):
                  // actualizar stock/precio por variación sin tocar el resto
                  // (combinaciones, fotos asociadas, etc.)
                  if (Array.isArray(fresh.variations) && Array.isArray(cached.variations)) {
                    const freshVarsById = new Map(fresh.variations.map(v => [v.id, v]));
                    for (const v of cached.variations) {
                      const fv = freshVarsById.get(v.id);
                      if (fv) {
                        v.available_quantity = fv.available_quantity;
                        v.sold_quantity      = fv.sold_quantity;
                        if (fv.price != null) v.price = fv.price;
                      }
                    }
                  }
                  totalUpdated++;
                }
              } catch (bErr) {
                errors.push(`[${acct.label || acct.id}] batch ${i}: ${bErr.message}`);
              }
            }

            // Persistir el cache por cuenta con el stock fresco
            try { fs.writeFileSync(acctPath, JSON.stringify(acctItems, null, 2)); } catch {}
            allRawItems.push(...acctItems);
          }

          if (!allRawItems.length) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'No hay datos en cache — corré una sincronización completa primero', errors }));
            return;
          }

          // Re-consolidar en memoria — mismo criterio que /sync, pero sin
          // pegarle de nuevo a la API (es instantáneo)
          const seen = new Set();
          const deduped = allRawItems.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id); return true;
          });

          let vinculaciones = null;
          try {
            const vincFp = path.join(__dirname, 'vinculaciones.json');
            if (fs.existsSync(vincFp)) {
              vinculaciones = JSON.parse(fs.readFileSync(vincFp, 'utf8'));
            }
          } catch (e) { console.warn('  ⚠ vinculaciones.json no leído:', e.message); }

          const consolidated = consolidateItems(deduped, vinculaciones);
          const cachePath = path.join(cacheDir, 'items.json');
          fs.writeFileSync(cachePath, JSON.stringify(consolidated, null, 2));
          invalidateProductCache();

          console.log(`  ✓ [tienda/sync/stock] ${totalUpdated}/${totalChecked} publicaciones refrescadas, ${consolidated.length} en cache`);

          // Reflejar stock/precio en la DB — mismo proceso idempotente que usa /sync
          migrateProductsFromCache().then(stats => {
            console.log(`  ✓ [tienda/sync/stock] DB: +${stats.inserted} nuevos, ~${stats.updated} actualizados`);
          }).catch(e => {
            console.warn('  ⚠ [tienda/sync/stock] Error al migrar a DB:', e.message);
          });

          res.writeHead(200);
          res.end(JSON.stringify({
            ok:         true,
            checked:    totalChecked,
            updated:    totalUpdated,
            total:      consolidated.length,
            updated_at: new Date().toISOString(),
            errors:     errors.length ? errors : undefined,
          }));
        } catch (e) {
          console.error('[tienda/sync/stock] Error inesperado:', e.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
      return;
    }

    // ── POST /api/tienda/pago/check ──────────────────────────
    // Trigger manual del polling de pagos pendientes.
    // Útil para forzar un check sin esperar el intervalo automático (30s).
    if (pathname === '/api/tienda/pago/check' && req.method === 'POST') {
      pollPendingPayments()
        .then(result => {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        })
        .catch(e => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });
      return;
    }

    // ── GET /api/tienda/pago/status/:orden_id ────────────────
    // Consulta el estado actual de una orden específica.
    // Si la orden está pendiente, fuerza un check con MP.
    if (pathname.match(/^\/api\/tienda\/pago\/status\/[^/]+$/) && req.method === 'GET') {
      (async () => {
        const ordenId = pathname.split('/').pop();
        let orden = await db.getOrdenById(ordenId);
        if (!orden) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Orden no encontrada' }));
          return;
        }

        // Si está pendiente_pago, hacer un check rápido con MP
        if (orden.status === 'pendiente_pago' && orden.pago?.metodo === 'mercadopago') {
          try {
            const accessToken = await getMpTokenFresh();
            if (accessToken) {
              const pago = await mpSearchPaymentByExternalRef(orden.id, accessToken);
              if (pago && pago.status === 'approved') {
                orden = await db.updateOrdenStatus(orden.id, 'pagado', {
                  mp_payment_id:     pago.id,
                  mp_payment_status: pago.status,
                });
              }
            }
          } catch(e) { /* ignorar — devolvemos el status actual */ }
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          id               : orden.id,
          status           : orden.status,
          mp_payment_id    : orden.mp_payment_id    || null,
          mp_payment_status: orden.mp_payment_status || null,
          paid_at          : orden.paid_at           || null,
        }));
      })().catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    // ── POST /api/tienda/pago/mercadopago/crear-preferencia ──
    // Body: { orden_id }  →  Respuesta: { init_point, sandbox_init_point, preference_id }
    if (pathname === '/api/tienda/pago/mercadopago/crear-preferencia' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { orden_id } = JSON.parse(body || '{}');
          if (!orden_id) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'orden_id requerido' }));
            return;
          }

          // Buscar la orden en DB
          const orden = await db.getOrdenById(orden_id);
          if (!orden) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Orden no encontrada' }));
            return;
          }
          if (orden.status === 'pagado') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Esta orden ya fue pagada' }));
            return;
          }

          // Token de MP — preferimos config.mp_access_token, fallback al de ML
          const accessToken = await getMpTokenFresh();
          if (!accessToken) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'MP access_token no configurado (poné mp_access_token en config.json)' }));
            return;
          }
          const sandbox = isMpSandbox();

          const baseUrl = getPublicBaseUrl(req);
          const pref    = await mpCreatePreference(orden, baseUrl, accessToken);

          // En sandbox usamos sandbox_init_point; en producción init_point
          const checkoutUrl = sandbox ? pref.sandbox_init_point : pref.init_point;

          // Guardar referencias de MP en la DB
          await db.updateOrdenStatus(orden.id, 'pendiente_pago', {
            mp_preference_id: pref.id,
          });

          console.log(`  ✓ [MP${sandbox ? ' SANDBOX' : ''}] Preferencia creada para orden ${orden_id}: ${pref.id}`);

          res.writeHead(200);
          res.end(JSON.stringify({
            preference_id      : pref.id,
            init_point         : checkoutUrl,                    // ← el correcto según modo
            production_url     : pref.init_point,
            sandbox_url        : pref.sandbox_init_point,
            sandbox            : sandbox,
          }));
        } catch(e) {
          console.error('[MP] Error creando preferencia:', e.message);
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: e.message, details: e.body || null }));
        }
      });
      return;
    }

    // ── POST /api/tienda/webhook/mercadopago ────────────────────
    // Recibe notificaciones IPN de MercadoPago cuando cambia el estado de un pago.
    // MP envía formato nuevo: { action, data: { id } }
    // MP envía formato viejo: ?id=xxx&topic=payment (query params)
    // El endpoint responde 200 de inmediato y procesa en background.
    if ((pathname === '/api/tienda/webhook/mercadopago' || pathname === '/api/tienda/pago/mercadopago/webhook') && req.method === 'POST') {
      // Responder 200 inmediatamente para que MP no reintente
      res.writeHead(200);
      res.end('OK');

      // Procesar en background
      (async () => {
        try {
          const url    = new URL(req.url, 'http://localhost');
          const qTopic = url.searchParams.get('topic') || '';
          const qId    = url.searchParams.get('id')    || '';

          let rawBody = '';
          // El body ya pudo haber sido consumido (req on data), pero como respondemos
          // antes de leer el body, tenemos que usar los datos que llegaron antes del end.
          // En este handler NO usamos readBody — leemos directamente.
          // (nota: req ya puede estar en estado "ended" si el body llegó antes del 200)

          const accessToken = await getMpTokenFresh();
          if (!accessToken) return;

          let paymentId = qId || '';
          let topic     = qTopic;

          // Si hay body JSON → formato nuevo
          await new Promise(resolve => {
            let buf = '';
            req.on('data', c => buf += c);
            req.on('end', () => { rawBody = buf; resolve(); });
            req.on('error', () => resolve());
            // Si req ya emitió end, resolver de inmediato
            if (req.readableEnded) resolve();
          });

          if (rawBody) {
            try {
              const j = JSON.parse(rawBody);
              if (j.type === 'payment' && j.data?.id) { paymentId = String(j.data.id); topic = 'payment'; }
              else if (j.action?.startsWith('payment') && j.data?.id) { paymentId = String(j.data.id); topic = 'payment'; }
            } catch(_) { /* cuerpo no-JSON → ignorar */ }
          }

          if (topic !== 'payment' || !paymentId) return; // solo procesamos pagos

          // Verificar firma x-signature (si hay secret configurado).
          // El manifest de MP usa el query param data.id (formato nuevo).
          const dataIdParam = url.searchParams.get('data.id') || paymentId;
          if (!mpVerifyWebhookSignature(req, dataIdParam, config.mp_webhook_secret || null)) {
            console.warn(`[webhook/mp] ✗ Firma inválida — notificación descartada (payment ${paymentId})`);
            return;
          }

          // Obtener el pago de MP
          const pago = await mpGetPaymentById(paymentId, accessToken);
          const externalRef = pago.external_reference;
          if (!externalRef) return;

          const orden = await db.getOrdenById(externalRef);
          if (!orden) return;
          if (orden.status === 'pagado' || orden.status === 'reembolsado') return; // ya procesado

          let newStatus = orden.status;
          if (pago.status === 'approved' || pago.status === 'authorized') newStatus = 'pagado';
          else if (pago.status === 'rejected' || pago.status === 'cancelled') newStatus = 'rechazado';
          else if (pago.status === 'refunded' || pago.status === 'charged_back') newStatus = 'reembolsado';

          // Anti-fraude: el monto aprobado debe cubrir el total de la orden.
          // Si no coincide, NO marcar pagado automáticamente — avisar para revisión manual.
          if (newStatus === 'pagado') {
            const montoPagado = Number(pago.transaction_amount) || 0;
            const totalOrden  = Number(orden.total) || 0;
            if (totalOrden > 0 && montoPagado < totalOrden - 1) { // tolerancia $1 por redondeos
              console.warn(`[webhook/mp] ⚠ Monto insuficiente: pago $${montoPagado} < orden $${totalOrden} (orden ${orden.id}, MP ${pago.id}) — requiere revisión manual`);
              tgSend(`⚠️ <b>Pago con monto insuficiente</b>\nOrden: <code>${orden.id}</code> — total $${totalOrden.toLocaleString('es-AR')}\nPagado: $${montoPagado.toLocaleString('es-AR')}\nMP: <code>${pago.id}</code>\n<i>NO se marcó como pagada — revisar manualmente.</i>`).catch(() => {});
              return;
            }
          }

          if (newStatus !== orden.status) {
            const updated = await db.updateOrdenStatus(orden.id, newStatus, {
              mp_payment_id:     pago.id,
              mp_payment_status: pago.status,
              mp_payment_amount: pago.transaction_amount,
            });

            const total   = `$${Number(pago.transaction_amount || orden.total || 0).toLocaleString('es-AR')}`;
            const cliente = orden.datos?.nombre || orden.datos?.email || 'Cliente';

            if (newStatus === 'pagado') {
              console.log(`  ✓ [webhook/mp] Orden ${orden.id}: ${orden.status} → pagado vía webhook`);
              tgSend(`💰 <b>Pago aprobado (webhook)</b> — ${total}\nOrden: <code>${orden.id}</code>\nCliente: ${cliente}\nMP: <code>${pago.id}</code>`).catch(() => {});
              sendVentaTiendaNotification(updated || orden).catch(() => {});
              const emailPago = orden.datos?.email || orden.cliente?.email;
              if (emailPago) {
                sendEmail({
                  to: emailPago,
                  subject: `💳 Pago recibido · Orden #${String(orden.id).slice(-8).toUpperCase()} · WZMALLAS`,
                  html: emailPagoConfirmado({ ...orden, total: pago.transaction_amount || orden.total }),
                }).then(r => {
                  if (r.ok) console.log(`  ✓ [email] Pago confirmado enviado a ${emailPago}`);
                  else if (!r.skipped) console.warn(`  ⚠ [email] Error pago confirmado a ${emailPago}:`, r.error);
                }).catch(e => console.warn(`  ⚠ [email] Error pago confirmado a ${emailPago}:`, e.message));
              }
            } else if (newStatus === 'rechazado') {
              console.log(`  ✗ [webhook/mp] Orden ${orden.id}: → rechazado (${pago.status_detail})`);
              tgSend(`❌ <b>Pago rechazado (webhook)</b>\nOrden: <code>${orden.id}</code>\nMotivo: ${pago.status_detail || '—'}`).catch(() => {});
            }
          }
        } catch(e) {
          console.warn('[webhook/mp] Error procesando:', e.message);
        }
      })();
      return;
    }

    // ── GET /api/tienda/pago/stripe/config ──────────────────────
    // Devuelve la clave pública para inicializar Stripe.js en el frontend.
    if (pathname === '/api/tienda/pago/stripe/config' && req.method === 'GET') {
      const stripeConf = getStripeConfig();
      if (!stripeConf.publishable_key) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Stripe no configurado' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ publishable_key: stripeConf.publishable_key }));
      return;
    }

    // ── POST /api/tienda/pago/stripe/crear-intent ────────────────
    // Body: { orden_id }  →  Respuesta: { client_secret }
    if (pathname === '/api/tienda/pago/stripe/crear-intent' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { orden_id } = JSON.parse(body || '{}');
          if (!orden_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'orden_id requerido' })); return; }
          const orden = await db.getOrdenById(orden_id);
          if (!orden) { res.writeHead(404); res.end(JSON.stringify({ error: 'Orden no encontrada' })); return; }
          const stripeConf = getStripeConfig();
          if (!stripeConf.secret_key) { res.writeHead(503); res.end(JSON.stringify({ error: 'Stripe no configurado' })); return; }

          const amountCents = Math.round((orden.total || 0) * 100);
          if (amountCents < 100) { res.writeHead(400); res.end(JSON.stringify({ error: 'Monto inválido' })); return; }

          const intent = await stripeApiCall(stripeConf.secret_key, 'POST', '/payment_intents', {
            amount:   amountCents,
            currency: 'ars',
            'metadata[orden_id]': orden_id,
            description: `Orden #${String(orden_id).slice(-8).toUpperCase()} - WZMALLAS`,
          });

          await db.updateOrdenStatus(orden.id, 'pendiente_pago', {
            stripe_payment_intent_id: intent.id,
          });

          res.writeHead(200);
          res.end(JSON.stringify({ client_secret: intent.client_secret }));
        } catch(e) {
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── POST /api/tienda/pago/stripe/confirmar ───────────────────
    // Body: { orden_id, payment_intent_id }
    // Verifica con Stripe y actualiza la orden.
    if (pathname === '/api/tienda/pago/stripe/confirmar' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { orden_id, payment_intent_id } = JSON.parse(body || '{}');
          if (!orden_id || !payment_intent_id) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'orden_id y payment_intent_id requeridos' }));
            return;
          }
          const orden = await db.getOrdenById(orden_id);
          if (!orden) { res.writeHead(404); res.end(JSON.stringify({ error: 'Orden no encontrada' })); return; }

          const stripeConf = getStripeConfig();
          if (!stripeConf.secret_key) { res.writeHead(503); res.end(JSON.stringify({ error: 'Stripe no configurado' })); return; }

          const intent = await stripeApiCall(stripeConf.secret_key, 'GET', '/payment_intents/' + payment_intent_id, null);
          if (intent.status !== 'succeeded') {
            res.writeHead(402);
            res.end(JSON.stringify({ error: 'Pago no completado', stripe_status: intent.status }));
            return;
          }

          const amount = (intent.amount_received || intent.amount || 0) / 100;
          await db.updateOrdenStatus(orden_id, 'pagado', {
            stripe_payment_intent_id: payment_intent_id,
            stripe_payment_status:    intent.status,
            stripe_amount_received:   amount,
          });

          // Notificaciones async
          const cliente = orden.datos?.nombre || orden.datos?.email || 'Cliente';
          const total   = `$${Number(amount || orden.total || 0).toLocaleString('es-AR')}`;
          tgSend(`💳 <b>Pago Stripe aprobado</b> — ${total}\nOrden: <code>${orden_id}</code>\nCliente: ${cliente}\nPI: <code>${payment_intent_id}</code>`).catch(() => {});
          sendVentaTiendaNotification(orden).catch(() => {});

          const emailPago = orden.datos?.email || orden.cliente?.email;
          if (emailPago) {
            sendEmail({
              to: emailPago,
              subject: `💳 Pago recibido · Orden #${String(orden_id).slice(-8).toUpperCase()} · WZMALLAS`,
              html: emailPagoConfirmado({ ...orden, total: amount || orden.total }),
            }).then(r => {
              if (r.ok) console.log(`  ✓ [email] Pago Stripe confirmado enviado a ${emailPago}`);
              else if (!r.skipped) console.warn(`  ⚠ [email] Error email Stripe:`, r.error);
            });
          }

          console.log(`  ✓ [stripe] Orden ${orden_id}: pagado ($${amount})`);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, status: 'pagado' }));
        } catch(e) {
          res.writeHead(e.status || 500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ══════════════════════════════════════════════════════════
    // AUTH TIENDA — Registro / Login / Logout / Me (todos públicos)
    // ══════════════════════════════════════════════════════════

    // ── POST /api/tienda/auth/register ───────────────────────
    if (pathname === '/api/tienda/auth/register' && req.method === 'POST') {
      readBody(req).then(async (rawBody) => {
        try {
          const data = JSON.parse(rawBody);
          const nombre = String(data.nombre || '').trim().slice(0, 100);
          const email  = String(data.email  || '').trim().toLowerCase().slice(0, 200);
          const pass   = String(data.password || '');

          if (!nombre || !email || !pass) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Nombre, email y contraseña son obligatorios' })); return;
          }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Email inválido' })); return;
          }
          if (pass.length < 6) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'La contraseña debe tener al menos 6 caracteres' })); return;
          }

          // Verificar si ya existe (DB)
          const existing = await db.getUserByEmail(email);
          if (existing) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: 'Ya existe una cuenta con ese email' })); return;
          }

          const salt          = crypto.randomBytes(16).toString('hex');
          const password_hash = hashPassword(pass, salt);
          const user = await db.createUser({ nombre, email, password_hash, salt });

          // Auto-login
          const sid     = makeSid();
          const sessData = { user_id: user.id, email, nombre, exp: Date.now() + TIENDA_SESSION_TTL };
          await setTiendaSession(sid, sessData);
          res.setHeader('Set-Cookie', `wz_sid=${sid}; HttpOnly; Path=/; Max-Age=${TIENDA_SESSION_TTL/1000}; SameSite=Lax${cookieSecure(req)}`);
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true, user: { id: user.id, nombre, email } }));
          console.log(`  ✓ [tienda-auth] Nuevo usuario: ${email}`);
        } catch(e) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' }));
        }
      }).catch(e => { res.writeHead(e.status || 400); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    // ── POST /api/tienda/auth/login ──────────────────────────
    if (pathname === '/api/tienda/auth/login' && req.method === 'POST') {
      readBody(req).then(async (rawBody) => {
        try {
          const data  = JSON.parse(rawBody);
          const email = String(data.email    || '').trim().toLowerCase();
          const pass  = String(data.password || '');

          // Rate limiting: máx 8 intentos fallidos por IP en 15 min (anti-bruteforce)
          const _rlIpLogin = getClientIP(req) || 'unknown';
          const _rlNowLogin = Date.now();
          const RL_WIN = 15 * 60 * 1000;
          const RL_MAX = 8;
          if (!_tiendaLoginRL.has(_rlIpLogin)) _tiendaLoginRL.set(_rlIpLogin, { count: 0, since: _rlNowLogin });
          const _rlEntry = _tiendaLoginRL.get(_rlIpLogin);
          if (_rlNowLogin - _rlEntry.since > RL_WIN) { _rlEntry.count = 0; _rlEntry.since = _rlNowLogin; }
          if (_rlEntry.count >= RL_MAX) {
            const wait = Math.ceil((RL_WIN - (_rlNowLogin - _rlEntry.since)) / 60000);
            return setTimeout(() => {
              res.writeHead(429);
              res.end(JSON.stringify({ error: `Demasiados intentos. Esperá ${wait} min.` }));
            }, 1000);
          }

          const user = await db.getUserByEmail(email);
          // Timing-safe: always hash even if user not found (anti-enumeration)
          const dummySalt = '0'.repeat(32);
          const hash = user ? hashPassword(pass, user.salt) : hashPassword(pass, dummySalt);

          // timingSafeEqual previene timing attacks: comparación en tiempo constante
          const hashBuf  = Buffer.from(hash, 'hex');
          const validBuf = Buffer.from(user ? user.password_hash : hash, 'hex');
          const match    = user && crypto.timingSafeEqual(hashBuf, validBuf);
          if (!match) {
            _rlEntry.count++;
            _tiendaLoginRL.set(_rlIpLogin, _rlEntry);
            return setTimeout(() => {
              res.writeHead(401);
              res.end(JSON.stringify({ error: 'Email o contraseña incorrectos' }));
            }, 500);
          }
          // Login exitoso: resetear contador
          _tiendaLoginRL.delete(_rlIpLogin);

          // Actualizar last_login en DB
          await db.updateLastLogin(user.id);

          const sid      = makeSid();
          const sessData = { user_id: user.id, email: user.email, nombre: user.nombre, exp: Date.now() + TIENDA_SESSION_TTL };
          await setTiendaSession(sid, sessData);
          res.setHeader('Set-Cookie', `wz_sid=${sid}; HttpOnly; Path=/; Max-Age=${TIENDA_SESSION_TTL/1000}; SameSite=Lax${cookieSecure(req)}`);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email } }));
          console.log(`  ✓ [tienda-auth] Login: ${email}`);
        } catch(e) {
          console.error('[tienda-auth] login error:', e.message);
          res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' }));
        }
      }).catch(e => { res.writeHead(e.status || 400); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    // ── POST /api/tienda/auth/logout ─────────────────────────
    if (pathname === '/api/tienda/auth/logout' && req.method === 'POST') {
      (async () => {
        const sid = parseCookies(req).wz_sid;
        if (sid) await deleteTiendaSession(sid);
        res.setHeader('Set-Cookie', `wz_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${cookieSecure(req)}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      })().catch(() => { res.writeHead(200); res.end(JSON.stringify({ ok: true })); });
      return;
    }

    // ── GET /api/tienda/me ───────────────────────────────────
    if (pathname === '/api/tienda/me' && req.method === 'GET') {
      (async () => {
        const session = await getTiendaUserFromReq(req);
        if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'No autenticado' })); return; }
        const user = await db.getUserById(session.user_id);
        if (!user) { res.writeHead(404); res.end(JSON.stringify({ error: 'Usuario no encontrado' })); return; }
        res.writeHead(200);
        res.end(JSON.stringify({
          id:         user.id,
          nombre:     user.nombre,
          email:      user.email,
          telefono:   user.telefono  || '',
          direccion:  user.direccion || '',
          altura:     user.altura    || '',
          piso:       user.piso      || '',
          provincia:  user.provincia || '',
          ciudad:     user.ciudad    || '',
          cp:         user.cp        || '',
          created_at: user.created_at,
        }));
      })().catch(e => {
        console.error('[tienda/me] GET error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'Error interno' }));
      });
      return;
    }

    // ── PUT /api/tienda/me ───────────────────────────────────
    // Actualizar nombre, contraseña y/o datos de envío del usuario logueado
    if (pathname === '/api/tienda/me' && req.method === 'PUT') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const session = await getTiendaUserFromReq(req);
        if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'No autenticado' })); return; }
        try {
          const data = JSON.parse(body);

          // Cargar usuario actual para validar contraseña
          const current = await db.getUserById(session.user_id);
          if (!current) { res.writeHead(404); res.end(JSON.stringify({ error: 'Usuario no encontrado' })); return; }

          // Armar patch de campos
          const patch = {};
          if (data.nombre    !== undefined) patch.nombre    = String(data.nombre).trim().slice(0, 100);
          if (data.telefono  !== undefined) patch.telefono  = String(data.telefono).trim().slice(0, 30);
          if (data.direccion !== undefined) patch.direccion = String(data.direccion).trim().slice(0, 120);
          if (data.altura    !== undefined) patch.altura    = String(data.altura).trim().slice(0, 20);
          if (data.piso      !== undefined) patch.piso      = String(data.piso).trim().slice(0, 30);
          if (data.provincia !== undefined) patch.provincia = String(data.provincia).trim().slice(0, 60);
          if (data.ciudad    !== undefined) patch.ciudad    = String(data.ciudad).trim().slice(0, 60);
          if (data.cp        !== undefined) patch.cp        = String(data.cp).trim().slice(0, 10);

          if (data.new_password) {
            const currentHash = hashPassword(String(data.current_password || ''), current.salt);
            if (currentHash !== current.password_hash) {
              res.writeHead(401); res.end(JSON.stringify({ error: 'Contraseña actual incorrecta' })); return;
            }
            if (data.new_password.length < 6) {
              res.writeHead(400); res.end(JSON.stringify({ error: 'La nueva contraseña debe tener al menos 6 caracteres' })); return;
            }
            patch.salt          = crypto.randomBytes(16).toString('hex');
            patch.password_hash = hashPassword(data.new_password, patch.salt);
          }

          const updated = await db.updateUser(session.user_id, patch);

          // Actualizar nombre en sesión si cambió
          if (patch.nombre) {
            const sid = parseCookies(req).wz_sid;
            const s   = await db.getSession(sid).catch(() => _sessionFallback.get(sid));
            if (s) { s.nombre = updated.nombre; await setTiendaSession(sid, s).catch(() => {}); }
          }

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, user: {
            id:        updated.id,
            nombre:    updated.nombre,
            email:     updated.email,
            telefono:  updated.telefono  || '',
            direccion: updated.direccion || '',
            altura:    updated.altura    || '',
            piso:      updated.piso      || '',
            provincia: updated.provincia || '',
            ciudad:    updated.ciudad    || '',
            cp:        updated.cp        || '',
          } }));
        } catch(e) {
          console.error('[tienda/me] PUT error:', e.message);
          res.writeHead(400); res.end(JSON.stringify({ error: 'Body inválido' }));
        }
      });
      return;
    }

    // ── GET /api/tienda/me/pedidos ───────────────────────────
    // Devuelve los pedidos del usuario logueado (match por email O user_id)
    if (pathname === '/api/tienda/me/pedidos' && req.method === 'GET') {
      (async () => {
        const session = await getTiendaUserFromReq(req);
        if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'No autenticado' })); return; }
        const ordenes = await db.getOrdenesByEmail(session.email);
        const mios = ordenes.map(o => ({
          id:              o.id,
          fecha:           o.fecha,
          status:          o.status,
          total:           o.total,
          items_count:     (o.items||[]).length,
          items:           (o.items||[]).map(i => ({ title: i.title, qty: i.qty, price: i.price, img: i.img, variant: i.variant })),
          envio:           o.envio,
          pago:            o.pago,
          tracking_number: o.tracking_number || null,
          shipped_at:      o.shipped_at      || null,
          delivered_at:    o.delivered_at    || null,
        }));
        res.writeHead(200);
        res.end(JSON.stringify({ pedidos: mios, total: mios.length }));
      })().catch(e => {
        console.error('[tienda/me/pedidos] error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'Error interno' }));
      });
      return;
    }

    // ── GET /api/tienda/seguimiento ──────────────────────────
    // Tracking público: requiere orden_id + email (seguridad por conocimiento conjunto)
    if (pathname === '/api/tienda/seguimiento' && req.method === 'GET') {
      (async () => {
        const params   = new URL(req.url, 'http://localhost').searchParams;
        const orden_id = String(params.get('id')    || '').trim();
        const email    = String(params.get('email') || '').trim().toLowerCase();
        if (!orden_id || !email) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Se requiere id y email' })); return;
        }
        const orden = await db.getOrdenById(orden_id);
        if (!orden || (orden.datos?.email || orden.cliente?.email || '').toLowerCase() !== email) {
          res.writeHead(404); res.end(JSON.stringify({ error: 'Orden no encontrada' })); return;
        }
        // Devuelve solo los datos que puede ver el comprador (sin notas_admin, IPs, etc.)
        res.writeHead(200);
        res.end(JSON.stringify({
          id:              orden.id,
          fecha:           orden.fecha,
          status:          orden.status,
          total:           orden.total || (orden.items||[]).reduce((s,i) => s + (i.price||0)*(i.qty||1), 0),
          items:           (orden.items||[]).map(i => ({ title: i.title||i.name, qty: i.qty||1, price: i.price||0, img: i.img||i.thumbnail, variant: i.variant||null })),
          envio:           { metodo: orden.envio?.nombre, precio: orden.envio?.precio },
          pago:            { metodo: orden.pago?.metodo },
          tracking_number: orden.tracking_number || null,
          shipped_at:      orden.shipped_at      || null,
          delivered_at:    orden.delivered_at    || null,
          paid_at:         orden.paid_at         || null,
          cliente:         { nombre: orden.datos?.nombre, email: orden.datos?.email },
        }));
      })().catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    // ── POST /api/tienda/orden/:id/cancelar ──────────────────
    // Cancelación pública por el cliente: requiere conocer id + email
    // (misma seguridad que /seguimiento). Solo permitido si el pago
    // todavía no se confirmó (pendiente / pendiente_pago / rechazado).
    if (pathname.match(/^\/api\/tienda\/orden\/[^/]+\/cancelar$/) && req.method === 'POST') {
      readBody(req).then(async (rawBody) => {
        try {
          const orden_id = decodeURIComponent(pathname.split('/')[4]);
          const data  = JSON.parse(rawBody || '{}');
          const email = String(data.email || '').trim().toLowerCase();
          if (!orden_id || !email) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Se requiere email' })); return;
          }
          const orden = await db.getOrdenById(orden_id);
          if (!orden || (orden.datos?.email || orden.cliente?.email || '').toLowerCase() !== email) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'Orden no encontrada' })); return;
          }
          if (!['pendiente', 'pendiente_pago', 'rechazado'].includes(orden.status)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Esta orden ya no se puede cancelar' }));
            return;
          }
          const actualizada = await db.updateOrdenStatus(orden.id, 'cancelado');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, status: actualizada.status }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
        }
      });
      return;
    }

    // ══════════════════════════════════════════════════════════
    // ADMIN — Gestión de órdenes (requieren auth — isAuthExempt excluye /admin/)
    // ══════════════════════════════════════════════════════════

    // ── GET /api/tienda/admin/ordenes ─────────────────────────
    // Lista órdenes paginadas + stats calculados en SQL. Solo admin.
    if (pathname === '/api/tienda/admin/ordenes' && req.method === 'GET') {
      (async () => {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const status = params.get('status') || undefined;
        const q      = (params.get('q') || '').trim() || undefined;
        const limit  = Math.min(parseInt(params.get('limit')  || '100', 10), 500);
        const offset = Math.max(parseInt(params.get('offset') || '0',   10), 0);

        const [{ ordenes, total }, statsRaw] = await Promise.all([
          db.getOrdenesFiltered({ status, q, limit, offset }),
          db.getOrdenesStats(),
        ]);

        // Formato de stats compatible con el frontend existente
        const stats = {
          total:       statsRaw.ordenes.total,
          hoy:         statsRaw.ordenes.hoy,
          pendiente:   statsRaw.por_estado.pendiente,
          pagado:      statsRaw.por_estado.pagado,
          preparacion: statsRaw.por_estado.preparacion,
          despachado:  statsRaw.por_estado.despachado,
          entregado:   statsRaw.por_estado.entregado,
          cancelado:   statsRaw.por_estado.cancelado,
          ingresos:    statsRaw.ingresos.total,
        };

        res.writeHead(200);
        res.end(JSON.stringify({ ordenes, total, stats }));
      })().catch(e => {
        console.error('[admin/ordenes] Error:', e?.message, e?.stack?.split('\n')[1]);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e?.message || e?.toString() || 'Error desconocido' }));
      });
      return;
    }

    // ── PUT /api/tienda/admin/ordenes/:id ────────────────────
    // Actualiza estado, tracking y/o notas de una orden. Solo admin.
    if (pathname.match(/^\/api\/tienda\/admin\/ordenes\/[^/]+$/) && req.method === 'PUT') {
      if (!checkCSRF(req)) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'csrf_rejected' })); return;
      }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const id   = pathname.split('/').pop();
          const data = JSON.parse(body || '{}');

          // Obtener orden actual
          const actual = await db.getOrdenById(id);
          if (!actual) {
            res.writeHead(404); res.end(JSON.stringify({ error: 'Orden no encontrada' })); return;
          }

          const prevStatus = actual.status;
          const newStatus  = data.status || prevStatus;

          // Armar extraFields para updateOrdenStatus
          const extraFields = {};
          if (data.tracking_number !== undefined) extraFields.tracking_number = data.tracking_number;
          if (data.notas_admin     !== undefined) extraFields.admin_notes     = data.notas_admin;

          const o = await db.updateOrdenStatus(id, newStatus, extraFields);
          const cliente = o.datos || o.cliente || {};

          // Notificación Telegram si cambia estado
          if (newStatus && newStatus !== prevStatus) {
            const statusEmojis = { pagado:'💰', despachado:'🚚', entregado:'✅', cancelado:'❌', reembolsado:'↩️', rechazado:'🚫' };
            const emoji = statusEmojis[newStatus] || '🔄';
            tgSend(
              `${emoji} <b>Orden actualizada</b>\n` +
              `ID: <code>${o.id}</code>\n` +
              `Cliente: ${cliente.nombre || '—'}\n` +
              `${prevStatus} → <b>${newStatus}</b>` +
              (data.tracking_number ? `\nTracking: <code>${data.tracking_number}</code>` : '')
            ).catch(() => {});

            // Email al cliente si es pagado desde admin (transferencia confirmada manualmente)
            if (newStatus === 'pagado' && cliente.email && prevStatus !== 'pagado') {
              sendEmail({
                to:      cliente.email,
                subject: `💳 Pago recibido · Orden #${String(o.id).slice(-8).toUpperCase()} · WZMALLAS`,
                html:    emailPagoConfirmado(o),
              }).catch(() => {});
            }

            // Email al cliente si es despachado (con tracking)
            if (newStatus === 'despachado' && cliente.email) {
              const tracking = data.tracking_number || o.tracking_number;
              sendEmail({
                to:      cliente.email,
                subject: `Tu pedido #${String(o.id).slice(-8).toUpperCase()} fue despachado · WZMALLAS`,
                html:    emailEnvioTracking(o, tracking),
              }).catch(() => {});
            }

            // Email al cliente si fue entregado
            if (newStatus === 'entregado' && cliente.email) {
              sendEmail({
                to:      cliente.email,
                subject: `Tu pedido #${String(o.id).slice(-8).toUpperCase()} fue entregado · WZMALLAS`,
                html:    emailPedidoEntregado(o),
              }).catch(() => {});
            }

            // Email al cliente si fue cancelado
            if (newStatus === 'cancelado' && cliente.email) {
              sendEmail({
                to:      cliente.email,
                subject: `Tu pedido #${String(o.id).slice(-8).toUpperCase()} fue cancelado · WZMALLAS`,
                html:    emailPedidoCancelado(o),
              }).catch(() => {});
            }

            // Email al cliente si fue reembolsado
            if (newStatus === 'reembolsado' && cliente.email) {
              sendEmail({
                to:      cliente.email,
                subject: `Reembolso procesado · Pedido #${String(o.id).slice(-8).toUpperCase()} · WZMALLAS`,
                html:    emailPedidoReembolsado(o),
              }).catch(() => {});
            }
          }

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, orden: o }));
        } catch(e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── GET /api/tienda/admin/stats ───────────────────────────
    // Stats de ventas para dashboard — calculados en SQL. Solo admin.
    if (pathname === '/api/tienda/admin/stats' && req.method === 'GET') {
      (async () => {
        const [stats, topRows, recentRows, softLaunch] = await Promise.all([
          db.getOrdenesStats(),
          // Top 10 productos más vendidos (por unidades en order_items)
          db.pool.query(`
            SELECT
              oi.product_id AS id,
              COALESCE(oi.product_name, oi.product_id::text) AS title,
              SUM(oi.quantity)                               AS qty,
              SUM(oi.unit_price * oi.quantity)               AS ingresos
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status::text IN ('paid','shipped','delivered','completed')
            GROUP BY oi.product_id, oi.product_name
            ORDER BY qty DESC
            LIMIT 10
          `).then(r => r.rows.map(row => ({
            title:    row.title,
            qty:      parseInt(row.qty),
            ingresos: parseFloat(row.ingresos),
          }))).catch(() => []),
          // Últimas 8 órdenes con sus items para el dashboard
          db.pool.query(`
            SELECT
              o.id, o.status::text AS estado, o.total,
              o.customer_name AS nombre_cliente, o.customer_email AS email,
              o.created_at,
              COALESCE(
                json_agg(
                  json_build_object('title', oi.product_name, 'qty', oi.quantity)
                  ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) AS items
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
            LIMIT 8
          `).then(r => r.rows.map(row => ({
            id:             row.id,
            estado:         row.estado,
            total:          parseFloat(row.total) || 0,
            nombre_cliente: row.nombre_cliente || row.email || '',
            email:          row.email || '',
            creado_en:      row.created_at,
            items:          row.items || [],
          }))).catch(() => []),
          db.getSoftLaunchStats(SOFT_LAUNCH_COUPON).catch(() => null),
        ]);

        // Normalizar: exponer pendientes directamente en ordenes
        if (stats.ordenes && stats.por_estado) {
          stats.ordenes.pendientes = stats.por_estado.pendiente || 0;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ ...stats, top_productos: topRows, ordenes_recientes: recentRows, soft_launch: softLaunch }));
      })().catch(e => {
        console.error('[admin/stats] Error:', e?.message, e?.stack?.split('\n')[1]);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e?.message || e?.toString() || 'Error desconocido' }));
      });
      return;
    }

    // ── CUPONES — CRUD (público GET, admin POST/DELETE) ──────
    //
    // Almacena en Stockroom/tienda-cupones.json (getCupones/saveCupones
    // y CUPONES_PATH están definidos a nivel de módulo, ver más arriba).
    // El front (carrito.html) hace GET /api/tienda/cupones como fallback.
    // ─────────────────────────────────────────────────────────

    // GET /api/tienda/cupones — público (para carrito.html)
    if (pathname === '/api/tienda/cupones' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(getCupones()));
      return;
    }

    // GET /api/tienda/admin/cupones — admin
    if (pathname === '/api/tienda/admin/cupones' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(getCupones()));
      return;
    }

    // POST /api/tienda/admin/cupones — crear cupón
    if (pathname === '/api/tienda/admin/cupones' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const code = (data.code || '').toUpperCase().trim();
          if (!code || !data.type) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'code y type son obligatorios' })); return;
          }
          const list = getCupones();
          if (list.find(c => c.code === code)) {
            res.writeHead(409); res.end(JSON.stringify({ error: 'El código ya existe' })); return;
          }
          const newCupon = {
            code,
            type:          data.type,   // 'percent' | 'fixed' | 'freeship'
            value:         parseFloat(data.value) || 0,
            label:         data.label || code,
            active:        data.active !== false,
            createdAt:     new Date().toISOString(),
          };
          if (data.categoria)    newCupon.categoria    = String(data.categoria).trim().toLowerCase();
          if (data.max_descuento > 0) newCupon.max_descuento = parseFloat(data.max_descuento);
          list.push(newCupon);
          saveCupones(list);
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true, cupones: list }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

    // DELETE /api/tienda/admin/cupones/:code — eliminar cupón
    if (pathname.match(/^\/api\/tienda\/admin\/cupones\/[^/]+$/) && req.method === 'DELETE') {
      const code = decodeURIComponent(pathname.split('/').pop()).toUpperCase();
      const list  = getCupones().filter(c => c.code !== code);
      saveCupones(list);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, cupones: list }));
      return;
    }

    // PATCH /api/tienda/admin/cupones/:code — activar/desactivar
    if (pathname.match(/^\/api\/tienda\/admin\/cupones\/[^/]+$/) && req.method === 'PATCH') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const code = decodeURIComponent(pathname.split('/').pop()).toUpperCase();
          const data = JSON.parse(body);
          const list = getCupones();
          const item = list.find(c => c.code === code);
          if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: 'No encontrado' })); return; }

          // Auditoría: registrar cambios en activación/valor del cupón
          const _watch = ['active', 'value', 'max_descuento'];
          const _before = {};
          for (const k of _watch) _before[k] = item[k];

          if (data.active        !== undefined) item.active        = !!data.active;
          if (data.type          !== undefined) item.type          = String(data.type);
          if (data.label         !== undefined) item.label         = data.label;
          if (data.value         !== undefined) item.value         = parseFloat(data.value) || 0;
          if (data.categoria     !== undefined) item.categoria     = data.categoria ? String(data.categoria).trim().toLowerCase() : null;
          if (data.max_descuento !== undefined) item.max_descuento = parseFloat(data.max_descuento) || 0;

          const _changes = {};
          for (const k of _watch) if (item[k] !== _before[k]) _changes[k] = { antes: _before[k], despues: item[k] };
          if (Object.keys(_changes).length) auditLog(req, 'cupon_update', code, _changes);

          saveCupones(list);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, cupones: list }));
        } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }

    // ── GET /api/tienda/admin/audit-log ───────────────────────
    // Últimas N entradas del log de auditoría (cambios críticos: precio,
    // stock, alta/baja de productos, cupones). ?limit=100 (máx 500).
    if (pathname === '/api/tienda/admin/audit-log' && req.method === 'GET') {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const limit = Math.min(parseInt(params.get('limit'), 10) || 100, 500);
        let lines = [];
        try { lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean); } catch {}
        const entries = lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        res.writeHead(200);
        res.end(JSON.stringify({ entries }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal_error', message: e.message }));
      }
      return;
    }

    // ── POST /api/tienda/correo/rates ───────────────────────
    // Retorna costo fijo de envío por Correo Argentino: $10.000
    // Body: { cpDestino: "1043", items: [{ qty: 1 }, ...] }
    // Respuesta: { configured: true, rates: 10000 }
    if (pathname === '/api/tienda/correo/rates' && req.method === 'POST') {
      (async () => {
        let rawBody = '';
        req.on('data', c => rawBody += c);
        req.on('end', async () => {
          try {
            const { cpDestino = '' } = JSON.parse(rawBody);
            const cpClean = cpDestino.replace(/\D/g, '');
            if (!cpClean) {
              return json(res, 400, { error: 'cpDestino requerido' });
            }

            // Costo fijo de envío por Correo Argentino
            const fixedRate = 10000;
            return json(res, 200, { configured: true, rates: fixedRate });
          } catch(e) {
            console.error('[correo/rates] Parse error:', e.message);
            return json(res, 400, { error: 'Request inválido' });
          }
        });
      })();
      return;
    }

    // ── GET /api/tienda/envio?id=MLA...&cp=#### ──────────────
    // Cotización real de Mercado Envíos para la ficha de producto:
    // costo y tiempo estimado de entrega según el código postal del
    // comprador — usa la cuenta de ML (con su token OAuth ya gestionado
    // por mlGetAuth, con auto-refresh) que sea dueña de la publicación.
    // Resultado cacheado en DB (TTL 6h) para no consumir cuota de la API
    // de ML en cada visita a la ficha.
    if (pathname === '/api/tienda/envio' && req.method === 'GET') {
      (async () => {
        try {
          const params = new URL(req.url, 'http://localhost').searchParams;
          const itemId = (params.get('id') || '').trim();
          const cp     = (params.get('cp') || '').replace(/\D/g, '');

          if (!/^ML[A-Z]\d+$/.test(itemId)) {
            return json(res, 400, { error: 'id de publicación inválido' });
          }
          if (!/^\d{4}$/.test(cp)) {
            return json(res, 400, { error: 'Código postal inválido (debe tener 4 dígitos)' });
          }

          // 1) Caché persistente (6 horas)
          const cached = await db.getShippingCache(itemId, cp);
          if (cached) return json(res, 200, cached);

          // 2) Probar con cada cuenta hasta encontrar la dueña de la publicación
          //    (igual patrón que /reviews — 403/404 → seguir con la próxima)
          const allAccts = (fullConfig.accounts && fullConfig.accounts.length) ? fullConfig.accounts : [config];
          let raw, lastErr;
          for (const acct of allAccts) {
            try {
              raw = await mlGetAuth(acct, `/items/${encodeURIComponent(itemId)}/shipping_options?zip_code=${cp}`);
              break;
            } catch (e2) {
              lastErr = e2;
              if (e2.status === 403 || e2.status === 404) continue;
              throw e2;
            }
          }
          if (!raw) throw (lastErr || new Error('No se pudo cotizar el envío'));

          const result = {
            zip_code: cp,
            options: (raw.options || []).map(opt => ({
              id:       opt.id,
              name:     friendlyShippingName(opt),
              cost:     typeof opt.cost === 'number' ? opt.cost : null,
              free:     opt.cost === 0,
              type:     opt.shipping_option_type || '',
              estimate: formatDeliveryEstimate(opt.estimated_delivery_time),
            })).filter(o => o.cost !== null),
          };

          await db.setShippingCache(itemId, cp, result);
          return json(res, 200, result);
        } catch (e) {
          const status = (e && e.status === 404) ? 404 : 200;
          // Devolvemos 200 con configured:false en vez de 5xx — así el front
          // puede mostrar un mensaje amable ("no disponible para tu zona")
          // en lugar de tratarlo como un error de red.
          console.error('[tienda/envio] Error:', e.message || e);
          return json(res, status, { configured: false, error: 'No se pudo calcular el envío para ese código postal' });
        }
      })();
      return;
    }

    // ── GET /api/tienda/reviews/:itemId ─────────────────────
    if (pathname.match(/^\/api\/tienda\/reviews\/[^/]+$/) && req.method === 'GET') {
      (async () => {
        const itemId = pathname.split('/').pop();
        const params = new URL(req.url, 'http://localhost').searchParams;
        const offset = parseInt(params.get('offset') || '0', 10);
        const limit  = parseInt(params.get('limit')  || '10', 10);

        // Productos locales (no-ML) no tienen reseñas en ML — devolver vacío
        // ML IDs siguen el formato: prefijo de país (MLA, MLB, MLM...) + dígitos
        if (!/^ML[A-Z]\d+$/.test(itemId)) {
          res.writeHead(200);
          res.end(JSON.stringify({
            rating_average: 0, total: 0, offset, limit, reviews: [], _local: true,
          }));
          return;
        }

        try {
          // Revisar caché persistente (TTL: 10 minutos)
          const cached = await db.getReviewsCache(itemId, offset, limit, 10 * 60 * 1000);
          if (cached) {
            res.writeHead(200);
            res.end(JSON.stringify(cached));
            return;
          }
          // Intentar con la cuenta activa; si falla por permisos probar las demás
          let raw;
          const allAccts = (fullConfig.accounts || [config]);
          for (const acct of allAccts) {
            try { raw = await mlGetAuth(acct, `/reviews/item/${itemId}?offset=${offset}&limit=${limit}`); break; }
            catch(e2) { if (e2.status !== 403) throw e2; }
          }
          if (!raw) throw new Error('No account with review permissions available');
          const result = {
            rating_average : raw.rating_average || 0,
            total          : raw.paging?.total  || 0,
            offset,
            limit,
            reviews: (raw.reviews || []).map(r => ({
              id           : r.id,
              title        : r.title   || '',
              content      : r.content || '',
              rate         : r.rate    || 0,
              date_created : r.date_created || null,
              photos       : (r.media || [])
                               .filter(m => m.type === 'photo' && m.status === 'published')
                               .map(m => {
                                 const vars = m.variations || [];
                                 const pick = (target) => (vars.find(v => v.size === target) || {}).url || '';
                                 return {
                                   thumb : pick('400x400') || pick('320x320') || (vars[0] || {}).url || '',
                                   full  : pick('800x800') || pick('675x1200') || (vars[0] || {}).url || '',
                                 };
                               })
                               .filter(ph => ph.thumb),
            })),
          };
          // Guardar en caché persistente
          await db.setReviewsCache(itemId, offset, limit, result);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch(e) {
          console.error(`[tienda/reviews] Error ${itemId}:`, e.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
      return;
    }

    // ── GET /api/tienda/stats ────────────────────────────────
    // Agrega reseñas de los top N productos por sold_quantity.
    // Cache de 6 horas (operación costosa: N llamadas a ML).
    if (pathname === '/api/tienda/stats' && req.method === 'GET') {
      (async () => {
        // Cache hit (fresca)
        if (_statsCache && Date.now() < _statsCache.expiry) {
          res.writeHead(200);
          res.end(JSON.stringify(_statsCache.data));
          return;
        }
        // Cache vencida: responder con datos viejos inmediatamente y recalcular en bg
        // Evita bloquear el event loop con 40 llamadas a ML en foreground
        if (_statsCache) {
          res.writeHead(200);
          res.end(JSON.stringify({ ..._statsCache.data, _stale: true }));
          // Recalcular en background sin bloquear
          _statsCache.expiry = Date.now() + 6 * 60 * 60 * 1000; // evitar refresh doble
          setImmediate(() => _refreshStatsCache());
          return;
        }

        // Sin caché en absoluto: calcular en foreground (primera vez) pero con timeout corto
        try {
          await _refreshStatsCache();
          if (_statsCache) {
            res.writeHead(200);
            res.end(JSON.stringify(_statsCache.data));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ rating_average: 0, total_reviews: 0, total_sold: 0 }));
          }
        } catch(e) {
          console.error('[tienda/stats] Error:', e.message);
          res.writeHead(200); // 200 con fallback vacío — la tienda no debe caerse por esto
          res.end(JSON.stringify({ rating_average: 0, total_reviews: 0, total_sold: 0 }));
        }
      })();
      return;
    }

    // Ruta /api/tienda no reconocida
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
    return;
  }
  // ══════════════════════════════════════════════════════════════
  // FIN RUTAS TIENDA
  // ══════════════════════════════════════════════════════════════

  // ── /api/* → proxy ML ──────────────────────────────────────
  // /api/stockroom/ y /api/tienda/ son rutas internas — no tocar con el proxy ML
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/stockroom/') && !pathname.startsWith('/api/tienda/')) {
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

  // ══════════════════════════════════════════════════════════════
  //  MODULE-BASED ROUTES (Fase 4 — routes/ extracted handlers)
  // ══════════════════════════════════════════════════════════════
  if (_vincRouter(req, res, pathname)) return;
  if (_flexRouter(req, res, pathname, parsed)) return;
  if (_despachosRouter(req, res, pathname, parsed)) return;
  if (handlePdfResumenes(req, res, pathname, parsed)) return;
  if (_preguntasRouter(req, res, pathname)) return;
  if (_backupRouter(req, res, pathname)) return;
  if (_alibabaRouter(req, res, pathname)) return;

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
        atomicWriteFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
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
      const desde    = String(parts['desde']   || '').trim();
      const hasta    = String(parts['hasta']    || '').trim();
      const modo     = String(parts['modo']     || 'fundas').trim();

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
      if (desde) args.push('--desde', desde);
      if (hasta) args.push('--hasta', hasta);

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

  // ── /ventas-rango?from=YYYY-MM-DD&to=YYYY-MM-DD → ventas de un rango ──
  if (pathname === '/ventas-rango' && req.method === 'GET') {
    const userId = config.user_id;
    if (!userId) { json(res, 400, { error: 'user_id no configurado' }); return; }
    const from = String(parsed.query.from || '').slice(0, 10);
    const to   = String(parsed.query.to   || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      json(res, 400, { error: 'from/to deben ser YYYY-MM-DD' }); return;
    }
    const fromStr = `${from}T00:00:00.000-0300`;
    const toStr   = `${to}T23:59:59.000-0300`;
    const mlPath  = `/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(fromStr)}&order.date_created.to=${encodeURIComponent(toStr)}&sort=date_desc&limit=50`;

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
          }));
          const total_ventas = orders.reduce((s, o) => s + (o.total_amount || 0), 0);
          json(res, 200, { ok: true, from, to, orders, total_ventas, count: orders.length });
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
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════

  // ── Imágenes de productos propios (/uploads/productos-propios/*) ─
  // Ver POST /api/tienda/admin/productos-propios/imagen (guarda acá los .jpg/.png/.webp/.gif).
  if (pathname.startsWith('/uploads/productos-propios/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const fname  = path.basename(pathname);
    const imgDir = path.join(__dirname, 'uploads', 'productos-propios');
    const resolved = path.resolve(imgDir, fname);
    const dirNorm  = path.normalize(imgDir);
    if (!path.normalize(resolved).startsWith(dirNorm + path.sep)) {
      res.setHeader('Cache-Control', 'no-store'); res.writeHead(404); res.end('Not found'); return;
    }
    let stat;
    try { stat = fs.statSync(resolved); } catch {
      res.setHeader('Cache-Control', 'no-store'); res.writeHead(404); res.end('Not found'); return;
    }
    if (!stat.isFile()) { res.setHeader('Cache-Control', 'no-store'); res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(resolved).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type':   mime,
      'Content-Length': stat.size,
      'Cache-Control':  'public, max-age=86400',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  // ── Videos subidos por el admin (/uploads/videos/*) ─────────
  // Servidos con soporte de Range para que el <video> pueda buscar.
  // Ver POST /api/tienda/admin/productos/:id/video (guarda acá los .mp4/.webm).
  if (pathname.startsWith('/uploads/videos/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const fname    = path.basename(pathname);
    const videoDir = path.join(__dirname, 'uploads', 'videos');
    const resolved = path.resolve(videoDir, fname);
    const dirNorm  = path.normalize(videoDir);
    if (!path.normalize(resolved).startsWith(dirNorm + path.sep)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    let stat;
    try { stat = fs.statSync(resolved); } catch { res.writeHead(404); res.end('Not found'); return; }
    if (!stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(resolved).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end   = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type':   mime,
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control':  'public, max-age=86400',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type':   mime,
      'Accept-Ranges':  'bytes',
      'Content-Length': stat.size,
      'Cache-Control':  'public, max-age=86400',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  // ── Archivos estáticos de la TIENDA WEB (/tienda/*) ─────────
  if (pathname === '/tienda' || pathname === '/tienda/' || pathname.startsWith('/tienda/')) {
    // Redirect /tienda → /tienda/ para que los paths relativos del HTML resuelvan bien
    if (pathname === '/tienda') {
      res.writeHead(302, { Location: '/tienda/' });
      res.end();
      return;
    }

    // Calcular sub-ruta dentro de la carpeta tienda
    let subPath = pathname.slice('/tienda'.length) || '/index.html';
    if (subPath === '/' || subPath === '') subPath = '/index.html';

    const resolved = path.resolve(TIENDA_DIR, '.' + subPath);

    // Páginas (sin extensión o .html) que no existen → 404.html personalizada.
    // Assets (imágenes, JS, CSS, etc.) que no existen → 404 plano, no tiene
    // sentido devolver una página HTML para un <img src> o <script src> roto.
    const reqExt    = path.extname(resolved).toLowerCase();
    const wantsPage = reqExt === '' || reqExt === '.html';
    const notFound404Page = () => {
      if (wantsPage) {
        const custom404 = path.join(TIENDA_DIR, '404.html');
        if (fs.existsSync(custom404)) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(custom404).pipe(res);
          return;
        }
      }
      res.writeHead(404); res.end('Not found');
    };

    // Seguridad: no salir de TIENDA_DIR (normalizado para Windows/Linux)
    const tiendaNorm   = path.normalize(TIENDA_DIR);
    const resolvedNorm = path.normalize(resolved);
    if (!resolvedNorm.startsWith(tiendaNorm + path.sep) && resolvedNorm !== tiendaNorm) {
      notFound404Page(); return;
    }

    const ext  = path.extname(resolvedNorm).toLowerCase();
    const mime = MIME[ext];
    if (!mime) { notFound404Page(); return; }

    let tiendaStat;
    try { tiendaStat = fs.statSync(resolvedNorm); } catch { tiendaStat = null; }
    if (!tiendaStat || !tiendaStat.isFile()) { notFound404Page(); return; }

    const tiendaHeaders = { 'Content-Type': mime };
    // Componentes JS/CSS: cacheables porque se versionan con ?v=N en el HTML
    // (header.js?v=2, etc.) y el HTML se sirve no-store, así un cambio de
    // versión se propaga al instante. Con ?v= presente el contenido de esa URL
    // nunca cambia → immutable 1 año. Sin ?v= (acceso directo, poco común) se
    // cachea poco por las dudas. ⚠️ IMPORTANTE: al editar un componente, subí
    // el ?v=N en los HTML que lo referencian, si no los visitantes verán la
    // versión vieja.
    const hasVersionQuery = !!parsed.query.v;
    if (subPath.startsWith('/components/') || ext === '.js' || ext === '.css') {
      tiendaHeaders['Cache-Control'] = hasVersionQuery
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    }
    // Agregar headers de seguridad a páginas HTML de la tienda pública
    if (ext === '.html') {
      tiendaHeaders['X-Frame-Options'] = 'DENY';
      tiendaHeaders['X-Content-Type-Options'] = 'nosniff';
      tiendaHeaders['Referrer-Policy'] = 'strict-origin-when-cross-origin';
      tiendaHeaders['Content-Security-Policy'] =
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://sdk.mercadopago.com https://www.mercadopago.com https://www.googletagmanager.com https://*.googletagmanager.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: https://*.mlstatic.com http://*.mlstatic.com https://mlstatic.com https://http2.mlstatic.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; " +
        "connect-src 'self' https://api.mercadolibre.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com; " +
        "frame-src https://www.mercadopago.com https://*.mercadopago.com https://www.google.com https://maps.google.com https://www.youtube.com https://www.youtube-nocookie.com https://www.googletagmanager.com; " +
        "media-src 'self' blob:; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    }
    res.writeHead(200, tiendaHeaders);
    fs.createReadStream(resolvedNorm).pipe(res);
    return;
  }

  // ── Archivos estáticos (panel admin + raíz) ──────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;

  // Block sensitive files by basename (case-insensitive)
  const basename = path.basename(filePath).toLowerCase();
  const BLOCKED_FILES = new Set([
    'server.js', 'config.json', 'tokens.json', 'accounts.json', 'vinculaciones.json',
    'vinculaciones-pending.json', 'vinculaciones-log.json', 'telegram-notified-questions.json',
    'tienda-pending-alerted.json',
    'tienda-cupones.json', 'tienda-users.json', 'tienda-ordenes.json',
    'ordenes.json', 'flex_zones.json',
    'sessions.json', 'auth.json', 'rate_limits.json',
    'package.json', 'package-lock.json', '.env', '.env.local', '.env.production',
    'readme.md', 'security_setup.md', 'alibaba-mapping.json',
  ]);
  if (BLOCKED_FILES.has(basename) || basename.startsWith('.') || basename.endsWith('.env')) {
    res.writeHead(404); res.end('Not found'); return;
  }

  // Block sensitive directories
  const lowPath = filePath.toLowerCase().replace(/\\/g, '/');
  const BLOCKED_DIRS = ['/memory/', '/node_modules/', '/.git/', '/data/', '/backup/', '/backups/', '/routes/', '/lib/'];
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

  let resolvedStat;
  try { resolvedStat = fs.statSync(resolved); } catch { resolvedStat = null; }
  if (!resolvedStat || !resolvedStat.isFile()) {
    // Si es una ruta de la tienda → 404 amigable
    if (filePath.startsWith('/tienda/')) {
      res.writeHead(404, {'Content-Type':'text/html; charset=utf-8'});
      res.end(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página no encontrada · WZMALLAS</title><link rel="stylesheet" href="/tienda/css/design-system.css"><style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:32px}.wrap{max-width:480px}.code{font-family:var(--font-accent);font-size:96px;font-weight:700;color:var(--border-2);line-height:1;margin:0}h1{font-family:var(--font-accent);font-size:24px;font-weight:600;color:var(--ink);margin:16px 0 8px}p{color:var(--text-2);font-size:15px;margin:0 0 32px}.btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}</style></head><body><div class="wrap"><p class="code">404</p><h1>Esta página no existe</h1><p>El producto o página que buscás no se encontró.<br>Puede que haya sido eliminado o el link esté mal.</p><div class="btns"><a href="/tienda/" class="btn-primary" style="text-decoration:none">Ir al inicio</a><a href="/tienda/catalogo.html" class="btn-secondary" style="text-decoration:none">Ver catálogo</a></div></div></body></html>`);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  const mime = MIME[ext];
  const fType = getFileType(ext);

  // Para HTML del panel admin: CSP con 'unsafe-inline' (sin nonces).
  // El panel admin es localhost-only; los nonces en CSP3 anulan 'unsafe-inline'
  // para onclick/event-handlers, rompiendo toda la interactividad.
  if (ext === '.html') {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https://*.mlstatic.com http://*.mlstatic.com https://mlstatic.com https://*.alicdn.com https://sc04.alicdn.com; " +
      "connect-src 'self' https://api.mercadolibre.com; " +
      "frame-src https://www.google.com https://maps.google.com https://*.google.com; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self' https://auth.mercadolibre.com.ar https://auth.mercadolibre.com"
    );
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(resolved).pipe(res);
});

let lastVincCheck = null;

// ══════════════════════════════════════════════════════════════
//  TELEGRAM BOT
//  Configurar en config.json:
//    "telegram": { "bot_token": "123:ABC...", "chat_id": "-100..." }
// ══════════════════════════════════════════════════════════════

function tgSend(text, keyboard) {
  const tg = fullConfig.telegram;
  if (!tg?.bot_token || !tg?.chat_id) return Promise.resolve();
  const params = { chat_id: tg.chat_id, text, parse_mode: 'HTML' };
  if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
  return tgRequest(tg.bot_token, 'sendMessage', params);
}

// Edita un mensaje existente (in-place). Se usa al tocar un botón para
// reemplazar la notificación por su resultado, sin generar mensajes nuevos
// ni dejar botones tocables (evita doble-tap sobre ajustes ya aplicados).
// keyboard omitido o [] → quita los botones.
function tgEdit(chatId, messageId, text, keyboard) {
  const tg = fullConfig.telegram;
  if (!tg?.bot_token || !chatId || !messageId) return Promise.resolve();
  const params = {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard || [] },
  };
  return tgRequest(tg.bot_token, 'editMessageText', params).catch(() => {});
}

async function sendTgAdjustmentNotification(adj) {
  const tg = fullConfig.telegram;
  if (!tg?.bot_token || !tg?.chat_id) return;

  // ── Ajustes por variante: no tienen "trigger" (venta puntual) sino N
  // variantes desbalanceadas entre cuentas, posiblemente repartidas en
  // varios items. Gestionar esto con botones de Telegram es poco práctico
  // (1 botón por variante por item), así que mostramos un resumen y
  // remitimos a la web, donde está el detalle completo y el botón "Aplicar".
  if (adj.type === 'variant') {
    const mm = adj.variantMismatches || [];
    let text = `🔀 <b>Variantes desbalanceadas</b> · ${adj.groupName}\n\n`;
    for (const m of mm) {
      const detalle = m.perItem.map(p => `${_shortAcct(p.acctLabel)} x${p.qty}`).join(' vs ');
      text += `🎨 ${m.label}: ${detalle} → x${m.targetQty}\n`;
    }

    let keyboard;
    if (mm.length === 1) {
      // Una sola variante desalineada: ofrecer un botón por cada cuenta para
      // elegir cuál tiene la cantidad correcta (sin tener que ir a la web).
      const m = mm[0];
      text += `\nElegí qué cuenta tiene el stock correcto:`;
      keyboard = m.perItem.map(p =>
        [{ text: `✅ Usar ${_shortAcct(p.acctLabel)} x${p.qty}`, callback_data: `vc:${adj.id}:0:${p.itemId}` }]
      );
      keyboard.push([{ text: '✕ Descartar', callback_data: `dis:${adj.id}` }]);
    } else {
      text += `\nGestioná esto desde la web (Vinculaciones → Pendientes) — son ${mm.length} variantes, no se pueden ajustar con botones acá.`;
      keyboard = [[{ text: '✕ Descartar', callback_data: `dis:${adj.id}` }]];
    }

    const sent = await tgSend(text, keyboard);
    console.log('[tg] Notificación enviada para ajuste:', adj.id);
    return (sent && sent.ok && sent.result)
      ? { chatId: sent.result.chat?.id, msgId: sent.result.message_id }
      : null;
  }

  const hasTrigger = !!adj.trigger;

  // Encabezado: producto + variante vendida (una sola vez)
  let text = `${hasTrigger ? '🔻' : '⚠️'} <b>${hasTrigger ? 'Venta' : 'Stock desincronizado'}</b> · ${adj.groupName}\n`;
  const tDeltas = adj.trigger?.variantDeltas || [];
  if (tDeltas.length) {
    text += `🎨 ${tDeltas.map(d => `${_fmtVarDelta(d)} (−${d.delta})`).join(', ')}\n`;
  }
  text += '\n';

  // Estado: quién vendió vs quién quedó desincronizado
  if (hasTrigger) {
    text += `✅ <b>${_shortAcct(adj.trigger.acctLabel)}</b> vendió → <b>${adj.trigger.to} u.</b>\n`;
  }
  for (const ch of adj.changes) {
    text += `⚠️ <b>${_shortAcct(ch.acctLabel)}</b> quedó en ${ch.from} u.\n`;
  }

  // Botones — uno por fila. El de la cuenta que vendió va primero y marcado.
  const keyboard = [];
  if (hasTrigger) {
    keyboard.push([{ text: `✅ Sincronizar a ${adj.trigger.to} u. · recomendado`, callback_data: `apply:${adj.id}` }]);
  }
  for (const ch of adj.changes) {
    const cbData = `sf:${adj.id}:${ch.itemId}`;
    if (cbData.length <= 64) {
      keyboard.push([{ text: `↩️ Usar ${ch.from} u. de ${_shortAcct(ch.acctLabel)}`, callback_data: cbData }]);
    }
  }
  keyboard.push([{ text: '✕ Descartar', callback_data: `dis:${adj.id}` }]);

  const sent = await tgSend(text, keyboard);
  console.log('[tg] Notificación enviada para ajuste:', adj.id);
  // Devuelve la referencia del mensaje para poder editarlo si luego la venta
  // se cancela (auto-resolve) y hay que quitar los botones.
  return (sent && sent.ok && sent.result)
    ? { chatId: sent.result.chat?.id, msgId: sent.result.message_id }
    : null;
}

// ── Manejo de callbacks de botones ────────────────────────────
async function handleTgCallback(cb) {
  const tg = fullConfig.telegram;
  // No-bloqueante: cierra el spinner del botón en Telegram sin frenar el
  // procesamiento (antes esperaba la respuesta de Telegram antes de empezar).
  tgRequest(tg.bot_token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  const data = cb.data || '';
  const firstColon = data.indexOf(':');
  const action = firstColon === -1 ? data : data.slice(0, firstColon);
  const rest   = firstColon === -1 ? '' : data.slice(firstColon + 1);

  // Contexto del mensaje que tiene el botón → permite editarlo in-place
  const _chatId = cb.message?.chat?.id;
  const _msgId  = cb.message?.message_id;
  // Edita el mensaje original (quita botones); si no hay contexto, manda uno nuevo
  const reply = (text, keyboard) => (_chatId && _msgId)
    ? tgEdit(_chatId, _msgId, text, keyboard)
    : tgSend(text, keyboard);

  try {
    if (action === 'apply') {
      // Aplica el ajuste tal como está (el item trigger es la fuente de verdad)
      const allAdj = loadPendingAdjustments();
      const adj = allAdj.find(a => a.id === rest);
      if (!adj || adj.status !== 'pending') { await reply(_adjStaleMsg(adj)); return; }
      const allAccounts = fullConfig.accounts || [];

      // Feedback inmediato in-place (quita botones → no se puede re-tocar)
      reply(`🔄 Sincronizando ${adj.changes.length} item(s) en ML...`).catch(() => {});

      // Procesar items en PARALELO (Promise.allSettled para que un fallo no aborte el resto).
      // Antes era serial: por cada item refresh + GET + PUT (3 HTTPs) × N items.
      // Con 3 items y 2-5s por HTTP → 18-45s. Ahora corre todo en paralelo: ~max(latencia).
      const results = await Promise.allSettled(adj.changes.map(async ch => {
        const acct = allAccounts.find(a => a.id === ch.accountId);
        if (!acct) return { skipped: true };
        await refreshAccountToken(acct);
        const itemData = await mlGetAuth(acct, '/items/' + ch.itemId);
        const vars = itemData.variations || [];
        if (vars.length) {
          const srcDeltas = ch.sourceVariantDeltas || [];
          let newVars;
          if (srcDeltas.length > 0) {
            newVars = vars.map(v => ({ id: v.id, available_quantity: v.available_quantity || 0 }));
            for (const sd of srcDeltas) {
              const mv = vars.find(v => _varKeysAll(v).some(k => k === sd.attrKey));
              const target = mv ? newVars.find(v => v.id === mv.id)
                                : newVars.reduce((m, v) => v.available_quantity > m.available_quantity ? v : m, newVars[0]);
              if (target) target.available_quantity = Math.max(0, target.available_quantity - sd.delta);
            }
          } else {
            const oldTotal = ch.from || 1;
            newVars = vars.map(v => ({
              id: v.id,
              available_quantity: Math.max(0, oldTotal === 0
                ? Math.floor(adj.targetStock / vars.length)
                : Math.round((v.available_quantity || 0) / oldTotal * adj.targetStock)),
            }));
          }
          const expected = newVars.reduce((s, v) => s + (v.available_quantity || 0), 0);
          await mlPutVerified(acct, ch.itemId, { variations: newVars }, expected);
        } else {
          await mlPutVerified(acct, ch.itemId, { available_quantity: adj.targetStock }, adj.targetStock);
        }
        return { applied: true, itemId: ch.itemId };
      }));

      let applied = 0, failed = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.applied) applied++;
        else if (r.status === 'rejected') {
          failed++;
          console.log('[tg] Error aplicando', adj.changes[i].itemId, r.reason?.message || r.reason);
        }
      });

      adj.status = 'applied'; adj.appliedAt = new Date().toISOString();
      savePendingAdjustments(allAdj);
      appendVincLog({ action: 'applied', source: 'telegram', adjId: adj.id, groupId: adj.groupId, triggerAcctLabel: adj.trigger?.acctLabel, targetStock: adj.targetStock, itemsApplied: applied, variantDeltas: adj.trigger?.variantDeltas || [] });
      const failMsg = failed ? ` · ${failed} fallido(s)` : '';
      await reply(`✅ <b>${adj.groupName}</b>\nStock sincronizado a ${adj.targetStock} u. en ${applied} publicación(es)${failMsg}.`);

    } else if (action === 'sf') {
      // Sync desde un item específico (ese item es la fuente de verdad)
      const c2 = rest.indexOf(':');
      const adjId = rest.slice(0, c2);
      const srcItemId = rest.slice(c2 + 1);
      const allAdj = loadPendingAdjustments();
      const adj = allAdj.find(a => a.id === adjId);
      if (!adj || adj.status !== 'pending') { await reply(_adjStaleMsg(adj)); return; }

      const allAccounts = fullConfig.accounts || [];
      const vincFp = path.join(__dirname, 'vinculaciones.json');
      const vinc = JSON.parse(fs.readFileSync(vincFp, 'utf8'));
      const group = vinc.groups.find(g => g.id === adj.groupId);
      if (!group) { await reply('⚠️ Grupo no encontrado.'); return; }

      const srcVincItem = group.items.find(it => it.itemId === srcItemId);
      const srcAcct = allAccounts.find(a => a.id === srcVincItem?.accountId);
      if (!srcAcct) { await reply('⚠️ Cuenta fuente no encontrada.'); return; }

      await refreshAccountToken(srcAcct);
      const srcData = await mlGetAuth(srcAcct, '/items/' + srcItemId);
      const srcVars = srcData.variations || [];
      const srcTotal = srcVars.length
        ? srcVars.reduce((s, v) => s + (v.available_quantity || 0), 0)
        : (srcData.available_quantity || 0);
      const srcVarMap = {};
      srcVars.forEach(v => { _varKeysAll(v).forEach(k => { if (k) srcVarMap[k] = v.available_quantity || 0; }); });

      // Items destino (todos menos el source)
      const targets = group.items.filter(it => it.itemId !== srcItemId);
      const srcLabel = srcAcct.label || srcAcct.id;

      // Feedback inmediato in-place
      reply(`🔄 Sincronizando ${targets.length} item(s) desde ${_shortAcct(srcLabel)} (x${srcTotal})...`).catch(() => {});

      // Procesar items destino en PARALELO
      const results = await Promise.allSettled(targets.map(async it => {
        const acct = allAccounts.find(a => a.id === it.accountId);
        if (!acct) return { skipped: true };
        await refreshAccountToken(acct);
        const itemData = await mlGetAuth(acct, '/items/' + it.itemId);
        const vars = itemData.variations || [];
        if (vars.length && Object.keys(srcVarMap).length) {
          const newVars = vars.map(v => {
            const keys = _varKeysAll(v);
            let qty = null;
            for (const k of keys) { if (srcVarMap[k] != null) { qty = srcVarMap[k]; break; } }
            return { id: v.id, available_quantity: Math.max(0, qty != null ? qty : v.available_quantity || 0) };
          });
          const expected = newVars.reduce((s, v) => s + (v.available_quantity || 0), 0);
          await mlPutVerified(acct, it.itemId, { variations: newVars }, expected);
        } else {
          await mlPutVerified(acct, it.itemId, { available_quantity: srcTotal }, srcTotal);
        }
        return { applied: true, itemId: it.itemId };
      }));

      let applied = 0, failed = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.applied) applied++;
        else if (r.status === 'rejected') {
          failed++;
          console.log('[tg] Error sync-from', targets[i].itemId, r.reason?.message || r.reason);
        }
      });

      adj.status = 'applied'; adj.appliedAt = new Date().toISOString();
      savePendingAdjustments(allAdj);
      appendVincLog({ action: 'sync-from', source: 'telegram', adjId: adj.id, groupId: adj.groupId, syncFromLabel: srcLabel, syncFromStock: srcTotal, itemsApplied: applied });
      const failMsg = failed ? ` · ${failed} fallido(s)` : '';
      await reply(`✅ <b>${adj.groupName}</b>\nStock sincronizado a ${srcTotal} u. (desde ${_shortAcct(srcLabel)}) en ${applied} publicación(es)${failMsg}.`);

    } else if (action === 'vc') {
      // Elegir, para la única variante desalineada de un ajuste tipo "variant",
      // qué cuenta tiene la cantidad correcta (botón generado en
      // sendTgAdjustmentNotification cuando mm.length === 1).
      const parts = rest.split(':');
      const adjId = parts[0];
      const mmIdx = parseInt(parts[1], 10);
      const chosenItemId = parts.slice(2).join(':');
      const allAdj = loadPendingAdjustments();
      const adj = allAdj.find(a => a.id === adjId);
      if (!adj || adj.status !== 'pending') { await reply(_adjStaleMsg(adj)); return; }

      const mm = (adj.variantMismatches || [])[mmIdx];
      if (!mm) { await reply('⚠️ Variante no encontrada.'); return; }
      const chosen = mm.perItem.find(p => p.itemId === chosenItemId);
      if (!chosen) { await reply('⚠️ Opción no encontrada.'); return; }

      const updatedMm = { ...mm, targetQty: chosen.qty };
      adj.variantMismatches = adj.variantMismatches.map((m, i) => i === mmIdx ? updatedMm : m);
      adj.changes = buildVariantChangesFromMismatches(adj.variantMismatches);

      reply('🔄 Aplicando...').catch(() => {});

      const allAccounts = fullConfig.accounts || [];
      const results = await Promise.allSettled(adj.changes.map(async ch => {
        const acct = allAccounts.find(a => a.id === ch.accountId);
        if (!acct) return { skipped: true };
        await refreshAccountToken(acct);
        const itemData = await mlGetAuth(acct, '/items/' + ch.itemId);
        const vars = itemData.variations || [];
        const newVars = vars.map(v => ({ id: v.id, available_quantity: v.available_quantity || 0 }));
        for (const vc of ch.variantChanges || []) {
          const matchedVar = vars.find(v => _varKeysAll(v).some(k => k === vc.attrKey));
          if (matchedVar) {
            const t = newVars.find(v => v.id === matchedVar.id);
            if (t) t.available_quantity = Math.max(0, vc.to);
          }
        }
        const expected = newVars.reduce((s, v) => s + (v.available_quantity || 0), 0);
        await mlPutVerified(acct, ch.itemId, { variations: newVars }, expected);
        return { applied: true, itemId: ch.itemId };
      }));

      let applied = 0, failed = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.applied) applied++;
        else if (r.status === 'rejected') {
          failed++;
          console.log('[tg] Error vc', adj.changes[i].itemId, r.reason?.message || r.reason);
        }
      });

      adj.status = (applied > 0 && failed === 0) ? 'applied' : 'error';
      adj.appliedAt = new Date().toISOString();
      savePendingAdjustments(allAdj);
      appendVincLog({ action: adj.status, source: 'telegram', adjId: adj.id, groupId: adj.groupId, itemsApplied: applied, itemsTotal: adj.changes.length });
      const failMsg = failed ? ` · ${failed} fallido(s)` : '';
      await reply(`✅ <b>${adj.groupName}</b>\n${mm.label}: ajustado a x${chosen.qty} (${_shortAcct(chosen.acctLabel)})${failMsg}.`);

    } else if (action === 'dis') {
      const allAdj = loadPendingAdjustments();
      const adj = allAdj.find(a => a.id === rest);
      if (adj && adj.status === 'pending') {
        adj.status = 'dismissed'; adj.dismissedAt = new Date().toISOString();
        savePendingAdjustments(allAdj);
        appendVincLog({ action: 'dismissed', source: 'telegram', adjId: adj.id, groupId: adj.groupId, triggerAcctLabel: adj.trigger?.acctLabel });
        await reply(`✕ Descartado · <b>${adj.groupName}</b>\n<i>El stock no se modificó.</i>`);
      } else {
        // Ya no estaba pendiente (aplicado, cancelado, etc.) — solo quita botones
        await reply(_adjStaleMsg(adj));
      }

    } else if (action === 'resp') {
      // Responder pregunta: pedir texto con force_reply
      const c2 = rest.indexOf(':');
      const questionId = rest.slice(0, c2);
      const accountId  = rest.slice(c2 + 1);
      const ctx = _tgQuestionsCtx.get(questionId);
      const preview = ctx?.questionText ? `\n\n❓ "${ctx.questionText}"` : '';
      const sentMsg = await tgRequest(tg.bot_token, 'sendMessage', {
        chat_id: tg.chat_id,
        text: `✏️ Escribí tu respuesta para <b>${ctx?.itemTitle || 'la pregunta'}</b>:${preview}\n\n<i>(Respondé este mensaje con tu texto)</i>`,
        parse_mode: 'HTML',
        reply_markup: { force_reply: true, selective: false },
      });
      if (sentMsg.ok) {
        _tgPendingReplies.set(sentMsg.result.message_id, {
          questionId,
          accountId: accountId === '_' ? ctx?.accountId : accountId,
          itemTitle: ctx?.itemTitle || '—',
          questionText: ctx?.questionText || '',
        });
      }

    } else if (action === 'ws_tw') {
      // "Mantener Tienda Web" — actualizar ML con stock = disponible - vendido
      const ctx = _tgVentaCtx.get(rest);
      if (!ctx) { await reply('⚠️ Contexto expirado.'); return; }
      if (ctx.webStock === null || ctx.webStock === undefined) { await reply('⚠️ Sin datos de stock ML para actualizar.'); return; }
      const allAccts = (fullConfig.accounts && fullConfig.accounts.length) ? fullConfig.accounts : [config];
      const acct = allAccts.find(a => a.id === ctx.acctId) || allAccts[0];
      if (!acct) { await reply('⚠️ Cuenta ML no encontrada.'); return; }
      reply(`🔄 Actualizando stock de ${ctx.itemTitle} a ${ctx.webStock} en ML...`).catch(() => {});
      try {
        await refreshAccountToken(acct);
        const mlData = await mlGetAuth(acct, '/items/' + ctx.itemId);
        const vars = mlData.variations || [];
        if (vars.length) {
          // Restar de la variación que coincida con la variante vendida (por texto) o la de mayor stock
          const variantLower = (ctx.variant || '').toLowerCase();
          let targetVar = vars.find(v =>
            (v.attribute_combinations || []).some(a =>
              (a.value_name || '').toLowerCase().includes(variantLower) ||
              variantLower.includes((a.value_name || '').toLowerCase())
            )
          );
          if (!targetVar) targetVar = vars.reduce((m, v) => (v.available_quantity || 0) > (m.available_quantity || 0) ? v : m, vars[0]);
          const newVars = vars.map(v => ({
            id: v.id,
            available_quantity: v.id === targetVar.id
              ? Math.max(0, (v.available_quantity || 0) - ctx.qtySold)
              : (v.available_quantity || 0),
          }));
          const expected = newVars.reduce((s, v) => s + (v.available_quantity || 0), 0);
          await mlPutVerified(acct, ctx.itemId, { variations: newVars }, expected);
        } else {
          await mlPutVerified(acct, ctx.itemId, { available_quantity: Math.max(0, ctx.webStock) }, Math.max(0, ctx.webStock));
        }
        _tgVentaCtx.delete(rest);
        await reply(`✅ Stock actualizado en ML → <b>${ctx.webStock} u.</b> (orden ${String(ctx.ordenId).slice(-8).toUpperCase()})`);
      } catch(e) {
        await reply(`❌ Error al actualizar ML: ${_errMsg(e)}`);
      }

    } else if (action === 'ws_ml') {
      // "Mantener MercadoLibre" — no tocar ML, solo registrar
      const ctx = _tgVentaCtx.get(rest);
      _tgVentaCtx.delete(rest);
      const stockInfo = ctx ? ` Se mantiene en ${ctx.mlStock} u.` : '';
      await reply(`✅ Stock de MercadoLibre sin cambios.${stockInfo}`);

    } else if (action === 'qign') {
      // Ignorar/marcar como vista la pregunta
      const questionId = rest;
      const notified = loadNotifiedQuestions();
      notified[questionId] = new Date().toISOString();
      saveNotifiedQuestions(notified);
      await tgRequest(tg.bot_token, 'answerCallbackQuery', {
        callback_query_id: cb.id, text: 'Pregunta ignorada', show_alert: false,
      }).catch(() => {});
    }
  } catch(e) {
    const m = _errMsg(e);
    console.log('[tg] Error en callback:', m);
    await reply('❌ Error: ' + m).catch(() => {});
  }
}

// ── Estado en memoria para respuestas pendientes ──────────────
// clave: message_id del mensaje force_reply del bot
// valor: { questionId, accountId, itemTitle, questionText }
const _tgPendingReplies = new Map();
// clave: questionId → { questionText, itemTitle, accountId } (para cuando toca "Responder")
const _tgQuestionsCtx = new Map();
// clave: ctxId → { ordenId, itemId, itemTitle, variant, qtySold, mlStock, webStock, acctId }
const _tgVentaCtx = new Map();

// ── Notificación Telegram: venta en tienda web (stock) ────────
// Llamar después de confirmar un pago web (MP o Stripe).
async function sendVentaTiendaNotification(orden) {
  const allAccts = (fullConfig.accounts && fullConfig.accounts.length)
    ? fullConfig.accounts
    : [config];

  for (const item of (orden.items || [])) {
    const itemId  = item.id;
    const qty     = item.qty || 1;
    const variant = item.variant || '';
    const title   = item.title || itemId;

    // Buscar stock actual en ML probando todas las cuentas
    let mlStock  = null;
    let acctId   = null;
    for (const acct of allAccts) {
      try {
        await refreshAccountToken(acct);
        const mlData = await mlGetAuth(acct, '/items/' + itemId);
        const vars = mlData.variations || [];
        if (vars.length) {
          mlStock = vars.reduce((s, v) => s + (v.available_quantity || 0), 0);
        } else {
          mlStock = mlData.available_quantity || 0;
        }
        acctId = acct.id;
        break;
      } catch(e) { /* probar siguiente cuenta */ }
    }

    const webStock = mlStock !== null ? Math.max(0, mlStock - qty) : null;

    // Generar ID corto para contexto
    const ctxId = Math.random().toString(36).slice(2, 10);
    _tgVentaCtx.set(ctxId, { ordenId: orden.id, itemId, itemTitle: title, variant, qtySold: qty, mlStock, webStock, acctId });
    // Limpiar entradas viejas (>24h)
    if (_tgVentaCtx.size > 200) {
      const oldest = [..._tgVentaCtx.keys()][0];
      _tgVentaCtx.delete(oldest);
    }

    const varLabel = variant ? ` <i>${variant}</i>` : '';
    const msgText = (
      `🛒 <b>Venta en la tienda web</b>\n` +
      `-${qty}${varLabel} ${title}\n` +
      (mlStock !== null
        ? `\n¿Qué stock es correcto?`
        : `\n<i>Stock ML no disponible</i>`)
    );

    if (mlStock !== null) {
      await tgSend(msgText, [[
        { text: `Tienda web (${webStock})`,      callback_data: `ws_tw:${ctxId}` },
        { text: `MercadoLibre (${mlStock})`,     callback_data: `ws_ml:${ctxId}` },
      ]]).catch(() => {});
    } else {
      await tgSend(msgText).catch(() => {});
    }
  }
}
// Guard: previene que dos /check corran en paralelo (ahora que el polling dispatchea sin await)
let _tgCheckInFlight = false;


// ── Check periódico de preguntas nuevas ───────────────────────
async function checkNewQuestions() {
  const tg = fullConfig.telegram;
  if (!tg?.bot_token || !tg?.chat_id) return;
  const allAccounts = (fullConfig.accounts || []).filter(a => a.access_token && a.user_id);
  if (!allAccounts.length) return;

  const notified = loadNotifiedQuestions();
  // Podar entradas viejas (> 7 días)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(notified)) {
    if (new Date(ts).getTime() < cutoff) delete notified[id];
  }

  let newCount = 0;
  for (const acct of allAccounts) {
    try {
      await refreshAccountToken(acct);
      const data = await mlGetAuth(acct,
        `/questions/search?seller_id=${acct.user_id}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=DESC`);
      const questions = data.questions || [];

      // Fetch títulos de items únicos
      const itemIds = [...new Set(questions.map(q => q.item_id).filter(Boolean))];
      const itemCache = {};
      await Promise.all(itemIds.map(async id => {
        try {
          const item = await mlGetAuth(acct, `/items/${id}?attributes=id,title,thumbnail`);
          itemCache[id] = item.title || id;
        } catch(e) { itemCache[id] = id; }
      }));

      for (const q of questions) {
        const qid = String(q.id);
        if (notified[qid]) continue; // ya notificada

        const itemTitle = itemCache[q.item_id] || '—';
        const shortAcct = (acct.label || acct.id).split(/\s[—-]\s/).pop().trim();

        // Guardar contexto en memoria
        _tgQuestionsCtx.set(qid, { questionText: q.text, itemTitle, accountId: acct.id });

        // Construir mensaje
        let text = `❓ <b>Nueva pregunta</b> · ${shortAcct}\n\n`;
        text += `📱 <i>${itemTitle}</i>\n`;
        text += `💬 "${q.text}"`;

        const cbResp = `resp:${qid}:${acct.id}`;
        const cbIgn  = `qign:${qid}`;
        const keyboard = [
          [{ text: '💬 Responder', callback_data: cbResp.length <= 64 ? cbResp : `resp:${qid}:_` }],
          [{ text: '✓ Ya respondí / Ignorar', callback_data: cbIgn }],
        ];

        await tgSend(text, keyboard);
        notified[qid] = new Date().toISOString();
        newCount++;
        // Pausa breve para no saturar la API de Telegram
        await new Promise(r => setTimeout(r, 300));
      }
    } catch(e) {
      console.log('[tg] Error chequeando preguntas cuenta', acct.id, e.message);
    }
  }

  saveNotifiedQuestions(notified);
  if (newCount) console.log('[tg] Notificadas ' + newCount + ' pregunta(s) nueva(s)');
}

// ── Manejo de mensajes de texto (respuestas del usuario) ──────
async function handleTgMessage(msg) {
  const tg = fullConfig.telegram;
  const txt = (msg.text || '').trim();

  // ── Comando /restart — reiniciar proceso con pm2 ─────────────
  if (txt === '/restart' || txt === '/reiniciar') {
    await tgSend('🔄 Ejecutando <code>pm2 restart all</code>...');
    const { exec } = require('child_process');
    exec('pm2 restart all', (err, stdout, stderr) => {
      if (err) {
        tgSend(`❌ Error al reiniciar:\n<code>${err.message}</code>`).catch(() => {});
      } else {
        tgSend('✅ Servidor reiniciado con pm2 correctamente.').catch(() => {});
      }
    });
    return;
  }

  // ── Comando /check — forzar revisión de stock ahora ──────────
  if (txt === '/check' || txt === '/verificar') {
    // Guard: como el polling ahora dispatchea en background (sin await),
    // dos /check seguidos podrían correr en paralelo y pisarse el estado.
    if (_tgCheckInFlight) {
      await tgSend('⏳ Ya hay un check en curso, esperá a que termine...');
      return;
    }
    _tgCheckInFlight = true;
    await tgSend('🔄 Verificando stock... (toma 1-3 min con muchos grupos)');
    try {
      await checkStockChanges();
      const pending = loadPendingAdjustments().filter(p => p.status === 'pending');
      if (pending.length) {
        await tgSend(`⚡ Listo — <b>${pending.length}</b> ajuste(s) pendiente(s) detectado(s).`, null);
      } else {
        await tgSend('✅ Listo — todo sincronizado, sin ajustes pendientes.', null);
      }
    } catch(e) {
      await tgSend('❌ Error al verificar: ' + e.message, null);
    } finally {
      _tgCheckInFlight = false;
    }
    return;
  }

  const replyToId = msg.reply_to_message?.message_id;
  if (!replyToId) return;
  const pending = _tgPendingReplies.get(replyToId);
  if (!pending) return;

  const answerText = msg.text?.trim();
  if (!answerText) { await tgSend('⚠️ El mensaje estaba vacío, escribí tu respuesta.'); return; }

  const acct = (fullConfig.accounts || []).find(a => a.id === pending.accountId);
  if (!acct) { await tgSend('❌ Cuenta no encontrada.'); return; }

  try {
    await refreshAccountToken(acct);
    await mlPostAuth(acct, '/answers', { question_id: parseInt(pending.questionId), text: answerText });
    _tgPendingReplies.delete(replyToId);
    // Marcar como notificada/respondida para que no vuelva a aparecer
    const notified = loadNotifiedQuestions();
    notified[pending.questionId] = new Date().toISOString();
    saveNotifiedQuestions(notified);
    await tgSend(`✅ Respuesta enviada a <b>${pending.itemTitle}</b>:\n\n"${answerText}"`, null);
    console.log('[tg] Pregunta', pending.questionId, 'respondida desde Telegram');
  } catch(e) {
    await tgSend('❌ Error al enviar la respuesta: ' + e.message);
  }
}

// ── Long-polling loop ─────────────────────────────────────────
// Persistir offset a disco para evitar loops infinitos cuando se ejecuta /restart:
// si el proceso muere antes de confirmar el offset a Telegram (vía la próxima
// llamada a getUpdates con offset > update_id), al rearrancar reprocesará el
// mismo mensaje → ejecutaría /restart de nuevo → ciclo infinito.

let _tgOffset = loadTgOffset();
let _tgPolling = false;
async function tgPollingLoop() {
  if (_tgPolling) return;
  _tgPolling = true;
  console.log('[tg] Iniciando long-polling... offset inicial:', _tgOffset);

  // CONFIRMAR inmediatamente al iniciar: una llamada explícita con el offset
  // persistido fuerza a Telegram a descartar los updates anteriores aunque el
  // proceso anterior haya muerto mid-handler (ej. después de /restart).
  if (_tgOffset > 0) {
    try {
      const tg = fullConfig.telegram;
      if (tg?.bot_token) {
        await tgRequest(tg.bot_token, 'getUpdates', { offset: _tgOffset, limit: 1, timeout: 0 });
      }
    } catch {}
  }

  while (true) {
    const tg = fullConfig.telegram;
    if (!tg?.bot_token || !tg?.chat_id) {
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    try {
      const result = await tgRequest(tg.bot_token, 'getUpdates', {
        offset: _tgOffset, timeout: 25,
        allowed_updates: ['callback_query', 'message'],
      });
      if (result.ok && result.result?.length) {
        for (const upd of result.result) {
          _tgOffset = upd.update_id + 1;
          saveTgOffset(_tgOffset);  // ⚠️ Persistir ANTES de procesar (importante para /restart)
          // ⚠ NO USAR await aquí: dispatcheamos en background. Si esperáramos,
          // un handler lento (ej: /check llama a checkStockChanges que tarda
          // 2-4 min iterando todos los grupos) bloquearía el polling y los
          // mensajes siguientes esperarían en cola minutos antes de procesarse.
          if (upd.callback_query) {
            handleTgCallback(upd.callback_query).catch(e => console.log('[tg] Error callback:', e.message));
          } else if (upd.message?.text) {
            handleTgMessage(upd.message).catch(e => console.log('[tg] Error mensaje:', e.message));
          }
        }
      }
    } catch(e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ── Vinculaciones: check periódico de stock ───────────────────
let _vincCheckInProgress = false;

async function checkStockChanges() {
  // Guard: evitar solapamiento si el check anterior todavía está corriendo
  if (_vincCheckInProgress) {
    console.log('[vinc] Check ya en curso, saltando esta iteración');
    return;
  }
  _vincCheckInProgress = true;
  try {
    await _checkStockChangesImpl();
  } finally {
    _vincCheckInProgress = false;
  }
}

// ── Vinculaciones: detección de mismatches por variante ───────────
// Compara, para cada atributo de variante compartido entre items del grupo
// (ej. "color:Gris,modelo:15 Pro"), si las cantidades disponibles coinciden.
// Se usa tanto en el check por variante manual como en el check periódico,
// para no dejar pasar por alto desbalances que se "cancelan" a nivel de
// stock total (ej: se vende una variante en una cuenta y otra variante
// distinta en la otra cuenta — los totales bajan igual pero las variantes
// quedan desalineadas).
function detectVariantMismatches(stocks) {
  const allHaveVariants = stocks.every(s => s.variantSnap && Object.keys(s.variantSnap).length);
  if (!allHaveVariants) return [];

  const keyCount = {};
  for (const s of stocks) {
    for (const k of Object.keys(s.variantSnap)) keyCount[k] = (keyCount[k] || 0) + 1;
  }
  const sharedKeys = Object.keys(keyCount).filter(k => keyCount[k] >= 2);

  const mismatches = [];
  for (const attrKey of sharedKeys) {
    const perItem = stocks
      .filter(s => s.variantSnap[attrKey] != null)
      .map(s => ({
        itemId: s.itemId,
        accountId: s.accountId,
        acctLabel: s.acctLabel || s.accountId,
        title: s.title || '',
        thumb: s.thumb || '',
        varId: s.variantSnap[attrKey].id,
        qty: s.variantSnap[attrKey].qty,
        label: s.variantSnap[attrKey].label || attrKey,
      }));

    if (perItem.length < 2) continue;
    const qtys = perItem.map(x => x.qty);
    const allSame = qtys.every(q => q === qtys[0]);
    if (!allSame) {
      const targetQty = Math.min(...qtys);
      mismatches.push({ attrKey, label: perItem[0].label, perItem, targetQty });
    }
  }
  return mismatches;
}

// Convierte mismatches por variante en la lista `changes` por item que
// esperan los ajustes pendientes (mismo formato que usa la UI/Telegram).
function buildVariantChangesFromMismatches(variantMismatches) {
  const changesMap = {};
  for (const mm of variantMismatches) {
    for (const pi of mm.perItem) {
      if (pi.qty > mm.targetQty) {
        if (!changesMap[pi.itemId]) {
          changesMap[pi.itemId] = {
            itemId: pi.itemId,
            accountId: pi.accountId,
            acctLabel: pi.acctLabel,
            title: pi.title,
            thumb: pi.thumb,
            variantChanges: [],
          };
        }
        changesMap[pi.itemId].variantChanges.push({
          attrKey: mm.attrKey,
          varId: pi.varId,
          label: mm.label,
          from: pi.qty,
          to: mm.targetQty,
        });
      }
    }
  }
  return Object.values(changesMap);
}

async function _checkStockChangesImpl() {
  const _checkStartMs = Date.now();
  const fp = path.join(__dirname, 'vinculaciones.json');
  if (!fs.existsSync(fp)) return;
  let vinc;
  try { vinc = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) { return; }
  if (!vinc.groups || !vinc.groups.length) return;

  const allAccounts = fullConfig.accounts || [];
  let vincChanged = false;

  // Cargar TODOS los ajustes (para poder mutar estados y guardar)
  const allAdjustments   = loadPendingAdjustments();
  const existing         = allAdjustments.filter(p => p.status === 'pending');
  const pendingGroupIds  = new Set(existing.map(p => p.groupId));
  const newAdjustments   = [];
  let   autoResolvedCount = 0;

  // ── 1. Refrescar tokens en PARALELO ──────────────────────────
  const uniqueAcctIds = [...new Set(vinc.groups.flatMap(g => g.items.map(it => it.accountId)))];
  await Promise.allSettled(
    uniqueAcctIds.map(id => {
      const acct = allAccounts.find(a => a.id === id);
      return acct ? refreshAccountToken(acct).catch(() => {}) : Promise.resolve();
    })
  );

  console.log('[vinc] Verificando stock de ' + vinc.groups.length + ' grupo(s)...');

  // ── 2. Leer TODOS los items en PARALELO ──────────────────────
  // Recolectar items únicos (mismo itemId puede aparecer en varios grupos teóricamente)
  const allItems = vinc.groups.flatMap(g => g.items);
  const uniqueItemIds = [...new Set(allItems.map(it => it.itemId))];

  // Fetch paralelo de todos los items únicos
  const fetchResults = await Promise.allSettled(
    uniqueItemIds.map(async itemId => {
      const it = allItems.find(x => x.itemId === itemId);
      const acct = allAccounts.find(a => a.id === it.accountId);
      if (!acct?.access_token) throw new Error('sin token');
      const d = await mlGetAuth(acct, '/items/' + itemId);
      const vars = d.variations || [];
      const realStock = vars.length
        ? vars.reduce((sum, v) => sum + (v.available_quantity || 0), 0)
        : (d.available_quantity || 0);
      const variantSnap = {};
      vars.forEach(v => {
        const key = (_varKeysAll(v)[0]) || ('var_' + v.id);
        variantSnap[key] = { id: v.id, qty: v.available_quantity || 0, label: _varLabel(v) };
      });
      const thumb = d.thumbnail ||
        (d.pictures && d.pictures[0] && (d.pictures[0].secure_url || d.pictures[0].url)) || '';
      return { itemId, realStock, variantSnap, thumb };
    })
  );

  // Construir mapa: itemId → datos leídos
  const itemDataMap = {};
  fetchResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      itemDataMap[uniqueItemIds[i]] = r.value;
    } else {
      const it = allItems.find(x => x.itemId === uniqueItemIds[i]);
      console.log('[vinc]   Error leyendo ' + uniqueItemIds[i] + ' (HTTP ' + (r.reason?.status||'?') + '): ' + (r.reason?.message||'?'));
    }
  });

  // ── 3. Procesar grupos usando los datos pre-cargados ─────────
  for (const g of vinc.groups) {
    // Armar stocks del grupo usando el mapa en lugar de llamadas adicionales
    const stocks = [];
    for (const it of g.items) {
      const data = itemDataMap[it.itemId];
      if (!data) continue;
      // Actualizar thumb si falta
      if (!it.thumb && data.thumb) { it.thumb = data.thumb; vincChanged = true; }
      stocks.push({ ...it, realStock: data.realStock, variantSnap: data.variantSnap });
    }

    if (stocks.length < 2) continue;

    // Detectar si algún item cambió vs lastStock
    let anyChanged = false;
    for (const s of stocks) {
      if (typeof s.lastStock === 'number' && s.realStock !== s.lastStock) { anyChanged = true; break; }
    }

    // Calcular deltas por variante ANTES de actualizar lastVariants
    // variantDeltas por itemId: [{ attrKey, id, from, to, delta }]
    const variantDeltasByItem = {};
    for (const s of stocks) {
      const it = g.items.find(x => x.itemId === s.itemId);
      const lastVars = it?.lastVariants || {};
      const deltas = [];
      for (const [attrKey, curr] of Object.entries(s.variantSnap || {})) {
        const prev = lastVars[attrKey];
        if (prev && prev.qty !== curr.qty) {
          deltas.push({ attrKey, id: curr.id, from: prev.qty, to: curr.qty, delta: prev.qty - curr.qty });
        }
      }
      if (deltas.length) variantDeltasByItem[s.itemId] = deltas;
    }

    // Actualizar lastStock y lastVariants en el objeto vinc
    for (const s of stocks) {
      const it = g.items.find(x => x.itemId === s.itemId);
      if (it) {
        if (it.lastStock !== s.realStock) { it.lastStock = s.realStock; vincChanged = true; }
        const snapStr = JSON.stringify(s.variantSnap);
        if (JSON.stringify(it.lastVariants || {}) !== snapStr) { it.lastVariants = s.variantSnap; vincChanged = true; }
      }
    }

    // Verificación por variante: se calcula siempre, sin importar si los
    // totales coinciden o no. Comparar sólo totales puede hacer que un
    // desbalance real quede oculto (los totales pueden "cuadrar" de
    // casualidad mientras las variantes individuales quedan desalineadas).
    const variantMismatches = detectVariantMismatches(stocks);

    // ── Auto-resolver ajustes pendientes si los stocks ya están igualados ──
    // Ocurre cuando el ajuste fue aplicado desde otra instancia del servidor.
    if (pendingGroupIds.has(g.id)) {
      const nums    = stocks.map(s => s.realStock);
      const allSame = nums.length >= 2 && nums.every(n => n === nums[0]);
      if (allSame) {
        allAdjustments.forEach(a => {
          if (a.groupId === g.id && a.status === 'pending') {
            a.status = 'auto-resolved';
            autoResolvedCount++;
            // Editar el mensaje de Telegram para quitar los botones zombi:
            // la venta se canceló o el stock se reequilibró solo.
            if (a.tgChatId && a.tgMsgId) {
              tgEdit(a.tgChatId, a.tgMsgId,
                `↩️ <b>${a.groupName}</b>\nLa venta se canceló o el stock se reequilibró solo (${nums[0]} u.) — no hay nada que ajustar.`
              ).catch(() => {});
            }
            console.log('[vinc]   ✅ Auto-resuelto: "' + g.name + '" — stocks igualados (' + nums[0] + ')');
          }
        });
        pendingGroupIds.delete(g.id); // liberar para que pueda generarse nuevo si vuelve a desbalancearse

        // Si pese a coincidir los totales hay variantes desalineadas
        // (ej: se vendió una variante distinta en cada cuenta), generar
        // un ajuste de tipo "variant" para corregirlas.
        if (variantMismatches.length) {
          const changes = buildVariantChangesFromMismatches(variantMismatches);
          if (changes.length) {
            newAdjustments.push({
              id: 'adj_var_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              type: 'variant',
              createdAt: new Date().toISOString(),
              groupId: g.id,
              groupName: g.name,
              variantMismatches,
              changes,
              status: 'pending',
            });
            pendingGroupIds.add(g.id);
            console.log('[vinc]   ⚠ "' + g.name + '" — totales igualados pero ' + variantMismatches.length + ' variante(s) desalineada(s)');
          }
        }
      }
    }

    // Generar ajuste pendiente si: stocks desiguales + hubo cambio + no hay pendiente para este grupo
    if (!pendingGroupIds.has(g.id)) {
      const nums = stocks.map(s => s.realStock);
      const allSame = nums.every(n => n === nums[0]);

      // Verificar siempre por variante primero: si hay desalineación a nivel
      // de variante, es más precisa que el ajuste por total y la corrige de
      // entrada, sin importar si los totales ya coinciden o no.
      if (variantMismatches.length) {
        const changes = buildVariantChangesFromMismatches(variantMismatches);
        if (changes.length) {
          newAdjustments.push({
            id: 'adj_var_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'variant',
            createdAt: new Date().toISOString(),
            groupId: g.id,
            groupName: g.name,
            variantMismatches,
            changes,
            status: 'pending',
          });
          pendingGroupIds.add(g.id);
          console.log('[vinc]   ⚠ "' + g.name + '" — ' + variantMismatches.length + ' variante(s) desalineada(s)' + (allSame ? ' (totales iguales)' : ''));
        }
      } else if (!allSame && anyChanged) {
        const minStock = Math.min(...nums);

        // Detectar el trigger: item con mayor caída
        let trigger = null;
        let maxDrop = -Infinity;
        for (const s of stocks) {
          const prev = typeof s.lastStock === 'number' ? s.lastStock : s.realStock;
          const drop = prev - s.realStock;
          if (drop > maxDrop) {
            maxDrop = drop;
            trigger = {
              itemId: s.itemId,
              acctLabel: s.acctLabel || s.accountId,
              from: prev,
              to: s.realStock,
              variantDeltas: variantDeltasByItem[s.itemId] || [],
            };
          }
        }

        // Items que hay que bajar (stock > mínimo)
        const sourceDeltas = trigger ? (variantDeltasByItem[trigger.itemId] || []) : [];
        const changes = stocks
          .filter(s => s.realStock > minStock)
          .map(s => ({
            itemId: s.itemId,
            accountId: s.accountId,
            acctLabel: s.acctLabel || s.accountId,
            title: s.title || '',
            thumb: s.thumb || '',
            from: s.realStock,
            to: minStock,
            sourceVariantDeltas: sourceDeltas,  // qué variante bajó en el item fuente
          }));

        if (changes.length) {
          newAdjustments.push({
            id: 'adj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            createdAt: new Date().toISOString(),
            groupId: g.id,
            groupName: g.name,
            trigger,
            changes,
            targetStock: minStock,
            status: 'pending',
          });
          pendingGroupIds.add(g.id);
          console.log('[vinc]   ⚠ Ajuste pendiente: "' + g.name + '" → stock ' + minStock + ' (' + changes.length + ' item(s))');
        }
      }
    }
  }

  // Guardar lastStock actualizado
  if (vincChanged) {
    try { fs.writeFileSync(fp, JSON.stringify(vinc, null, 2)); } catch(e) {}
  }

  // Persistir si hay nuevos ajustes O auto-resoluciones
  if (newAdjustments.length || autoResolvedCount > 0) {
    savePendingAdjustments([...allAdjustments, ...newAdjustments]);
    // Enviar notificaciones y guardar la referencia del mensaje (chatId/msgId)
    // para poder editarlo si la venta se cancela y el ajuste se auto-resuelve.
    if (newAdjustments.length) {
      (async () => {
        let refsChanged = false;
        for (const adj of newAdjustments) {
          try {
            const ref = await sendTgAdjustmentNotification(adj);
            if (ref?.msgId) { adj.tgChatId = ref.chatId; adj.tgMsgId = ref.msgId; refsChanged = true; }
          } catch(e) { console.log('[tg] Error notificando:', _errMsg(e)); }
        }
        if (refsChanged) {
          const all = loadPendingAdjustments();
          for (const adj of newAdjustments) {
            const a = all.find(x => x.id === adj.id);
            if (a && adj.tgMsgId) { a.tgChatId = adj.tgChatId; a.tgMsgId = adj.tgMsgId; }
          }
          savePendingAdjustments(all);
        }
      })();
    }
  }

  lastVincCheck = new Date().toISOString();
  const totalPending = allAdjustments.filter(a => a.status === 'pending').length + newAdjustments.length;
  const fetched2 = Object.keys(itemDataMap).length;
  const total2   = uniqueItemIds.length;
  console.log(
    '[vinc] Check OK en ' + ((Date.now() - _checkStartMs) / 1000).toFixed(1) + 's' +
    ' — ' + fetched2 + '/' + total2 + ' items leídos' +
    ' — pendientes: ' + totalPending +
    (newAdjustments.length  ? ' (+' + newAdjustments.length  + ' nuevos)'        : '') +
    (autoResolvedCount > 0  ? ' (' + autoResolvedCount + ' auto-resueltos)'      : '')
  );
}

// ── Auto-refresh proactivo — renueva token cada 4 horas ──────
const TOKEN_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 horas (tokens ML duran 6h)

async function proactiveRefresh() {
  if (!config.refresh_token) return;
  console.log('  ⟳ Auto-refresh proactivo...');
  const ok = await refreshAccessToken();
  if (!ok) console.log('  ✗ Falló el refresh proactivo — se reintentará en la próxima request 401');
}

// Refresh al arrancar sólo si el token está expirado o no se conoce su vigencia
setTimeout(() => {
  if (config.access_token && config.refresh_token) {
    const expiry = config.token_expiry || 0;
    if (Date.now() < expiry) {
      const mins = Math.round((expiry - Date.now()) / 60000);
      console.log(`  ✓ Token vigente — vence en ~${mins} min, sin renovación necesaria`);
    } else {
      console.log('  ⟳ Refresh inicial al arrancar...');
      refreshAccessToken();
    }
  }
}, 3000);

// Timer periódico de token
setInterval(proactiveRefresh, TOKEN_REFRESH_INTERVAL);

// ── Telegram: arrancar long-polling + check de preguntas ─────
tgPollingLoop().catch(e => console.log('[tg] Error iniciando polling:', e.message));

// Primer check de preguntas a los 60s del arranque (después del refresh de tokens)
setTimeout(() => {
  checkNewQuestions().catch(e => console.log('[tg] Error check preguntas inicial:', e.message));
}, 60000);
// Check periódico cada 10 minutos
setInterval(() => {
  checkNewQuestions().catch(e => console.log('[tg] Error check preguntas:', e.message));
}, 10 * 60 * 1000);

// ── Vinculaciones: check de stock cada 10 minutos ─────────────
const VINC_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutos
// Primer check 45s después de arrancar (dar tiempo a que los tokens se refresquen)
setTimeout(() => {
  checkStockChanges().catch(e => console.log('[vinc] Error en check inicial:', e.message));
}, 45000);
setInterval(() => {
  checkStockChanges().catch(e => console.log('[vinc] Error en check periódico:', e.message));
}, VINC_CHECK_INTERVAL);

// ── Inicializar caché persistente de reseñas ──────────────────
db.ensureReviewsCacheTable().catch(e => console.log('[reviews] Error en init de cache:', e.message));

// ── Inicializar caché persistente de cotizaciones de envío ────
db.ensureShippingCacheTable().catch(e => console.log('[shipping] Error en init de cache:', e.message));

// ── Inicializar tabla de overrides de productos (admin Tienda) ─
db.ensureProductOverridesTable().catch(e => console.log('[tienda-overrides] Error en init de tabla:', e.message));

// ── Inicializar tabla de productos propios (admin Tienda — alta no-ML) ─
db.ensureProductosPropiosTable().catch(e => console.log('[tienda-productos-propios] Error en init de tabla:', e.message));

// ── Inicializar tabla de carritos abandonados + cron de recordatorio ──
db.ensureCarritosAbandonadosTable().catch(e => console.log('[carrito-abandonado] Error en init de tabla:', e.message));

// Cada 15 min: busca carritos abandonados hace +4hs sin recordatorio enviado
// y manda UN email "tu carrito te espera" con deep-link de restauración.
const CARRITO_ABANDONADO_CHECK_INTERVAL = 15 * 60 * 1000;
async function checkCarritosAbandonados() {
  const pendientes = await db.getCarritosAbandonadosPendientes();
  for (const c of pendientes) {
    try {
      await sendEmail({
        to:      c.email,
        subject: '🛒 Tu carrito te espera · WZMALLAS',
        html:    emailCarritoAbandonado({ nombre: c.nombre, items: c.items, total: c.total, token: c.token }),
      });
      await db.marcarCarritoEmailEnviado(c.id);
      console.log(`  ✓ [carrito-abandonado] Email enviado a ${c.email}`);
    } catch (e) {
      console.log(`  ⚠ [carrito-abandonado] Error enviando a ${c.email}:`, e.message);
    }
  }
}
setInterval(() => {
  checkCarritosAbandonados().catch(e => console.log('[carrito-abandonado] Error en check periódico:', e.message));
}, CARRITO_ABANDONADO_CHECK_INTERVAL);

// ── Alerta Telegram: órdenes pending +24hs (Fase 2 — monitoreo) ──────
// Cada hora busca órdenes que quedaron sin pagar +24hs y avisa al admin.
// Para no spamear, guarda los IDs ya alertados en un JSON; cada orden se
// alerta una sola vez (sobrevive reinicios de PM2).
const PENDING_ALERTED_PATH = path.join(__dirname, 'tienda-pending-alerted.json');
const PENDING_24H_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hora

function _loadPendingAlerted() {
  try { return new Set(JSON.parse(fs.readFileSync(PENDING_ALERTED_PATH, 'utf8'))); }
  catch { return new Set(); }
}
function _savePendingAlerted(set) {
  try { atomicWriteFileSync(PENDING_ALERTED_PATH, JSON.stringify([...set])); } catch {}
}

async function checkPendientes24h() {
  const ordenes = await db.getOrdenesPending24h();
  const alerted = _loadPendingAlerted();

  // Limpiar del set los IDs que ya no están pendientes (se pagaron/cancelaron)
  const vigentes = new Set(ordenes.map(o => o.id));
  let changed = false;
  for (const id of alerted) if (!vigentes.has(id)) { alerted.delete(id); changed = true; }

  for (const o of ordenes) {
    if (alerted.has(o.id)) continue;
    const horas = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 3600000);
    await tgSend(
      `⏳ <b>Orden sin pagar +24hs</b>\n` +
      `<b>${o.order_number}</b> · ${o.nombre || o.email}\n` +
      `Total: $${Math.round(o.total).toLocaleString('es-AR')} · hace ${horas}hs\n` +
      `Revisá si conviene contactar al cliente o cancelarla.`
    ).catch(() => {});
    alerted.add(o.id);
    changed = true;
    console.log(`  ⏳ [pending-24h] Alertada orden ${o.order_number} (${horas}hs)`);
  }
  if (changed) _savePendingAlerted(alerted);
}
setInterval(() => {
  checkPendientes24h().catch(e => console.log('[pending-24h] Error en check periódico:', e.message));
}, PENDING_24H_CHECK_INTERVAL);

// ── Handler global — evita que promesas rechazadas cierren el proceso ──
process.on('unhandledRejection', (reason, promise) => {
  const msg   = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error && reason.stack
    ? '\n    ' + reason.stack.split('\n').slice(1, 4).join('\n    ')
    : '';
  console.error(`\x1b[31m  ✗ [unhandledRejection] ${msg}${stack}\x1b[0m`);
  // No rethrow — el servidor sigue corriendo
});
process.on('uncaughtException', (err) => {
  const stack = err.stack
    ? '\n    ' + err.stack.split('\n').slice(1, 4).join('\n    ')
    : '';
  console.error(`\x1b[31m  ✗ [uncaughtException] ${err.message}${stack}\x1b[0m`);
  if (err.code === 'EISDIR') console.error('[EISDIR-DEBUG] path:', err.path || '(sin path)', '| syscall:', err.syscall);
  // No rethrow — el servidor sigue corriendo
});

server.listen(PORT, BIND, () => {
  const acct = config.label || config.id || '—';
  const now  = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const dim  = s => `\x1b[2m${s}\x1b[0m`;
  const grn  = s => `\x1b[32m${s}\x1b[0m`;
  const cyn  = s => `\x1b[36m${s}\x1b[0m`;
  const bold = s => `\x1b[1m${s}\x1b[0m`;

  console.log('');
  console.log(`  ${bold('✓ STOCKROOM')} ${dim(`arrancó a las ${now}`)}`);
  console.log(`    ${grn('●')} ${cyn(`http://localhost:${PORT}`)}`);
  console.log(`    Cuenta: ${acct}`);
  console.log(`    Bind: ${BIND === '0.0.0.0' ? 'LAN + local' : 'solo localhost'}`);
  console.log('');

  // ── Avisos de configuración opcional ─────────────────────────
  if (!fullConfig.email) {
    const ylw = s => `\x1b[33m${s}\x1b[0m`;
    console.log(`  ${ylw('⚠')} ${ylw('[email]')} Sin configuración de email — los compradores NO recibirán`);
    console.log(`         confirmaciones automáticas de pedido ni de pago.`);
    console.log(`         Para activar: agregá el bloque "email" en config.json`);
    console.log(`         (resend.com gratis hasta 3.000 emails/mes)`);
    console.log('');
  }
  if (!fullConfig.stripe?.secret_key) {
    // Silencioso — Stripe no está disponible en AR todavía, no alarmar
  }
});

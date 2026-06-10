// ── Verificación de firma de webhooks de Mercado Pago (anti-replay) ──
const crypto = require('crypto');

/**
 * Verifica la firma x-signature de un webhook de MP.
 * (opt-in: la validación se activa al configurar el secret en config.json,
 * se obtiene en MP Panel → Tu aplicación → Webhooks → Clave secreta).
 */
function mpVerifyWebhookSignature(req, dataId, secret) {
  if (!secret) return true; // sin secret → no validar (compatibilidad)

  const sig = req.headers['x-signature'] || '';
  const requestId = req.headers['x-request-id'] || '';
  const parts = Object.fromEntries(
    sig.split(',').map(p => p.trim().split('=').map(s => s.trim())).filter(p => p.length === 2)
  );
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1) return false;

  // Rechazar timestamps de más de 5 min (anti-replay)
  const age = Math.abs(Date.now() - parseInt(ts, 10));
  if (isNaN(age) || age > 5 * 60 * 1000) return false;

  let manifest = '';
  if (dataId)    manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch { return false; }
}

module.exports = { mpVerifyWebhookSignature };

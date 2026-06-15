// ── Helpers de MercadoPago de alto nivel (token activo + cuotas) ──
// Dependen de la cuenta activa (config) y de refreshAccountToken, que viven
// en server.js, así que se inyectan via factory.
const { mpGetInstallments } = require('./mercadopago');

/**
 * @param {() => object} getConfig - devuelve la cuenta activa (config) actual.
 * @param {(acct: object) => Promise<boolean>} refreshAccountToken
 */
function createMpHelpers({ getConfig, refreshAccountToken }) {

  // Variante async: si no hay mp_access_token dedicado, el fallback es el token de ML,
  // que expira cada ~6 h. Refrescarlo ANTES de llamar a MP evita los 401 intermitentes
  // en polling, creación de preferencias y webhooks.
  async function getMpTokenFresh() {
    const config = getConfig();
    if (config.mp_access_token) return config.mp_access_token;
    try { await refreshAccountToken(config); } catch (e) {}
    return config.access_token || null;
  }

  function isMpSandbox() {
    return getConfig().mp_sandbox === true;
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

  return { getMpTokenFresh, getCuotasTasas, isMpSandbox };
}

module.exports = { createMpHelpers };

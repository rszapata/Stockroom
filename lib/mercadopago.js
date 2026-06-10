// ── Cliente HTTP de bajo nivel para la API de Mercado Pago ──
const https = require('https');
const { applyHttpTimeout } = require('./http-client');

function mpCreatePreference(orden, baseUrl, accessToken) {
  return new Promise((resolve, reject) => {
    // Items del carrito
    const items = (orden.items || []).map(it => ({
      id           : String(it.id || it.product_id || 'item'),
      title        : ((it.title || 'Producto') + (it.variant ? ' — ' + it.variant : '')).slice(0, 256),
      description  : it.variant || undefined,
      quantity     : parseInt(it.qty || it.quantity || 1, 10),
      currency_id  : 'ARS',
      unit_price   : Math.round(parseFloat(it.price || 0) * 100) / 100,
      picture_url  : it.img || undefined,
    })).filter(it => it.unit_price > 0 && it.quantity > 0);

    // Envío como item separado (más claro en el resumen MP)
    if (orden.envio && orden.envio.precio > 0) {
      items.push({
        id          : 'shipping',
        title       : 'Envío — ' + (orden.envio.nombre || 'Envío'),
        quantity    : 1,
        currency_id : 'ARS',
        unit_price  : orden.envio.precio,
      });
    }

    const isHttps = baseUrl.startsWith('https://');
    const payload = {
      items,
      payer: {
        email : orden.datos?.email || undefined,
        name  : orden.datos?.nombre || undefined,
        phone : orden.datos?.telefono ? { number: String(orden.datos.telefono) } : undefined,
      },
      back_urls: {
        success : `${baseUrl}/tienda/confirmacion.html?id=${encodeURIComponent(orden.id)}&status=approved`,
        pending : `${baseUrl}/tienda/confirmacion.html?id=${encodeURIComponent(orden.id)}&status=pending`,
        failure : `${baseUrl}/tienda/confirmacion.html?id=${encodeURIComponent(orden.id)}&status=rejected`,
      },
      // auto_return solo funciona con HTTPS — en localhost no se setea
      ...(isHttps ? { auto_return: 'approved' } : {}),
      external_reference   : String(orden.id),
      statement_descriptor : 'WZMALLAS',
      notification_url: `${baseUrl}/api/tienda/webhook/mercadopago`,
    };

    const body = JSON.stringify(payload);
    const opts = {
      hostname : 'api.mercadopago.com',
      path     : '/checkout/preferences',
      method   : 'POST',
      headers  : {
        'Authorization' : `Bearer ${accessToken}`,
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent'    : 'WZMALLAS-Tienda/1.0',
      },
    };

    const req = https.request(opts, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (r.statusCode >= 200 && r.statusCode < 300) {
            resolve(j);
          } else {
            const e = new Error(`MP ${r.statusCode}: ${j.message || j.error || b.slice(0, 200)}`);
            e.status = r.statusCode;
            e.body   = j;
            reject(e);
          }
        } catch(parseErr) {
          reject(new Error(`MP respuesta inválida: ${b.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Busca pagos en MP por external_reference (= orden.id).
 * Devuelve el pago más reciente (puede haber varios si el usuario reintentó).
 */
function mpGetPaymentById(paymentId, accessToken) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${paymentId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'WZMALLAS-Tienda/1.0' },
    };
    const r = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
          else reject(Object.assign(new Error(`MP get payment ${res.statusCode}: ${j.message || ''}`), { status: res.statusCode }));
        } catch(e) { reject(e); }
      });
    });
    applyHttpTimeout(r, `mpGetPayment ${paymentId}`);
    r.on('error', reject);
    r.end();
  });
}

function mpSearchPaymentByExternalRef(externalRef, accessToken) {
  return new Promise((resolve, reject) => {
    const path = `/v1/payments/search?external_reference=${encodeURIComponent(externalRef)}&sort=date_created&criteria=desc&limit=10`;
    const opts = {
      hostname: 'api.mercadopago.com', path, method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'WZMALLAS-Tienda/1.0' },
    };
    const r = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const results = j.results || [];
            // Priorizar approved sobre pending sobre rejected
            const PRIORITY = { approved: 3, authorized: 3, in_process: 2, pending: 2, rejected: 1, cancelled: 1, refunded: 0, charged_back: 0 };
            results.sort((a, b) => (PRIORITY[b.status] || 0) - (PRIORITY[a.status] || 0));
            resolve(results[0] || null);
          } else {
            const e = new Error(`MP search ${res.statusCode}: ${j.message || b.slice(0,200)}`);
            e.status = res.statusCode;
            reject(e);
          }
        } catch(e) { reject(e); }
      });
    });
    applyHttpTimeout(r, `mpSearch ${externalRef}`);
    r.on('error', reject);
    r.end();
  });
}

module.exports = { mpCreatePreference, mpGetPaymentById, mpSearchPaymentByExternalRef };

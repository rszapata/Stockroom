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

    // ── Aplicar descuentos (cupón / transferencia) prorrateando sobre los items ──
    // orden.total ya viene con los descuentos restados (ver server.js, creación de orden).
    // Los items de MP deben sumar lo mismo que orden.total (menos el envío), sino
    // MP cobra el precio de lista completo aunque la orden registre un total menor.
    const subtotalItems = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    const envioPrecio   = (orden.envio && orden.envio.precio > 0) ? orden.envio.precio : 0;
    const targetItems   = (parseFloat(orden.total) || 0) - envioPrecio;
    if (subtotalItems > 0 && targetItems > 0 && Math.round(targetItems * 100) < Math.round(subtotalItems * 100)) {
      const factor = targetItems / subtotalItems;
      let acumulado = 0;
      items.forEach((it, idx) => {
        if (idx < items.length - 1) {
          it.unit_price = Math.round(it.unit_price * factor * 100) / 100;
          acumulado += it.unit_price * it.quantity;
        } else {
          // El último item absorbe la diferencia de redondeo para que la suma sea exacta
          it.unit_price = Math.round((targetItems - acumulado) / it.quantity * 100) / 100;
        }
      });
    }

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
    // notification_url lo llama MP desde sus propios servidores — tiene que ser
    // siempre el dominio público con HTTPS, sin importar desde dónde se generó
    // la preferencia (ej. probando desde la IP de LAN, MP rechaza esa URL con
    // "notification_url attribute must be a valid url"). back_urls sí pueden
    // usar baseUrl porque las sigue el navegador del comprador.
    const notificationBaseUrl = isHttps ? baseUrl : 'https://wzmallas.com';
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
      notification_url: `${notificationBaseUrl}/api/tienda/webhook/mercadopago`,
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
 * Consulta los planes de cuotas (con sus tasas de interés) que ofrece la cuenta
 * para un medio de pago dado. Las tasas no dependen del monto, así que se puede
 * cachear el resultado y reutilizarlo para cualquier precio.
 */
function mpGetInstallments(amount, paymentMethodId, accessToken) {
  return new Promise((resolve, reject) => {
    const path = `/v1/payment_methods/installments?amount=${amount}&payment_method_id=${paymentMethodId}&locale=es-AR`;
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
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
          else reject(Object.assign(new Error(`MP installments ${res.statusCode}: ${j.message || b.slice(0,200)}`), { status: res.statusCode }));
        } catch(e) { reject(e); }
      });
    });
    applyHttpTimeout(r, 'mpGetInstallments');
    r.on('error', reject);
    r.end();
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

module.exports = { mpCreatePreference, mpGetPaymentById, mpSearchPaymentByExternalRef, mpGetInstallments };

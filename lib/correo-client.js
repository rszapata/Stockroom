// ── Cliente de la API MiCorreo (Correo Argentino) ──────────────────────
// Cotiza envíos con la tarifa real de Correo. Se usa para las filas de
// "Correo Argentino" de la tienda, que antes mostraban precio y fecha de
// Mercado Libre: por eso una opción de Correo Clásico decía "Llega mañana",
// que Correo no hace (su plazo es de 2 a 5 días).
//
// Sólo cotiza. NO implementa /shipping/import ni /register a propósito: el
// primero crea envíos reales y el segundo usuarios.
//
// Credenciales por entorno (Stockroom/.env, fuera del repo y del deploy):
//   CORREO_USER, CORREO_PASS, CORREO_CUSTOMER_ID, CORREO_CP_ORIGEN,
//   CORREO_AMBIENTE=qa|prod
'use strict';
const https = require('https');

const HOSTS = {
  qa:   'apitest.correoargentino.com.ar',
  prod: 'api.correoargentino.com.ar',
};
const RUTA = '/micorreo/v1';

function crearCorreoClient(env = process.env) {
  const USER      = env.CORREO_USER || '';
  const PASS      = env.CORREO_PASS || '';
  const CUSTOMER  = env.CORREO_CUSTOMER_ID || '';
  const CP_ORIGEN = env.CORREO_CP_ORIGEN || '1635';
  const HOST      = HOSTS[(env.CORREO_AMBIENTE || 'prod').toLowerCase()] || HOSTS.prod;

  const configurado = !!(USER && PASS && CUSTOMER);

  function pedir(metodo, camino, { basic, bearer, json, timeout = 12000 } = {}) {
    return new Promise(resolve => {
      const cuerpo = json ? JSON.stringify(json) : null;
      const headers = { 'User-Agent': 'WZMALLAS/1.0', Accept: 'application/json' };
      if (basic)  headers.Authorization = 'Basic ' + Buffer.from(basic).toString('base64');
      if (bearer) headers.Authorization = 'Bearer ' + bearer;
      if (cuerpo) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(cuerpo);
      }
      const req = https.request({ hostname: HOST, path: RUTA + camino, method: metodo, headers, timeout },
        res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            let j = null;
            try { j = JSON.parse(d); } catch (e) {}
            resolve({ status: res.statusCode, json: j, texto: d.slice(0, 300) });
          });
        });
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, texto: 'timeout' }); });
      req.on('error', e => resolve({ status: 0, texto: e.message }));
      if (cuerpo) req.write(cuerpo);
      req.end();
    });
  }

  /* El token dura 2 h 30. Se guarda en memoria y se renueva 5 min antes de
     vencer, así una cotización no se pierde por un token que venció entre
     medio. Un solo pedido en vuelo por vez. */
  let _token = null, _vence = 0, _enVuelo = null;
  async function token() {
    if (_token && Date.now() < _vence) return _token;
    if (_enVuelo) return _enVuelo;
    _enVuelo = (async () => {
      for (let intento = 0; intento < 3; intento++) {
        const r = await pedir('POST', '/token', { basic: USER + ':' + PASS });
        if (r.status >= 200 && r.status < 300 && r.json && r.json.token) {
          _token = r.json.token;
          // La expiración sale del propio JWT; si no se puede leer, 2 h.
          _vence = Date.now() + 2 * 3600 * 1000;
          try {
            const carga = JSON.parse(Buffer.from(_token.split('.')[1], 'base64').toString('utf8'));
            if (carga.exp) _vence = carga.exp * 1000 - 5 * 60 * 1000;
          } catch (e) {}
          return _token;
        }
        // La API corta la conexión cada tanto; un par de intentos alcanza.
        await new Promise(r2 => setTimeout(r2, 400 * Math.pow(2, intento)));
      }
      return null;
    })();
    try { return await _enVuelo; } finally { _enVuelo = null; }
  }

  /* Caja por defecto. El catálogo todavía no tiene peso ni medidas cargadas
     (ver FASE 10.2 del PLAN), así que se cotiza con una caja chica que cubre
     mallas, fundas y protectores. Cuando haya medidas reales por producto,
     este default deja de usarse. */
  const CAJA_DEFECTO = { weight: 300, height: 5, width: 15, length: 20 };

  /* Cotiza un envío. Devuelve
       { validTo, opciones: [{ tipo:'D'|'S', producto, precio, diasMin, diasMax }] }
     o null si no se pudo cotizar (sin credenciales, CP inválido, API caída).
     Devolver null y no un precio inventado es a propósito: quien llama decide
     qué mostrar, pero nunca muestra un número que Correo no dio. */
  async function cotizar({ cp, caja } = {}) {
    if (!configurado) return null;
    const destino = String(cp || '').replace(/\D/g, '');
    if (!/^\d{4}$/.test(destino)) return null;

    const t = await token();
    if (!t) return null;

    const dims = Object.assign({}, CAJA_DEFECTO, caja || {});
    // La API exige enteros y tiene topes propios (25 kg, 150 cm por lado).
    const dimensions = {
      weight: Math.min(25000, Math.max(1, Math.round(dims.weight))),
      height: Math.min(150, Math.max(1, Math.round(dims.height))),
      width:  Math.min(150, Math.max(1, Math.round(dims.width))),
      length: Math.min(150, Math.max(1, Math.round(dims.length))),
    };

    // Sin deliveredType devuelve domicilio (D) y sucursal (S) en un solo pedido.
    const r = await pedir('POST', '/rates', { bearer: t, json: {
      customerId: CUSTOMER,
      postalCodeOrigin: CP_ORIGEN,
      postalCodeDestination: destino,
      dimensions,
    }});

    // Ojo: /rates contesta 202 (Accepted), no 200.
    if (!(r.status >= 200 && r.status < 300) || !r.json || !Array.isArray(r.json.rates)) return null;

    return {
      validTo: r.json.validTo || null,
      opciones: r.json.rates.map(x => ({
        tipo: x.deliveredType,                       // 'D' domicilio · 'S' sucursal
        producto: String(x.productName || '').replace(/^Correo Argentino\s*/i, '') || 'Clásico',
        precio: Math.round(Number(x.price) || 0),
        diasMin: x.deliveryTimeMin != null ? parseInt(x.deliveryTimeMin, 10) : null,
        diasMax: x.deliveryTimeMax != null ? parseInt(x.deliveryTimeMax, 10) : null,
      })).filter(o => o.precio > 0),
    };
  }

  return { configurado, cotizar, cpOrigen: CP_ORIGEN, ambiente: HOST, CAJA_DEFECTO };
}

module.exports = { crearCorreoClient };

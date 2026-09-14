#!/usr/bin/env node
/* Sonda de la API MiCorreo (Correo Argentino) — FASE 10 del PLAN.
 *
 * Sirve para dos cosas: confirmar que las credenciales andan y comparar la
 * tarifa de Correo contra lo que se está cobrando hoy, ANTES de mostrarle un
 * número a un cliente.
 *
 * Sólo toca endpoints que no crean nada:
 *   POST /token           autenticación
 *   POST /users/validate  lectura del customerId (necesita el mail de la cuenta)
 *   POST /rates           cotización — no genera ningún envío
 *   GET  /agencies        lectura de sucursales
 * NO implementa /register ni /shipping/import a propósito: el primero crea
 * usuarios y el segundo envíos reales.
 *
 * Uso (las credenciales salen del entorno, nunca de un archivo del repo):
 *   CORREO_USER=... CORREO_PASS=... [CORREO_CUSTOMER_ID=...] \
 *     node scripts/correo-probe.js [qa|prod]
 *
 * En el servidor viven en Stockroom/.env, que está en .gitignore y excluido
 * de deploy.sh.
 */
'use strict';
const https = require('https');
try { require('dotenv').config({ path: __dirname + '/../.env' }); } catch (e) {}

const USER = process.env.CORREO_USER;
const PASS = process.env.CORREO_PASS;
const CUSTOMER = process.env.CORREO_CUSTOMER_ID || '';
const CP_ORIGEN = process.env.CORREO_CP_ORIGEN || '1425';
const AMBIENTE = (process.argv[2] || process.env.CORREO_AMBIENTE || 'qa').toLowerCase();

const HOSTS = {
  qa:   'apitest.correoargentino.com.ar',
  prod: 'api.correoargentino.com.ar',
};
const HOST = HOSTS[AMBIENTE];
const RUTA = '/micorreo/v1';

if (!USER || !PASS) {
  console.error('Faltan CORREO_USER / CORREO_PASS (ponelos en Stockroom/.env o en el entorno).');
  process.exit(1);
}
if (!HOST) { console.error('Ambiente inválido: usá "qa" o "prod".'); process.exit(1); }

function pedir(metodo, camino, { basic, bearer, json } = {}) {
  return new Promise(resolve => {
    const cuerpo = json ? JSON.stringify(json) : null;
    const headers = { 'User-Agent': 'WZMALLAS/1.0', Accept: 'application/json' };
    if (basic)  headers.Authorization = 'Basic ' + Buffer.from(basic).toString('base64');
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (cuerpo) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(cuerpo);
    }
    const req = https.request(
      { hostname: HOST, path: RUTA + camino, method: metodo, headers, timeout: 20000 },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch (e) {}
          resolve({ status: res.statusCode, json: j, texto: d.slice(0, 400) });
        });
      });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, texto: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, texto: e.message }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

// Caja chica típica de una malla. Cambiala para probar otras categorías.
const CAJA = { weight: 300, height: 5, width: 15, length: 20 };

const DESTINOS = [
  { cp: '1425', desc: 'CABA' },
  { cp: '1704', desc: 'GBA oeste' },
  { cp: '5000', desc: 'Córdoba capital' },
  { cp: '3400', desc: 'Corrientes' },
  { cp: '9410', desc: 'Ushuaia' },
];

(async () => {
  console.log(`\nAmbiente: ${AMBIENTE} · ${HOST}\nOrigen: CP ${CP_ORIGEN} · Caja: ${JSON.stringify(CAJA)}\n`);

  // La API corta la conexión de vez en cuando; un par de intentos alcanza.
  let tok = null;
  for (let i = 0; i < 4; i++) {
    tok = await pedir('POST', '/token', { basic: USER + ':' + PASS });
    if (tok.status >= 200 && tok.status < 300 && tok.json && tok.json.token) break;
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!tok || !tok.json || !tok.json.token) {
    console.error('✗ POST /token →', tok ? tok.status : '-', tok ? tok.texto : '');
    process.exit(1);
  }
  const token = tok.json.token;
  let vence = '?';
  try {
    const carga = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    vence = new Date(carga.exp * 1000).toLocaleString('es-AR');
    console.log(`✓ token ok · cuenta "${carga.sub}" (${carga['member of']}) · vence ${vence}` +
                ` · dura ${Math.round((carga.exp - carga.iat) / 60)} min`);
  } catch (e) { console.log('✓ token ok'); }

  let customerId = CUSTOMER;
  if (!customerId) {
    /* El usuario de la API NO sirve acá: /users/validate espera el mail y la
       contraseña de la cuenta de MiCorreo, que son otros. Si no los hay, el
       customerId se saca del panel de MiCorreo. */
    const val = await pedir('POST', '/users/validate', { bearer: token, json: { email: USER, password: PASS } });
    if (val.json && val.json.customerId) customerId = val.json.customerId;
    else {
      console.log(`\n✗ Falta el customerId. POST /users/validate → ${val.status} ${val.texto}`);
      console.log('  Es una cadena de 10 dígitos (ej. 0000550137). Sacala del panel de MiCorreo');
      console.log('  y ponela en CORREO_CUSTOMER_ID, o corré esto con el mail/clave de esa cuenta.');
      process.exit(1);
    }
  }
  console.log(`✓ customerId: ${customerId}\n`);

  console.log('Cotizaciones (D = domicilio, S = sucursal):');
  for (const d of DESTINOS) {
    const r = await pedir('POST', '/rates', { bearer: token, json: {
      customerId,
      postalCodeOrigin: CP_ORIGEN,
      postalCodeDestination: d.cp,
      dimensions: CAJA,
    }});
    /* Ojo: /rates contesta 202 (Accepted), no 200. Filtrando por 200, una
       cotización buena se lee como error. */
    if (r.status >= 200 && r.status < 300 && r.json && r.json.rates) {
      const filas = r.json.rates
        .map(x => `${x.deliveredType} ${x.productName.replace('Correo Argentino ', '')} $${x.price}` +
                  (x.deliveryTimeMin ? ` (${x.deliveryTimeMin}-${x.deliveryTimeMax}d)` : ''))
        .join('  |  ');
      console.log(`  ${d.cp} ${d.desc.padEnd(16)} ${filas}`);
    } else {
      console.log(`  ${d.cp} ${d.desc.padEnd(16)} ✗ ${r.status} ${r.json ? r.json.message : r.texto}`);
    }
  }

  const ag = await pedir('GET',
    `/agencies?customerId=${encodeURIComponent(customerId)}&provinceCode=C`, { bearer: token });
  if (Array.isArray(ag.json)) {
    const ej = ag.json.length ? ` · ej: ${ag.json[0].code} ${ag.json[0].name}` : ' (lista vacía — revisá el customerId)';
    console.log(`\n✓ ${ag.json.length} sucursales en CABA${ej}`);
  } else {
    console.log(`\n✗ GET /agencies → ${ag.status} ${ag.json ? ag.json.message : ag.texto}`);
  }
  console.log();
})();

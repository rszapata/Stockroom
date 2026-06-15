// ── Cupones — almacenados en Stockroom/tienda-cupones.json ────────
// El checkout valida los cupones contra este archivo (vía getCupones()), y
// el admin de tienda los gestiona (alta/baja). guardarCuponFidelidad() crea
// el cupón de fidelidad post-compra para que sea válido en el próximo checkout.
const fs   = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./json-store');
const { generarCuponFidelidad } = require('./email-templates');

const CUPONES_PATH = path.join(__dirname, '..', 'tienda-cupones.json');

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

// Guardar cupón de fidelidad para que sea válido en el checkout
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

module.exports = { CUPONES_PATH, SOFT_LAUNCH_COUPON, getCupones, saveCupones, guardarCuponFidelidad };

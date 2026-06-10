// ── mailer.js — Emails transaccionales WZMALLAS ──────────────────
// Usa Gmail SMTP via Nodemailer.
// Configuración en config.json: { "gmail_user": "...", "gmail_pass": "..." }
// El gmail_pass debe ser un App Password de Google (no la contraseña normal).

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter(cfg) {
  if (_transporter) return _transporter;
  if (!cfg || !cfg.gmail_user || !cfg.gmail_pass) return null;
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.gmail_user, pass: cfg.gmail_pass },
  });
  return _transporter;
}

// ── Helpers ───────────────────────────────────────────────────────

function formatPrice(n) {
  return '$' + Number(n).toLocaleString('es-AR');
}

function logoUrl() {
  return 'https://wzmallas.com.ar/tienda/img/logo.png';
}

// Genera cupón único de fidelidad basado en el ID de la orden
function generarCuponFidelidad(ordenId) {
  const suffix = String(ordenId).slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, '0');
  return `GRACIAS${suffix}`;
}

// ── Templates ─────────────────────────────────────────────────────

function baseTemplate({ title, preheader, body, footer }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:#F5F5F5;">${preheader}</div>
  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:28px 40px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">WZMALLAS</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F5F5F5;padding:24px 40px;text-align:center;border-top:1px solid #E6E6E6;">
            <p style="margin:0;font-size:12px;color:#6E6E73;">${footer}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#6E6E73;">
              <a href="https://wzmallas.com.ar/tienda/" style="color:#3D5AFE;text-decoration:none;">wzmallas.com.ar</a>
              &nbsp;·&nbsp; Buenos Aires, Argentina
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Email 1: Confirmación de orden ────────────────────────────────

function templateConfirmacion({ orden, cupon }) {
  const items = (orden.items || []);
  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F0F0F0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:56px;vertical-align:top;">
              ${it.img ? `<img src="${it.img}" width="48" height="48" style="border-radius:8px;object-fit:cover;display:block;" alt="${it.title || ''}">` : ''}
            </td>
            <td style="padding-left:12px;vertical-align:top;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#111;">${it.title || 'Producto'}</p>
              ${it.variant ? `<p style="margin:2px 0 0;font-size:12px;color:#6E6E73;">${it.variant}</p>` : ''}
              <p style="margin:4px 0 0;font-size:12px;color:#6E6E73;">Cantidad: ${it.qty || 1}</p>
            </td>
            <td style="text-align:right;vertical-align:top;font-size:14px;font-weight:600;color:#111;white-space:nowrap;">
              ${formatPrice((it.price || 0) * (it.qty || 1))}
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const cuponHtml = cupon ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;background:#F0F7FF;border-radius:12px;border:2px dashed #3D5AFE;">
      <tr>
        <td style="padding:24px 28px;">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#3D5AFE;">🎁 Regalo para tu próxima compra</p>
          <p style="margin:8px 0 4px;font-size:28px;font-weight:700;letter-spacing:2px;color:#0A0A0A;">${cupon.codigo}</p>
          <p style="margin:0;font-size:14px;color:#444;">${cupon.descripcion}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6E6E73;">Válido por 60 días · No acumulable con otras promociones</p>
        </td>
      </tr>
    </table>` : '';

  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A0A0A;letter-spacing:-0.5px;">¡Gracias por tu compra! 🎉</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#5B5B5F;">Recibimos tu pedido y lo estamos procesando. Te avisaremos cuando esté en camino.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F9F9;border-radius:10px;padding:0;margin-bottom:24px;">
      <tr><td style="padding:20px 24px;">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6E6E73;">N° de orden</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#0A0A0A;">#${String(orden.id || '').slice(-8).toUpperCase()}</p>
      </td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      ${orden.descuento ? `<tr><td style="padding:6px 0;font-size:14px;color:#0E9F6E;">Descuento</td><td style="text-align:right;font-size:14px;color:#0E9F6E;">-${formatPrice(orden.descuento)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-size:14px;color:#5B5B5F;">Envío</td><td style="text-align:right;font-size:14px;color:#5B5B5F;">${orden.envio ? formatPrice(orden.envio) : 'A calcular'}</td></tr>
      <tr><td style="padding:10px 0;font-size:16px;font-weight:700;color:#0A0A0A;border-top:2px solid #ECECEC;">Total</td><td style="text-align:right;padding:10px 0;font-size:16px;font-weight:700;color:#0A0A0A;border-top:2px solid #ECECEC;">${formatPrice(orden.total || 0)}</td></tr>
    </table>

    ${orden.tracking ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td>
        <a href="https://wzmallas.com.ar/tienda/seguimiento.html?id=${orden.id}" style="display:inline-block;background:#0A0A0A;color:#fff;font-size:14px;font-weight:600;padding:14px 28px;border-radius:10px;text-decoration:none;">Seguir mi pedido →</a>
      </td></tr>
    </table>` : ''}

    ${cuponHtml}`;

  return baseTemplate({
    title: `Orden confirmada #${String(orden.id || '').slice(-8)} · WZMALLAS`,
    preheader: `Tu pedido fue confirmado. Total: ${formatPrice(orden.total || 0)}`,
    body,
    footer: 'Recibiste este email porque realizaste una compra en WZMALLAS.',
  });
}

// ── Email 2: Pago confirmado ──────────────────────────────────────

function templatePagoConfirmado({ orden }) {
  const body = `
    <div style="text-align:center;padding:16px 0 32px;">
      <div style="width:64px;height:64px;background:#E7F6EF;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:32px;">✅</span>
      </div>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A0A0A;">¡Pago recibido!</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#5B5B5F;">Tu pago fue procesado exitosamente. Estamos preparando tu pedido.</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#E7F6EF;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;font-size:12px;color:#0E9F6E;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Monto pagado</p>
              <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#0A0A0A;">${formatPrice(orden.total || 0)}</p>
            </td>
            <td style="text-align:right;">
              <p style="margin:0;font-size:12px;color:#0E9F6E;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Orden</p>
              <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#0A0A0A;">#${String(orden.id || '').slice(-8).toUpperCase()}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td>
        <a href="https://wzmallas.com.ar/tienda/seguimiento.html?id=${orden.id}" style="display:inline-block;background:#0A0A0A;color:#fff;font-size:14px;font-weight:600;padding:14px 28px;border-radius:10px;text-decoration:none;">Ver estado del pedido →</a>
      </td></tr>
    </table>`;

  return baseTemplate({
    title: `Pago confirmado · WZMALLAS`,
    preheader: `Tu pago de ${formatPrice(orden.total || 0)} fue recibido correctamente.`,
    body,
    footer: 'Recibiste este email porque realizaste un pago en WZMALLAS.',
  });
}

// ── Envío ─────────────────────────────────────────────────────────

async function enviarConfirmacionOrden(cfg, orden) {
  const transport = getTransporter(cfg);
  if (!transport) return { ok: false, error: 'Gmail no configurado' };

  const email = orden.email || (orden.items && orden.items[0] && orden.items[0].email);
  if (!email) return { ok: false, error: 'Sin email de destino' };

  // Generar cupón de fidelidad único para esta orden
  const codigoCupon = generarCuponFidelidad(orden.id);
  const cupon = {
    codigo: codigoCupon,
    descripcion: '10% de descuento en tu próxima compra',
    descuento: { type: 'percent', value: 10 },
  };

  // Guardar cupón en DB para que sea válido en el carrito
  if (cfg._saveCupon) {
    try { await cfg._saveCupon(codigoCupon, cupon.descuento); } catch(e) { console.error('[mailer] Error guardando cupón:', e.message); }
  }

  try {
    await transport.sendMail({
      from: `"WZMALLAS" <${cfg.gmail_user}>`,
      to: email,
      subject: `✅ Orden confirmada #${String(orden.id || '').slice(-8).toUpperCase()} · WZMALLAS`,
      html: templateConfirmacion({ orden, cupon }),
    });
    return { ok: true, cupon: codigoCupon };
  } catch(e) {
    console.error('[mailer] Error enviando confirmación:', e.message);
    return { ok: false, error: e.message };
  }
}

async function enviarPagoConfirmado(cfg, orden) {
  const transport = getTransporter(cfg);
  if (!transport) return { ok: false, error: 'Gmail no configurado' };

  const email = orden.email || (orden.items && orden.items[0] && orden.items[0].email);
  if (!email) return { ok: false, error: 'Sin email de destino' };

  try {
    await transport.sendMail({
      from: `"WZMALLAS" <${cfg.gmail_user}>`,
      to: email,
      subject: `💳 Pago recibido · Orden #${String(orden.id || '').slice(-8).toUpperCase()}`,
      html: templatePagoConfirmado({ orden }),
    });
    return { ok: true };
  } catch(e) {
    console.error('[mailer] Error enviando pago confirmado:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarConfirmacionOrden, enviarPagoConfirmado, generarCuponFidelidad };

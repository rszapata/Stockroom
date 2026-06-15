// ── Sistema de diseño compartido para emails transaccionales ──────
// Estética minimalista "Clean & Bold" 2026: fondos claros, texto
// oscuro de alto contraste, un único acento corporativo para los CTA,
// sin emojis. Maquetado con tablas (compatibilidad Gmail/Outlook/Apple
// Mail), estilos inline + soporte de modo oscuro vía media query.
const EMAIL_COLORS = {
  bgPage:   '#F4F4F5',
  bgCard:   '#FFFFFF',
  text:     '#0A0A0A',
  text2:    '#6B6B70',
  text3:    '#9B9BA1',
  border:   '#E4E4E7',
  accent:   '#1F3A93',
  success:  '#15803D',
  warning:  '#B45309',
  surface2: '#FAFAFA',
};

function _escEmail(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Envoltorio común: header con logo, card central de 600px y footer.
// Recibe el HTML interno ya armado (bodyHtml) y un texto de preheader
// (el resumen que se ve en la bandeja de entrada antes de abrir el mail).
function _emailShell({ preheader = '', bodyHtml = '' }) {
  const c = EMAIL_COLORS;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>WZMALLAS</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  body, table, td { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  body { margin:0; padding:0; background:${c.bgPage}; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:${c.accent}; }
  @media (prefers-color-scheme: dark) {
    .email-bg      { background:#0F0F11 !important; }
    .email-card    { background:#19191C !important; border-color:#2A2A2E !important; }
    .email-text    { color:#F2F2F3 !important; }
    .email-text-2  { color:#B5B5BA !important; }
    .email-text-3  { color:#86868B !important; }
    .email-border  { border-color:#2A2A2E !important; }
    .email-surface2{ background:#222226 !important; }
  }
  @media (max-width: 600px) {
    .email-container { width:100% !important; }
    .email-padding   { padding-left:24px !important; padding-right:24px !important; }
    .email-stack     { display:block !important; width:100% !important; text-align:left !important; }
    .email-stack-r   { text-align:left !important; padding-top:6px !important; }
  }
</style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:${c.bgPage};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.bgPage};">${_escEmail(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-bg" style="background:${c.bgPage};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="email-container" style="width:600px;max-width:600px;">

          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span class="email-text" style="font-size:18px;font-weight:700;letter-spacing:0.06em;color:${c.text};">WZMALLAS</span>
            </td>
          </tr>

          <tr>
            <td class="email-card email-border" style="background:${c.bgCard};border:1px solid ${c.border};border-radius:16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="email-padding" style="padding:40px 48px;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:32px 24px 0;">
              <p class="email-text-3" style="margin:0;font-size:12px;line-height:1.6;color:${c.text3};">WZMALLAS · Iparraguirre 169, Presidente Derqui (Pilar), Buenos Aires</p>
              <p class="email-text-3" style="margin:6px 0 0;font-size:12px;line-height:1.6;color:${c.text3};">
                <a href="mailto:contacto@wzmallas.com.ar" style="color:${c.text3};text-decoration:underline;">contacto@wzmallas.com.ar</a>
                &nbsp;·&nbsp;
                <a href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a>
                &nbsp;·&nbsp;
                <a href="https://wzmallas.com/tienda/" style="color:${c.text3};text-decoration:underline;">wzmallas.com</a>
              </p>
              <p class="email-text-3" style="margin:14px 0 0;font-size:11px;line-height:1.6;color:${c.text3};">© 2026 WZMALLAS — Todos los derechos reservados</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Template HTML de email de confirmación de orden
function emailConfirmacionOrden(orden) {
  const c       = EMAIL_COLORS;
  const items   = orden.items || [];
  const total   = orden.total || items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  const envio   = orden.envio || {};
  const cliente = orden.cliente || orden.datos || {};
  const fmt     = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const metodoLabel = { mercadopago: 'MercadoPago', stripe: 'Tarjeta (Stripe)', transferencia: 'Transferencia bancaria' };
  // El campo real de "método de envío" en la orden es `envio.empresa`
  // (p.ej. "correo-argentino", "retiro"), no `envio.metodo`.
  const esRetiro    = envio.empresa === 'retiro';
  const ordenCorta  = '#' + String(orden.id || '').slice(-8).toUpperCase();

  const itemsRows = items.map(it => `
    <tr>
      <td class="email-text email-border" style="padding:16px 0;border-bottom:1px solid ${c.border};font-size:14px;line-height:1.4;color:${c.text};">
        <span style="font-weight:600;">${_escEmail(it.title || it.name || 'Producto')}</span>
        ${it.variant ? `<br><span class="email-text-2" style="font-size:13px;color:${c.text2};">${_escEmail(it.variant)}</span>` : ''}
        <br><span class="email-text-3" style="font-size:12px;color:${c.text3};">Cantidad: ${it.qty || 1}</span>
      </td>
      <td class="email-text email-border" style="padding:16px 0;border-bottom:1px solid ${c.border};text-align:right;font-size:14px;font-weight:600;color:${c.text};white-space:nowrap;vertical-align:top;">
        ${fmt((it.price||0)*(it.qty||1))}
      </td>
    </tr>`).join('');

  const envioLinea = esRetiro
    ? `<tr>
         <td class="email-text-2" style="padding:4px 0;font-size:14px;color:${c.text2};">Envío</td>
         <td class="email-text-2" style="padding:4px 0;font-size:14px;text-align:right;color:${c.text2};">Retiro sin cargo</td>
       </tr>`
    : `<tr>
         <td class="email-text-2" style="padding:4px 0;font-size:14px;color:${c.text2};">Envío${envio.nombre ? ' · ' + _escEmail(envio.nombre) : ''}</td>
         <td class="email-text-2" style="padding:4px 0;font-size:14px;text-align:right;color:${c.text2};">${envio.precio > 0 ? fmt(envio.precio) : 'Sin cargo'}</td>
       </tr>`;

  const direccionHtml = !esRetiro && cliente.direccion ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td style="padding:0;">
          <p class="email-text-3" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Dirección de entrega</p>
          <p class="email-text" style="margin:0;font-size:14px;line-height:1.6;color:${c.text};">${_escEmail([cliente.direccion, cliente.piso, cliente.ciudad, cliente.provincia, cliente.cp].filter(Boolean).join(', '))}</p>
        </td>
      </tr>
    </table>` : '';

  const retiroHtml = esRetiro ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td class="email-surface2" style="background:${c.surface2};border-radius:12px;padding:20px 24px;">
          <p class="email-text-3" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Retiro en sucursal</p>
          <p class="email-text" style="margin:0;font-size:14px;line-height:1.6;color:${c.text};">Iparraguirre 169, Presidente Derqui (Pilar), Buenos Aires<br>Lunes a viernes de 9 a 18&nbsp;h · Sábados de 10 a 14&nbsp;h</p>
        </td>
      </tr>
    </table>` : '';

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.accent};">Pedido recibido</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Gracias por tu compra, ${_escEmail(cliente.nombre || 'cliente')}</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Recibimos tu pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong> y ya lo estamos procesando. Te vamos a avisar por email en cada paso: confirmación del pago, preparación y envío.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsRows}</table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      ${envioLinea}
      <tr>
        <td class="email-text email-border" style="padding:16px 0 0;border-top:1px solid ${c.border};font-size:16px;font-weight:700;color:${c.text};">Total</td>
        <td class="email-text email-border" style="padding:16px 0 0;border-top:1px solid ${c.border};font-size:16px;font-weight:700;text-align:right;color:${c.text};">${fmt(total)}</td>
      </tr>
      <tr>
        <td colspan="2" class="email-text-3" style="padding-top:6px;font-size:13px;color:${c.text3};">Pago con ${metodoLabel[orden.pago?.metodo] || orden.pago?.metodo || '—'}</td>
      </tr>
    </table>

    ${direccionHtml}
    ${retiroHtml}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <a href="https://wzmallas.com/tienda/seguimiento.html?id=${encodeURIComponent(orden.id)}&email=${encodeURIComponent(cliente.email || '')}" style="display:inline-block;background:${c.accent};color:#FFFFFF;font-size:14px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">Seguir mi pedido</a>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Necesitás ayuda con tu pedido? Respondé este correo o escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a>.</p>
  `;

  return _emailShell({
    preheader: `Recibimos tu pedido ${ordenCorta} por ${fmt(total)}. Te contamos los próximos pasos.`,
    bodyHtml: body,
  });
}

// ── Cupón de fidelidad — genera código único por orden ────────────
function generarCuponFidelidad(ordenId) {
  const suffix = String(ordenId).slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, '0');
  return `GRACIAS${suffix}`;
}

// ── Email: pago confirmado ────────────────────────────────────────
function emailPagoConfirmado(orden) {
  const c      = EMAIL_COLORS;
  const fmt    = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const total  = orden.total || 0;
  const codigo = generarCuponFidelidad(orden.id);
  const ordenCorta = '#' + String(orden.id || '').slice(-8).toUpperCase();
  const cliente = orden.cliente || orden.datos || {};

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.success};">Pago aprobado</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Tu pago fue confirmado</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(cliente.nombre || 'cliente')}, ya acreditamos el pago de tu pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong>. A partir de ahora empezamos a prepararlo para el envío.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-surface2" style="background:${c.surface2};border-radius:12px;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="email-stack" style="vertical-align:top;">
                <p class="email-text-3" style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Monto pagado</p>
                <p class="email-text" style="margin:0;font-size:20px;font-weight:700;color:${c.text};">${fmt(total)}</p>
              </td>
              <td class="email-stack email-stack-r" align="right" style="vertical-align:top;">
                <p class="email-text-3" style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Pedido</p>
                <p class="email-text" style="margin:0;font-size:20px;font-weight:700;color:${c.text};">${ordenCorta}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr>
        <td style="border:1px dashed ${c.accent};border-radius:12px;padding:24px 28px;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${c.accent};">Un gracias para tu próxima compra</p>
          <p class="email-text" style="margin:0 0 6px;font-size:26px;font-weight:700;letter-spacing:3px;color:${c.text};">${_escEmail(codigo)}</p>
          <p class="email-text-2" style="margin:0;font-size:14px;color:${c.text2};">10% de descuento en tu próximo pedido · Válido por 60 días</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <a href="https://wzmallas.com/tienda/seguimiento.html?id=${encodeURIComponent(orden.id)}&email=${encodeURIComponent(cliente.email || '')}" style="display:inline-block;background:${c.accent};color:#FFFFFF;font-size:14px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">Ver estado de mi pedido</a>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">Recibiste este correo porque se confirmó un pago asociado a tu pedido en WZMALLAS.</p>
  `;

  return _emailShell({
    preheader: `Confirmamos tu pago de ${fmt(total)} para el pedido ${ordenCorta}. Guardá tu cupón ${codigo}.`,
    bodyHtml: body,
  });
}

// ── Email: pedido despachado / tracking de envío ─────────────────
function emailEnvioTracking(orden, tracking) {
  const c = EMAIL_COLORS;
  const cliente    = orden.cliente || orden.datos || {};
  const ordenCorta = '#' + String(orden.id || '').slice(-8).toUpperCase();

  const trackingBlock = tracking ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-surface2" style="background:${c.surface2};border-radius:12px;">
      <tr>
        <td align="center" style="padding:24px;">
          <p class="email-text-3" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Número de seguimiento</p>
          <p class="email-text" style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:1.5px;color:${c.text};font-family:'SFMono-Regular',Consolas,monospace;">${_escEmail(tracking)}</p>
          <a href="https://correoargentino.com.ar/MiCorreo/public/index#seguimiento?piezas=${encodeURIComponent(tracking)}" style="display:inline-block;background:${c.accent};color:#FFFFFF;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">Rastrear envío</a>
        </td>
      </tr>
    </table>` : '';

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.accent};">Pedido despachado</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Tu pedido está en camino</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(cliente.nombre || 'cliente')}, despachamos tu pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong>. Ya está en camino hacia la dirección que indicaste al finalizar la compra.
    </p>

    ${trackingBlock}

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés dudas sobre tu envío? Escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a> o a <a class="email-text-3" href="mailto:contacto@wzmallas.com.ar" style="color:${c.text3};text-decoration:underline;">contacto@wzmallas.com.ar</a>.</p>
  `;

  return _emailShell({
    preheader: `Despachamos tu pedido ${ordenCorta}${tracking ? ' · Seguimiento: ' + tracking : ''}.`,
    bodyHtml: body,
  });
}

// ── Email: pedido entregado ───────────────────────────────────────
function emailPedidoEntregado(orden) {
  const c = EMAIL_COLORS;
  const cliente    = orden.cliente || orden.datos || {};
  const ordenCorta = '#' + String(orden.id || '').slice(-8).toUpperCase();

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.success};">Pedido entregado</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Tu pedido llegó a destino</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(cliente.nombre || 'cliente')}, registramos la entrega de tu pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong>. ¡Esperamos que lo disfrutes!
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td class="email-border" style="border-left:3px solid ${c.accent};padding:4px 0 4px 18px;">
          <p class="email-text-2" style="margin:0;font-size:14px;line-height:1.6;color:${c.text2};">Si algo no llegó como esperabas, recordá que contás con 30 días de garantía y devolución sin costo (Art. 34, Ley 24.240). Escribinos y lo resolvemos.</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <a href="https://wzmallas.com/tienda/seguimiento.html?id=${encodeURIComponent(orden.id)}&email=${encodeURIComponent(cliente.email || '')}" style="display:inline-block;background:${c.accent};color:#FFFFFF;font-size:14px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">Ver mi pedido</a>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés alguna consulta sobre tu pedido? Escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a> o a <a class="email-text-3" href="mailto:contacto@wzmallas.com.ar" style="color:${c.text3};text-decoration:underline;">contacto@wzmallas.com.ar</a>.</p>
  `;

  return _emailShell({
    preheader: `Tu pedido ${ordenCorta} fue entregado. Contás con 30 días de garantía y devolución sin costo.`,
    bodyHtml: body,
  });
}

// ── Email: pedido cancelado ───────────────────────────────────────
function emailPedidoCancelado(orden) {
  const c = EMAIL_COLORS;
  const fmt    = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const cliente    = orden.cliente || orden.datos || {};
  const ordenCorta = '#' + String(orden.id || '').slice(-8).toUpperCase();

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.text3};">Pedido cancelado</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Tu pedido fue cancelado</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(cliente.nombre || 'cliente')}, te confirmamos que el pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong> ${orden.total ? `por ${fmt(orden.total)}` : ''} fue cancelado y no se procesará el envío.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td class="email-border" style="border-left:3px solid ${c.accent};padding:4px 0 4px 18px;">
          <p class="email-text-2" style="margin:0;font-size:14px;line-height:1.6;color:${c.text2};">Si ya habías realizado un pago, te vamos a contactar para coordinar el reembolso (o ya fue procesado, según corresponda).</p>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés dudas sobre esta cancelación? Escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a> o a <a class="email-text-3" href="mailto:contacto@wzmallas.com.ar" style="color:${c.text3};text-decoration:underline;">contacto@wzmallas.com.ar</a>, mencionando el pedido ${ordenCorta}.</p>
  `;

  return _emailShell({
    preheader: `Tu pedido ${ordenCorta} fue cancelado.`,
    bodyHtml: body,
  });
}

// ── Email: pedido reembolsado ─────────────────────────────────────
function emailPedidoReembolsado(orden) {
  const c = EMAIL_COLORS;
  const fmt    = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  const cliente    = orden.cliente || orden.datos || {};
  const ordenCorta = '#' + String(orden.id || '').slice(-8).toUpperCase();

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.accent};">Reembolso procesado</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Tu reembolso fue procesado</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(cliente.nombre || 'cliente')}, te confirmamos que reembolsamos el pedido <strong class="email-text" style="color:${c.text};">${ordenCorta}</strong>${orden.total ? ` por ${fmt(orden.total)}` : ''}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td class="email-border" style="border-left:3px solid ${c.accent};padding:4px 0 4px 18px;">
          <p class="email-text-2" style="margin:0;font-size:14px;line-height:1.6;color:${c.text2};">El dinero puede demorar algunos días hábiles en reflejarse según tu medio de pago (MercadoPago / tarjeta / banco).</p>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés dudas sobre este reembolso? Escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a> o a <a class="email-text-3" href="mailto:contacto@wzmallas.com.ar" style="color:${c.text3};text-decoration:underline;">contacto@wzmallas.com.ar</a>, mencionando el pedido ${ordenCorta}.</p>
  `;

  return _emailShell({
    preheader: `Reembolsamos tu pedido ${ordenCorta}${orden.total ? ' por ' + fmt(orden.total) : ''}.`,
    bodyHtml: body,
  });
}

// ── Email: confirmación de solicitud de arrepentimiento/devolución ─
function emailArrepentimientoConfirmacion({ nombre, pedido, ticket, tipo }) {
  const c = EMAIL_COLORS;
  const tipoLabel = { devolucion: 'devolución', cambio: 'cambio', arrepentimiento: 'arrepentimiento de compra' };
  const tipoTexto = tipoLabel[tipo] || tipo || 'devolución';

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.accent};">Solicitud recibida</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Recibimos tu solicitud</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Hola ${_escEmail(nombre || 'cliente')}, registramos tu solicitud de <strong class="email-text" style="color:${c.text};">${_escEmail(tipoTexto)}</strong> para el pedido <strong class="email-text" style="color:${c.text};">${_escEmail(pedido)}</strong>. Vamos a contactarte dentro de las próximas 48 horas hábiles para coordinar los pasos siguientes.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-surface2" style="background:${c.surface2};border-radius:12px;">
      <tr>
        <td align="center" style="padding:24px;">
          <p class="email-text-3" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${c.text3};">Ticket de seguimiento</p>
          <p class="email-text" style="margin:0;font-size:22px;font-weight:700;letter-spacing:2px;color:${c.text};font-family:'SFMono-Regular',Consolas,monospace;">${_escEmail(ticket)}</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td class="email-border" style="border-left:3px solid ${c.accent};padding:4px 0 4px 18px;">
          <p class="email-text-2" style="margin:0;font-size:14px;line-height:1.6;color:${c.text2};">El costo del flete de devolución corre por nuestra cuenta, conforme al derecho de arrepentimiento de compra (Art. 34, Ley 24.240). No necesitás hacer nada más por ahora — te contactamos nosotros para coordinar el retiro o el cambio.</p>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés alguna consulta mientras tanto? Respondé este correo o escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a>, mencionando el ticket <strong class="email-text" style="color:${c.text};">${_escEmail(ticket)}</strong>.</p>
  `;

  return _emailShell({
    preheader: `Registramos tu solicitud de ${tipoTexto} — Ticket ${ticket}. Te contactamos en menos de 48 h hábiles.`,
    bodyHtml: body,
  });
}

// ── Carrito abandonado — "tu carrito te espera" (1 vez, a las 4hs) ──
function emailCarritoAbandonado({ nombre, items, total, token }) {
  const c   = EMAIL_COLORS;
  const fmt = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });

  const itemsRows = (items || []).map(it => `
    <tr>
      <td class="email-text email-border" style="padding:16px 0;border-bottom:1px solid ${c.border};font-size:14px;line-height:1.4;color:${c.text};">
        <span style="font-weight:600;">${_escEmail(it.title || it.name || 'Producto')}</span>
        ${it.variant ? `<br><span class="email-text-2" style="font-size:13px;color:${c.text2};">${_escEmail(it.variant)}</span>` : ''}
        <br><span class="email-text-3" style="font-size:12px;color:${c.text3};">Cantidad: ${it.qty || 1}</span>
      </td>
      <td class="email-text email-border" style="padding:16px 0;border-bottom:1px solid ${c.border};text-align:right;font-size:14px;font-weight:600;color:${c.text};white-space:nowrap;vertical-align:top;">
        ${fmt((it.price||0)*(it.qty||1))}
      </td>
    </tr>`).join('');

  const body = `
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${c.accent};">Tu carrito te espera</p>
    <h1 class="email-text" style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:${c.text};">Hola ${_escEmail(nombre || '')}, ¿te olvidaste algo?</h1>
    <p class="email-text-2" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${c.text2};">
      Dejaste estos productos en tu carrito. Te los guardamos — volvé cuando quieras para completar tu compra.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsRows}</table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      <tr>
        <td class="email-text email-border" style="padding:16px 0 0;border-top:1px solid ${c.border};font-size:16px;font-weight:700;color:${c.text};">Total</td>
        <td class="email-text email-border" style="padding:16px 0 0;border-top:1px solid ${c.border};font-size:16px;font-weight:700;text-align:right;color:${c.text};">${fmt(total)}</td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;">
      <tr>
        <td align="center">
          <a href="https://wzmallas.com/tienda/carrito.html?restore=${encodeURIComponent(token)}" style="display:inline-block;background:${c.accent};color:#FFFFFF;font-size:14px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">Volver a mi carrito</a>
        </td>
      </tr>
    </table>

    <p class="email-text-3" style="margin:28px 0 0;font-size:13px;line-height:1.6;color:${c.text3};text-align:center;">¿Tenés alguna duda? Escribinos por <a class="email-text-3" href="https://wa.me/5492304216009" style="color:${c.text3};text-decoration:underline;">WhatsApp</a>, estamos para ayudarte.</p>
  `;

  return _emailShell({
    preheader: `Tenés ${(items || []).length} producto(s) esperándote en tu carrito por ${fmt(total)}.`,
    bodyHtml: body,
  });
}

module.exports = {
  EMAIL_COLORS, _escEmail, _emailShell,
  emailConfirmacionOrden, generarCuponFidelidad, emailPagoConfirmado,
  emailEnvioTracking, emailArrepentimientoConfirmacion,
  emailPedidoEntregado, emailPedidoCancelado, emailPedidoReembolsado,
  emailCarritoAbandonado,
};

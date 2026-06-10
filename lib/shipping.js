// ── Helpers de presentación de envíos (estimación de entrega, nombres) ──

/**
 * Formatea una estimación de entrega de ML en un texto amigable
 * (ej: "Llega hoy", "Llega mañana", "Llega el martes 9 de
 * junio", "Llega entre el lunes 10 y el martes 11 de junio").
 */
function formatDeliveryEstimate(est) {
  if (!est || !est.date) return null;
  const fmtDate = (iso) => {
    try {
      const d       = new Date(iso);
      const weekday = d.toLocaleDateString('es-AR', { weekday: 'long' });
      const month   = d.toLocaleDateString('es-AR', { month: 'long' });
      return `${weekday} ${d.getDate()} de ${month}`;  // ej: "martes 9 de junio"
    } catch { return null; }
  };
  const dayDiff = (iso) => {
    const target = new Date(iso); target.setHours(0, 0, 0, 0);
    const now    = new Date();   now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);
  };

  const from = est.date;
  const to   = (est.offset && est.offset.date && est.offset.date !== from) ? est.offset.date : null;

  let label;
  if (to) {
    label = `Llega entre el ${fmtDate(from)} y el ${fmtDate(to)}`;
  } else {
    const diff = dayDiff(from);
    if (diff <= 0)      label = 'Llega hoy';
    else if (diff === 1) label = 'Llega mañana';
    else                 label = `Llega el ${fmtDate(from)}`;
  }
  return { from, to, label };
}

/**
 * Algunas opciones de envío que devuelve la API de ML traen un `name`
 * técnico/interno (ej: "MLA-address-slow_meli") en lugar de un nombre
 * legible para el comprador. Esta función arma un nombre amigable en
 * español a partir de `shipping_method_type` + `shipping_option_type`
 * cuando detecta que el nombre original no es presentable.
 */
function friendlyShippingName(opt) {
  const raw = (opt && opt.name || '').trim();
  // Nombres "lindos" que ya vienen listos para mostrar (ej: "Express a
  // domicilio", "Estándar a sucursal de correo") — los dejamos tal cual.
  if (raw && !/^MLA-|_meli$/i.test(raw)) return raw;

  const dest = opt.shipping_option_type === 'agency' ? 'a sucursal de correo' : 'a domicilio';
  const speedMap = {
    same_day:   'Mismo día',
    next_day:   'Día siguiente',
    express:    'Express',
    standard:   'Estándar',
    slow_meli:  'Estándar',
    fulfillment:'Full',
  };
  const speed = speedMap[opt.shipping_method_type] || 'Envío';
  return `${speed} ${dest}`;
}

module.exports = { formatDeliveryEstimate, friendlyShippingName };

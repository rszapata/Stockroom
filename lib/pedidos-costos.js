/* ──────────────────────────────────────────────────────────────
 * pedidos-costos.js — Costo PUESTO real por variante, a partir de un pedido
 *
 * Un "pedido" es un envío: el recibo del proveedor (qué se compró y a qué
 * precio) más los costos del envío (flete, impuestos, dólar). A partir de eso
 * se reparte lo que NO es mercadería y sale el costo real de cada unidad.
 *
 * ⚠️ Este módulo NO toca stock. Vincular una línea del recibo a una variante
 * es solo para saber a qué producto imputarle el costo — nunca modifica
 * cantidades en MercadoLibre. Eso lo hace `carga Alibaba`, que es otra cosa.
 *
 * Por qué el reparto es configurable: el flete se cobra por peso volumétrico,
 * así que lo correcto sería repartirlo por VOLUMEN. Pero el recibo no trae las
 * medidas de cada artículo, así que se ofrecen tres criterios y el dueño elige
 * el que mejor represente su caja.
 * ────────────────────────────────────────────────────────────── */
'use strict';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Peso volumétrico (kg) con el divisor estándar de courier aéreo. */
function pesoVolumetrico(medidas, divisor = 5000) {
  if (!Array.isArray(medidas) || medidas.length !== 3) return 0;
  const [a, b, c] = medidas.map(num);
  if (a <= 0 || b <= 0 || c <= 0) return 0;
  return (a * b * c) / divisor;
}

/**
 * El courier cobra el MAYOR entre el peso real y el volumétrico. Para fundas
 * suele ganar el volumétrico (livianas y voluminosas); para mallas, el real.
 */
function pesoCobrable(envio = {}) {
  const real = num(envio.peso_real_kg);
  const vol  = pesoVolumetrico(envio.medidas_cm, num(envio.divisor_volumetrico) || 5000);
  return { real, volumetrico: vol, cobrable: Math.max(real, vol), manda: vol > real ? 'volumetrico' : 'real' };
}

/** Peso de reparto de cada línea según el criterio elegido. */
function pesoDeReparto(item, criterio) {
  const cant = num(item.cantidad);
  if (cant <= 0) return 0;
  if (criterio === 'valor')   return cant * num(item.precio_unit_usd);
  if (criterio === 'volumen') return cant * (num(item.vol_factor) || 1);
  return cant;   // 'unidades' (default)
}

/**
 * Calcula el costo puesto por unidad de cada línea.
 * Devuelve un objeto nuevo; no muta el pedido recibido.
 */
function calcularPedido(pedido = {}) {
  const envio    = pedido.envio || {};
  const dolar    = num(envio.dolar);
  const criterio = ['unidades', 'valor', 'volumen'].includes(pedido.reparto) ? pedido.reparto : 'unidades';
  const items    = Array.isArray(pedido.items) ? pedido.items : [];

  // Todo lo que no es mercadería, en pesos. El flete viene en USD (así lo
  // cotiza el courier) y los impuestos en ARS (así se pagan acá).
  const flete_ars     = num(envio.flete_usd) * dolar;
  const impuestos_ars = num(envio.impuestos_ars);
  const otros_ars     = num(envio.otros_ars);
  const no_producto   = flete_ars + impuestos_ars + otros_ars;

  const pesos = items.map(it => pesoDeReparto(it, criterio));
  const suma  = pesos.reduce((a, b) => a + b, 0);

  let mercaderia_ars = 0, unidades = 0;
  const lineas = items.map((it, i) => {
    const cant  = num(it.cantidad);
    const pu    = num(it.precio_unit_usd);
    // Sin peso total no hay forma de repartir: se imputa 0 en vez de NaN.
    const parte = suma > 0 ? no_producto * (pesos[i] / suma) : 0;
    const merc_unit  = pu * dolar;
    const extra_unit = cant > 0 ? parte / cant : 0;
    // Envío e impuestos se reparten en la misma proporción en que componen el
    // costo no-mercadería, para poder mostrarlos separados aguas abajo.
    const flete_unit = no_producto > 0 ? extra_unit * (flete_ars / no_producto) : 0;
    const imp_unit   = extra_unit - flete_unit;

    mercaderia_ars += merc_unit * cant;
    unidades       += cant;

    return {
      ...it,
      cantidad: cant,
      precio_unit_usd: pu,
      mercaderia_unit_ars: Math.round(merc_unit),
      extra_unit_ars:      Math.round(extra_unit),        // flete + impuestos imputados
      flete_unit_ars:      Math.round(flete_unit),
      impuestos_unit_ars:  Math.round(imp_unit),
      costo_unit_ars:      Math.round(merc_unit + extra_unit),
      costo_linea_ars:     Math.round((merc_unit + extra_unit) * cant),
      parte_no_producto_ars: Math.round(parte),
    };
  });

  const total_ars = Math.round(mercaderia_ars + no_producto);
  const pc = pesoCobrable(envio);

  return {
    ...pedido,
    reparto: criterio,
    items: lineas,
    totales: {
      unidades,
      mercaderia_ars: Math.round(mercaderia_ars),
      flete_ars:      Math.round(flete_ars),
      impuestos_ars:  Math.round(impuestos_ars),
      otros_ars:      Math.round(otros_ars),
      no_producto_ars: Math.round(no_producto),
      total_ars,
      costo_unit_promedio_ars: unidades > 0 ? Math.round(total_ars / unidades) : 0,
      // Participación de cada rubro: hace visible cuánto pesan los impuestos,
      // que es justo lo que el modelo viejo ignoraba.
      pct_mercaderia: total_ars > 0 ? +(mercaderia_ars / total_ars).toFixed(4) : 0,
      pct_flete:      total_ars > 0 ? +(flete_ars / total_ars).toFixed(4) : 0,
      pct_impuestos:  total_ars > 0 ? +((impuestos_ars + otros_ars) / total_ars).toFixed(4) : 0,
    },
    envio_calc: {
      ...pc,
      usd_por_kg: pc.cobrable > 0 ? +(num(envio.flete_usd) / pc.cobrable).toFixed(2) : 0,
    },
  };
}

/**
 * Mapa `item_id::variation_id` → costo, tomando de cada variante el pedido MÁS
 * RECIENTE que la incluya. Es lo que consumen orden de compra y rentabilidad:
 * un costo medido, no estimado.
 */
function costosPorVariante(pedidos = []) {
  const out = {};
  const ordenados = [...pedidos].sort((a, b) =>
    String(a.fecha_compra || '').localeCompare(String(b.fecha_compra || '')));
  for (const p of ordenados) {
    const calc = calcularPedido(p);
    for (const it of calc.items) {
      if (!it.item_id) continue;   // línea sin vincular: no se puede imputar
      const key = `${it.item_id}::${it.variation_id || ''}`;
      out[key] = {
        costo_unit_ars: it.costo_unit_ars,
        precio_unit_usd: it.precio_unit_usd,
        mercaderia_unit_ars: it.mercaderia_unit_ars,
        extra_unit_ars: it.extra_unit_ars,
        flete_unit_ars: it.flete_unit_ars,
        impuestos_unit_ars: it.impuestos_unit_ars,
        pedido_id: p.id,
        fecha_compra: p.fecha_compra || null,
        dolar: num((p.envio || {}).dolar),
        titulo_ml: it.titulo_ml || '',
      };
    }
  }
  return out;
}

/**
 * Costos NO-mercadería promedio por unidad, sobre todos los pedidos cargados.
 * Reemplaza al viejo par "flete total / unidades de referencia", que había que
 * escribir a mano y no contemplaba impuestos.
 */
function promediosNoProducto(pedidos = []) {
  let uds = 0, flete = 0, imp = 0;
  for (const p of pedidos) {
    const c = calcularPedido(p);
    uds   += c.totales.unidades;
    flete += c.totales.flete_ars;
    imp   += c.totales.impuestos_ars + c.totales.otros_ars;
  }
  if (uds <= 0) return null;
  return {
    unidades: uds, pedidos: pedidos.length,
    flete_unit_ars:     Math.round(flete / uds),
    impuestos_unit_ars: Math.round(imp / uds),
    extra_unit_ars:     Math.round((flete + imp) / uds),
  };
}

module.exports = { calcularPedido, costosPorVariante, promediosNoProducto, pesoVolumetrico, pesoCobrable };

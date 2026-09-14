// ── Conciliación: lo cargado a mano vs lo que ML reporta hoy ───────────
//
// Por qué existe: los cobros de fundas se cargan bajando el Excel de
// liquidación de ML. Ese Excel es la verdad de lo que ML pagó ESE DÍA, pero
// tiene dos límites que sólo se ven comparándolo contra la API:
//
//   1. DEVOLUCIONES POSTERIORES. Si el comprador devuelve después de que la
//      liquidación se pagó, el Excel ya no cambia. La API sí: marca la orden
//      como "Cancelada/Devolución". Medido sobre los 10 períodos cargados,
//      apareció un paquete de $35.503 (25/07) contado como venta que ML hoy
//      da por devuelto — y en ningún período hay netos negativos, así que esa
//      plata nunca se descontó.
//
//   2. PAQUETES MIXTOS ESTIMADOS. En el Excel los sub-ítems de un paquete
//      vienen sin precio propio: sólo la fila padre trae el total. Por eso
//      genera_cobro.py cae en estimar_neto_funda_en_paquete(), que adivina el
//      precio de la funda con el promedio histórico de títulos parecidos.
//      Por la API cada ítem trae su precio real y el cálculo es exacto.
//      No es que un método use "otro criterio": el Excel no tiene el dato.
//
// Qué NO hace: tocar los cobros. La conciliación sólo informa. Reescribir
// automáticamente plata ya cargada a mano sería peor que mostrar la
// diferencia y dejar que alguien decida.
//
// El cruce se hace POR DÍA, no por id de venta: entre el Excel y la API los
// ids no siempre coinciden (el Excel trae el nº de operación en unas filas y
// el de la orden en otras), pero la fecha y el importe sí.

const CANCELADA = /cancel|devol/i;
const ES_PAQUETE = /^PKT:/i;
const ESTIMADO = /mixto/i;          // tipo "Paquete mixto (1F+1O)"

const dia = v => String(v.fecha || '').slice(0, 10);
const num = v => Number(v) || 0;

/** Suma de neto por día de una lista de ventas (ignora las excluidas). */
function netoPorDia(ventas) {
  const m = new Map();
  (ventas || []).filter(v => !v.excluida).forEach(v => {
    const d = dia(v);
    if (d) m.set(d, (m.get(d) || 0) + num(v.neto));
  });
  return m;
}

/**
 * Devoluciones CONFIRMADAS de un día: filas del manual que se contaron como
 * venta y que la API hoy da por canceladas.
 *
 * No alcanza con listar lo que la API marca cancelado ese día. En un día
 * cualquiera se cancelan mallas y protectores, que nunca entraron al cobro de
 * fundas: culparlas de una diferencia en fundas es contar mal. Por eso se
 * confirma por IMPORTE BRUTO — una fila del manual está devuelta si su
 * `ingresos` coincide con el de una cancelada, o con la suma de las canceladas
 * que comparten título (un paquete de 2 fundas iguales llega como 2 filas).
 *
 * Ejemplo real: el 25/07 el manual tiene un paquete de $62.510 y la API dos
 * fundas canceladas de $31.255 → confirma. El 21/07 el manual tiene un paquete
 * de $60.799 y las canceladas del día son una malla de $23.500 y un combo de
 * $60.892 → no confirma, y la diferencia queda como criterio de cálculo.
 */
function devueltasDelDia(ventasManual, ventasApi, d) {
  const canceladas = (ventasApi || [])
    .filter(v => dia(v) === d && CANCELADA.test(String(v.tipo || '')));
  if (!canceladas.length) return [];

  // Importes candidatos: cada cancelada sola, y la suma por título repetido.
  const candidatos = new Map();               // importe → filas que lo componen
  const agrega = (monto, filas) => {
    if (monto <= 0) return;
    const k = Math.round(monto);
    if (!candidatos.has(k)) candidatos.set(k, filas);
  };
  canceladas.forEach(v => agrega(num(v.ingresos), [v]));
  const porTitulo = new Map();
  canceladas.forEach(v => {
    const t = String(v.titulo || '');
    porTitulo.set(t, (porTitulo.get(t) || []).concat([v]));
  });
  porTitulo.forEach(filas => {
    if (filas.length > 1) agrega(filas.reduce((a, v) => a + num(v.ingresos), 0), filas);
  });
  // Y la suma de todas, para paquetes de productos distintos
  if (canceladas.length > 1) agrega(canceladas.reduce((a, v) => a + num(v.ingresos), 0), canceladas);

  const out = [];
  (ventasManual || []).filter(v => dia(v) === d).forEach(v => {
    const k = Math.round(num(v.ingresos));
    const filas = candidatos.get(k);
    if (!filas) return;
    out.push({
      id: String(v.id),                   // para poder descontarla sin ambigüedad
      fecha: d,
      titulo: String(v.titulo || ''),
      ingresos: num(v.ingresos),
      neto_contado: num(v.neto),          // lo que el manual sumó por esta venta
      items: filas.map(x => ({ titulo: String(x.titulo || ''), ingresos: num(x.ingresos) })),
    });
    candidatos.delete(k);                 // una cancelada explica una sola fila
  });
  return out;
}

/**
 * Concilia UN cobro manual contra el recálculo por API del mismo rango.
 * @param {object} cobro           cobro guardado (el cargado a mano)
 * @param {Array}  ventasApi       ventas devueltas por /cobro/ml para ese rango
 * @returns {object|null}          null si no hay nada que reportar
 */
function conciliarCobro(cobro, ventasApi) {
  const vMan = (cobro.ventas || []).filter(v => !v.excluida);
  const vApi = (ventasApi || []).filter(v => !v.excluida);
  if (!vMan.length) return null;

  const netoMan = vMan.reduce((a, v) => a + num(v.neto), 0);
  const netoApi = vApi.reduce((a, v) => a + num(v.neto), 0);

  const porDiaMan = netoPorDia(vMan);
  const porDiaApi = netoPorDia(vApi);

  // Días donde los dos métodos no coinciden (más de un peso de diferencia)
  const dias = [...new Set([...porDiaMan.keys(), ...porDiaApi.keys()])].sort();
  const desalineados = [];
  for (const d of dias) {
    const man = porDiaMan.get(d) || 0;
    const api = porDiaApi.get(d) || 0;
    if (Math.abs(man - api) < 1) continue;

    const devueltas = devueltasDelDia(vMan, ventasApi, d);
    const estimados = vMan
      .filter(v => dia(v) === d && (v.mixto || ESTIMADO.test(String(v.tipo || ''))))
      .map(v => ({ titulo: String(v.titulo || ''), neto: num(v.neto), tipo: String(v.tipo || '') }));
    const paquetes = vMan
      .filter(v => dia(v) === d && ES_PAQUETE.test(String(v.titulo || '')) && !v.mixto)
      .map(v => ({ titulo: String(v.titulo || ''), neto: num(v.neto), tipo: String(v.tipo || '') }));

    desalineados.push({ fecha: d, manual: man, api, dif: api - man, devueltas, estimados, paquetes });
  }

  if (!desalineados.length) return null;

  // Plata en riesgo: el neto de las filas del manual que quedaron CONFIRMADAS
  // como devueltas (ver devueltasDelDia). No se usa la diferencia del día:
  // un mismo día puede mezclar una devolución con un paquete estimado.
  const enRiesgo = desalineados
    .reduce((a, d) => a + d.devueltas.reduce((s, v) => s + v.neto_contado, 0), 0);
  // El resto de la diferencia es criterio de cálculo, no plata que se fue.
  const porEstimacion = desalineados
    .reduce((a, d) => a + Math.abs(d.dif + d.devueltas.reduce((s, v) => s + v.neto_contado, 0)), 0);

  return {
    id: cobro.id,
    nombre: cobro.nombre,
    periodo: cobro.periodo,
    cuenta: (cobro.cuenta && cobro.cuenta.id) || 'wz',
    cuenta_label: (cobro.cuenta && cobro.cuenta.label) || 'WZ — WZMALLAS',
    neto_manual: netoMan,
    neto_api: netoApi,
    dif: netoApi - netoMan,
    en_riesgo: enRiesgo,
    por_estimacion: porEstimacion,
    dias: desalineados,
  };
}

/**
 * Concilia todos los cobros cargados a mano.
 * @param {object} deps
 *   - cobros: lista completa de cobros guardados
 *   - pedirApi: ({desde, hasta, cuenta, fiscal}) => Promise<Array ventas>
 *   - desdeMin: 'YYYY-MM-DD' — no concilia períodos anteriores (ya liquidados
 *               hace rato y sin margen de acción); ahorra llamadas a ML.
 */
async function conciliarTodo({ cobros, pedirApi, desdeMin = null, log = () => {} }) {
  const manuales = (cobros || []).filter(c => c.modo === 'fundas' && !c.auto && (c.ventas || []).length);
  const hallazgos = [];
  let revisados = 0, fallados = 0;

  for (const c of manuales) {
    const m = String(c.periodo || '').match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const [, desde, hasta] = m;
    if (desdeMin && hasta < desdeMin) continue;

    let ventasApi;
    try {
      ventasApi = await pedirApi({
        desde, hasta,
        cuenta: (c.cuenta && c.cuenta.id) || 'wz',
        fiscal: (c.cuenta && c.cuenta.fiscal) || 'responsable',
      });
    } catch (e) {
      fallados++;
      log(`[conciliar] ${c.periodo}: ${e.message}`);
      continue;
    }
    revisados++;
    const h = conciliarCobro(c, ventasApi);
    if (h) hallazgos.push(h);
  }

  const tot = (f) => hallazgos.reduce((a, h) => a + f(h), 0);
  return {
    corrido_en: new Date().toISOString(),
    revisados, fallados,
    periodos_con_diferencia: hallazgos.length,
    total_dif: tot(h => h.dif),
    total_en_riesgo: tot(h => h.en_riesgo),
    total_por_estimacion: tot(h => h.por_estimacion),
    hallazgos,
  };
}

/**
 * Descuenta del cobro las ventas que ML da por canceladas o devueltas.
 *
 * Regla del negocio: si está cancelada o devuelta, no es una venta. El Excel
 * de liquidación no se entera de las devoluciones posteriores al pago, así que
 * sin esto quedan contadas para siempre — y en los datos no hay ni un neto
 * negativo, o sea que ML tampoco las descuenta en un período siguiente.
 *
 * NO borra la fila: la marca `excluida` con una nota. Así queda la traza de por
 * qué el período bajó, y el cálculo la ignora igual (todo el resto del sistema
 * filtra por `excluida`).
 *
 * Es idempotente: una fila ya excluida no vuelve a aparecer como devuelta,
 * porque conciliarCobro() sólo mira las incluidas.
 *
 * @returns {{cobros: Array, aplicadas: Array}} cobros nuevos y qué se descontó
 */
function aplicarDevoluciones(cobros, hallazgos) {
  const porId = new Map();
  (hallazgos || []).forEach(h => {
    (h.dias || []).forEach(d => (d.devueltas || []).forEach(v => {
      if (v.id) porId.set(`${h.id}|${v.id}`, { ...v, cobro: h.id, cuenta_label: h.cuenta_label, periodo: h.periodo });
    }));
  });
  if (!porId.size) return { cobros, aplicadas: [] };

  const aplicadas = [];
  const salida = (cobros || []).map(c => {
    const mias = [...porId.values()].filter(x => x.cobro === c.id);
    if (!mias.length) return c;

    const ids = new Set(mias.map(x => String(x.id)));
    let tocado = false;
    const ventas = (c.ventas || []).map(v => {
      if (v.excluida || !ids.has(String(v.id))) return v;
      tocado = true;
      const info = mias.find(x => String(x.id) === String(v.id));
      aplicadas.push({
        cobro: c.id, periodo: c.periodo, cuenta_label: info.cuenta_label,
        id: String(v.id), fecha: info.fecha, titulo: String(v.titulo || ''),
        neto: num(v.neto), ingresos: num(v.ingresos),
        items: info.items || [], aplicado_en: new Date().toISOString(),
      });
      return { ...v, excluida: true, devuelta: true,
               notas: 'Descontada: MercadoLibre la reporta cancelada/devuelta' };
    });
    if (!tocado) return c;

    // Resumen recalculado desde el array, no ajustado a mano: si alguna vez
    // el resumen y las ventas se separan, gana el array.
    const incl = ventas.filter(v => !v.excluida);
    const mixtos = incl.filter(v => v.mixto);
    return { ...c, ventas, resumen: { ...(c.resumen || {}),
      incluidas: incl.length,
      excluidas: ventas.length - incl.length,
      mixtos: mixtos.length,
      total_neto: Math.round(incl.reduce((a, v) => a + num(v.neto), 0) * 100) / 100,
      mixtos_det: mixtos.map(v => ({ titulo: String(v.titulo || '').slice(0, 60), neto: num(v.neto) })),
    } };
  });

  return { cobros: salida, aplicadas };
}

module.exports = { conciliarTodo, conciliarCobro, netoPorDia, devueltasDelDia, aplicarDevoluciones };

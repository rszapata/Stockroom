// ── Refresco automático de cobros (rentabilidad al día) ────────────────
//
// Problema que resuelve: la rentabilidad de fundas se alimenta de las
// liquidaciones que alguien carga a mano en Cobros, una cuenta por vez y con
// el rango que se le ocurra. En la práctica eso dejaba el tablero así:
//
//   WZ — WZMALLAS   cerrada al 31/08
//   RZ - ZETTAI     cerrada al 25/08   ← seis días menos
//   septiembre      sin cargar en ninguna de las dos
//
// Con las ventanas desalineadas el total suma tramos distintos (la propia
// pantalla ya lo advertía) y con septiembre sin cargar directamente falta
// plata. Además había períodos superpuestos en ZETTAI (08/08–25/08 pisaba
// 09/07–09/08), que se contaban dos veces.
//
// Cómo lo resuelve: cada 24 h, por cada cuenta, genera UN cobro que arranca el
// día siguiente al último período cargado A MANO y termina hoy. Reglas:
//
//   · Lo cargado a mano siempre gana. El Excel oficial de ML es más
//     confiable que una reconstrucción por API, así que el tramo automático
//     empieza donde termina el manual y nunca lo pisa.
//   · Un registro automático por cuenta y por mes. Cada corrida reemplaza a
//     TODOS los anteriores de esa cuenta, así no se acumulan duplicados como
//     pasaría llamando a /cobro/guardar, que siempre inserta.
//   · Por eso mismo tampoco puede haber solapamiento: los tramos automáticos
//     se recalculan enteros en cada corrida.
//   · Los tramos se cortan en el cambio de mes (ver tramosPorMes). La pantalla
//     de rentabilidad se mira por mes y un tramo a caballo entre dos aparecía
//     como "parcial" en los dos.
//
// El cálculo NO se reimplementa acá: se reutiliza /cobro/ml por loopback,
// exactamente el mismo endpoint que usa el botón "Traer de MercadoLibre".
// Es código que calcula plata; duplicarlo sería pedir que las dos versiones
// se desincronicen.

const AR = 'America/Argentina/Buenos_Aires';

/* Fecha de hoy en horario argentino, como YYYY-MM-DD.
   Se arma leyendo las PARTES, no el string formateado: el Node de producción
   viene con ICU reducido y ahí `en-CA` no da "2026-09-09" sino "09/09/2026",
   que /cobro/ml rechaza. Los tipos de parte no dependen del locale, y la
   conversión de huso funciona igual porque los datos de zona horaria van
   aparte del ICU. Mismo criterio que ymdAR() en server.js. */
function hoyAR(ahora = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: AR, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function sumarDias(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');   // mediodía: inmune a saltos de huso
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Último día del mes de una fecha YYYY-MM-DD. */
function finDeMes(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * Parte un rango en tramos que nunca cruzan un cambio de mes.
 *
 *   tramosPorMes('2026-08-26', '2026-09-09')
 *     → [{ desde: '2026-08-26', hasta: '2026-08-31' },
 *        { desde: '2026-09-01', hasta: '2026-09-09' }]
 *
 * Existe por la pantalla de rentabilidad, que se mira por mes: un tramo
 * 26/08→09/09 aparecía como "parcial" tanto en agosto como en septiembre,
 * porque ninguno de los dos meses lo contiene entero. El total siempre estuvo
 * bien (se recorta por fecha de venta), pero el desglose de períodos no se
 * podía auditar contra el total. Cortando por mes, cada período cae completo
 * dentro de un mes y "parcial" vuelve a significar algo.
 */
function tramosPorMes(desde, hasta) {
  const tramos = [];
  let ini = desde;
  while (ini <= hasta) {
    const fin = finDeMes(ini);
    tramos.push({ desde: ini, hasta: fin < hasta ? fin : hasta });
    ini = sumarDias(fin, 1);
  }
  return tramos;
}

/** Última fecha cubierta por un período con formato "YYYY-MM-DD al YYYY-MM-DD". */
function hastaDe(periodo) {
  const m = String(periodo || '').match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/);
  return m ? m[2] : null;
}

/**
 * Desde cuándo tiene que arrancar el tramo automático de una cuenta:
 * el día siguiente al último período cargado a mano. Si nunca se cargó nada,
 * arranca el 1 del mes en curso (no tiene sentido reconstruir toda la historia).
 */
function desdeParaCuenta(cobros, cuentaId, hoy) {
  const manuales = cobros.filter(c =>
    c.modo === 'fundas' && !c.auto && c.cuenta && String(c.cuenta.id) === String(cuentaId));
  const hastas = manuales.map(c => hastaDe(c.periodo)).filter(Boolean).sort();
  if (!hastas.length) return hoy.slice(0, 8) + '01';
  return sumarDias(hastas[hastas.length - 1], 1);
}

/**
 * Corre el refresco para todas las cuentas.
 * @param {object} deps
 *   - cuentas: [{ id, label, fiscal }]
 *   - leerCobros / escribirCobros: acceso al almacén de cobros guardados
 *   - fetchInterno: (path, opts) => Response  (loopback autenticado)
 */
async function refrescarCobros({ cuentas, leerCobros, escribirCobros, fetchInterno, log = () => {} }) {
  const hoy = hoyAR();
  const resultados = [];
  log(`[cobros-auto] arranca · hoy=${hoy} · cuentas: ${cuentas.map(c => c.label).join(", ")}`);

  for (const cu of cuentas) {
    const lista = leerCobros();
    const desde = desdeParaCuenta(lista, cu.id, hoy);

    if (desde > hoy) {
      // Lo cargado a mano ya cubre hasta hoy: no hay tramo que agregar.
      log(`[cobros-auto] ${cu.label}: ya está al día (lo manual cubre hasta hoy)`);
      resultados.push({ cuenta: cu.label, estado: 'al-dia', desde, hasta: hoy });
      continue;
    }

    // Un cobro por mes, no uno solo: ver tramosPorMes().
    const tramos = tramosPorMes(desde, hoy);
    const nuevos = [];
    let falló = null;

    for (const t of tramos) {
      let data;
      try {
        const r = await fetchInterno('/cobro/ml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            desde: t.desde, hasta: t.hasta, modo: 'fundas',
            sin_iva: cu.fiscal === 'monotributo' ? '1' : '',
            cuenta: String(cu.id),
          }),
        });
        data = await r.json();
        if (!data || !data.ok) throw new Error(data && (data.detail || data.error) || 'respuesta inválida');
      } catch (e) {
        // Si un tramo falla no se escribe nada de esta cuenta: dejar la mitad
        // de los meses actualizados y la otra mitad viejos sería peor que no
        // tocar nada, porque el hueco no se ve.
        falló = e.message;
        break;
      }

      const ventas = Array.isArray(data.ventas) ? data.ventas : [];
      // Un tramo sin ventas no genera registro: sólo ensuciaría la lista de períodos.
      if (!ventas.length) continue;

      nuevos.push({
        id: `cb_auto_${String(cu.id).replace(/\W/g, '')}_${t.desde.slice(0, 7).replace('-', '')}`,
        nombre: `Automático · ${t.desde} al ${t.hasta}`,
        modo: 'fundas',
        periodo: `${t.desde} al ${t.hasta}`,
        auto: true,
        cuenta: { id: String(cu.id), label: cu.label, fiscal: cu.fiscal === 'monotributo' ? 'monotributo' : 'responsable' },
        resumen: data.resumen || {},
        ventas,
        file_b64: data.b64 || data.file_b64 || '',
        guardado_en: new Date().toISOString(),
      });
    }

    if (falló) {
      log(`[cobros-auto] ${cu.label}: ${falló}`);
      resultados.push({ cuenta: cu.label, estado: 'error', error: falló });
      continue;
    }

    // Reemplaza TODOS los automáticos anteriores de ESTA cuenta (antes había uno
    // solo, ahora uno por mes). Nunca toca los manuales.
    const sinAutoPrevio = lista.filter(c =>
      !(c.auto && c.modo === 'fundas' && c.cuenta && String(c.cuenta.id) === String(cu.id)));

    if (!nuevos.length) {
      escribirCobros(sinAutoPrevio);
      log(`[cobros-auto] ${cu.label}: sin ventas entre ${desde} y ${hoy}`);
      resultados.push({ cuenta: cu.label, estado: 'sin-ventas', desde, hasta: hoy });
      continue;
    }

    escribirCobros([...nuevos, ...sinAutoPrevio]);

    const netoDe = c => (c.resumen && (c.resumen.neto ?? c.resumen.total_neto)) || 0;
    const neto = nuevos.reduce((a, c) => a + netoDe(c), 0);
    const ventas = nuevos.reduce((a, c) => a + c.ventas.length, 0);
    log(`[cobros-auto] ${cu.label}: ${desde} → ${hoy} · ${ventas} ventas · neto ${Math.round(neto)}`
        + ` · ${nuevos.length} tramo(s): ${nuevos.map(c => c.periodo).join(' | ')}`);
    resultados.push({ cuenta: cu.label, estado: 'ok', desde, hasta: hoy, ventas, neto,
                      tramos: nuevos.map(c => c.periodo) });
  }

  return { ok: true, corrido_en: new Date().toISOString(), hoy, resultados };
}

module.exports = { refrescarCobros, hoyAR, sumarDias, hastaDe, desdeParaCuenta, tramosPorMes, finDeMes };

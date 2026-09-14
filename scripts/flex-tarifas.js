#!/usr/bin/env node
/* Genera la tabla de costos del reparto propio (Flex) a partir de los
 * resúmenes de la logística que se cargan en verificar-envios.html.
 *
 * Cada resumen trae una fila por entrega con el domicilio (que incluye el CP)
 * y el valor que efectivamente cobró la logística. De ahí sale el costo real
 * por código postal, que es la única fuente honesta: la zona no sigue rangos
 * numéricos limpios —1605 cuesta $6.490 y 1608 cuesta $8.690— así que no se
 * puede clasificar por tramos, hay que mirar CP por CP.
 *
 * Uso:
 *   node scripts/flex-tarifas.js            # escribe tienda/components/flex-tarifas.js
 *   node scripts/flex-tarifas.js --dry      # sólo muestra el resumen
 *
 * Correlo de nuevo cada vez que cargues resúmenes nuevos y volvé a deployar.
 * Acordate de subir el ?v= de flex-tarifas.js en producto.html y checkout.html.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR_RESUMENES = path.join(__dirname, '..', 'pdf-resumenes');
// Clasificador de zonas que se edita desde el panel (/flex-zones).
const ZONAS_PATH = path.join(__dirname, '..', 'flex_zones.json');
const SALIDA = path.join(__dirname, '..', '..', 'tienda', 'components', 'flex-tarifas.js');
const DRY = process.argv.includes('--dry');

// Sólo se mira la ventana reciente: hubo subas de tarifa y lo de hace medio
// año ya no es lo que se paga hoy.
const DIAS_VIGENCIA = 75;

function cpDe(dom) {
  const m = String(dom || '').match(/(?:^|,)\s*[A-Z]?(\d{4})\s*(?:,|$)/);
  return m ? +m[1] : null;
}
function aFecha(f) {
  const m = String(f || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

const filas = [];
let archivos = 0;
for (const nombre of fs.readdirSync(DIR_RESUMENES)) {
  if (!nombre.endsWith('.json') || nombre.startsWith('index') || nombre.includes('.bak-')) continue;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(DIR_RESUMENES, nombre), 'utf8')); }
  catch (e) { continue; }
  archivos++;
  for (const r of (d.rows || [])) {
    const cp = cpDe(r.domicilio), f = aFecha(r.fecha);
    if (cp && f && r.valor > 0) filas.push({ cp, valor: r.valor, fecha: f });
  }
}
if (!filas.length) { console.error('No se encontró ninguna entrega en ' + DIR_RESUMENES); process.exit(1); }

filas.sort((a, b) => a.fecha - b.fecha);
const ultima = filas[filas.length - 1].fecha;
const corte = new Date(ultima.getTime() - DIAS_VIGENCIA * 86400000);
const recientes = filas.filter(f => f.fecha >= corte);

/* Por CP, el costo de la entrega más reciente. Si el mismo CP aparece con dos
   valores el mismo día (pasa: paquetes distintos, tarifas distintas), se toma
   el mayor — cobrar de menos lo paga WZMALLAS. */
const porCp = new Map();
for (const f of recientes) {
  const previo = porCp.get(f.cp);
  if (!previo || f.fecha > previo.fecha || (+f.fecha === +previo.fecha && f.valor > previo.valor)) {
    porCp.set(f.cp, { valor: f.valor, fecha: f.fecha });
  }
}

/* Las tarifas suben. Un CP al que no se despachó en las últimas semanas
   conserva el precio viejo, y publicarlo significa cobrar de menos hasta la
   próxima entrega. Se toman como vigentes los valores que aparecen en la
   ventana más reciente y, si el último costo conocido de un CP ya no está en
   esa lista, se lo lleva al tramo vigente inmediato superior — nunca al
   inferior: cobrar de menos lo paga WZMALLAS. */
const DIAS_TARIFA_VIGENTE = 45;
const corteTarifa = new Date(ultima.getTime() - DIAS_TARIFA_VIGENTE * 86400000);
const vigentes = [...new Set(filas.filter(f => f.fecha >= corteTarifa).map(f => f.valor))].sort((a, b) => a - b);

const tabla = {};
const ajustados = [];
for (const [cp, v] of [...porCp.entries()].sort((a, b) => a[0] - b[0])) {
  let valor = v.valor;
  if (!vigentes.includes(valor)) {
    const arriba = vigentes.find(x => x >= valor);
    const nuevo = arriba != null ? arriba : vigentes[vigentes.length - 1];
    ajustados.push(`${cp}: $${valor}→$${nuevo}`);
    valor = nuevo;
  }
  tabla[cp] = valor;
}

// Costo para los CP de CABA que todavía no aparecieron en ningún resumen:
// CABA es una sola zona y siempre cobró lo mismo.
const cabaVals = Object.entries(tabla).filter(([cp]) => +cp >= 1000 && +cp <= 1499).map(([, v]) => v);
const cabaDefault = cabaVals.length
  ? cabaVals.sort((a, b) => a - b)[Math.floor(cabaVals.length / 2)]   // mediana
  : null;

const tramos = {};
for (const v of Object.values(tabla)) tramos[v] = (tramos[v] || 0) + 1;

/* Zona declarada a mano → tramo vigente. Los nombres son los que usa
   flex_zones.json; el precio sale de los tramos que realmente se están
   cobrando ahora, no del FLEX_TARIFFS de routes/flex.js, que quedó en $8.490
   para gba_lejos y no contempla la suba. */
const TRAMO_POR_ZONA = { caba: 4490, gba_cerca: 6490, gba_lejos: 8690 };
let zonasCp = {};
try {
  const crudo = JSON.parse(fs.readFileSync(ZONAS_PATH, 'utf8'));
  for (const [cp, zona] of Object.entries(crudo)) {
    const n = parseInt(cp, 10);
    if (Number.isFinite(n) && TRAMO_POR_ZONA[zona]) zonasCp[n] = TRAMO_POR_ZONA[zona];
  }
} catch (e) { console.log('(sin flex_zones.json: ' + e.message + ')'); }

// Tramo más caro visto en GBA — el respaldo cuando no hay ningún CP cerca.
const valoresGba = Object.entries(tabla)
  .filter(([cp]) => +cp >= 1600 && +cp <= 1900)
  .map(([, v]) => v);
const topeGba = valoresGba.length ? Math.max(...valoresGba) : 9990;

console.log(`${archivos} resúmenes · ${filas.length} entregas · ${recientes.length} en los últimos ${DIAS_VIGENCIA} días`);
console.log(`ventana: ${corte.toLocaleDateString('es-AR')} → ${ultima.toLocaleDateString('es-AR')}`);
console.log(`CPs con costo vigente: ${Object.keys(tabla).length}`);
console.log('tramos vigentes: ' + vigentes.map(v => '$' + v).join(' '));
console.log('tabla: ' + Object.entries(tramos).sort((a, b) => a[0] - b[0]).map(([v, n]) => `$${v}×${n}`).join('  '));
console.log(`CABA por defecto: $${cabaDefault} · tope GBA (sin dato cerca): $${topeGba}`);

/* Cuánto de la zona queda con precio estimado en vez de medido: es la
   exposición real de esta tabla y conviene mirarla en cada regeneración. */
let exactos = 0, porZonaN = 0, estimados = 0;
for (let n = 1600; n <= 1900; n++) {
  if (tabla[n] != null) exactos++;
  else if (zonasCp[n] != null) porZonaN++;
  else estimados++;
}
console.log(`GBA 1600-1900: ${exactos} medidos · ${porZonaN} por zona declarada · ${estimados} estimados por cercanía`);
if (ajustados.length) {
  console.log(`\n${ajustados.length} CP(s) con tarifa retirada, llevados al tramo vigente:`);
  console.log('  ' + ajustados.join('  '));
}

/* Sólo se emiten las zonas de los CP que NO tienen costo medido: donde hay
   una entrega real, ese número gana sobre la clasificación. */
const zonasSoloFaltantes = {};
for (const [cp, v] of Object.entries(zonasCp)) if (tabla[cp] == null) zonasSoloFaltantes[cp] = v;
console.log(`zonas declaradas usadas: ${Object.keys(zonasSoloFaltantes).length} de ${Object.keys(zonasCp).length} (el resto ya tiene costo medido)`);

if (DRY) process.exit(0);

const contenido = `/* Costo del reparto propio (Flex) por código postal.
 *
 * GENERADO — no editar a mano.
 *   node Stockroom/scripts/flex-tarifas.js
 *
 * Sale de los resúmenes reales de la logística (${archivos} resúmenes,
 * ${recientes.length} entregas entre el ${corte.toLocaleDateString('es-AR')} y el ${ultima.toLocaleDateString('es-AR')}).
 * Es lo que la logística COBRA, no un precio de lista.
 *
 * La zona no sigue rangos numéricos: 1605 cuesta $${tabla[1605] || '6.490'} y 1608 cuesta
 * $${tabla[1608] || '8.690'}. Por eso es una tabla CP por CP y no un clasificador por tramos.
 */
window.WZ_FLEX_TARIFAS = ${JSON.stringify(tabla)};

/* CABA es una sola zona y siempre cobró lo mismo, así que cualquier CP de CABA
   que todavía no apareció en ningún resumen usa este valor. */
window.WZ_FLEX_CABA_DEFAULT = ${cabaDefault};

/* Zona de reparto: CABA y GBA. La tabla de arriba tiene el precio de los CP a
   los que ya se despachó, pero eso es apenas una parte de la zona — no tener
   historial de un CP no significa que no se llegue. */
window.WZ_FLEX_ZONA = { cabaDesde: 1000, cabaHasta: 1499, gbaDesde: 1600, gbaHasta: 1900 };

/* Tramo más caro visto en GBA: es el que se usa cuando no hay ningún CP
   conocido cerca. */
window.WZ_FLEX_GBA_TOPE = ${topeGba};

/* Zonas declaradas a mano en el panel (/flex-zones), ya convertidas al tramo
   vigente. Se usan para los CP que todavía no tienen una entrega medida. */
window.WZ_FLEX_ZONAS_CP = ${JSON.stringify(zonasSoloFaltantes)};

/* Costo del reparto propio para un CP, o null si queda fuera de la zona.
   Si el CP no tiene dato propio se estima con los conocidos más cercanos
   (hasta 25 números para arriba y para abajo) y se toma el MAYOR de los dos:
   ante la duda se cobra el tramo caro, porque cobrar de menos lo pone
   WZMALLAS en cada envío. */
window.wzFlexCosto = function (cp) {
  const n = parseInt(String(cp == null ? '' : cp).replace(/\\D/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  const T = window.WZ_FLEX_TARIFAS, Z = window.WZ_FLEX_ZONA;
  if (T[n]) return T[n];                                  // 1· costo medido
  const porZona = window.WZ_FLEX_ZONAS_CP[n];
  if (porZona) return porZona;                            // 2· zona declarada
  if (n >= Z.cabaDesde && n <= Z.cabaHasta) return window.WZ_FLEX_CABA_DEFAULT;
  if (n < Z.gbaDesde || n > Z.gbaHasta) return null;

  const VENTANA = 25;
  let abajo = null, arriba = null;
  for (let d = 1; d <= VENTANA; d++) {
    if (abajo  == null && T[n - d] != null) abajo  = T[n - d];
    if (arriba == null && T[n + d] != null) arriba = T[n + d];
    if (abajo != null && arriba != null) break;
  }
  if (abajo != null && arriba != null) return Math.max(abajo, arriba);
  if (abajo != null)  return abajo;
  if (arriba != null) return arriba;
  return window.WZ_FLEX_GBA_TOPE;
};

/* true si el precio salió de una entrega real y no de una estimación. Sirve
   para auditar, no para mostrar. */
window.wzFlexCostoExacto = function (cp) {
  const n = parseInt(String(cp == null ? '' : cp).replace(/\\D/g, ''), 10);
  return Number.isFinite(n) && window.WZ_FLEX_TARIFAS[n] != null;
};
`;

fs.writeFileSync(SALIDA, contenido);
console.log('\n✓ escrito ' + SALIDA + ' (' + contenido.length + ' bytes)');
console.log('  Acordate de subir el ?v= de flex-tarifas.js en producto.html y checkout.html.');

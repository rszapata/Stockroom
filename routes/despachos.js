'use strict';
const https = require('https');
const fs   = require('fs');
const path = require('path');
const { json } = require('../lib/http');

const ML_BASE = 'api.mercadolibre.com';

// ── Costo esperado de logística por CP ──────────────────────────
// Tabla empírica CP -> costos válidos, derivada de los resúmenes ya
// validados (cp-tarifas.json, regenerable). Permite que el verificador
// detecte sobrecobros del proveedor, no solo que el envío exista.
// Es más exacta que una regla por rangos: dentro de GBA las tarifas
// cercano/lejano no siguen un rango numérico limpio (se solapan).
let _tarifasCache = null, _tarifasMtime = 0;
function loadCpTarifas() {
  try {
    const p = path.join(__dirname, '..', 'cp-tarifas.json');
    const m = fs.statSync(p).mtimeMs;
    if (!_tarifasCache || m !== _tarifasMtime) {
      _tarifasCache = JSON.parse(fs.readFileSync(p, 'utf8'));
      _tarifasMtime = m;
    }
  } catch (e) { _tarifasCache = _tarifasCache || { caba_default: 4490, tarifas: {} }; }
  return _tarifasCache;
}
// Devuelve { known, valid_costs:[...], expected } para un CP.
function expectedCostForCp(cp) {
  const t = loadCpTarifas();
  const clean = String(cp || '').trim().replace(/^C/i, '');
  if (t.tarifas && t.tarifas[clean]) {
    const costs = t.tarifas[clean];
    return { known: true, valid_costs: costs, expected: costs[0] };
  }
  // CP CABA no visto en los validados → tarifa CABA por defecto
  const n = parseInt(clean, 10);
  if (Number.isFinite(n) && n >= 1000 && n <= 1499) {
    return { known: true, valid_costs: [t.caba_default], expected: t.caba_default };
  }
  return { known: false, valid_costs: [], expected: null };
}

module.exports = function(ctx) {
  const { mlGetAuth, fullConfig, refreshAccountToken } = ctx;

  function fetchMLLabelsAuth(acct, shipmentIds, responseType) {
    return new Promise((resolve, reject) => {
      const ids       = shipmentIds.join(',');
      const labelsPath = `/shipment_labels?shipment_ids=${ids}&response_type=${responseType || 'pdf'}`;
      const opts = {
        hostname: ML_BASE, path: labelsPath, method: 'GET',
        headers: { 'Authorization': `Bearer ${acct.access_token}`, 'User-Agent': 'Stockroom/1.0' },
      };
      const req = https.request(opts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200)
            return reject(new Error(`ML labels HTTP ${res.statusCode}: ${buf.toString().slice(0, 400)}`));
          resolve(buf);
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  /* Recorre con un tope de tareas en paralelo. Sin esto, 21 envíos disparan
     42 pedidos simultáneos y ML empieza a demorar los últimos. */
  async function mapLimit(lista, limite, fn) {
    const salida = new Array(lista.length);
    let siguiente = 0;
    const obreros = Array.from({ length: Math.min(limite, lista.length) }, async () => {
      for (;;) {
        const i = siguiente++;
        if (i >= lista.length) return;
        salida[i] = await fn(lista[i], i);
      }
    });
    await Promise.all(obreros);
    return salida;
  }

  /* Reintenta lo que vale la pena reintentar: throttling (429), errores del
     lado de ML (5xx) y cortes de red. Un 401/404 no se reintenta. */
  async function conReintento(fn, intentos = 3) {
    let ultimo;
    for (let n = 0; n < intentos; n++) {
      try { return await fn(); }
      catch (e) {
        ultimo = e;
        const vaDeNuevo = !e.status || e.status === 429 || e.status >= 500;
        if (!vaDeNuevo || n === intentos - 1) break;
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, n)));
      }
    }
    throw ultimo;
  }

  /* ML publica la misma foto en varios tamaños según el sufijo: -O es la
     original (~88 KB) y -I es de 90px (~6 KB). La lista las muestra a 44px,
     así que mandar la original es tirar ~15x de ancho de banda por ítem. */
  const miniatura = url => String(url || '')
    .replace(/([-_])[A-Z]\.(webp|jpe?g|png)(\?.*)?$/i, (m, sep, ext, qs) => `${sep}I.webp${qs || ''}`);

  /* Recorre TODAS las páginas del resultado. Antes se pedía limit=50 y no se
     miraba paging.total: con 51 ventas listas, la 51 no aparecía y no había
     forma de notarlo. El tope es un cinturón — si se llega, se avisa
     (truncated) en vez de recortar en silencio. */
  const TOPE_ORDENES = 300;
  async function buscarOrdenes(acct, filtro) {
    const porPagina = 50;
    const lista = [];
    let offset = 0, total = 0;
    for (;;) {
      const p = `/orders/search?seller=${acct.user_id}&${filtro}` +
                `&sort=date_desc&limit=${porPagina}&offset=${offset}`;
      const data = await conReintento(() => mlGetAuth(acct, p));
      const lote = data.results || [];
      lista.push(...lote);
      total = (data.paging && typeof data.paging.total === 'number') ? data.paging.total : lista.length;
      offset += porPagina;
      if (!lote.length || lista.length >= total || offset >= TOPE_ORDENES) break;
    }
    return { lista, total, truncado: lista.length < total };
  }

  async function getDespachosPendientes(acct) {
    const _t0 = Date.now();
    const tokenOk = await refreshAccountToken(acct).catch(() => false);

    const DISPATCHED = new Set(['picked_up','dropped_off','in_hub','in_packing_list',
      'shipped','delivered','not_delivered','cancelled','returning_to_sender','returned','forwarded_to_third']);

    // Fuente principal: lo que ML considera listo para despachar.
    const base = await buscarOrdenes(acct, 'shipping.status=ready_to_ship&order.status=paid');
    const rawOrders = base.lista.slice();
    const yaEstan = new Set(rawOrders.map(o => String(o.id)));

    /* Segunda fuente, independiente de la primera. El índice de búsqueda de ML
       se atrasa: una venta puede tener el envío en ready_to_ship y todavía no
       salir en la consulta filtrada por ese estado. Se piden las pagadas más
       recientes SIN filtro de envío y se agrega lo que falte.
       No alcanza con avisar: un envío que no se ve termina en un envío no
       hecho, así que la orden se suma a la lista y se marca. Más abajo pasa
       por el mismo control de estado real que las demás, o sea que si en
       realidad ya se despachó, se filtra igual.
       Una sola página: el atraso del índice se mide en minutos y las 50 ventas
       más recientes cubren esa ventana de sobra. */
    let recuperadas = 0, cruceOk = false;
    try {
      const rec = await conReintento(() => mlGetAuth(acct,
        `/orders/search?seller=${acct.user_id}&order.status=paid&sort=date_desc&limit=50`));
      cruceOk = true;
      for (const o of (rec.results || [])) {
        const est = o.shipping && o.shipping.status;
        const sub = o.shipping && o.shipping.substatus;
        if (est !== 'ready_to_ship') continue;
        if (sub && DISPATCHED.has(sub)) continue;
        if (yaEstan.has(String(o.id))) continue;
        yaEstan.add(String(o.id));
        o._recuperada = true;
        rawOrders.push(o);
        recuperadas++;
      }
    } catch (e) {
      console.warn(`[despachos-hoy] cruce falló en ${acct.label || acct.id}: ${e.message}`);
    }

    /* Un pack son varias órdenes con el MISMO shipping id: antes se pedía el
       envío una vez por orden, duplicando llamadas sin necesidad. */
    const shipmentStatus = {};
    /* Envíos que no se pudieron consultar. Antes esto era un catch vacío y el
       precio de fallar era alto: sin logistic_type la orden cae en el "todo lo
       que no es Flex es Agencia", así que un Flex real se mostraba como
       AGENCIA, no entraba en el PDF de etiquetas y el paquete no salía. Ahora
       se reintenta y, si igual falla, la orden queda marcada. */
    const sinEstado = [];
    const sidsUnicos = [...new Set(rawOrders.map(o => o.shipping?.id).filter(Boolean))];
    await mapLimit(sidsUnicos, 6, async sid => {
      try {
        // /sla → expected_date = fecha límite de despacho REAL de ML (contempla
        // corte horario, días hábiles y feriados). Igual criterio que el dashboard.
        const [sh, sla] = await Promise.all([
          conReintento(() => mlGetAuth(acct, '/shipments/' + sid)),
          mlGetAuth(acct, '/shipments/' + sid + '/sla').catch(() => null),
        ]);
        shipmentStatus[sid] = {
          status: sh.status, substatus: sh.substatus, logistic_type: sh.logistic_type,
          dispatch: sla?.expected_date || sh.lead_time?.estimated_handling_limit?.date || null,
        };
      } catch(e) { sinEstado.push(String(sid)); }
    });

    const validOrders = rawOrders.filter(o => {
      const sid = o.shipping?.id;
      const sh  = sid ? shipmentStatus[sid] : null;
      const status    = sh?.status    ?? o.shipping?.status;
      const substatus = sh?.substatus ?? o.shipping?.substatus;
      if (status !== 'ready_to_ship') return false;
      if (substatus && DISPATCHED.has(substatus)) return false;
      return true;
    });

    const itemIds = new Set();
    for (const o of validOrders) for (const i of (o.order_items || [])) if (i.item?.id) itemIds.add(i.item.id);
    /* Solo los campos que se usan para la miniatura: el item completo son
       ~17 KB cada uno (320 KB por cuenta) y de eso se lee la foto nomás. */
    const itemCache = {};
    await mapLimit([...itemIds], 6, async id => {
      try {
        itemCache[id] = await mlGetAuth(acct,
          '/items/' + id + '?attributes=id,thumbnail,pictures,variations');
      } catch(e) {}
    });

    const _arToday = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const _arDate = iso => { if (!iso) return null; const t = new Date(iso).getTime(); return isNaN(t) ? null : new Date(t - 3 * 3600000).toISOString().slice(0, 10); };

    const orders = validOrders.map(o => {
      const sid = o.shipping?.id;
      const sh  = sid ? shipmentStatus[sid] : null;
      const logisticType = sh?.logistic_type || null;
      const isFlex = logisticType === 'self_service';
      // Full: ML tiene el stock en su depósito y despacha directo — el
      // vendedor no empaqueta ni lleva nada a una agencia. Antes cualquier
      // pedido no-Flex se etiquetaba "Agencia" por descarte (getDispatchType
      // en despachos.html siempre devolvía 'agencia'), así que un Full real
      // aparecía como si hubiera que despacharlo a mano.
      const isFull = logisticType === 'fulfillment';
      const handling_date = _arDate(sh?.dispatch);           // 'YYYY-MM-DD' AR o null
      /* Sin fecha de despacho confirmada NO se programa a futuro: programado
         es lo único que sale deseleccionado, y deseleccionar por no haber
         podido leer el dato es justamente cómo se pierde un envío. */
      const scheduled = !!(handling_date && handling_date > _arToday); // se despacha a futuro
      return {
        id: o.id,
        handling_date, scheduled,
        // No se pudo confirmar el envío contra ML: el tipo (Flex/Agencia/Full)
        // que se muestra es el del listado, que puede no ser el real.
        estado_incierto: !sh,
        // Apareció en el cruce y no en la consulta principal (atraso del índice).
        recuperada: !!o._recuperada,
        // pack_id: ML parte una compra de varios productos en varias órdenes que
        // comparten este id (y el mismo shipping_id). El front las agrupa en una
        // sola venta. Null/ausente → compra de un solo ítem.
        pack_id: o.pack_id || null,
        date_created: o.date_created,
        buyer: o.buyer?.nickname || o.buyer?.id || '—',
        shipping_id: sid || null,
        shipping_status: sh?.status ?? o.shipping?.status ?? null,
        shipping_substatus: sh?.substatus ?? o.shipping?.substatus ?? null,
        logistic_type: logisticType, is_flex: isFlex, is_full: isFull,
        items: (o.order_items || []).map(i => {
          const itemId = i.item?.id, varId = i.item?.variation_id;
          let picture = null;
          if (itemId && itemCache[itemId]) {
            const full = itemCache[itemId];
            const pics = full.pictures || [];
            if (varId && full.variations) {
              const variation = full.variations.find(v => v.id === varId);
              if (variation?.picture_ids?.length) {
                const pic = pics.find(p => p.id === variation.picture_ids[0]);
                if (pic) picture = pic.secure_url || pic.url;
              }
            }
            if (!picture && pics.length) picture = pics[0].secure_url || pics[0].url;
            if (!picture) picture = full.thumbnail;
          }
          return { title: i.item?.title || '—', quantity: i.quantity,
            variation_attributes: i.item?.variation_attributes || [],
            // picture = la chica que se pinta en la fila; picture_full = la que
            // abre el visor al hacer clic.
            picture: picture ? miniatura(picture) : null,
            picture_full: picture || null };
        }),
      };
    });
    console.log(`[despachos-hoy] ${acct.label || acct.id}: ${orders.length} órdenes · ` +
      `${sidsUnicos.length} envíos · ${itemIds.size} ítems · ${Date.now() - _t0}ms` +
      (base.truncado ? ` · ⚠ TRUNCADO (${base.total} en ML)` : '') +
      (recuperadas ? ` · ${recuperadas} recuperada(s) por cruce` : '') +
      (sinEstado.length ? ` · ⚠ ${sinEstado.length} envío(s) sin estado` : '') +
      (cruceOk ? '' : ' · ⚠ cruce no disponible'));
    return {
      orders,
      filtered: rawOrders.length - validOrders.length,
      // Todo lo que el front necesita para decidir si puede confiar en el número.
      token_ok: tokenOk,
      total_ml: base.total,
      truncated: base.truncado,
      degraded: sinEstado.length,
      recovered: recuperadas,
      cross_check: cruceOk,
    };
  }

  return function handleDespachos(req, res, pathname, parsed) {

    // GET /despachos-hoy-all
    if (pathname === '/despachos-hoy-all' && req.method === 'GET') {
      (async () => {
        try {
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          const results = await Promise.all(allAccounts.map(async acct => {
            const base = { accountId: acct.id, label: acct.label || acct.id };
            try {
              const r = await getDespachosPendientes(acct);
              return { ...base, ok: true, fetched_at: new Date().toISOString(), ...r };
            } catch(e) {
              /* orders:[] acá NO significa "no hay nada que despachar", significa
                 "no pude ver". El front tiene que poder distinguirlos: por eso
                 va ok:false y nunca pisa lo último confirmado de esta cuenta. */
              return { ...base, ok: false, error: e.message, orders: [], filtered: 0 };
            }
          }));

          const totalOrders = results.reduce((s, r) => s + r.orders.length, 0);
          const totalUnits  = results.reduce((s, r) => s + r.orders.reduce((a, o) => a + o.items.reduce((b, i) => b + (i.quantity||0), 0), 0), 0);
          json(res, 200, {
            ok: true, accounts: results, totalOrders, totalUnits,
            // Sello del servidor: el front mide la antigüedad contra esto y no
            // contra el reloj de la máquina, que puede estar corrido.
            generated_at: new Date().toISOString(),
            // true solo si TODAS las cuentas respondieron y ninguna quedó a medias.
            complete: results.every(r => r.ok && !r.truncated && r.cross_check !== false),
          });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    // GET /flex-pdf-all?responseType=pdf|zpl2&shipping_ids=id1,id2
    if (pathname === '/flex-pdf-all' && req.method === 'GET') {
      (async () => {
        try {
          const responseType = parsed.query.responseType || 'pdf';
          const filterIds    = parsed.query.shipping_ids
            ? new Set(parsed.query.shipping_ids.split(',').map(s => s.trim()).filter(Boolean))
            : null;
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          const results = await Promise.all(allAccounts.map(async acct => {
            try {
              await refreshAccountToken(acct);
              const { orders } = await getDespachosPendientes(acct);
              let flexShipIds = orders.filter(o => o.is_flex && o.shipping_id).map(o => String(o.shipping_id));
              if (filterIds) flexShipIds = flexShipIds.filter(id => filterIds.has(id));
              if (!flexShipIds.length) return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: 0, data_b64: null };
              const buf = await fetchMLLabelsAuth(acct, flexShipIds, responseType);
              return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: flexShipIds.length, data_b64: buf.toString('base64') };
            } catch(e) {
              return { accountId: acct.id, label: acct.label || acct.id, ok: false, count: 0, error: e.message, data_b64: null };
            }
          }));

          json(res, 200, { ok: true, responseType, total: results.reduce((s, r) => s + r.count, 0), accounts: results });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    // GET /etiquetas-all?responseType=zpl2&shipping_ids=id1,id2
    if (pathname === '/etiquetas-all' && req.method === 'GET') {
      (async () => {
        try {
          const responseType = parsed.query.responseType || 'zpl2';
          const filterIds    = parsed.query.shipping_ids
            ? new Set(parsed.query.shipping_ids.split(',').map(s => s.trim()).filter(Boolean))
            : null;
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          const results = await Promise.all(allAccounts.map(async acct => {
            try {
              await refreshAccountToken(acct);
              const { orders } = await getDespachosPendientes(acct);
              let allShipIds = orders.filter(o => o.shipping_id).map(o => String(o.shipping_id));
              if (filterIds) allShipIds = allShipIds.filter(id => filterIds.has(id));
              if (!allShipIds.length) return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: 0, data_b64: null };
              const buf = await fetchMLLabelsAuth(acct, allShipIds, responseType);
              return { accountId: acct.id, label: acct.label || acct.id, ok: true, count: allShipIds.length, data_b64: buf.toString('base64') };
            } catch(e) {
              return { accountId: acct.id, label: acct.label || acct.id, ok: false, count: 0, error: e.message, data_b64: null };
            }
          }));

          json(res, 200, { ok: true, responseType, total: results.reduce((s, r) => s + r.count, 0), accounts: results });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /verificar-envios
    if (pathname === '/verificar-envios' && req.method === 'POST') {
      (async () => {
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          const { shipping_ids } = JSON.parse(body);
          if (!Array.isArray(shipping_ids) || !shipping_ids.length) {
            json(res, 400, { error: 'Se requiere shipping_ids array' }); return;
          }
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          await Promise.all(allAccounts.map(a => refreshAccountToken(a)));

          const results = await Promise.all(shipping_ids.map(async rawId => {
            const numId = String(rawId).replace(/^ML/i, '').trim();
            if (!numId || !/^\d+$/.test(numId))
              return { raw: rawId, id: numId, found: false, reason: 'ID no numérico (envío particular)' };

            const attempts = await Promise.all(allAccounts.map(async acct => {
              try {
                const ship = await mlGetAuth(acct, `/shipments/${numId}`);
                if (ship && ship.id) return { acct, ship };
              } catch(e) {}
              return null;
            }));

            const found = attempts.find(a => a !== null);
            if (!found) return { raw: rawId, id: numId, found: false, reason: 'No encontrado en ninguna cuenta' };

            const { acct, ship } = found;
            const addr = ship.receiver_address || {};
            const zip  = addr.zip_code || '';
            const exp  = expectedCostForCp(zip);
            return {
              raw: rawId, id: numId, found: true,
              cuenta: acct.label || acct.id,
              seller_id: String(acct.user_id),
              sender_id: String(ship.sender_id || ''),
              ok_owner: String(ship.sender_id) === String(acct.user_id),
              order_id: ship.order_id ? String(ship.order_id) : null,
              status: ship.status || '',
              logistic_type: ship.logistic_type || ship.shipping_option?.name || '',
              address: `${addr.street_name || ''} ${addr.street_number || ''}`.trim(),
              city: addr.city?.name || addr.neighborhood?.name || '',
              zip,
              // Validación de costo (vs tabla empírica de los validados)
              cp_known: exp.known,
              expected_cost: exp.expected,
              valid_costs: exp.valid_costs,
            };
          }));

          const found      = results.filter(r => r.found);
          const notFound   = results.filter(r => !r.found);
          const wrongOwner = found.filter(r => !r.ok_owner);
          json(res, 200, { ok: true, total: shipping_ids.length, found: found.length, not_found: notFound.length, wrong_owner: wrongOwner.length, results });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    return false;
  };
};

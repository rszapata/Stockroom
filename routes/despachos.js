'use strict';
const https = require('https');
const { json } = require('../lib/http');

const ML_BASE = 'api.mercadolibre.com';

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

  async function getDespachosPendientes(acct) {
    try { await refreshAccountToken(acct); } catch(e) {}

    const DISPATCHED = new Set(['picked_up','dropped_off','in_hub','in_packing_list',
      'shipped','delivered','not_delivered','cancelled','returning_to_sender','returned','forwarded_to_third']);

    const mlPath = `/orders/search?seller=${acct.user_id}&shipping.status=ready_to_ship&order.status=paid&sort=date_desc&limit=50`;
    const data   = await mlGetAuth(acct, mlPath);
    const rawOrders = data.results || [];

    const shipmentStatus = {};
    await Promise.all(rawOrders.map(async o => {
      const sid = o.shipping?.id;
      if (!sid) return;
      try {
        const sh = await mlGetAuth(acct, '/shipments/' + sid);
        shipmentStatus[sid] = { status: sh.status, substatus: sh.substatus, logistic_type: sh.logistic_type };
      } catch(e) {}
    }));

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
    const itemCache = {};
    await Promise.all([...itemIds].map(async id => {
      try { itemCache[id] = await mlGetAuth(acct, '/items/' + id); } catch(e) {}
    }));

    const orders = validOrders.map(o => {
      const sid = o.shipping?.id;
      const sh  = sid ? shipmentStatus[sid] : null;
      const logisticType = sh?.logistic_type || null;
      const isFlex = logisticType === 'self_service';
      return {
        id: o.id,
        date_created: o.date_created,
        buyer: o.buyer?.nickname || o.buyer?.id || '—',
        shipping_id: sid || null,
        shipping_status: sh?.status ?? o.shipping?.status ?? null,
        shipping_substatus: sh?.substatus ?? o.shipping?.substatus ?? null,
        logistic_type: logisticType, is_flex: isFlex,
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
            variation_attributes: i.item?.variation_attributes || [], picture };
        }),
      };
    });
    return { orders, filtered: rawOrders.length - validOrders.length };
  }

  return function handleDespachos(req, res, pathname, parsed) {

    // GET /despachos-hoy-all
    if (pathname === '/despachos-hoy-all' && req.method === 'GET') {
      (async () => {
        try {
          const allAccounts = (fullConfig().accounts || []).filter(a => a.access_token && a.user_id);
          if (!allAccounts.length) { json(res, 400, { error: 'Sin cuentas configuradas' }); return; }

          const results = await Promise.all(allAccounts.map(async acct => {
            try {
              const { orders, filtered } = await getDespachosPendientes(acct);
              return { accountId: acct.id, label: acct.label || acct.id, ok: true, orders, filtered };
            } catch(e) {
              return { accountId: acct.id, label: acct.label || acct.id, ok: false, error: e.message, orders: [], filtered: 0 };
            }
          }));

          const totalOrders = results.reduce((s, r) => s + r.orders.length, 0);
          const totalUnits  = results.reduce((s, r) => s + r.orders.reduce((a, o) => a + o.items.reduce((b, i) => b + (i.quantity||0), 0), 0), 0);
          json(res, 200, { ok: true, accounts: results, totalOrders, totalUnits });
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
              zip: addr.zip_code || '',
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

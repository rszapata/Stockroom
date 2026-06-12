'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { json } = require('../lib/http');
const { parseMultipart } = require('../lib/files');

const FLEX_TARIFFS  = { caba: 4490, gba_cerca: 6490, gba_lejos: 8490 };
const FLEX_ZONES_PATH = path.join(__dirname, '..', 'flex_zones.json');

function loadFlexZones() {
  try { if (fs.existsSync(FLEX_ZONES_PATH)) return JSON.parse(fs.readFileSync(FLEX_ZONES_PATH, 'utf8')); } catch(e) {}
  return {};
}
function saveFlexZones(map) { fs.writeFileSync(FLEX_ZONES_PATH, JSON.stringify(map, null, 2)); }

function autoZoneForCp(cp) {
  if (!cp) return null;
  const s = String(cp).trim().toUpperCase();
  if (/^C\d{4}/.test(s)) return 'caba';
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); if (n >= 1000 && n <= 1499) return 'caba'; }
  return null;
}

module.exports = function(ctx) {
  const { mlGetAuth, fullConfig } = ctx;

  return function handleFlex(req, res, pathname, parsed) {

    // GET /flex-zones
    if (pathname === '/flex-zones' && req.method === 'GET') {
      json(res, 200, { zones: loadFlexZones(), tariffs: FLEX_TARIFFS });
      return true;
    }

    // POST /flex-zones
    if (pathname === '/flex-zones' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const map  = loadFlexZones();
          const validZones = new Set(['caba', 'gba_cerca', 'gba_lejos', 'sin_zona', '']);
          if (data.cp && data.zone !== undefined) {
            if (!validZones.has(data.zone)) { json(res, 400, { error: 'zone inválida' }); return; }
            if (data.zone === '') delete map[String(data.cp)];
            else map[String(data.cp)] = data.zone;
          } else if (data.zones && typeof data.zones === 'object') {
            for (const [cp, z] of Object.entries(data.zones)) {
              if (!validZones.has(z)) continue;
              if (z === '') delete map[String(cp)];
              else map[String(cp)] = z;
            }
          } else { json(res, 400, { error: 'body inválido' }); return; }
          saveFlexZones(map);
          json(res, 200, { ok: true, count: Object.keys(map).length });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // POST /flex-cost-excel
    if (pathname === '/flex-cost-excel' && req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=(.+)/);
      if (!bm) { json(res, 400, { error: 'No boundary' }); return true; }
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body    = Buffer.concat(chunks);
        const parts   = parseMultipart(body, bm[1]);
        const fileData = parts['file'];
        const desde   = String(parts['desde'] || '').trim();
        const hasta   = String(parts['hasta']  || '').trim();
        if (!fileData?.data) { json(res, 400, { error: 'Archivo no recibido' }); return; }

        const tmpIn = path.join(os.tmpdir(), `flex_in_${Date.now()}.xlsx`);
        fs.writeFileSync(tmpIn, fileData.data);

        const scriptPath = path.join(__dirname, '..', 'flex_cost.py');
        if (!fs.existsSync(scriptPath)) {
          try { fs.unlinkSync(tmpIn); } catch(e) {}
          json(res, 500, { error: 'No se encontró flex_cost.py' });
          return;
        }

        const args = [scriptPath, tmpIn, '--zones', FLEX_ZONES_PATH];
        if (desde) args.push('--desde', desde);
        if (hasta)  args.push('--hasta',  hasta);

        const PYTHON      = process.platform === 'win32' ? 'py' : 'python3';
        const PYTHON_ARGS = process.platform === 'win32' ? ['-3.12'] : [];
        const py = spawn(PYTHON, [...PYTHON_ARGS, ...args]);
        let stdout = '', stderr = '';
        py.stdout.on('data', d => stdout += d);
        py.stderr.on('data', d => stderr += d);
        py.on('close', code => {
          try { fs.unlinkSync(tmpIn); } catch(e) {}
          if (code !== 0) { json(res, 500, { error: 'Error ejecutando script', detail: stderr.slice(-800) }); return; }
          try {
            const clean = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const idx   = clean.indexOf('FLEX_JSON:');
            if (idx === -1) { json(res, 500, { error: 'Script no devolvió FLEX_JSON', detail: stdout.slice(-800) }); return; }
            const jsonStr = clean.slice(idx + 'FLEX_JSON:'.length).split('\n')[0].trim();
            json(res, 200, JSON.parse(jsonStr));
          } catch(e) { json(res, 500, { error: 'Error parseando salida', detail: e.message }); }
        });
      });
      return true;
    }

    // GET /flex-cost?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=all|<id>
    if (pathname === '/flex-cost' && req.method === 'GET') {
      (async () => {
        try {
          const fromQ   = parsed.query.from;
          const toQ     = parsed.query.to;
          const acctIdQ = parsed.query.accountId || 'all';
          if (!fromQ || !toQ) { json(res, 400, { error: 'from/to requeridos (YYYY-MM-DD)' }); return; }

          const fromISO = new Date(fromQ + 'T00:00:00.000-03:00').toISOString();
          const toISO   = new Date(toQ   + 'T23:59:59.999-03:00').toISOString();

          const allAccounts = fullConfig().accounts || [];
          const targetAccts = acctIdQ === 'all'
            ? allAccounts.filter(a => a.access_token && a.user_id)
            : allAccounts.filter(a => a.id === acctIdQ && a.access_token && a.user_id);
          if (!targetAccts.length) { json(res, 400, { error: 'sin cuentas válidas' }); return; }

          const zonesMap  = loadFlexZones();
          const breakdown = {};
          const unmapped  = {};
          const perAccount = {};
          let flexShipmentsTotal = 0;
          let totalCost = 0;
          const errors = [];

          for (const acct of targetAccts) {
            perAccount[acct.id] = { label: acct.label || acct.id, count: 0, cost: 0 };
            const collectedShipIds = new Set();
            let offset = 0;
            const LIMIT = 50, MAX_ORDERS = 1000;
            while (offset < MAX_ORDERS) {
              const mlPath = `/orders/search?seller=${acct.user_id}` +
                `&order.date_created.from=${encodeURIComponent(fromISO)}` +
                `&order.date_created.to=${encodeURIComponent(toISO)}` +
                `&sort=date_desc&limit=${LIMIT}&offset=${offset}`;
              let data;
              try { data = await mlGetAuth(acct, mlPath); }
              catch(e) { errors.push({ account: acct.id, stage: 'orders_search', error: e.message }); break; }
              const results = data.results || [];
              for (const o of results) { if (o.shipping?.id) collectedShipIds.add(o.shipping.id); }
              if (results.length < LIMIT) break;
              offset += LIMIT;
            }

            const shipIds = Array.from(collectedShipIds);
            const CHUNK = 8;
            for (let i = 0; i < shipIds.length; i += CHUNK) {
              const chunk = shipIds.slice(i, i + CHUNK);
              const results = await Promise.all(chunk.map(sid =>
                mlGetAuth(acct, '/shipments/' + sid).catch(e => ({ _err: e.message, _sid: sid }))
              ));
              for (const sh of results) {
                if (sh._err) { errors.push({ account: acct.id, stage: 'shipment', sid: sh._sid, error: sh._err }); continue; }
                if (sh.logistic_type !== 'self_service') continue;
                const status = sh.status, sub = sh.substatus;
                if (status === 'cancelled' || sub === 'cancelled' || sub === 'returned' || sub === 'returning_to_sender') continue;

                flexShipmentsTotal++;
                perAccount[acct.id].count++;

                const recv   = sh.receiver_address || {};
                const cp     = String(recv.zip_code || '').trim();
                const addrSample = [recv.address_line, recv.neighborhood?.name, recv.city?.name, recv.state?.name].filter(Boolean).join(' · ');
                const zone   = zonesMap[cp] || autoZoneForCp(cp);
                if (zone && FLEX_TARIFFS[zone]) {
                  const cost = FLEX_TARIFFS[zone];
                  totalCost += cost;
                  perAccount[acct.id].cost += cost;
                  if (!breakdown[cp]) breakdown[cp] = { count: 0, sample_address: addrSample, zone, accounts: new Set() };
                  breakdown[cp].count++;
                  breakdown[cp].accounts.add(acct.id);
                } else {
                  if (!unmapped[cp]) unmapped[cp] = { count: 0, sample_address: addrSample, accounts: new Set() };
                  unmapped[cp].count++;
                  unmapped[cp].accounts.add(acct.id);
                }
              }
            }
          }

          const breakdownArr = Object.entries(breakdown).map(([cp, v]) => ({
            cp, count: v.count, zone: v.zone, tariff: FLEX_TARIFFS[v.zone],
            subtotal: v.count * FLEX_TARIFFS[v.zone],
            sample_address: v.sample_address, accounts: Array.from(v.accounts),
          })).sort((a, b) => b.subtotal - a.subtotal);
          const unmappedArr = Object.entries(unmapped).map(([cp, v]) => ({
            cp, count: v.count, sample_address: v.sample_address, accounts: Array.from(v.accounts),
            auto_suggest: autoZoneForCp(cp),
          })).sort((a, b) => b.count - a.count);

          json(res, 200, {
            ok: true, from: fromQ, to: toQ, accountId: acctIdQ,
            tariffs: FLEX_TARIFFS, flex_shipments: flexShipmentsTotal,
            mapped_count: breakdownArr.reduce((a, r) => a + r.count, 0),
            unmapped_count: unmappedArr.reduce((a, r) => a + r.count, 0),
            total_cost: totalCost, breakdown: breakdownArr,
            unmapped: unmappedArr, per_account: perAccount,
            errors: errors.slice(0, 20),
          });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    return false;
  };
};

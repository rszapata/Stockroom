'use strict';
const fs   = require('fs');
const path = require('path');
const { json } = require('../lib/http');
const {
  loadPendingAdjustments, savePendingAdjustments,
  loadVincLog, appendVincLog,
} = require('../lib/json-store');
const { _varKeysAll } = require('../lib/variant-helpers');

const VINC_PATH = path.join(__dirname, '..', 'vinculaciones.json');

module.exports = function(ctx) {
  const {
    mlGetAuth, mlPutAuth, refreshAccountToken,
    fullConfig, checkStockChanges, getLastVincCheck,
    buildVariantChangesFromMismatches,
  } = ctx;

  return function handleVinculaciones(req, res, pathname) {

    // GET /vinculaciones
    if (pathname === '/vinculaciones' && req.method === 'GET') {
      if (!fs.existsSync(VINC_PATH)) { json(res, 200, { groups: [] }); return true; }
      try { json(res, 200, JSON.parse(fs.readFileSync(VINC_PATH, 'utf8'))); }
      catch(e) { json(res, 200, { groups: [] }); }
      return true;
    }

    // POST /vinculaciones
    if (pathname === '/vinculaciones' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          fs.writeFileSync(VINC_PATH, JSON.stringify(data, null, 2));
          json(res, 200, { ok: true });
        } catch(e) { json(res, 400, { error: 'invalid_json' }); }
      });
      return true;
    }

    // POST /vinculaciones/sync
    if (pathname === '/vinculaciones/sync' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { group, sourceItemId } = JSON.parse(body);
          const results = [];
          for (const it of group.items) {
            const acct = (fullConfig().accounts || []).find(a => a.id === it.accountId);
            if (!acct || !acct.access_token) { results.push({ ...it, error: 'sin_token' }); continue; }
            try {
              const data = await mlGetAuth(acct, '/items/' + it.itemId);
              const variations  = data.variations || [];
              const hasVariations = variations.length > 0;
              let realStock;
              if (hasVariations) {
                realStock = variations.reduce((sum, v) => sum + (v.available_quantity || 0), 0);
              } else {
                realStock = data.available_quantity || 0;
              }
              results.push({ ...it, realStock, status: data.status, hasVariations, variations });
            } catch(e) { results.push({ ...it, error: e.message }); }
          }
          const valid = results.filter(r => !r.error && typeof r.realStock === 'number');
          if (!valid.length) { json(res, 200, { ok: false, error: 'No se pudo leer stock de ningún item', results }); return; }

          let targetStock;
          if (sourceItemId) {
            const src = valid.find(r => r.itemId === sourceItemId);
            if (!src) { json(res, 200, { ok: false, error: 'Item fuente no encontrado o sin stock', results }); return; }
            targetStock = src.realStock;
          } else {
            targetStock = Math.min(...valid.map(r => r.realStock));
          }

          // Item fuente para matcheo por variante
          const srcItem   = sourceItemId ? valid.find(r => r.itemId === sourceItemId) : null;
          const srcVarMap = {};
          if (srcItem && srcItem.hasVariations && srcItem.variations?.length) {
            srcItem.variations.forEach(v => {
              const qty = v.available_quantity || 0;
              _varKeysAll(v).forEach(k => { if (k) srcVarMap[k] = qty; });
            });
          }

          const updates = [];
          for (const it of valid) {
            if (sourceItemId && it.itemId === sourceItemId) continue;
            const acct = (fullConfig().accounts || []).find(a => a.id === it.accountId);
            try {
              if (it.hasVariations && it.variations && it.variations.length) {
                let newVariations;
                let matchMethod = 'proportional';
                const hasSrcMap = Object.keys(srcVarMap).length > 0;
                let matchedCount = 0;
                if (hasSrcMap) {
                  newVariations = it.variations.map(v => {
                    const keys = _varKeysAll(v);
                    let qty = null;
                    for (const k of keys) {
                      if (k && Object.prototype.hasOwnProperty.call(srcVarMap, k)) { qty = srcVarMap[k]; break; }
                    }
                    if (qty !== null) { matchedCount++; return { id: v.id, available_quantity: Math.max(qty, 0) }; }
                    return { id: v.id, available_quantity: Math.max(v.available_quantity || 0, 0) };
                  });
                  matchMethod = matchedCount > 0 ? 'variants-by-attr' : 'no-match';
                  if (matchedCount === 0) {
                    updates.push({ itemId: it.itemId, from: it.realStock, to: it.realStock, ok: false, error: 'variantes no coinciden con la fuente (atributos distintos)' });
                    continue;
                  }
                } else {
                  // Sin fuente: distribución proporcional
                  const oldTotal = it.realStock || 1;
                  newVariations = it.variations.map(v => {
                    const oldQty = v.available_quantity || 0;
                    let newQty = oldTotal === 0
                      ? Math.floor(targetStock / it.variations.length)
                      : Math.round((oldQty / oldTotal) * targetStock);
                    return { id: v.id, available_quantity: Math.max(newQty, 0) };
                  });
                  // Ajustar diferencia por redondeo
                  const sum = newVariations.reduce((a, v) => a + v.available_quantity, 0);
                  if (sum !== targetStock && newVariations.length) {
                    newVariations[0].available_quantity += (targetStock - sum);
                    if (newVariations[0].available_quantity < 0) newVariations[0].available_quantity = 0;
                  }
                }
                await mlPutAuth(acct, '/items/' + it.itemId, { variations: newVariations });
                updates.push({ itemId: it.itemId, from: it.realStock, to: targetStock, ok: true, hasVariations: true, matchMethod });
              } else {
                if (it.realStock !== targetStock) {
                  await mlPutAuth(acct, '/items/' + it.itemId, { available_quantity: targetStock });
                }
                updates.push({ itemId: it.itemId, from: it.realStock, to: targetStock, ok: true });
              }
            } catch(e) { updates.push({ itemId: it.itemId, from: it.realStock, to: targetStock, ok: false, error: e.message }); }
          }

          // Actualizar lastStock en vinculaciones.json
          try {
            const vinc = JSON.parse(fs.readFileSync(VINC_PATH, 'utf8'));
            const g = vinc.groups.find(x => x.id === group.id);
            if (g) {
              for (const it of g.items) it.lastStock = targetStock;
              g.lastSync = new Date().toISOString();
              fs.writeFileSync(VINC_PATH, JSON.stringify(vinc, null, 2));
            }
          } catch(e) {}

          json(res, 200, { ok: true, targetStock, results, updates });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // POST /vinculaciones/check-orders
    if (pathname === '/vinculaciones/check-orders' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          let bodyData = {};
          try { bodyData = body ? JSON.parse(body) : {}; } catch(e) {}
          const dryRun = !!bodyData.dryRun;
          const vinc = fs.existsSync(VINC_PATH) ? JSON.parse(fs.readFileSync(VINC_PATH, 'utf8')) : { groups: [] };
          if (!vinc.groups?.length) { json(res, 200, { ok: true, msg: 'No hay grupos', synced: 0, dryRun }); return; }

          const itemToGroup = {};
          for (const g of vinc.groups) {
            for (const it of g.items) itemToGroup[it.itemId] = g;
          }

          const since       = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const allAccounts = fullConfig().accounts || [];
          const groupsToSync = new Set();

          for (const acct of allAccounts) {
            if (!acct.access_token || !acct.user_id) continue;
            try {
              const mlPath = `/orders/search?seller=${acct.user_id}&order.status=paid&order.date_created.from=${encodeURIComponent(since)}&sort=date_desc&limit=50`;
              const data   = await mlGetAuth(acct, mlPath);
              for (const o of (data.results || [])) {
                for (const oi of (o.order_items || [])) {
                  const iid = oi.item?.id;
                  if (iid && itemToGroup[iid]) groupsToSync.add(itemToGroup[iid].id);
                }
              }
            } catch(e) { console.log(`[vinc] Error checking orders for ${acct.id}:`, e.message); }
          }

          const syncResults = [];
          for (const gid of groupsToSync) {
            const g = vinc.groups.find(x => x.id === gid);
            if (!g) continue;
            const stocks = [];
            for (const it of g.items) {
              const acct = allAccounts.find(a => a.id === it.accountId);
              if (!acct?.access_token) continue;
              try {
                const d    = await mlGetAuth(acct, '/items/' + it.itemId);
                const vars = d.variations || [];
                const hasVars = vars.length > 0;
                const stock   = hasVars ? vars.reduce((sum, v) => sum + (v.available_quantity || 0), 0) : (d.available_quantity || 0);
                stocks.push({ ...it, stock, hasVars, variations: vars });
              } catch(e) { /* skip */ }
            }
            if (!stocks.length) continue;
            const minStock = Math.min(...stocks.map(s => s.stock));
            for (const s of stocks) {
              if (s.stock > minStock) {
                const acct = allAccounts.find(a => a.id === s.accountId);
                try {
                  if (!dryRun) {
                    if (s.hasVars && s.variations?.length) {
                      const oldTotal = s.stock || 1;
                      const newVars  = s.variations.map(v => {
                        const oldQty = v.available_quantity || 0;
                        let newQty   = oldTotal === 0
                          ? Math.floor(minStock / s.variations.length)
                          : Math.round((oldQty / oldTotal) * minStock);
                        return { id: v.id, available_quantity: Math.max(newQty, 0) };
                      });
                      const sum = newVars.reduce((a, v) => a + v.available_quantity, 0);
                      if (sum !== minStock && newVars.length) {
                        newVars[0].available_quantity += (minStock - sum);
                        if (newVars[0].available_quantity < 0) newVars[0].available_quantity = 0;
                      }
                      await mlPutAuth(acct, '/items/' + s.itemId, { variations: newVars });
                    } else {
                      await mlPutAuth(acct, '/items/' + s.itemId, { available_quantity: minStock });
                    }
                  }
                  syncResults.push({ group: g.name, groupId: g.id, accountId: s.accountId, item: s.itemId, from: s.stock, to: minStock, hasVars: !!s.hasVars });
                } catch(e) { /* skip */ }
              }
            }
          }
          json(res, 200, { ok: true, dryRun, groupsChecked: groupsToSync.size, synced: syncResults.length, details: syncResults });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // GET /vinculaciones/pending
    if (pathname === '/vinculaciones/pending' && req.method === 'GET') {
      const list = loadPendingAdjustments().filter(p => p.status === 'pending');
      json(res, 200, { ok: true, pending: list, lastCheck: getLastVincCheck() });
      return true;
    }

    // GET /vinculaciones/log
    if (pathname === '/vinculaciones/log' && req.method === 'GET') {
      const qs    = new URL('http://x' + req.url).searchParams;
      const limit = Math.min(parseInt(qs.get('limit') || '100'), 300);
      json(res, 200, { ok: true, entries: loadVincLog().slice(0, limit) });
      return true;
    }

    // POST /vinculaciones/apply-adjustment
    if (pathname === '/vinculaciones/apply-adjustment' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          let bodyData = {};
          try { bodyData = body ? JSON.parse(body) : {}; } catch(e) {}
          const { id } = bodyData;
          const all    = !id;
          const allAdj = loadPendingAdjustments();
          const toApply = all
            ? allAdj.filter(p => p.status === 'pending')
            : allAdj.filter(p => p.status === 'pending' && p.id === id);

          if (!toApply.length) { json(res, 200, { ok: true, applied: 0, msg: 'Sin ajustes pendientes' }); return; }

          if (bodyData.variantChoices && Object.keys(bodyData.variantChoices).length) {
            for (const adj of toApply) {
              if (adj.type !== 'variant' || !adj.variantMismatches) continue;
              const mismatchesWithChoice = adj.variantMismatches.map(mm => {
                const chosenItemId = bodyData.variantChoices[mm.attrKey];
                if (!chosenItemId) return mm;
                const chosen = mm.perItem.find(p => p.itemId === chosenItemId);
                if (!chosen) return mm;
                return { ...mm, targetQty: chosen.qty };
              });
              adj.changes = buildVariantChangesFromMismatches(mismatchesWithChoice);
              adj.variantMismatches = mismatchesWithChoice;
            }
          }

          const allAccounts = fullConfig().accounts || [];
          const results = [];

          for (const adj of toApply) {
            for (const ch of adj.changes) {
              const acct = allAccounts.find(a => a.id === ch.accountId);
              if (!acct) { results.push({ adjId: adj.id, itemId: ch.itemId, ok: false, error: 'cuenta no encontrada' }); continue; }
              try {
                await refreshAccountToken(acct);
                const itemData = await mlGetAuth(acct, '/items/' + ch.itemId);
                const vars = itemData.variations || [];
                if (vars.length) {
                  let newVars;
                  let applyMethod = 'proportional';

                  if (adj.type === 'variant' && ch.variantChanges?.length) {
                    newVars = vars.map(v => ({ id: v.id, available_quantity: v.available_quantity || 0 }));
                    for (const vc of ch.variantChanges) {
                      const matchedVar = vars.find(v => _varKeysAll(v).some(k => k === vc.attrKey));
                      if (matchedVar) {
                        const t = newVars.find(v => v.id === matchedVar.id);
                        if (t) { t.available_quantity = Math.max(0, vc.to); applyMethod = 'variant-exact'; }
                      }
                    }
                  } else {
                    const srcDeltas = ch.sourceVariantDeltas || [];
                    if (srcDeltas.length > 0) {
                      newVars = vars.map(v => ({ id: v.id, available_quantity: v.available_quantity || 0 }));
                      for (const srcDelta of srcDeltas) {
                        const matchedVar = vars.find(v => _varKeysAll(v).some(k => k === srcDelta.attrKey));
                        if (matchedVar) {
                          const t = newVars.find(v => v.id === matchedVar.id);
                          if (t) { t.available_quantity = Math.max(0, t.available_quantity - srcDelta.delta); applyMethod = 'variant-match'; }
                        } else {
                          const maxVar = newVars.reduce((m, v) => v.available_quantity > m.available_quantity ? v : m, newVars[0]);
                          if (maxVar) { maxVar.available_quantity = Math.max(0, maxVar.available_quantity - srcDelta.delta); applyMethod = 'max-variant-fallback'; }
                        }
                      }
                    } else {
                      console.log('[vinc] apply', ch.itemId, '— omitido: sin info de variante, evita desalinear stock por variante');
                      results.push({ adjId: adj.id, itemId: ch.itemId, ok: false, error: 'Sin info de variante para ajustar con precisión — omitido' });
                      continue;
                    }
                  }
                  console.log('[vinc] apply', ch.itemId, 'method:', applyMethod);
                  await mlPutAuth(acct, '/items/' + ch.itemId, { variations: newVars });
                } else {
                  await mlPutAuth(acct, '/items/' + ch.itemId, { available_quantity: adj.targetStock });
                }
                const fromQty = adj.type === 'variant' ? (ch.variantChanges?.reduce((s, v) => s + v.from, 0) || ch.from) : ch.from;
                const toQty   = adj.type === 'variant' ? (ch.variantChanges?.reduce((s, v) => s + v.to,   0) || adj.targetStock) : adj.targetStock;
                results.push({ adjId: adj.id, itemId: ch.itemId, ok: true, from: fromQty, to: toQty });
              } catch(e) {
                results.push({ adjId: adj.id, itemId: ch.itemId, ok: false, error: e.message });
              }
            }
            const adjResults = results.filter(r => r.adjId === adj.id);
            adj.status    = (adjResults.length > 0 && adjResults.every(r => r.ok)) ? 'applied' : 'error';
            adj.appliedAt = new Date().toISOString();
          }

          savePendingAdjustments(allAdj);

          for (const adj of toApply) {
            const adjOk = results.filter(r => r.adjId === adj.id && r.ok).length;
            appendVincLog({
              action: adj.status === 'applied' ? 'applied' : 'error',
              source: 'web', adjId: adj.id, groupId: adj.groupId,
              triggerAcctLabel: adj.trigger?.acctLabel,
              targetStock: adj.targetStock,
              itemsApplied: adjOk, itemsTotal: adj.changes.length,
            });
          }

          // Actualizar lastStock en vinculaciones.json
          try {
            const vinc = JSON.parse(fs.readFileSync(VINC_PATH, 'utf8'));
            for (const adj of toApply) {
              if (adj.status !== 'applied') continue;
              const g = vinc.groups.find(x => x.id === adj.groupId);
              if (!g) continue;
              for (const it of g.items) it.lastStock = adj.targetStock;
              g.lastSync = new Date().toISOString();
            }
            fs.writeFileSync(VINC_PATH, JSON.stringify(vinc, null, 2));
          } catch(e) {}

          json(res, 200, { ok: true, applied: results.filter(r => r.ok).length, total: results.length, results });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // POST /vinculaciones/revert-adjustment
    if (pathname === '/vinculaciones/revert-adjustment' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          let bodyData = {};
          try { bodyData = body ? JSON.parse(body) : {}; } catch(e) {}
          const { id } = bodyData;
          const allAdj = loadPendingAdjustments();
          const adj    = allAdj.find(a => a.id === id);
          if (!adj) { json(res, 404, { error: 'Ajuste no encontrado' }); return; }
          if (adj.status !== 'applied') { json(res, 400, { error: 'Sólo se pueden revertir ajustes aplicados (estado actual: ' + adj.status + ')' }); return; }

          const allAccounts = fullConfig().accounts || [];
          const results = [];

          for (const ch of adj.changes) {
            const acct = allAccounts.find(a => a.id === ch.accountId);
            if (!acct) { results.push({ itemId: ch.itemId, ok: false, error: 'cuenta no encontrada' }); continue; }
            try {
              await refreshAccountToken(acct);
              const itemData = await mlGetAuth(acct, '/items/' + ch.itemId);
              const vars     = itemData.variations || [];
              if (vars.length) {
                const newVars = vars.map(v => ({ id: v.id, available_quantity: v.available_quantity || 0 }));
                if (adj.type === 'variant' && ch.variantChanges?.length) {
                  for (const vc of ch.variantChanges) {
                    const matchedVar = vars.find(v => _varKeysAll(v).some(k => k === vc.attrKey));
                    if (matchedVar) {
                      const t = newVars.find(v => v.id === matchedVar.id);
                      if (t) t.available_quantity = Math.max(0, vc.from);
                    }
                  }
                } else if (ch.sourceVariantDeltas?.length) {
                  for (const sd of ch.sourceVariantDeltas) {
                    const matchedVar = vars.find(v => _varKeysAll(v).some(k => k === sd.attrKey));
                    if (matchedVar) {
                      const t = newVars.find(v => v.id === matchedVar.id);
                      if (t) t.available_quantity = Math.max(0, t.available_quantity + sd.delta);
                    }
                  }
                } else {
                  results.push({ itemId: ch.itemId, ok: false, error: 'sin info de variante para revertir' });
                  continue;
                }
                await mlPutAuth(acct, '/items/' + ch.itemId, { variations: newVars });
              } else {
                await mlPutAuth(acct, '/items/' + ch.itemId, { available_quantity: ch.from });
              }
              results.push({ itemId: ch.itemId, ok: true });
            } catch(e) {
              results.push({ itemId: ch.itemId, ok: false, error: e.message });
            }
          }

          const allOk = results.length > 0 && results.every(r => r.ok);
          if (allOk) {
            adj.status    = 'reverted';
            adj.revertedAt = new Date().toISOString();
            savePendingAdjustments(allAdj);
            appendVincLog({ action: 'reverted', source: 'web', adjId: adj.id, groupId: adj.groupId, triggerAcctLabel: adj.trigger?.acctLabel, itemsApplied: results.length });
          }
          json(res, 200, { ok: allOk, results });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // POST /vinculaciones/dismiss-adjustment
    if (pathname === '/vinculaciones/dismiss-adjustment' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          let bodyData = {};
          try { bodyData = body ? JSON.parse(body) : {}; } catch(e) {}
          const { id } = bodyData;
          const list = loadPendingAdjustments();
          const toDismiss = [];
          for (const p of list) {
            if (p.status !== 'pending') continue;
            if (!id || p.id === id) { p.status = 'dismissed'; toDismiss.push(p); }
          }
          savePendingAdjustments(list);
          for (const p of toDismiss)
            appendVincLog({ action: 'dismissed', source: 'web', adjId: p.id, groupId: p.groupId, triggerAcctLabel: p.trigger?.acctLabel, bulk: !id });
          json(res, 200, { ok: true });
        } catch(e) { json(res, 500, { error: e.message }); }
      });
      return true;
    }

    // POST /vinculaciones/check-now
    if (pathname === '/vinculaciones/check-now' && req.method === 'POST') {
      (async () => {
        try {
          await checkStockChanges();
          const list = loadPendingAdjustments().filter(p => p.status === 'pending');
          json(res, 200, { ok: true, pending: list, lastCheck: getLastVincCheck() });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    return false;
  };
};

'use strict';
const fs   = require('fs');
const path = require('path');
const { json }                          = require('../lib/http');
const { readBody, readBodyWithLimit }   = require('../lib/http-body');
const { parsePdfRows }                  = require('../lib/pdf-parsers');
const { loadAlibabaMapping, saveAlibabaMapping } = require('../lib/json-store');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

module.exports = function(ctx) {
  const { mlGetAuth, mlPutAuth, fullConfig, getProductCache, invalidateProductCache } = ctx;

  return function handleAlibaba(req, res, pathname) {

    // POST /api/stockroom/alibaba/parse
    if (pathname === '/api/stockroom/alibaba/parse' && req.method === 'POST') {
      (async () => {
        try {
          const rawBody  = await readBodyWithLimit(req, 30 * 1024 * 1024);
          const { data } = JSON.parse(rawBody);
          if (!data) throw Object.assign(new Error('Falta campo "data" (base64 del PDF)'), { status: 400 });

          const pdfBuf   = Buffer.from(data, 'base64');
          const pdfParse = require('pdf-parse');
          const parsed   = await pdfParse(pdfBuf);

          let text    = parsed.text || '';
          let usedOcr = false;
          const hasText = text.replace(/\s/g, '').length > 50;

          if (!hasText) {
            console.log('[alibaba-parse] PDF sin texto — activando OCR...');
            const { execFile }  = require('child_process');
            const { promisify } = require('util');
            const execFileP     = promisify(execFile);
            const os            = require('os');
            const stamp         = Date.now();
            const tmpDir        = os.tmpdir();
            const pdfPath       = path.join(tmpDir, `alibaba-${stamp}.pdf`);
            const imgPrefix     = path.join(tmpDir, `alibaba-${stamp}`);
            const tmpFiles      = [pdfPath];

            try {
              fs.writeFileSync(pdfPath, pdfBuf);
              await execFileP('pdftoppm', ['-r', '180', '-png', pdfPath, imgPrefix]);

              const imgFiles = fs.readdirSync(tmpDir)
                .filter(f => f.startsWith(`alibaba-${stamp}`) && f.endsWith('.png'))
                .sort()
                .map(f => { tmpFiles.push(path.join(tmpDir, f)); return path.join(tmpDir, f); });

              if (!imgFiles.length) throw new Error('pdftoppm no generó imágenes');
              console.log(`[alibaba-parse] OCR: ${imgFiles.length} páginas`);

              const { createWorker } = require('tesseract.js');
              const worker = await createWorker('eng', 1, { logger: () => {} });
              const parts = [];
              for (const img of imgFiles) {
                const { data: { text: t } } = await worker.recognize(img);
                parts.push(t);
              }
              await worker.terminate();

              text    = parts.join('\n');
              usedOcr = true;
              console.log(`[alibaba-parse] OCR OK — ${text.replace(/\s/g,'').length} chars`);
            } finally {
              tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
            }
          }

          console.log(`[alibaba-parse] Text length: ${text.length}, calling parsePdfRows...`);
          const rows = parsePdfRows(text);
          console.log(`[alibaba-parse] Parsed rows: ${rows.length} items`);
          json(res, 200, { ok: true, rows, rawText: text, totalPages: parsed.numpages, usedOcr });
        } catch(e) {
          console.error('[alibaba-parse] Error:', e.message);
          console.error('[alibaba-parse] Stack:', e.stack);
          json(res, e.status || 500, { error: e.message });
        }
      })();
      return true;
    }

    // GET /api/stockroom/alibaba/fetch-image?url=...
    if (pathname === '/api/stockroom/alibaba/fetch-image' && req.method === 'GET') {
      const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
      if (!targetUrl) { json(res, 400, { error: 'Falta url' }); return true; }
      (async () => {
        const fetchHtml = (urlStr) => new Promise((resolve, reject) => {
          const parsedUrl = new URL(urlStr);
          const lib = parsedUrl.protocol === 'https:' ? require('https') : require('http');
          const opts = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            timeout: 10000,
          };
          const request = lib.get(opts, resp => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
              resolve({ redirect: resp.headers.location }); resp.resume(); return;
            }
            if (resp.statusCode !== 200) { reject(new Error(`HTTP ${resp.statusCode}`)); resp.resume(); return; }
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8', 0, 200000) }));
            resp.on('error', reject);
          });
          request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
          request.on('error', reject);
        });

        try {
          let result = await fetchHtml(targetUrl);
          if (result.redirect) {
            const redirectUrl = result.redirect.startsWith('http') ? result.redirect : new URL(result.redirect, targetUrl).href;
            result = await fetchHtml(redirectUrl);
          }
          const html = result.html || '';
          const ogRe = /<meta[^>]+(?:property=["']og:image["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+property=["']og:image["'])/i;
          const m = ogRe.exec(html);
          const imageUrl = m ? (m[1] || m[2]) : null;
          if (imageUrl) json(res, 200, { imageUrl });
          else json(res, 404, { error: 'No se encontró imagen en la página' });
        } catch(e) { json(res, 500, { error: e.message }); }
      })();
      return true;
    }

    // GET /api/stockroom/alibaba/ml-items?account_id=X
    if (pathname === '/api/stockroom/alibaba/ml-items' && req.method === 'GET') {
      const acctId = new URL(req.url, 'http://localhost').searchParams.get('account_id');
      if (!acctId) { json(res, 400, { error: 'Falta account_id' }); return true; }
      const acctCachePath = path.join(CACHE_DIR, `items-${acctId}.json`);
      try {
        const raw = JSON.parse(fs.readFileSync(acctCachePath, 'utf8'));
        json(res, 200, Array.isArray(raw) ? raw : (raw.items || []));
      } catch {
        json(res, 200, []);
      }
      return true;
    }

    // GET /api/stockroom/alibaba/mappings
    if (pathname === '/api/stockroom/alibaba/mappings' && req.method === 'GET') {
      json(res, 200, loadAlibabaMapping());
      return true;
    }

    // POST /api/stockroom/alibaba/mappings
    if (pathname === '/api/stockroom/alibaba/mappings' && req.method === 'POST') {
      (async () => {
        try {
          const body = JSON.parse(await readBody(req));
          const { alibaba_name, ml_item_id, account_id } = body;
          if (!alibaba_name || !ml_item_id || !account_id)
            throw Object.assign(new Error('Faltan campos requeridos: alibaba_name, ml_item_id, account_id'), { status: 400 });

          const d   = loadAlibabaMapping();
          const idx = d.mappings.findIndex(m => m.alibaba_name === alibaba_name.trim());
          const mapping = {
            alibaba_name:     alibaba_name.trim(),
            ml_item_id:       ml_item_id.trim(),
            variation_id:     body.variation_id       || null,
            account_id:       account_id.trim(),
            ml_title:         (body.ml_title           || '').trim(),
            ml_variant_label: (body.ml_variant_label   || '').trim(),
            updated_at:       new Date().toISOString(),
          };
          if (idx >= 0) d.mappings[idx] = mapping;
          else d.mappings.push(mapping);
          saveAlibabaMapping(d);
          json(res, 200, { ok: true, mapping });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // DELETE /api/stockroom/alibaba/mappings/:encodedName
    if (pathname.startsWith('/api/stockroom/alibaba/mappings/') && req.method === 'DELETE') {
      const alibaba_name = decodeURIComponent(pathname.slice('/api/stockroom/alibaba/mappings/'.length));
      const d = loadAlibabaMapping();
      d.mappings = d.mappings.filter(m => m.alibaba_name !== alibaba_name);
      saveAlibabaMapping(d);
      json(res, 200, { ok: true });
      return true;
    }

    // POST /api/stockroom/alibaba/preview
    if (pathname === '/api/stockroom/alibaba/preview' && req.method === 'POST') {
      (async () => {
        try {
          const { items } = JSON.parse(await readBody(req));
          if (!Array.isArray(items)) throw Object.assign(new Error('items debe ser un array'), { status: 400 });

          const allItems = getProductCache() || [];
          const itemMap  = new Map(allItems.map(p => [p.id, p]));

          const preview = items.map(item => {
            const product = itemMap.get(item.ml_item_id);
            let currentStock = 0;
            if (product) {
              if (item.variation_id) {
                const v = (product.variations || []).find(v => String(v.id) === String(item.variation_id));
                currentStock = v ? (v.available_quantity || 0) : 0;
              } else {
                currentStock = product.available_quantity || 0;
              }
            }
            return {
              ml_item_id:       item.ml_item_id,
              variation_id:     item.variation_id || null,
              account_id:       item.account_id,
              ml_title:         product ? product.title : item.ml_item_id,
              ml_variant_label: item.ml_variant_label || '',
              currentStock,
              deltaQty: item.qty,
              newStock: currentStock + item.qty,
              found: !!product,
            };
          });
          json(res, 200, { ok: true, preview });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /api/stockroom/alibaba/apply
    if (pathname === '/api/stockroom/alibaba/apply' && req.method === 'POST') {
      (async () => {
        try {
          const { items } = JSON.parse(await readBody(req));
          if (!Array.isArray(items) || !items.length)
            throw Object.assign(new Error('items debe ser un array no vacío'), { status: 400 });

          const accounts = fullConfig().accounts || [];
          const results  = [];

          // Agrupar por (account_id, ml_item_id) para UN SOLO PUT por item
          const byItem = new Map();
          for (const item of items) {
            const key = `${item.account_id}::${item.ml_item_id}`;
            if (!byItem.has(key)) byItem.set(key, { account_id: item.account_id, ml_item_id: item.ml_item_id, variations: [] });
            byItem.get(key).variations.push(item);
          }
          const itemGroups = [...byItem.values()];

          for (let i = 0; i < itemGroups.length; i += 4) {
            const batch   = itemGroups.slice(i, i + 4);
            const settled = await Promise.allSettled(batch.map(async group => {
              const acct = accounts.find(a => a.id === group.account_id);
              if (!acct) throw Object.assign(new Error(`Cuenta no encontrada: ${group.account_id}`), { group });

              const mlItem      = await mlGetAuth(acct, `/items/${group.ml_item_id}`);
              const allVariations = mlItem.variations || [];

              const varResults = [];
              const varMap = new Map(
                allVariations.map(v => [String(v.id), { id: v.id, available_quantity: v.available_quantity || 0 }])
              );

              for (const item of group.variations) {
                if (item.variation_id) {
                  const vid   = String(item.variation_id);
                  const entry = varMap.get(vid);
                  const currentStock = entry ? entry.available_quantity : 0;
                  const newStock     = currentStock + item.qty;
                  if (entry) entry.available_quantity = newStock;
                  const tv  = allVariations.find(v => String(v.id) === vid);
                  const pid = tv?.picture_ids?.[0];
                  varResults.push({
                    variation_id:    item.variation_id,
                    ml_title:        mlItem.title,
                    prevStock:       currentStock,
                    deltaQty:        item.qty,
                    newStock,
                    variation_thumb: pid ? `https://http2.mlstatic.com/D_${pid}-I.webp` : null,
                  });
                } else {
                  const currentStock = mlItem.available_quantity || 0;
                  const newStock     = currentStock + item.qty;
                  varMap.set('__simple__', { available_quantity: newStock });
                  varResults.push({
                    variation_id:    null,
                    ml_title:        mlItem.title,
                    prevStock:       currentStock,
                    deltaQty:        item.qty,
                    newStock,
                    variation_thumb: mlItem.pictures?.[0]?.url || mlItem.thumbnail || null,
                  });
                }
              }

              const putBody = allVariations.length
                ? { variations: [...varMap.values()].filter(v => v.id) }
                : { available_quantity: varMap.get('__simple__')?.available_quantity ?? (mlItem.available_quantity || 0) };

              await mlPutAuth(acct, `/items/${group.ml_item_id}`, putBody);
              return varResults.map(vr => ({ ok: true, ml_item_id: group.ml_item_id, ...vr }));
            }));

            for (let j = 0; j < settled.length; j++) {
              const r = settled[j];
              if (r.status === 'fulfilled') {
                results.push(...r.value);
              } else {
                const reason = r.reason;
                let errMsg = reason?.message || 'Error desconocido';
                const cause = reason?.body?.cause;
                if (Array.isArray(cause) && cause.length)
                  errMsg += ` — ${cause.map(c => c.description || c.code).filter(Boolean).join('; ')}`;
                else if (reason?.body?.error)
                  errMsg += ` (${reason.body.error})`;
                const grp = batch[j];
                console.warn(`[alibaba] Error ${grp.ml_item_id}:`, errMsg, reason?.body || '');
                for (const item of grp.variations)
                  results.push({ ok: false, ml_item_id: grp.ml_item_id, variation_id: item.variation_id || null, error: errMsg });
              }
            }
          }

          invalidateProductCache();
          const succeeded = results.filter(r => r.ok).length;
          const failed    = results.filter(r => !r.ok).length;
          console.log(`[alibaba] Apply: ${succeeded} OK, ${failed} error(es)`);
          json(res, 200, { ok: true, results, succeeded, failed });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    return false;
  };
};

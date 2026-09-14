'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { json }                          = require('../lib/http');
const { readBody, readBodyWithLimit }   = require('../lib/http-body');
const { parsePdfRows }                  = require('../lib/pdf-parsers');
const {
  loadAlibabaMapping, saveAlibabaMapping,
  loadAlibabaHistorial, saveAlibabaHistorial, ALIBABA_RECIBOS_DIR,
} = require('../lib/json-store');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Suma (sign=+1, usado por /apply) o resta (sign=-1, usado por /revert) qty
// a la variante indicada de cada item. Comparte toda la lógica de matcheo y
// escritura entre ambos endpoints — son la misma operación con signo opuesto.
// dryRun: hace TODAS las lecturas y validaciones pero NO escribe. Así la
// previsualización recorre exactamente el mismo camino que la carga real y
// no puede divergir de ella.
async function applyStockDelta(items, sign, { mlGetAuth, mlPutVerified, fullConfig }, dryRun = false) {
  const accounts = fullConfig().accounts || [];
  const results  = [];

  // Agrupar por (account_id, ml_item_id) para UN SOLO PUT por item.
  // Se guarda la posición original de cada fila (_idx) porque agrupar altera
  // el orden: al final los resultados se reordenan al orden del recibo, que
  // es como el usuario los verifica (recibo al lado de la pantalla).
  const byItem = new Map();
  items.forEach((item, _idx) => {
    const key = `${item.account_id}::${item.ml_item_id}`;
    if (!byItem.has(key)) byItem.set(key, { account_id: item.account_id, ml_item_id: item.ml_item_id, variations: [] });
    byItem.get(key).variations.push({ ...item, _idx });
  });
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
        const qtyDelta = sign * item.qty;
        // Publicación CON variantes pero sin variante elegida: no hay dónde
        // imputar la cantidad. El campo available_quantity raíz de un item con
        // variantes es derivado (ML lo ignora en el PUT), así que escribirlo
        // perdía la cantidad en silencio y se reportaba como éxito.
        if (!item.variation_id && allVariations.length) {
          varResults.push({
            _idx: item._idx,
            ok: false, variation_id: null, ml_title: mlItem.title,
            error: 'La publicación tiene variantes y no se eligió ninguna — elegí la variante antes de aplicar',
          });
          continue;
        }
        if (item.variation_id) {
          const vid   = String(item.variation_id);
          const entry = varMap.get(vid);
          // La variante que se mandó no existe en la publicación ACTUAL de ML
          // (mapping viejo, id incorrecto, o auto-match difuso que erró de
          // variante). Antes esto se reportaba como éxito con un stock
          // inventado — ahora es un error explícito, nada se escribe.
          if (!entry) {
            varResults.push({
              _idx: item._idx,
              ok: false, variation_id: item.variation_id, ml_title: mlItem.title,
              error: 'La variante no existe en esta publicación (id desactualizado o incorrecto)',
            });
            continue;
          }
          const currentStock = entry.available_quantity;
          const newStock     = Math.max(currentStock + qtyDelta, 0);
          entry.available_quantity = newStock;
          const tv  = allVariations.find(v => String(v.id) === vid);
          const pid = tv?.picture_ids?.[0];
          varResults.push({
            _idx: item._idx,
            ok: true, variation_id: item.variation_id, ml_title: mlItem.title,
            prevStock: currentStock, deltaQty: qtyDelta, newStock,
            variation_thumb: pid ? `https://http2.mlstatic.com/D_${pid}-I.webp` : null,
          });
        } else {
          const currentStock = mlItem.available_quantity || 0;
          const newStock     = Math.max(currentStock + qtyDelta, 0);
          varMap.set('__simple__', { available_quantity: newStock });
          varResults.push({
            _idx: item._idx,
            ok: true, variation_id: null, ml_title: mlItem.title,
            prevStock: currentStock, deltaQty: qtyDelta, newStock,
            variation_thumb: mlItem.pictures?.[0]?.url || mlItem.thumbnail || null,
          });
        }
      }

      // Si todas las variantes de este item fallaron el match, no hay nada
      // real para escribir — evita un PUT sin cambios.
      const hasSuccess = varResults.some(vr => vr.ok);
      if (hasSuccess && !dryRun) {
        const putBody = allVariations.length
          ? { variations: [...varMap.values()].filter(v => v.id) }
          : { available_quantity: varMap.get('__simple__')?.available_quantity ?? (mlItem.available_quantity || 0) };
        // expTotal se deriva del putBody REAL (no de varMap) — si se calculara
        // aparte podría incluir entradas que el PUT no manda y mlPutVerified
        // rechazaría un cambio correcto con un error confuso.
        // mlPutVerified reintenta ante 409/conflict transitorio de ML y relee
        // el item después de escribir para confirmar que el total quedó como
        // se esperaba — mlPutAuth (usado antes acá) no verificaba nada.
        const expTotal = putBody.variations
          ? putBody.variations.reduce((s, v) => s + (v.available_quantity || 0), 0)
          : putBody.available_quantity;
        await mlPutVerified(acct, group.ml_item_id, putBody, expTotal);
      }

      return varResults.map(vr => ({ ml_item_id: group.ml_item_id, account_id: group.account_id, ok: true, ...vr }));
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
          results.push({ _idx: item._idx, ok: false, ml_item_id: grp.ml_item_id, variation_id: item.variation_id || null, error: errMsg });
      }
    }
  }

  // Devolver en el orden del recibo, no en el de los grupos: así el panel de
  // resultados y el historial se leen renglón a renglón contra el papel.
  results.sort((a, b) => (a._idx ?? 0) - (b._idx ?? 0));
  return results.map(({ _idx, ...r }) => r);
}

// Guarda el recibo original en disco. Lo usan el parseo de PDF y el de
// HTML/carpeta: antes sólo el PDF pasaba por el servidor, así que los
// recibos HTML no quedaban guardados en ningún lado.
function guardarRecibo(buf, filename, ext) {
  try {
    fs.mkdirSync(ALIBABA_RECIBOS_DIR, { recursive: true });
    const limpio = path.basename(String(filename || "recibo"), ext)
      .replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 60).trim() || "recibo";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const nombre = stamp + "__" + limpio + ext;
    fs.writeFileSync(path.join(ALIBABA_RECIBOS_DIR, nombre), buf);
    return nombre;
  } catch (e) {
    console.warn("[alibaba] no se pudo guardar el recibo:", e.message);
    return null;
  }
}

module.exports = function(ctx) {
  const { mlGetAuth, mlPutVerified, fullConfig, getProductCache, invalidateProductCache } = ctx;

  return function handleAlibaba(req, res, pathname) {

    // POST /api/stockroom/alibaba/parse
    if (pathname === '/api/stockroom/alibaba/parse' && req.method === 'POST') {
      (async () => {
        try {
          const rawBody  = await readBodyWithLimit(req, 30 * 1024 * 1024);
          const { data, filename } = JSON.parse(rawBody);
          if (!data) throw Object.assign(new Error('Falta campo "data" (base64 del PDF)'), { status: 400 });

          const pdfBuf   = Buffer.from(data, 'base64');

          // Guardar el recibo original: sin esto, si el historial dice
          // "se cargaron 30 unidades" no hay contra qué contrastarlo.
          // No bloquea el parseo: el usuario igual necesita cargar el stock
          const reciboGuardado = guardarRecibo(pdfBuf, filename, '.pdf');
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
          json(res, 200, { ok: true, rows, rawText: text, totalPages: parsed.numpages, usedOcr, recibo: reciboGuardado });
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

    // POST /api/stockroom/alibaba/preview — simulacro: mismas lecturas y
    //   validaciones que /apply, pero sin escribir nada en ML.
    if (pathname === '/api/stockroom/alibaba/preview' && req.method === 'POST') {
      (async () => {
        try {
          const { items } = JSON.parse(await readBody(req));
          if (!Array.isArray(items) || !items.length)
            throw Object.assign(new Error('items debe ser un array no vacío'), { status: 400 });

          const results = await applyStockDelta(items, +1, { mlGetAuth, mlPutVerified, fullConfig }, true);
          const succeeded = results.filter(r => r.ok).length;
          const failed    = results.filter(r => !r.ok).length;
          console.log('[alibaba] Preview: ' + succeeded + ' OK, ' + failed + ' con problema');
          json(res, 200, { ok: true, preview: true, results, succeeded, failed });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /api/stockroom/alibaba/recibo — guarda un recibo que se parseó
    //   en el navegador (HTML suelto o carpeta del pedido). El PDF ya se
    //   guarda dentro de /parse porque ese sí pasa por el servidor.
    if (pathname === '/api/stockroom/alibaba/recibo' && req.method === 'POST') {
      (async () => {
        try {
          const { data, filename } = JSON.parse(await readBodyWithLimit(req, 30 * 1024 * 1024));
          if (!data) throw Object.assign(new Error('Falta "data" (base64 del archivo)'), { status: 400 });
          const ext = /.html?$/i.test(String(filename || '')) ? '.html' : '.txt';
          const nombre = guardarRecibo(Buffer.from(data, "base64"), filename, ext);
          if (!nombre) throw new Error('No se pudo escribir el archivo');
          json(res, 200, { ok: true, recibo: nombre });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // GET /api/stockroom/alibaba/historial
    if (pathname === '/api/stockroom/alibaba/historial' && req.method === 'GET') {
      json(res, 200, { ok: true, entradas: loadAlibabaHistorial() });
      return true;
    }

    // POST /api/stockroom/alibaba/historial — agrega una entrada (una carga)
    if (pathname === '/api/stockroom/alibaba/historial' && req.method === 'POST') {
      (async () => {
        try {
          const entrada = JSON.parse(await readBody(req));
          if (!entrada || !Array.isArray(entrada.items) || !entrada.items.length)
            throw Object.assign(new Error('La entrada necesita items'), { status: 400 });

          const lista = loadAlibabaHistorial();
          const nueva = {
            id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            ts: entrada.ts || Date.now(),
            items: entrada.items,
            recibo: entrada.recibo || null,   // nombre del PDF guardado, si hubo
            reverted: false,
          };
          lista.unshift(nueva);
          saveAlibabaHistorial(lista);
          json(res, 200, { ok: true, entrada: nueva });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /api/stockroom/alibaba/historial/:id/revertida — marca revertida
    const mRev = pathname.match(/^\/api\/stockroom\/alibaba\/historial\/([^/]+)\/revertida$/);
    if (mRev && req.method === 'POST') {
      const lista = loadAlibabaHistorial();
      const e = lista.find(x => x.id === decodeURIComponent(mRev[1]));
      if (!e) { json(res, 404, { error: 'Entrada no encontrada' }); return true; }
      e.reverted   = true;
      e.revertedAt = new Date().toISOString();
      saveAlibabaHistorial(lista);
      json(res, 200, { ok: true });
      return true;
    }

    // DELETE /api/stockroom/alibaba/historial/:id — borra una entrada
    const mDel = pathname.match(/^\/api\/stockroom\/alibaba\/historial\/([^/]+)$/);
    if (mDel && req.method === 'DELETE') {
      const id = decodeURIComponent(mDel[1]);
      saveAlibabaHistorial(loadAlibabaHistorial().filter(x => x.id !== id));
      json(res, 200, { ok: true });
      return true;
    }

    // GET /api/stockroom/alibaba/recibos — lista los recibos archivados
    if (pathname === '/api/stockroom/alibaba/recibos' && req.method === 'GET') {
      try {
        const dir = ALIBABA_RECIBOS_DIR;
        const archivos = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        const lista = archivos
          .filter(f => ['pdf','html','htm','txt'].includes(f.toLowerCase().split('.').pop()))
          .map(f => {
            const st = fs.statSync(path.join(dir, f));
            return { archivo: f, bytes: st.size, ts: st.mtimeMs };
          })
          .sort((a, b) => b.ts - a.ts);
        // Cruce con el historial: marca cuáles ya se aplicaron a ML y cuántas
        // unidades movieron. Un recibo archivado sin carga asociada suele ser
        // uno que se subió y quedó a medio procesar.
        const hist = loadAlibabaHistorial();
        const uso = {};
        for (const e of hist) {
          if (!e.recibo) continue;
          const u = uso[e.recibo] || (uso[e.recibo] = { cargas: 0, unidades: 0, revertidas: 0, ultima: 0 });
          u.cargas++;
          if (e.reverted) u.revertidas++;
          u.unidades += (e.items || []).reduce((s, it) => s + (it.deltaQty || 0), 0);
          if (e.ts > u.ultima) u.ultima = e.ts;
        }
        for (const r of lista) {
          const u = uso[r.archivo];
          r.aplicado  = !!u;
          r.cargas    = u ? u.cargas : 0;
          r.unidades  = u ? u.unidades : 0;
          r.revertidas = u ? u.revertidas : 0;
          r.aplicado_ts = u ? u.ultima : null;
        }
        json(res, 200, { ok: true, recibos: lista });
      } catch (e) { json(res, 500, { error: e.message }); }
      return true;
    }

    // DELETE /api/stockroom/alibaba/recibo/:archivo — borra un recibo
    const PREFIJO_RECIBO = '/api/stockroom/alibaba/recibo/';
    const esRutaRecibo = pathname.startsWith(PREFIJO_RECIBO);
    if (esRutaRecibo && req.method === 'DELETE') {
      try {
        // basename() + lista blanca de extensiones: no se puede borrar
        // nada fuera de la carpeta de recibos ni un archivo del sistema.
        const archivo = path.basename(decodeURIComponent(pathname.slice(PREFIJO_RECIBO.length)));
        const extD = archivo.toLowerCase().split('.').pop();
        if (!['pdf','html','htm','txt'].includes(extD)) {
          json(res, 400, { error: 'Extensión no permitida' });
          return true;
        }
        const rutaD = path.join(ALIBABA_RECIBOS_DIR, archivo);
        if (!fs.existsSync(rutaD)) {
          json(res, 404, { error: 'Recibo no encontrado' });
          return true;
        }
        fs.unlinkSync(rutaD);
        // El historial guarda el nombre del recibo: se desvincula para que
        // no quede un enlace roto apuntando a un archivo que ya no está.
        const hist = loadAlibabaHistorial();
        let tocadas = 0;
        for (const e of hist) if (e.recibo === archivo) { e.recibo = null; tocadas++; }
        if (tocadas) saveAlibabaHistorial(hist);
        console.log('[alibaba] recibo borrado: ' + archivo + (tocadas ? ' (' + tocadas + ' entrada(s) desvinculada(s))' : ''));
        json(res, 200, { ok: true, desvinculadas: tocadas });
      } catch (e) { json(res, 500, { error: e.message }); }
      return true;
    }

    // GET /api/stockroom/alibaba/recibo/:archivo — descarga un recibo guardado
    const mRec = pathname.match(/^\/api\/stockroom\/alibaba\/recibo\/([^/]+)$/);
    if (mRec && req.method === 'GET') {
      // basename() evita path traversal (../../config.json)
      const archivo = path.basename(decodeURIComponent(mRec[1]));
      const ruta = path.join(ALIBABA_RECIBOS_DIR, archivo);
      const esPdf  = archivo.endsWith('.pdf');
      const ext    = archivo.toLowerCase().split('.').pop();
      const esHtml = ext === 'html' || ext === 'htm' || ext === 'txt';
      if ((!esPdf && !esHtml) || !fs.existsSync(ruta)) {
        json(res, 404, { error: 'Recibo no encontrado' });
        return true;
      }
      // El PDF se abre en el visor; el HTML viene de Alibaba y puede traer
      // scripts: servirlo inline en el MISMO origen del panel sería XSS, así
      // que se fuerza descarga y se manda como texto plano, no ejecutable.
      res.writeHead(200, esPdf ? {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${archivo}"`,
      } : {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${archivo}"`,
      });
      fs.createReadStream(ruta).pipe(res);
      return true;
    }

    // POST /api/stockroom/alibaba/apply
    if (pathname === '/api/stockroom/alibaba/apply' && req.method === 'POST') {
      (async () => {
        try {
          const { items } = JSON.parse(await readBody(req));
          if (!Array.isArray(items) || !items.length)
            throw Object.assign(new Error('items debe ser un array no vacío'), { status: 400 });

          const results = await applyStockDelta(items, +1, { mlGetAuth, mlPutVerified, fullConfig });
          invalidateProductCache();
          const succeeded = results.filter(r => r.ok).length;
          const failed    = results.filter(r => !r.ok).length;
          console.log(`[alibaba] Apply: ${succeeded} OK, ${failed} error(es)`);
          json(res, 200, { ok: true, results, succeeded, failed });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    // POST /api/stockroom/alibaba/revert — inverso de /apply: resta la
    // misma qty que se había sumado, para deshacer una carga mal hecha
    // (ej. una variante equivocada por auto-match difuso).
    if (pathname === '/api/stockroom/alibaba/revert' && req.method === 'POST') {
      (async () => {
        try {
          const { items } = JSON.parse(await readBody(req));
          if (!Array.isArray(items) || !items.length)
            throw Object.assign(new Error('items debe ser un array no vacío'), { status: 400 });

          const results = await applyStockDelta(items, -1, { mlGetAuth, mlPutVerified, fullConfig });
          invalidateProductCache();
          const succeeded = results.filter(r => r.ok).length;
          const failed    = results.filter(r => !r.ok).length;
          console.log(`[alibaba] Revert: ${succeeded} OK, ${failed} error(es)`);
          json(res, 200, { ok: true, results, succeeded, failed });
        } catch(e) { json(res, e.status || 500, { error: e.message }); }
      })();
      return true;
    }

    return false;
  };
};

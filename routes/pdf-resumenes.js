'use strict';
const fs   = require('fs');
const path = require('path');
const { json }                                       = require('../lib/http');
const { RESUMEN_DIR, loadResumenIndex, saveResumenIndex } = require('../lib/resumenes');
const { extractPdfText, extractStringsFromStream, parseSinergiaTable } = require('../lib/pdf-extract');

module.exports = function handlePdfResumenes(req, res, pathname, parsed) {

  // GET /pdf-resumenes/list
  if (pathname === '/pdf-resumenes/list' && req.method === 'GET') {
    try {
      const idx = loadResumenIndex();
      json(res, 200, { ok: true, items: idx });
    } catch(e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /pdf-resumenes/save
  if (pathname === '/pdf-resumenes/save' && req.method === 'POST') {
    (async () => {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { filename, pdf_b64, parsed: parsedData } = JSON.parse(body);
        if (!filename || !pdf_b64) { json(res, 400, { error: 'filename y pdf_b64 requeridos' }); return; }

        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        const pdfBuf = Buffer.from(pdf_b64, 'base64');

        if (!fs.existsSync(RESUMEN_DIR)) fs.mkdirSync(RESUMEN_DIR, { recursive: true });
        fs.writeFileSync(path.join(RESUMEN_DIR, id + '.pdf'), pdfBuf);
        fs.writeFileSync(path.join(RESUMEN_DIR, id + '.json'), JSON.stringify(parsedData || {}, null, 2));

        const idx = loadResumenIndex();
        idx.unshift({
          id,
          filename,
          savedAt: new Date().toISOString(),
          cliente:        parsedData?.cliente       || null,
          periodo:        parsedData?.periodo       || null,
          total_entregas: parsedData?.total_entregas || (parsedData?.rows?.length || 0),
          total_valor:    parsedData?.total_valor    || (parsedData?.rows||[]).reduce((s,r)=>s+(r.valor||0), 0),
          size: pdfBuf.length,
        });
        saveResumenIndex(idx);
        json(res, 200, { ok: true, id });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // GET /pdf-resumenes/data?id=xxx
  if (pathname === '/pdf-resumenes/data' && req.method === 'GET') {
    try {
      const id = String(parsed.query.id || '').replace(/[^a-z0-9-]/gi, '');
      if (!id) { json(res, 400, { error: 'id requerido' }); return true; }
      const dataPath = path.join(RESUMEN_DIR, id + '.json');
      if (!fs.existsSync(dataPath)) { json(res, 404, { error: 'No encontrado' }); return true; }
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      json(res, 200, { ok: true, ...data });
    } catch(e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /pdf-resumenes/pdf?id=xxx
  if (pathname === '/pdf-resumenes/pdf' && req.method === 'GET') {
    try {
      const id = String(parsed.query.id || '').replace(/[^a-z0-9-]/gi, '');
      if (!id) { res.writeHead(400); res.end('id requerido'); return true; }
      const pdfPath = path.join(RESUMEN_DIR, id + '.pdf');
      if (!fs.existsSync(pdfPath)) { res.writeHead(404); res.end('No encontrado'); return true; }
      const idx  = loadResumenIndex();
      const meta = idx.find(i => i.id === id);
      const fname = meta?.filename || (id + '.pdf');
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fname.replace(/[^\w\-. ]/g,'_')}"`,
      });
      fs.createReadStream(pdfPath).pipe(res);
    } catch(e) { res.writeHead(500); res.end(e.message); }
    return true;
  }

  // DELETE /pdf-resumenes/delete?id=xxx
  if (pathname === '/pdf-resumenes/delete' && req.method === 'DELETE') {
    try {
      const id = String(parsed.query.id || '').replace(/[^a-z0-9-]/gi, '');
      if (!id) { json(res, 400, { error: 'id requerido' }); return true; }
      const pdfPath  = path.join(RESUMEN_DIR, id + '.pdf');
      const dataPath = path.join(RESUMEN_DIR, id + '.json');
      if (fs.existsSync(pdfPath))  fs.unlinkSync(pdfPath);
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
      const idx = loadResumenIndex().filter(i => i.id !== id);
      saveResumenIndex(idx);
      json(res, 200, { ok: true });
    } catch(e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /parse-pdf
  if (pathname === '/parse-pdf' && req.method === 'POST') {
    (async () => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const buf = Buffer.concat(chunks);

        const _dbg = {};
        const streamText = extractPdfText(buf, _dbg);
        const allStrings = extractStringsFromStream(streamText);
        const rows = parseSinergiaTable(streamText, _dbg);

        const flat = allStrings.join(' ');
        const periodoMatch = flat.match(/PER[IÍ]ODO[:\s]*(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/i);
        const clienteIdx   = allStrings.findIndex(s => /^CLIENTE$/i.test(s));
        const cliente      = clienteIdx >= 0 ? allStrings[clienteIdx + 1] : null;
        const totalMatch   = flat.match(/(\d+)\s+entregas\s+por\s+\$\s*([\d,\.]+)/i);

        json(res, 200, {
          ok: true,
          periodo: periodoMatch ? { desde: periodoMatch[1], hasta: periodoMatch[2] } : null,
          cliente,
          total_entregas: totalMatch ? parseInt(totalMatch[1]) : rows.length,
          total_valor:    totalMatch ? parseFloat(totalMatch[2].replace(/,/g,'.')) : null,
          rows,
          _debug: {
            ..._dbg,
            stringCount: allStrings.length,
          },
        });
      } catch(e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  return false;
};

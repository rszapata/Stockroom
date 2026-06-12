'use strict';
const fs   = require('fs');
const path = require('path');
const { json }     = require('../lib/http');
const { readBody } = require('../lib/http-body');

const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

module.exports = function(ctx) {
  const { mlGetAuth, fullConfig, config } = ctx;

  return function handleBackup(req, res, pathname) {

    // POST /api/stockroom/backup/items
    if (pathname === '/api/stockroom/backup/items' && req.method === 'POST') {
      (async () => {
        try {
          const body = JSON.parse(await readBody(req));
          const { account_id, include_paused = true } = body;
          const accounts = fullConfig().accounts || [config()];
          const acct = accounts.find(a => a.id === account_id);
          if (!acct) throw Object.assign(new Error('Cuenta no encontrada: ' + account_id), { status: 404 });
          if (!acct.access_token) throw Object.assign(new Error('La cuenta no tiene token configurado'), { status: 400 });

          console.log(`[backup] Iniciando backup de cuenta "${acct.label || acct.id}"…`);
          const me     = await mlGetAuth(acct, '/users/me');
          const userId = me.id;

          const allIds   = [];
          const statuses = include_paused ? ['active', 'paused'] : ['active'];
          for (const status of statuses) {
            let offset = 0;
            const PER  = 50;
            let total  = Infinity;
            while (offset < total) {
              const r = await mlGetAuth(acct,
                `/users/${userId}/items/search?status=${status}&limit=${PER}&offset=${offset}`);
              total = r.paging?.total ?? 0;
              const ids = r.results || [];
              if (!ids.length) break;
              allIds.push(...ids);
              offset += PER;
            }
          }
          const uniqueIds = [...new Set(allIds)];
          console.log(`[backup]   ${uniqueIds.length} publicaciones encontradas`);

          const items = [];
          const BATCH = 20;
          for (let i = 0; i < uniqueIds.length; i += BATCH) {
            const batch   = uniqueIds.slice(i, i + BATCH);
            const details = await mlGetAuth(acct, `/items?ids=${batch.join(',')}`);
            for (const entry of (Array.isArray(details) ? details : [])) {
              if (entry.code === 200 && entry.body) {
                const it = entry.body;
                items.push({
                  id:                 it.id,
                  title:              it.title,
                  price:              it.price,
                  original_price:     it.original_price,
                  available_quantity: it.available_quantity,
                  sold_quantity:      it.sold_quantity,
                  status:             it.status,
                  listing_type_id:    it.listing_type_id,
                  category_id:        it.category_id,
                  thumbnail:          it.thumbnail,
                  variations: (it.variations || []).map(v => ({
                    id:                   v.id,
                    attribute_combinations: v.attribute_combinations,
                    available_quantity:   v.available_quantity,
                    price:                v.price,
                  })),
                  picture_url: (it.pictures || [])[0]?.secure_url || it.thumbnail || '',
                });
              }
            }
          }

          const stamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const backup = {
            _meta: {
              created_at:        new Date().toISOString(),
              account_id:        acct.id,
              account_label:     acct.label || acct.id,
              ml_user_id:        userId,
              total_items:       items.length,
              statuses_included: statuses,
            },
            items,
          };

          if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
          const filename = `backup-${acct.id}-${stamp}.json`;
          fs.writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(backup, null, 2));
          console.log(`[backup] ✓ Guardado: ${filename} (${items.length} items)`);

          json(res, 200, { ok: true, filename, backup });
        } catch(e) {
          console.error('[backup] Error:', e.message);
          json(res, e.status || 500, { error: e.message });
        }
      })();
      return true;
    }

    // GET /api/stockroom/backup/list
    if (pathname === '/api/stockroom/backup/list' && req.method === 'GET') {
      if (!fs.existsSync(BACKUPS_DIR)) { json(res, 200, { backups: [] }); return true; }
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json') && f.startsWith('backup-'))
        .map(f => {
          const stat = fs.statSync(path.join(BACKUPS_DIR, f));
          let meta = {};
          try { const d = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f), 'utf8')); meta = d._meta || {}; } catch {}
          return { filename: f, size: stat.size, modified_at: stat.mtime.toISOString(), ...meta };
        })
        .sort((a, b) => new Date(b.modified_at) - new Date(a.modified_at));
      json(res, 200, { backups: files });
      return true;
    }

    // GET /api/stockroom/backup/download/:filename
    if (pathname.startsWith('/api/stockroom/backup/download/') && req.method === 'GET') {
      const filename = path.basename(pathname.slice('/api/stockroom/backup/download/'.length));
      if (!filename.match(/^backup-[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)) {
        res.writeHead(400); res.end('Nombre de archivo inválido'); return true;
      }
      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return true; }
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type':        'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      content.length,
      });
      res.end(content);
      return true;
    }

    return false;
  };
};

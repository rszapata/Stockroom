/* ──────────────────────────────────────────────────────────────
 * routes/pedidos-costos.js — Costo puesto por variante
 *
 * ⚠️ INVARIANTE: este router NO escribe en MercadoLibre. Ni una sola llamada
 * PUT/POST a la API de ML. Vincular una línea del recibo a una variante sirve
 * únicamente para imputarle el costo; el stock no se toca. Si alguna vez hace
 * falta mover stock, eso va en `carga Alibaba`, que es un flujo distinto.
 *
 * Para elegir la variante se REUSA el catálogo que ya arma carga Alibaba
 * (getProductCache), así no hay dos fuentes de verdad del catálogo.
 * ────────────────────────────────────────────────────────────── */
'use strict';

const fs   = require('fs');
const path = require('path');
const { json }      = require('../lib/http');
const { readBody }  = require('../lib/http-body');
const { loadPedidosCostos, savePedidosCostos } = require('../lib/json-store');
const { calcularPedido, costosPorVariante, promediosNoProducto } = require('../lib/pedidos-costos');
const { esFunda }   = require('../lib/costos-fundas');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

const nuevoId = () =>
  'ped_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' +
  Math.random().toString(36).slice(2, 6);

module.exports = function(ctx) {
  const { getProductCache } = ctx;

  return function handlePedidosCostos(req, res, pathname) {

    // GET → todos los pedidos, ya calculados
    if (pathname === '/api/stockroom/pedidos-costos' && req.method === 'GET') {
      const { pedidos } = loadPedidosCostos();
      const calculados = (pedidos || []).map(calcularPedido)
        .sort((a, b) => String(b.fecha_compra || '').localeCompare(String(a.fecha_compra || '')));
      json(res, 200, { ok: true, pedidos: calculados });
      return true;
    }

    // GET → mapa item::variante → costo real (lo consumen orden de compra
    //       y rentabilidad en vez de los costos estimados a mano)
    if (pathname === '/api/stockroom/pedidos-costos/variantes' && req.method === 'GET') {
      const { pedidos } = loadPedidosCostos();
      const costos = costosPorVariante(pedidos || []);
      json(res, 200, { ok: true, costos, total: Object.keys(costos).length,
                       promedios: promediosNoProducto(pedidos || []) });
      return true;
    }

    // POST → crear o actualizar (el cálculo se rehace siempre en el server,
    //        así el front nunca puede guardar un total inconsistente)
    if (pathname === '/api/stockroom/pedidos-costos' && req.method === 'POST') {
      (async () => {
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          const p    = body.pedido;
          if (!p || typeof p !== 'object') { json(res, 400, { error: 'Falta "pedido"' }); return; }
          if (!Array.isArray(p.items) || !p.items.length) {
            json(res, 400, { error: 'El pedido no tiene líneas' }); return;
          }

          const store = loadPedidosCostos();
          store.pedidos = store.pedidos || [];

          const ahora = new Date().toISOString();
          const idx   = p.id ? store.pedidos.findIndex(x => x.id === p.id) : -1;
          const limpio = {
            id: p.id || nuevoId(),
            fecha_compra: p.fecha_compra || null,
            proveedor: String(p.proveedor || '').slice(0, 120),
            detalle:   String(p.detalle   || '').slice(0, 500),
            reparto:   p.reparto || 'unidades',
            envio: {
              flete_usd:     Number(p.envio?.flete_usd)     || 0,
              impuestos_ars: Number(p.envio?.impuestos_ars) || 0,
              otros_ars:     Number(p.envio?.otros_ars)     || 0,
              dolar:         Number(p.envio?.dolar)         || 0,
              peso_real_kg:  Number(p.envio?.peso_real_kg)  || 0,
              medidas_cm:    Array.isArray(p.envio?.medidas_cm) ? p.envio.medidas_cm.map(Number) : [],
            },
            items: p.items.map(it => ({
              descripcion:     String(it.descripcion || '').slice(0, 300),
              color:           String(it.color  || '').slice(0, 80),
              modelo:          String(it.modelo || '').slice(0, 120),
              cantidad:        Number(it.cantidad) || 0,
              precio_unit_usd: Number(it.precio_unit_usd) || 0,
              vol_factor:      Number(it.vol_factor) || 1,
              item_id:         it.item_id     || null,
              variation_id:    it.variation_id || null,
              titulo_ml:       String(it.titulo_ml || '').slice(0, 300),
              variante_ml:     String(it.variante_ml || '').slice(0, 200),
              foto_ml:         String(it.foto_ml || '').slice(0, 400),
            })),
            creado:     idx >= 0 ? (store.pedidos[idx].creado || ahora) : ahora,
            actualizado: ahora,
          };

          if (idx >= 0) store.pedidos[idx] = limpio;
          else store.pedidos.push(limpio);
          savePedidosCostos(store);

          console.log(`[pedidos-costos] ${idx >= 0 ? 'actualizado' : 'creado'} ${limpio.id} — ${limpio.items.length} líneas (stock NO modificado)`);
          json(res, 200, { ok: true, pedido: calcularPedido(limpio) });
        } catch (e) {
          console.error('[pedidos-costos] POST error:', e.message);
          json(res, 500, { error: e.message });
        }
      })();
      return true;
    }

    // DELETE /api/stockroom/pedidos-costos/:id
    if (pathname.startsWith('/api/stockroom/pedidos-costos/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.split('/').pop());
      const store = loadPedidosCostos();
      const antes = (store.pedidos || []).length;
      store.pedidos = (store.pedidos || []).filter(p => p.id !== id);
      if (store.pedidos.length === antes) { json(res, 404, { error: 'Pedido no encontrado' }); return true; }
      savePedidosCostos(store);
      console.log(`[pedidos-costos] borrado ${id}`);
      json(res, 200, { ok: true });
      return true;
    }

    // GET → catálogo plano de variantes para el selector (SOLO LECTURA)
    //
    // Lee las caches POR CUENTA (`cache/items-<id>.json`), que es donde están
    // los datos reales: `cache/items.json` no existe en producción y
    // getProductCache() volvía vacío. Además así entran las dos cuentas, no
    // solo la activa. La etiqueta se arma con attribute_combinations porque
    // estas caches guardan el item crudo de ML (no traen `varLabel`).
    if (pathname === '/api/stockroom/pedidos-costos/variantes-catalogo' && req.method === 'GET') {
      try {
        const out = [];
        const vistos = new Set();
        const pushItem = (it, cuenta) => {
          // Foto: la de la variante si tiene picture_ids, si no la principal.
          // Misma resolución que usa el resto del panel.
          const pics = it.pictures || [];
          const fotoItem = pics[0]?.secure_url || pics[0]?.url || it.thumbnail || '';
          const fotoDe = v => {
            const id = v.picture_ids?.[0];
            if (!id) return fotoItem;
            const f = pics.find(p => p.id === id);
            return f?.secure_url || f?.url || fotoItem;
          };
          const vars = Array.isArray(it.variations) ? it.variations : [];
          const filas = vars.length
            ? vars.map(v => ({
                variation_id: String(v.id || ''),
                variante: (v.attribute_combinations || []).map(a => `${a.name}: ${a.value_name}`).join(' · '),
                stock: v.available_quantity ?? null,
                foto: fotoDe(v),
              }))
            : [{ variation_id: '', variante: '', stock: it.available_quantity ?? null, foto: fotoItem }];
          for (const f of filas) {
            const key = `${it.id}::${f.variation_id}`;
            if (vistos.has(key)) continue;      // el mismo item puede estar en dos caches
            vistos.add(key);
            out.push({ item_id: it.id, titulo: it.title || it.id, cuenta, es_funda: esFunda(it.title || ''), ...f });
          }
        };

        let leidas = 0;
        try {
          for (const f of fs.readdirSync(CACHE_DIR)) {
            if (!/^items-.+\.json$/.test(f)) continue;
            const cuenta = f.replace(/^items-|\.json$/g, '');
            try {
              const raw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
              const items = Array.isArray(raw) ? raw : (raw.items || []);
              items.forEach(it => pushItem(it, cuenta));
              leidas++;
            } catch (e) { console.warn(`[pedidos-costos] cache ${f} ilegible:`, e.message); }
          }
        } catch { /* no hay carpeta cache */ }

        // Respaldo: si no había caches por cuenta, usar la global (array, sincrónica)
        if (!leidas && typeof getProductCache === 'function') {
          const g = getProductCache();
          (Array.isArray(g) ? g : (g?.items || [])).forEach(it => pushItem(it, 'activa'));
        }

        out.sort((a, b) => a.titulo.localeCompare(b.titulo));
        json(res, 200, { ok: true, variantes: out, caches: leidas });
      } catch (e) {
        console.error('[pedidos-costos] catálogo:', e.message);
        json(res, 500, { error: e.message });
      }
      return true;
    }

    return false;
  };
};

'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  migrate-products-fn.js
//  Exporta migrateProductsFromCache() para uso programático desde server.js.
//  Comparte el pool singleton de la app — NO llama pool.end().
//  Idempotente, safe para llamar múltiples veces; usa lock para evitar runs
//  concurrentes.
// ═══════════════════════════════════════════════════════════════════════════

const pool = require('./pool');
const fs   = require('fs');
const path = require('path');

// ── Lock: evitar migraciones concurrentes ────────────────────────────────
let _migrationInProgress = false;

// ── Helpers (igual que migrate-products.js) ───────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180);
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('apple watch') || t.includes('iwatch'))       return 'apple-watch';
  if (t.includes('samsung') || t.includes('galaxy watch'))     return 'samsung-watch';
  if (t.includes('xiaomi') || t.includes('amazfit'))           return 'xiaomi';
  if (t.includes('protector') || t.includes('vidrio'))         return 'protectores';
  if (t.includes('funda') || t.includes('carcasa') ||
      t.includes('cover') || t.includes('case iphone'))        return 'fundas';
  if (t.includes('malla') || t.includes('correa') ||
      t.includes('banda') || t.includes('pulsera'))            return 'mallas';
  return null;
}

function parseDims(sizeStr) {
  if (!sizeStr) return { w: null, h: null };
  const [w, h] = (sizeStr || '').split('x').map(n => parseInt(n) || null);
  return { w: w || null, h: h || null };
}

function variantDisplayName(attrCombinations) {
  if (!Array.isArray(attrCombinations) || !attrCombinations.length) return null;
  return attrCombinations
    .filter(a => a.value_name)
    .map(a => a.value_name)
    .join(' / ');
}

function attrCombToMap(attrCombinations) {
  const map = {};
  if (!Array.isArray(attrCombinations)) return map;
  for (const a of attrCombinations) {
    if (a.id && a.value_name) {
      map[a.id.toLowerCase()] = a.value_name;
    }
  }
  return map;
}

// ── Carga del cache ───────────────────────────────────────────────────────
function loadCache() {
  const candidates = [
    path.join(__dirname, '..', 'cache', 'items.json'),
    path.join(__dirname, '..', 'items.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw.items)) return raw.items;
    }
  }
  throw new Error('No se encontró cache/items.json');
}

// ── Migrar un item ML (transacción por item) ──────────────────────────────
async function migrateItem(item, catIdBySlug, pgPool, counters) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const mlId       = item.id;
    const hasVars    = Array.isArray(item.variations) && item.variations.length > 0;
    const catSlug    = detectCategory(item.title);
    const categoryId = catSlug ? catIdBySlug[catSlug] : null;

    const baseSlug = slugify(item.title || mlId);
    const slug     = baseSlug ? `${baseSlug}-${mlId.toLowerCase()}` : mlId.toLowerCase();

    let basePrice = parseFloat(item.price) || 0;
    if (hasVars) {
      const varPrices = item.variations
        .map(v => parseFloat(v.price))
        .filter(p => p > 0);
      if (varPrices.length) basePrice = Math.min(...varPrices);
    }

    // ── Upsert products ───────────────────────────────────────────────────
    const prodResult = await client.query(
      `INSERT INTO products (
         slug, name, base_price, currency,
         category_id, has_variants,
         stock, status,
         sold_count, is_bestseller,
         ml_listing_id, ml_account_code, ml_synced_at,
         published_at,
         metadata
       ) VALUES (
         $1, $2, $3, 'ARS',
         $4, $5,
         $6, 'active'::product_status,
         $7, $8,
         $9, 'wz', NOW(),
         NOW(),
         $10
       )
       ON CONFLICT (ml_listing_id) DO UPDATE SET
         name          = EXCLUDED.name,
         base_price    = EXCLUDED.base_price,
         has_variants  = EXCLUDED.has_variants,
         stock         = CASE WHEN EXCLUDED.has_variants THEN products.stock ELSE EXCLUDED.stock END,
         sold_count    = EXCLUDED.sold_count,
         is_bestseller = EXCLUDED.is_bestseller,
         category_id   = COALESCE(EXCLUDED.category_id, products.category_id),
         ml_synced_at  = NOW(),
         updated_at    = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        slug,
        (item.title || '').trim().slice(0, 200),
        basePrice,
        categoryId,
        hasVars,
        hasVars ? 0 : (parseInt(item.available_quantity) || 0),
        parseInt(item.sold_quantity) || 0,
        (item.sold_quantity || 0) >= 50,
        mlId,
        JSON.stringify({ ml_raw: { status: item.status, health: item.health } }),
      ]
    );

    const productId    = prodResult.rows[0].id;
    const wasInserted  = prodResult.rows[0].inserted;
    if (wasInserted) counters.onProdInserted(); else counters.onProdUpdated();

    // ── Variantes ─────────────────────────────────────────────────────────
    if (hasVars) {
      for (let i = 0; i < item.variations.length; i++) {
        const v      = item.variations[i];
        const mlVarId = v.id && /^\d+$/.test(String(v.id)) ? BigInt(v.id) : null;
        const vPrice  = parseFloat(v.price) || basePrice;
        const vStock  = parseInt(v.available_quantity) || 0;
        const vName   = variantDisplayName(v.attribute_combinations);
        const vAttrs  = attrCombToMap(v.attribute_combinations);
        const vSku    = v.seller_custom_field
          ? `${mlId}-${v.seller_custom_field}`.slice(0, 48)
          : (v.id && String(v.id) !== mlId)
            ? `${String(v.id)}-var`.slice(0, 48)
            : null;

        let varResult;
        if (mlVarId) {
          varResult = await client.query(
            `INSERT INTO product_variants (
               product_id, sku, name,
               ml_variation_id,
               attributes, price, stock,
               is_default, display_order
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (ml_variation_id)
               WHERE ml_variation_id IS NOT NULL
             DO UPDATE SET
               price      = EXCLUDED.price,
               stock      = EXCLUDED.stock,
               name       = COALESCE(EXCLUDED.name, product_variants.name),
               attributes = EXCLUDED.attributes,
               sku        = COALESCE(EXCLUDED.sku, product_variants.sku),
               updated_at = NOW()
             RETURNING id, (xmax = 0) AS inserted`,
            [productId, vSku, vName, mlVarId.toString(), JSON.stringify(vAttrs), vPrice, vStock, i === 0, i]
          );
        } else if (vSku) {
          varResult = await client.query(
            `INSERT INTO product_variants (
               product_id, sku, name,
               attributes, price, stock,
               is_default, display_order
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (sku) DO UPDATE SET
               price      = EXCLUDED.price,
               stock      = EXCLUDED.stock,
               updated_at = NOW()
             RETURNING id, (xmax = 0) AS inserted`,
            [productId, vSku, vName, JSON.stringify(vAttrs), vPrice, vStock, i === 0, i]
          );
        } else {
          const attrsJson = JSON.stringify(vAttrs);
          const { rows: existing } = await client.query(
            `SELECT id FROM product_variants
             WHERE product_id = $1 AND attributes::text = $2
             LIMIT 1`,
            [productId, attrsJson]
          );
          if (!existing.length) {
            varResult = await client.query(
              `INSERT INTO product_variants (
                 product_id, name, attributes, price, stock, is_default, display_order
               ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
               RETURNING id, TRUE AS inserted`,
              [productId, vName, attrsJson, vPrice, vStock, i === 0, i]
            );
          }
        }

        if (varResult && varResult.rows.length > 0) {
          if (varResult.rows[0].inserted) counters.onVarInserted();
          else counters.onVarUpdated();
        }
      }
    } else {
      // Sin variantes → variante "default" para uniformidad
      const vSku = `${mlId}-default`;
      const varResult = await client.query(
        `INSERT INTO product_variants (
           product_id, sku, name,
           attributes, price, stock,
           is_default, display_order
         ) VALUES ($1, $2, 'Default', '{}', $3, $4, TRUE, 0)
         ON CONFLICT (sku) DO UPDATE SET
           price      = EXCLUDED.price,
           stock      = EXCLUDED.stock,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [productId, vSku, basePrice, parseInt(item.available_quantity) || 0]
      );
      if (varResult.rows[0].inserted) counters.onVarInserted();
      else counters.onVarUpdated();
    }

    // ── Imágenes ──────────────────────────────────────────────────────────
    const pictures = Array.isArray(item.pictures) ? item.pictures : [];
    for (let i = 0; i < pictures.length; i++) {
      const pic  = pictures[i];
      const url  = pic.secure_url || pic.url;
      const dims = parseDims(pic.max_size || pic.size);
      if (!url) continue;

      if (pic.id) {
        const imgRes = await client.query(
          `INSERT INTO product_images (
             product_id, ml_picture_id,
             url, thumbnail_url,
             display_order, is_primary,
             width, height
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (ml_picture_id)
             WHERE ml_picture_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [productId, pic.id, url, url, i, i === 0, dims.w, dims.h]
        );
        if (imgRes.rowCount > 0) counters.onImgInserted();
      } else {
        await client.query(
          `INSERT INTO product_images (
             product_id, url, thumbnail_url,
             display_order, is_primary, width, height
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING`,
          [productId, url, url, i, i === 0, dims.w, dims.h]
        );
        counters.onImgInserted();
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Función exportada ─────────────────────────────────────────────────────
/**
 * Migra productos desde cache/items.json a la base de datos.
 * Idempotente — se puede llamar múltiples veces.
 * Usa lock para evitar runs concurrentes (el segundo retorna stats vacías).
 *
 * @returns {Promise<{inserted: number, updated: number, errors: number}>}
 */
async function migrateProductsFromCache() {
  if (_migrationInProgress) {
    console.log('  ⏭ [migrate-fn] Migración ya en progreso, saltando.');
    return { inserted: 0, updated: 0, errors: 0 };
  }
  _migrationInProgress = true;

  let prodInserted = 0, prodUpdated = 0, errors = 0;
  let varInserted  = 0, varUpdated  = 0, imgInserted = 0;

  try {
    const items = loadCache();

    const { rows: catRows } = await pool.query('SELECT id, slug FROM categories');
    const catIdBySlug = {};
    catRows.forEach(r => { catIdBySlug[r.slug] = r.id; });

    const counters = {
      onProdInserted: () => prodInserted++,
      onProdUpdated:  () => prodUpdated++,
      onVarInserted:  () => varInserted++,
      onVarUpdated:   () => varUpdated++,
      onImgInserted:  () => imgInserted++,
    };

    for (const item of items) {
      try {
        await migrateItem(item, catIdBySlug, pool, counters);
      } catch (err) {
        console.warn(`  ⚠ [migrate-fn] Error en ${item.id}: ${err.message}`);
        errors++;
      }
    }

    console.log(
      `  ✓ [migrate-fn] Productos: +${prodInserted} nuevos, ~${prodUpdated} actualizados` +
      ` | Variantes: +${varInserted}/~${varUpdated}` +
      ` | Imágenes: +${imgInserted}` +
      (errors ? ` | ⚠ ${errors} errores` : '')
    );
  } catch (err) {
    console.error('  ✗ [migrate-fn] Error fatal en migración:', err.message);
    errors++;
  } finally {
    _migrationInProgress = false;
  }

  return { inserted: prodInserted, updated: prodUpdated, errors };
}

module.exports = { migrateProductsFromCache };

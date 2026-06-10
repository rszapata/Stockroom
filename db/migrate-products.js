#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  WZMALLAS — Migración de productos ML → PostgreSQL
//  Uso: node db/migrate-products.js
//
//  Lee cache/items.json (generado por /api/tienda/sync) y vuelca todos los
//  productos, variantes e imágenes a la DB.
//  IDEMPOTENTE: se puede correr múltiples veces — actualiza precios y stock.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Conexión con usuario de app (tiene permisos de DML) ──────────────────
const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB       || 'wzmallas',
  user:     process.env.PG_USER     || 'wzmallas_app',
  password: process.env.PG_PASS     || 'wzapp2026',
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Convierte un texto en slug URL-safe */
function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')                         // descompone tildes
    .replace(/[̀-ͯ]/g, '')           // elimina diacríticos
    .replace(/[^\w\s-]/g, ' ')                // elimina no-alfanuméricos
    .replace(/\s+/g, '-')                     // espacios → guiones
    .replace(/-+/g, '-')                      // guiones dobles → uno
    .replace(/^-|-$/g, '')                    // trim guiones
    .slice(0, 180);                           // límite
}

/** Mapea el título de un item ML a una categoría de tienda */
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
  return null; // sin categoría específica
}

/** Extrae dimensiones de un string de ML como "500x500" → {w, h} */
function parseDims(sizeStr) {
  if (!sizeStr) return { w: null, h: null };
  const [w, h] = (sizeStr || '').split('x').map(n => parseInt(n) || null);
  return { w: w || null, h: h || null };
}

/** Extrae el nombre legible de las attribute_combinations de una variante ML */
function variantDisplayName(attrCombinations) {
  if (!Array.isArray(attrCombinations) || !attrCombinations.length) return null;
  return attrCombinations
    .filter(a => a.value_name)
    .map(a => a.value_name)
    .join(' / ');
}

/** Convierte attribute_combinations a objeto JSONB {color: "Negro", ...} */
function attrCombToMap(attrCombinations) {
  const map = {};
  if (!Array.isArray(attrCombinations)) return map;
  for (const a of attrCombinations) {
    if (a.id && a.value_name) {
      // Normalizar el key: BAND_WIDTH → band_width, COLOR → color
      const key = a.id.toLowerCase();
      map[key] = a.value_name;
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
  throw new Error('No se encontró cache/items.json. Corré primero el sync desde tienda-admin.html.');
}

// ── Preparar constraints necesarios para ON CONFLICT ─────────────────────
async function ensureConstraints(pool) {
  // ml_listing_id debe ser UNIQUE para el ON CONFLICT (ml_listing_id)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'products'::regclass
          AND contype = 'u'
          AND conname = 'products_ml_listing_id_key'
      ) THEN
        ALTER TABLE products ADD CONSTRAINT products_ml_listing_id_key
          UNIQUE (ml_listing_id);
      END IF;
    END $$;
  `);
  // Unique index en product_images.ml_picture_id (parcial — solo si NOT NULL)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_images_ml_picture
      ON product_images(ml_picture_id)
      WHERE ml_picture_id IS NOT NULL;
  `);
  // Unique index en product_variants.ml_variation_id (parcial)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_ml_var_id
      ON product_variants(ml_variation_id)
      WHERE ml_variation_id IS NOT NULL;
  `);
}

// ── Migración principal ───────────────────────────────────────────────────
async function migrate() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  WZMALLAS — Migración de productos ML → PostgreSQL');
  console.log('═══════════════════════════════════════════════════\n');

  // Los constraints/índices únicos se crean una vez con:
  //   psql -U postgres -d wzmallas -f db/setup-product-constraints.sql
  // (o se pasan como parte del deploy). Si no existen, el upsert falla con
  // un error descriptivo — no se pierden datos.

  const items = loadCache();
  console.log(`  Leyendo ${items.length} items del cache\n`);

  // Pre-cargar IDs de categorías para FK
  const { rows: catRows } = await pool.query('SELECT id, slug FROM categories');
  const catIdBySlug = {};
  catRows.forEach(r => { catIdBySlug[r.slug] = r.id; });
  console.log(`  Categorías disponibles: ${Object.keys(catIdBySlug).join(', ')}\n`);

  // Contadores
  let prodInserted = 0, prodUpdated = 0;
  let varInserted  = 0, varUpdated  = 0;
  let imgInserted  = 0;
  let errors       = 0;

  for (const item of items) {
    try {
      await migrateItem(item, catIdBySlug, pool, {
        onProdInserted: () => prodInserted++,
        onProdUpdated:  () => prodUpdated++,
        onVarInserted:  () => varInserted++,
        onVarUpdated:   () => varUpdated++,
        onImgInserted:  () => imgInserted++,
      });
    } catch (err) {
      console.error(`  ✗ Error en ${item.id} (${item.title?.slice(0, 40)}): ${err.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('  Productos insertados: ', prodInserted);
  console.log('  Productos actualizados:', prodUpdated);
  console.log('  Variantes insertadas: ', varInserted);
  console.log('  Variantes actualizadas:', varUpdated);
  console.log('  Imágenes insertadas:  ', imgInserted);
  console.log('  Errores:              ', errors);
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
}

// ── Migrar un item ML ─────────────────────────────────────────────────────
async function migrateItem(item, catIdBySlug, pool, counters) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mlId       = item.id;
    const hasVars    = Array.isArray(item.variations) && item.variations.length > 0;
    const catSlug    = detectCategory(item.title);
    const categoryId = catSlug ? catIdBySlug[catSlug] : null;

    // ── Slug único: title-slug + mlId (garantiza unicidad global) ─────────
    const baseSlug = slugify(item.title || mlId);
    const slug     = baseSlug ? `${baseSlug}-${mlId.toLowerCase()}` : mlId.toLowerCase();

    // ── Precio base: mínimo de las variantes (o base del item) ────────────
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

    // ON CONFLICT → (xmax = 0) es TRUE sólo en INSERT (no UPDATE)
    // Nota: en Postgres, xmax=0 indica que la fila es nueva en esta transacción
    const productId = prodResult.rows[0].id;
    const wasInserted = prodResult.rows[0].inserted;
    if (wasInserted) counters.onProdInserted(); else counters.onProdUpdated();

    // ── Variantes ─────────────────────────────────────────────────────────
    if (hasVars) {
      for (let i = 0; i < item.variations.length; i++) {
        const v        = item.variations[i];
        // ML variation IDs son numéricos (177969563847), pero algunos items
        // devuelven IDs con formato string "MLA..." → solo convertir si es numérico
        // ML variation IDs son numéricos (177969563847), pero los family-merged
        // usan el listing ID como variation.id → no convertir si no es numérico
        const mlVarId = v.id && /^\d+$/.test(String(v.id)) ? BigInt(v.id) : null;
        const vPrice   = parseFloat(v.price) || basePrice;
        const vStock   = parseInt(v.available_quantity) || 0;
        const vName    = variantDisplayName(v.attribute_combinations);
        const vAttrs   = attrCombToMap(v.attribute_combinations);
        // SKU: seller_custom_field > v.id (listing id de la variante merged) > null
        const vSku     = v.seller_custom_field
          ? `${mlId}-${v.seller_custom_field}`.slice(0, 48)
          : (v.id && String(v.id) !== mlId)
            ? `${String(v.id)}-var`.slice(0, 48)
            : null;

        let varResult;
        if (mlVarId) {
          // Upsert por ml_variation_id (más confiable que SKU)
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
               price           = EXCLUDED.price,
               stock           = EXCLUDED.stock,
               name            = COALESCE(EXCLUDED.name, product_variants.name),
               attributes      = EXCLUDED.attributes,
               sku             = COALESCE(EXCLUDED.sku, product_variants.sku),
               updated_at      = NOW()
             RETURNING id, (xmax = 0) AS inserted`,
            [productId, vSku, vName, mlVarId.toString(), JSON.stringify(vAttrs), vPrice, vStock, i === 0, i]
          );
        } else if (vSku) {
          // Fallback: upsert por sku
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
          // Sin identificadores únicos: solo insertar si no hay variante con
          // idénticos atributos para este producto (check separado para evitar type ambiguity)
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
      // Producto sin variantes → upsert variante "default" para uniformidad
      const vSku = `${mlId}-default`;
      const varResult = await client.query(
        `INSERT INTO product_variants (
           product_id, sku, name,
           attributes, price, stock,
           is_default, display_order
         ) VALUES (
           $1, $2, 'Default', '{}', $3, $4, TRUE, 0
         )
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

    // ── Imágenes — solo insertar (no borrar las existentes) ───────────────
    const pictures = Array.isArray(item.pictures) ? item.pictures : [];
    for (let i = 0; i < pictures.length; i++) {
      const pic  = pictures[i];
      const url  = pic.secure_url || pic.url;
      const dims = parseDims(pic.max_size || pic.size);
      if (!url) continue;

      if (pic.id) {
        // Con ml_picture_id → upsert idempotente usando unique index
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
        // Sin ml_picture_id → insertar solo si es un producto nuevo
        // (evitar duplicados en re-runs al no tener key)
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

// ── Punto de entrada ──────────────────────────────────────────────────────
migrate().catch(err => {
  console.error('\n✗ Migración fallida:', err.message);
  console.error(err.stack);
  process.exit(1);
});

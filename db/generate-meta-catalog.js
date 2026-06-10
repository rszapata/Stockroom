'use strict';
// Genera wzmallas_catalog_meta.csv para subir al catálogo de Meta / WhatsApp Business

const pool = require('./pool');
const fs   = require('fs');

const TIENDA_URL = 'https://wzmallas.com';
const OUT_PATH   = 'C:/Users/frexz1/Downloads/wzmallas_catalog_meta.csv';

const googleCat = {
  'apple-watch':  'Electronics > Communications > Telephony > Mobile Phones > Smartphone Accessories',
  'samsung-watch':'Electronics > Communications > Telephony > Mobile Phones > Smartphone Accessories',
  'xiaomi':       'Electronics > Communications > Telephony > Mobile Phones > Smartphone Accessories',
  'mallas':       'Apparel & Accessories > Jewelry > Watch Bands & Straps',
  'fundas':       'Electronics > Communications > Telephony > Mobile Phones > Smartphone Accessories > Cases & Covers',
  'protectores':  'Electronics > Communications > Telephony > Mobile Phones > Smartphone Accessories',
};
const fbCat = {
  'apple-watch':  'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
  'samsung-watch':'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
  'xiaomi':       'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
  'mallas':       'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
  'fundas':       'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
  'protectores':  'Electronics & Gadgets > Wearable Technology > Smartwatch Accessories',
};
const catSuffix = {
  'apple-watch':  'Compatible con Apple Watch.',
  'samsung-watch':'Compatible con Samsung Galaxy Watch.',
  'xiaomi':       'Compatible con relojes Xiaomi y Amazfit.',
  'mallas':       'Malla / correa para reloj inteligente.',
  'fundas':       'Funda protectora para smartwatch.',
  'protectores':  'Protector de pantalla para smartwatch.',
};

function buildDesc(name, catSlug) {
  const suffix = catSuffix[catSlug] || 'Accesorio para smartwatch.';
  return (name || '').trim() + '. ' + suffix + ' Marca WZMALLAS. Envio a todo el pais.';
}

function escCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function fmtPrice(n) {
  return parseFloat(n || 0).toFixed(2) + ' ARS';
}

async function main() {
  const { rows: products } = await pool.query(`
    SELECT p.id, p.ml_listing_id, p.name, p.base_price, p.stock, p.has_variants,
           c.slug AS cat_slug,
           pi.url AS img_url
    FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = TRUE
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL AND p.status = 'active'
    ORDER BY p.name
  `);

  const { rows: variants } = await pool.query(`
    SELECT pv.product_id, pv.sku, pv.name AS var_name,
           pv.price, pv.stock, pv.attributes, pv.display_order
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE p.deleted_at IS NULL AND p.status = 'active'
    ORDER BY pv.product_id, pv.display_order
  `);

  const varByProd = {};
  for (const v of variants) {
    if (!varByProd[v.product_id]) varByProd[v.product_id] = [];
    varByProd[v.product_id].push(v);
  }

  const header = [
    'id','title','description','availability','condition','price','link','image_link','brand',
    'google_product_category','fb_product_category','quantity_to_sell_on_facebook',
    'sale_price','sale_price_effective_date','item_group_id',
    'gender','color','size','age_group','material','pattern',
    'shipping','shipping_weight','offer_disclaimer','offer_disclaimer_url',
    'video[0].url','video[0].tag[0]','gtin','product_tags[0]','product_tags[1]','style[0]'
  ];

  const csvRows = [header.join(',')];

  for (const prod of products) {
    const prodVars = varByProd[prod.id] || [];
    const link  = `${TIENDA_URL}/tienda/producto.html?id=${prod.ml_listing_id}`;
    const gCat  = googleCat[prod.cat_slug] || googleCat['mallas'];
    const fCat  = fbCat[prod.cat_slug]     || fbCat['mallas'];
    const img   = prod.img_url || '';
    const desc  = buildDesc(prod.name, prod.cat_slug);
    const tag0  = prod.cat_slug || 'smartwatch';

    if (prod.has_variants && prodVars.length > 0) {
      for (const v of prodVars) {
        const attrs  = v.attributes || {};
        const color  = attrs.color || '';
        const size   = attrs.band_width || attrs.size || attrs.talle || '';
        const avail  = parseInt(v.stock) > 0 ? 'in stock' : 'out of stock';
        const qty    = Math.max(0, parseInt(v.stock) || 0);
        const varId  = v.sku || `${prod.ml_listing_id}-${v.display_order}`;
        const price  = fmtPrice(v.price || prod.base_price);

        csvRows.push([
          varId, prod.name, desc, avail, 'new', price, link, img, 'WZMALLAS',
          gCat, fCat, qty,
          '', '', prod.ml_listing_id,       // sale_price, sale_date, item_group_id
          'unisex', color, size, 'adult', 'silicone', '',
          'AR::Standard:0.00 ARS',           // envío gratis
          '', '', '', '', '', '', tag0, 'mallas-correas', ''
        ].map(escCsv).join(','));
      }
    } else {
      const avail = parseInt(prod.stock) > 0 ? 'in stock' : 'out of stock';
      const qty   = Math.max(0, parseInt(prod.stock) || 0);

      csvRows.push([
        prod.ml_listing_id, prod.name, desc, avail, 'new',
        fmtPrice(prod.base_price), link, img, 'WZMALLAS',
        gCat, fCat, qty,
        '', '', '',                          // sin item_group_id (no tiene variantes)
        'unisex', '', '', 'adult', 'silicone', '',
        'AR::Standard:0.00 ARS',
        '', '', '', '', '', '', tag0, 'mallas-correas', ''
      ].map(escCsv).join(','));
    }
  }

  fs.writeFileSync(OUT_PATH, csvRows.join('\n'), 'utf8');

  const dataRows = csvRows.length - 1;
  console.log(`\n✓ CSV generado: ${OUT_PATH}`);
  console.log(`  Productos procesados : ${products.length}`);
  console.log(`  Filas totales (incl. variantes): ${dataRows}`);
  console.log(`  Productos con variantes : ${products.filter(p => p.has_variants).length}`);
  console.log(`  Productos sin variantes : ${products.filter(p => !p.has_variants).length}`);

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

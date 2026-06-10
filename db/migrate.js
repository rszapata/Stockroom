// ── db/migrate.js ─────────────────────────────────────────────
// Importa los datos de tienda-users.json y ordenes.json a PostgreSQL.
// Es IDEMPOTENTE: usa ON CONFLICT DO NOTHING para no duplicar.
//
// Uso: node db/migrate.js
// ─────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Migración usa credenciales de admin (postgres) porque wzmallas_app
// puede no tener permisos DML al momento de la primera ejecución.
const pool = new Pool({
  host:     'localhost',
  port:     5432,
  database: 'wzmallas',
  user:     process.env.PG_MIGRATE_USER || 'postgres',
  password: process.env.PG_MIGRATE_PASS || 'wzmallas2026',
});

const USERS_PATH   = path.join(__dirname, '..', 'tienda-users.json');
const ORDENES_PATH = path.join(__dirname, '..', 'ordenes.json');

// ── Utilidades ────────────────────────────────────────────────
function loadJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  ⚠ No se pudo leer ${filePath}: ${e.message}`);
    return [];
  }
}

function mapStatus(old) {
  const map = {
    pendiente:       'pending',
    pendiente_pago:  'pending',
    pagado:          'paid',
    preparacion:     'processing',
    enviado:         'shipped',
    entregado:       'delivered',
    cancelado:       'cancelled',
  };
  return map[old] || 'pending';
}

function mapPaymentStatus(old) {
  const map = {
    pendiente:      'pending',
    pendiente_pago: 'pending',
    pagado:         'paid',
    entregado:      'paid',
  };
  return map[old] || 'pending';
}

// ── Migrar usuarios ───────────────────────────────────────────
async function migrateUsers(client) {
  const users = loadJSON(USERS_PATH);
  if (!users.length) { console.log('  → Sin usuarios para migrar'); return {}; }

  let ok = 0, skip = 0;
  const idMap = {};  // old hex id → new UUID

  for (const u of users) {
    const addr = {
      direccion: u.direccion || '',
      altura:    u.altura    || '',
      piso:      u.piso      || '',
      provincia: u.provincia || '',
      ciudad:    u.ciudad    || '',
      cp:        u.cp        || '',
    };
    const metadata = {
      migrated_from_json: true,
      old_id: u.id,
      address: addr,
    };

    try {
      const { rows } = await client.query(
        `INSERT INTO users
           (nombre, email, password_hash, password_salt, telefono,
            status, acepta_terms, login_count,
            created_at, last_login_at, updated_at, metadata)
         VALUES ($1,$2,$3,$4,$5,'active',true,1,$6,$7,$8,$9)
         ON CONFLICT (email) DO UPDATE SET
           metadata = EXCLUDED.metadata || users.metadata
         RETURNING id, email`,
        [
          u.nombre        || '',
          u.email,
          u.password_hash || '',
          u.salt          || '',
          u.telefono      || '',
          u.created_at    ? new Date(u.created_at) : new Date(),
          u.last_login    ? new Date(u.last_login) : new Date(),
          u.updated_at    ? new Date(u.updated_at) : new Date(),
          JSON.stringify(metadata),
        ]
      );
      idMap[u.id] = rows[0].id;
      ok++;
      console.log(`  ✓ Usuario: ${u.email} → ${rows[0].id}`);
    } catch (err) {
      skip++;
      console.warn(`  ✗ Usuario ${u.email}: ${err.message}`);
    }
  }
  console.log(`  ► Usuarios: ${ok} migrados, ${skip} omitidos\n`);
  return idMap;
}

// ── Migrar órdenes ────────────────────────────────────────────
async function migrateOrdenes(client, userIdMap) {
  const ordenes = loadJSON(ORDENES_PATH);
  if (!ordenes.length) { console.log('  → Sin órdenes para migrar'); return; }

  let ok = 0, skip = 0;

  for (const o of ordenes) {
    const d      = o.datos    || o.cliente || {};
    const envio  = o.envio    || {};
    const pago   = o.pago     || {};
    const items  = o.items    || [];
    const total  = Number(o.total) || 0;
    const shippingCost = Number(envio.precio) || 0;
    const subtotal = total - shippingCost;

    // Buscar user_id por email
    let userId = null;
    if (d.email) {
      // Primero por map de migración, luego en DB
      const byMap = Object.entries(userIdMap).find(([,v]) => {
        // no tenemos email aquí, buscar en DB
      });
      const { rows } = await client.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [d.email]
      );
      if (rows[0]) userId = rows[0].id;
    }

    const metadata = {
      migrated_from_json: true,
      old_id: o.id,
      raw:    o,
    };
    if (o.mp_preference_id) metadata.mp_preference_id = o.mp_preference_id;

    try {
      // Verificar si ya existe
      const { rows: existing } = await client.query(
        'SELECT id FROM orders WHERE order_number = $1 LIMIT 1',
        [o.id]
      );
      if (existing[0]) {
        skip++;
        continue;
      }

      const { rows: [orderRow] } = await client.query(
        `INSERT INTO orders (
           order_number, user_id, is_guest,
           customer_email, customer_name, customer_phone,
           shipping_calle, shipping_piso,
           shipping_ciudad, shipping_provincia, shipping_cp,
           shipping_method_name, shipping_carrier, shipping_total,
           payment_method,
           subtotal, total, items_count, items_quantity,
           status, payment_status,
           paid_at, delivered_at, cancelled_at,
           created_at, metadata
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
           $12,$13,$14,$15,$16,$17,$18,$19,
           $20,$21,$22,$23,$24,$25,$26
         ) RETURNING id`,
        [
          o.id,
          userId,
          !userId,
          d.email      || '',
          d.nombre     || '',
          d.telefono   || '',
          d.direccion  || '',
          d.piso       || '',
          d.ciudad     || '',
          d.provincia  || '',
          d.cp         || '',
          envio.nombre   || '',
          envio.empresa  || '',
          shippingCost,
          pago.metodo  || 'mercadopago',
          subtotal,
          total,
          items.length,
          items.reduce((s, i) => s + (i.qty || 1), 0),
          mapStatus(o.status),
          mapPaymentStatus(o.status),
          o.paid_at        ? new Date(o.paid_at)        : null,
          o.delivered_at   ? new Date(o.delivered_at)   : null,
          o.cancelled_at   ? new Date(o.cancelled_at)   : null,
          o.fecha          ? new Date(o.fecha)           : new Date(),
          JSON.stringify(metadata),
        ]
      );

      // Insertar items
      for (const item of items) {
        const unitPrice = Number(item.price) || 0;
        await client.query(
          `INSERT INTO order_items
             (order_id, ml_item_id, product_name, product_image,
              variant_name, quantity, unit_price, total, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
          [
            orderRow.id,
            item.id    || null,
            item.title || '',
            item.img   || null,
            item.variant || null,
            item.qty   || 1,
            unitPrice,
            unitPrice * (item.qty || 1),
          ]
        );
      }

      ok++;
      console.log(`  ✓ Orden: ${o.id} (${o.status}) — $${total}`);
    } catch (err) {
      skip++;
      console.warn(`  ✗ Orden ${o.id}: ${err.message}`);
    }
  }
  console.log(`  ► Órdenes: ${ok} migradas, ${skip} omitidas\n`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Migración JSON → PostgreSQL (WZMALLAS)');
  console.log('══════════════════════════════════════════\n');

  const client = await pool.connect();
  try {
    console.log('── Usuarios ──────────────────────────────');
    const userIdMap = await migrateUsers(client);

    console.log('── Órdenes ───────────────────────────────');
    await migrateOrdenes(client, userIdMap);

    console.log('══════════════════════════════════════════');
    console.log('  ✅ Migración completada');
    console.log('══════════════════════════════════════════\n');
  } catch (err) {
    console.error('  ✗ Error en migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

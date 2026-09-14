// ── db/queries.js ─────────────────────────────────────────────
// Funciones async que reemplazan las operaciones sobre JSON files.
// Mantienen la misma "firma de retorno" que el código original
// para minimizar cambios en server.js.
//
// STATUS MAPPING:
//   El frontend usa status en español (pendiente, pagado, despachado…).
//   La DB usa English enums (pending, paid, shipped…).
//   Las funciones aquí traducen en ambas direcciones.
//   metadata.es_status guarda el status español para filtros exactos.
// ─────────────────────────────────────────────────────────────
const pool = require('./pool');

// ═══════════════════════════════════════════════════════════════
//  STATUS HELPERS
// ═══════════════════════════════════════════════════════════════

/** Español → DB enum */
function statusESToDb(es) {
  const map = {
    pendiente:      'pending',
    pendiente_pago: 'pending',
    pagado:         'paid',
    preparacion:    'paid',    // 'processing' no existe en el enum DB → usar 'paid'
    despachado:     'shipped',
    entregado:      'delivered',
    cancelado:      'cancelled',
    rechazado:      'cancelled',
    reembolsado:    'cancelled',
  };
  return map[es] || es; // pass-through si ya es inglés
}

/** payment_status a guardar según el nuevo status español */
function paymentStatusFromES(es) {
  const map = {
    pagado:      'paid',
    entregado:   'paid',
    rechazado:   'failed',
    reembolsado: 'refunded',
    pendiente_pago: 'pending',
  };
  return map[es] || null;
}

/** Reconstruye el status español desde una fila de orders */
function dbStatusToES(row) {
  // Primero: usar el campo es_status guardado en metadata (fuente de verdad)
  if (row.metadata && row.metadata.es_status) return row.metadata.es_status;

  // Fallback: reconstrucción heurística
  const s  = row.status;
  const ps = row.payment_status;
  const pm = row.payment_method;

  if (s === 'pending' && pm === 'mercadopago') return 'pendiente_pago';
  if (s === 'pending')    return 'pendiente';
  if (s === 'paid')       return 'pagado';
  if (s === 'processing') return 'preparacion';
  if (s === 'shipped')    return 'despachado';
  if (s === 'delivered')  return 'entregado';
  if (s === 'cancelled' && ps === 'failed')   return 'rechazado';
  if (s === 'cancelled' && ps === 'refunded') return 'reembolsado';
  if (s === 'cancelled')  return 'cancelado';
  return s;
}

// ═══════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════

/**
 * Devuelve un user-object compatible con el formato anterior del JSON.
 * Los campos de dirección viven en metadata.address
 */
function rowToUser(row) {
  if (!row) return null;
  const addr = (row.metadata && row.metadata.address) || {};
  return {
    id:            row.id,
    nombre:        row.nombre,
    email:         row.email,
    salt:          row.password_salt,
    password_hash: row.password_hash,
    firebase_uid:     row.firebase_uid     || null,
    auth_provider:    row.auth_provider    || 'local',
    email_verificado: row.email_verificado === true,
    telefono:      row.telefono      || '',
    direccion:     addr.direccion    || '',
    altura:        addr.altura       || '',
    piso:          addr.piso         || '',
    provincia:     addr.provincia    || '',
    ciudad:        addr.ciudad       || '',
    cp:            addr.cp           || '',
    created_at:    row.created_at    ? row.created_at.toISOString() : null,
    last_login:    row.last_login_at ? row.last_login_at.toISOString() : null,
    updated_at:    row.updated_at    ? row.updated_at.toISOString() : null,
  };
}

/** Buscar usuario por email */
async function getUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1',
    [email]
  );
  return rowToUser(rows[0]);
}

/** Buscar usuario por ID (UUID) */
async function getUserById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  return rowToUser(rows[0]);
}

/** Crear nuevo usuario. Devuelve el user-object completo. */
async function createUser({ nombre, email, password_hash, salt }) {
  const { rows } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, password_salt, status, acepta_terms, last_login_at)
     VALUES ($1, $2, $3, $4, 'active', true, NOW())
     RETURNING *`,
    [nombre, email, password_hash, salt]
  );
  return rowToUser(rows[0]);
}

/** Actualizar campos de perfil (nombre, telefono, dirección, contraseña) */
async function updateUser(id, fields) {
  const setClauses = [];
  const params     = [];
  let   pidx       = 1;

  const directFields = ['nombre', 'telefono'];
  for (const f of directFields) {
    if (fields[f] !== undefined) {
      setClauses.push(`${f} = $${pidx++}`);
      params.push(fields[f]);
    }
  }

  // Contraseña (opcional)
  if (fields.password_hash !== undefined) {
    setClauses.push(`password_hash = $${pidx++}`);
    params.push(fields.password_hash);
    setClauses.push(`password_salt = $${pidx++}`);
    params.push(fields.salt);
  }

  // Campos de dirección → dentro de metadata.address (merge con ||)
  const addrFields = ['direccion', 'altura', 'piso', 'provincia', 'ciudad', 'cp'];
  const addrPatch  = {};
  for (const f of addrFields) {
    if (fields[f] !== undefined) addrPatch[f] = fields[f];
  }
  if (Object.keys(addrPatch).length > 0) {
    setClauses.push(`metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{address}',
      COALESCE(metadata->'address', '{}') || $${pidx++}::jsonb
    )`);
    params.push(JSON.stringify(addrPatch));
  }

  if (setClauses.length === 0) return getUserById(id);

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${pidx} AND deleted_at IS NULL RETURNING *`,
    params
  );
  return rowToUser(rows[0]);
}

/** Actualizar last_login_at al timestamp actual */
async function updateLastLogin(id) {
  await pool.query(
    'UPDATE users SET last_login_at = NOW(), login_count = login_count + 1 WHERE id = $1',
    [id]
  );
}

// ── Firebase Auth (modo híbrido — ver PLAN.md FASE 9) ─────────────
// La tabla `users` la creó el admin (postgres) en schema.sql, así que
// wzmallas_app NO puede hacer DDL sobre ella ("must be owner"). La migración
// de columnas se aplica una vez como admin (ver db/migrate-firebase-auth.sql),
// NO en runtime. Esta función queda como referencia/instalación limpia.
async function ensureUsersAuthColumns() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid     TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider    TEXT    NOT NULL DEFAULT 'local'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique ON users (firebase_uid) WHERE firebase_uid IS NOT NULL`);
}

/** Buscar usuario por firebase_uid (o null) */
async function getUserByFirebaseUid(uid) {
  if (!uid) return null;
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL LIMIT 1',
    [uid]
  );
  return rowToUser(rows[0]);
}

/**
 * Vincula un firebase_uid a un usuario existente (cuenta legacy o creada por
 * email antes de migrar). Actualiza también provider y verificación de email.
 */
async function linkFirebaseUid(userId, { firebase_uid, auth_provider, email_verificado }) {
  const { rows } = await pool.query(
    `UPDATE users
        SET firebase_uid     = $2,
            auth_provider    = COALESCE($3, auth_provider),
            email_verificado = COALESCE($4, email_verificado),
            updated_at       = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`,
    [userId, firebase_uid, auth_provider || null,
     typeof email_verificado === 'boolean' ? email_verificado : null]
  );
  return rowToUser(rows[0]);
}

/** Crear un usuario nuevo proveniente de Firebase (sin password local). */
async function createUserFromFirebase({ nombre, email, firebase_uid, auth_provider, email_verificado }) {
  const { rows } = await pool.query(
    `INSERT INTO users (nombre, email, firebase_uid, auth_provider, email_verificado,
                        password_hash, password_salt, status, acepta_terms, last_login_at)
     VALUES ($1, $2, $3, $4, $5, '', '', 'active', true, NOW())
     RETURNING *`,
    [nombre || '', email, firebase_uid, auth_provider || 'firebase', email_verificado === true]
  );
  return rowToUser(rows[0]);
}

// ═══════════════════════════════════════════════════════════════
//  ORDERS
// ═══════════════════════════════════════════════════════════════

/** Convierte una fila de orders + filas de order_items al formato JSON anterior */
function rowsToOrden(orderRow, itemRows) {
  if (!orderRow) return null;
  const o = orderRow;
  return {
    id:     o.order_number,   // el ID legible (el viejo timestamp-id)
    _uuid:  o.id,             // UUID interno
    fecha:  o.created_at ? o.created_at.toISOString() : null,
    status: dbStatusToES(o),  // siempre en español para compatibilidad con frontend
    items: (itemRows || []).map(i => ({
      id:      i.ml_item_id || i.product_sku || '',
      title:   i.product_name,
      price:   Number(i.unit_price),
      img:     i.product_image || '',
      variant: i.variant_name  || null,
      qty:     i.quantity,
    })),
    datos: {
      nombre:    o.customer_name    || '',
      email:     o.customer_email   || '',
      telefono:  o.customer_phone   || '',
      direccion: o.shipping_calle   || '',
      piso:      o.shipping_piso    || '',
      provincia: o.shipping_provincia || '',
      ciudad:    o.shipping_ciudad  || '',
      cp:        o.shipping_cp      || '',
    },
    // Alias legacy — algunos handlers usan orden.cliente
    cliente: {
      nombre:    o.customer_name    || '',
      email:     o.customer_email   || '',
      telefono:  o.customer_phone   || '',
      direccion: o.shipping_calle   || '',
      piso:      o.shipping_piso    || '',
      provincia: o.shipping_provincia || '',
      ciudad:    o.shipping_ciudad  || '',
      cp:        o.shipping_cp      || '',
    },
    envio: {
      nombre:  o.shipping_method_name || '',
      precio:  Number(o.shipping_total) || 0,
      empresa: o.shipping_carrier     || '',
    },
    pago: {
      metodo: o.payment_method || 'mercadopago',
    },
    total:           Number(o.total),
    paid_at:         o.paid_at         ? o.paid_at.toISOString()         : undefined,
    delivered_at:    o.delivered_at    ? o.delivered_at.toISOString()    : undefined,
    cancelled_at:    o.cancelled_at    ? o.cancelled_at.toISOString()    : undefined,
    shipped_at:      o.shipped_at      ? o.shipped_at.toISOString()      : undefined,
    tracking_number: (o.metadata && o.metadata.tracking_number) || null,
    mp_preference_id: (o.metadata && o.metadata.mp_preference_id) || undefined,
    mp_payment_id:    (o.metadata && o.metadata.mp_payment_id)    || null,
    mp_payment_status:(o.metadata && o.metadata.mp_payment_status)|| null,
    notas_admin:      o.admin_notes    || null,
    updated_at:       o.updated_at ? o.updated_at.toISOString() : null,
  };
}

/** Obtener todas las órdenes (con items).
 *  filters.status acepta valores en ESPAÑOL (pendiente, pagado, etc.)
 *  o en inglés (pending, paid, etc.)
 */
async function getOrdenes(filters = {}) {
  let where = 'WHERE 1=1';
  const params = [];
  let pidx = 1;

  if (filters.status) {
    const dbStatus = statusESToDb(filters.status);
    const isSpanish = dbStatus !== filters.status;

    if (isSpanish) {
      // Filtrar por es_status (exacto) o por DB status si es_status no está seteado
      where += ` AND (
        metadata->>'es_status' = $${pidx}
        OR (metadata->>'es_status' IS NULL AND status = $${pidx + 1}::order_status)
      )`;
      params.push(filters.status, dbStatus);
      pidx += 2;
    } else {
      // Valor inglés directo
      where += ` AND status = $${pidx++}::order_status`;
      params.push(filters.status);
    }
  }
  if (filters.email) {
    where += ` AND LOWER(customer_email) = LOWER($${pidx++})`;
    params.push(filters.email);
  }
  if (filters.max_age_days) {
    where += ` AND created_at > NOW() - INTERVAL '${parseInt(filters.max_age_days, 10)} days'`;
  }

  const { rows: orderRows } = await pool.query(
    `SELECT * FROM orders ${where} ORDER BY created_at DESC`,
    params
  );
  if (!orderRows.length) return [];

  // Cargar items en batch
  const orderIds = orderRows.map(r => r.id);
  const { rows: itemRows } = await pool.query(
    'SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY created_at',
    [orderIds]
  );
  const itemsByOrder = {};
  for (const item of itemRows) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push(item);
  }

  return orderRows.map(o => rowsToOrden(o, itemsByOrder[o.id] || []));
}

/** Obtener una orden por su order_number (el viejo id de timestamp) o UUID */
async function getOrdenById(idOrUuid) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(idOrUuid);
  const col    = isUuid ? 'id' : 'order_number';
  const { rows: [o] } = await pool.query(
    `SELECT * FROM orders WHERE ${col} = $1 LIMIT 1`,
    [idOrUuid]
  );
  if (!o) return null;
  const { rows: items } = await pool.query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
    [o.id]
  );
  return rowsToOrden(o, items);
}

/** Genera un número de orden legible: WZ-YYMMDD-XXXX (4 caracteres alfanuméricos). */
function generarOrderNumber() {
  const d  = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WZ-${yy}${mm}${dd}-${rand}`;
}

/** Crear nueva orden. Recibe el mismo objeto que antes se guardaba en JSON. */
async function createOrden(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let orderNumber = data.id;
    if (!orderNumber) {
      for (let i = 0; i < 5; i++) {
        const candidate = generarOrderNumber();
        const { rows } = await client.query('SELECT 1 FROM orders WHERE order_number = $1', [candidate]);
        if (!rows.length) { orderNumber = candidate; break; }
      }
      if (!orderNumber) orderNumber = generarOrderNumber() + Date.now().toString(36).slice(-2).toUpperCase();
    }
    const d           = data.datos    || data.cliente || {};
    const envio       = data.envio    || {};
    const pago        = data.pago     || {};
    const items       = data.items    || [];
    const total       = Number(data.total) || 0;
    const shippingCost = Number(envio.precio) || 0;
    const subtotal    = total - shippingCost;

    // Calcular es_status inicial
    const esStatus = (pago.metodo === 'mercadopago') ? 'pendiente_pago' : 'pendiente';

    // Buscar user_id si existe
    let userId = null;
    if (d.email) {
      const { rows } = await client.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1',
        [d.email]
      );
      if (rows[0]) userId = rows[0].id;
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
         created_at, metadata,
         coupon_code, coupon_discount
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14,
         $15,
         $16, $17, $18, $19,
         'pending', 'pending',
         NOW(), $20,
         $21, $22
       ) RETURNING *`,
      [
        orderNumber,
        userId,
        !userId,
        d.email   || '',
        d.nombre  || '',
        d.telefono || '',
        d.direccion || '',
        d.piso    || '',
        d.ciudad  || '',
        d.provincia || '',
        d.cp      || '',
        envio.nombre   || '',
        envio.empresa  || '',
        shippingCost,
        pago.metodo || 'mercadopago',
        subtotal,
        total,
        items.length,
        items.reduce((s, i) => s + (i.qty || 1), 0),
        JSON.stringify({ raw: data, es_status: esStatus }),
        pago.cupon || null,
        Number(pago.descuento_cupon || pago.descuento_envio || 0),
      ]
    );

    // Insertar order_items
    for (const item of items) {
      const unitPrice = Number(item.price) || 0;
      await client.query(
        `INSERT INTO order_items
           (order_id, ml_item_id, product_name, product_image,
            variant_name, quantity, unit_price, total, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
          orderRow.id,
          item.id   || null,
          item.title || '',
          item.img  || null,
          item.variant || null,
          item.qty  || 1,
          unitPrice,
          unitPrice * (item.qty || 1),
        ]
      );
    }

    // Actualizar contadores del usuario si aplica
    if (userId) {
      await client.query(
        `UPDATE users
         SET orders_count = orders_count + 1,
             total_spent  = total_spent + $1,
             last_order_at = NOW()
         WHERE id = $2`,
        [total, userId]
      );
    }

    await client.query('COMMIT');
    return rowsToOrden(orderRow, []);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Actualizar status de una orden.
 * newStatus puede ser en español (pagado, despachado…) o inglés (paid, shipped…).
 * extraFields: { payment_status, mp_preference_id, admin_notes, tracking_number,
 *               mp_payment_id, mp_payment_status, mp_payment_amount, mp_payment_method }
 */
async function updateOrdenStatus(idOrUuid, newStatus, extraFields = {}) {
  const isUuid  = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(idOrUuid);
  const col     = isUuid ? 'id' : 'order_number';
  const dbStatus = statusESToDb(newStatus);

  const setClauses = [`status = $1::order_status`];
  const params     = [dbStatus];
  let   pidx       = 2;

  // Timestamps automáticos según status español
  const tsMap = {
    pagado:      'paid_at',
    entregado:   'delivered_at',
    cancelado:   'cancelled_at',
    rechazado:   'cancelled_at',
    reembolsado: 'cancelled_at',
    preparacion: 'preparing_at',
    despachado:  'shipped_at',
  };
  if (tsMap[newStatus]) {
    setClauses.push(`${tsMap[newStatus]} = NOW()`);
  }

  // payment_status: explícito en extraFields, o calculado desde el status español
  const payStatus = extraFields.payment_status || paymentStatusFromES(newStatus);
  if (payStatus) {
    setClauses.push(`payment_status = $${pidx++}::payment_status`);
    params.push(payStatus);
  }

  // Campos que van a metadata (merge con ||)
  const metaPatch = { es_status: newStatus };  // siempre guardamos es_status
  if (extraFields.mp_preference_id)  metaPatch.mp_preference_id  = extraFields.mp_preference_id;
  if (extraFields.mp_payment_id)     metaPatch.mp_payment_id      = extraFields.mp_payment_id;
  if (extraFields.mp_payment_status) metaPatch.mp_payment_status  = extraFields.mp_payment_status;
  if (extraFields.mp_payment_amount) metaPatch.mp_payment_amount  = extraFields.mp_payment_amount;
  if (extraFields.mp_payment_method) metaPatch.mp_payment_method  = extraFields.mp_payment_method;
  if (extraFields.tracking_number !== undefined) metaPatch.tracking_number = extraFields.tracking_number;

  setClauses.push(`metadata = COALESCE(metadata,'{}') || $${pidx++}::jsonb`);
  params.push(JSON.stringify(metaPatch));

  if (extraFields.admin_notes !== undefined) {
    setClauses.push(`admin_notes = $${pidx++}`);
    params.push(extraFields.admin_notes);
  }

  params.push(idOrUuid);
  const { rows: [o] } = await pool.query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE ${col} = $${pidx} RETURNING *`,
    params
  );
  if (!o) return null;
  return getOrdenById(o.id);
}

/** Órdenes de un usuario por email */
async function getOrdenesByEmail(email) {
  return getOrdenes({ email });
}

/** Órdenes pendientes de pago (para polling de MP) */
async function getOrdenesPendientesPago() {
  // Las preferencias MP expiran a los 5 días; no tiene sentido pollear más allá de eso
  return getOrdenes({ status: 'pendiente_pago', max_age_days: 7 });
}

/**
 * Órdenes con filtrado y paginación en SQL — evita cargar todo en memoria.
 * @param {object} opts  { status?, q?, limit?, offset? }
 * @returns {{ ordenes: Orden[], total: number }}
 */
async function getOrdenesFiltered({ status, q, limit = 50, offset = 0 } = {}) {
  const params = [];
  let pidx = 1;
  const conditions = [];

  if (status && status !== 'all') {
    const dbStatus = statusESToDb(status);
    const isSpanish = dbStatus !== status;
    if (isSpanish) {
      conditions.push(`(metadata->>'es_status' = $${pidx} OR (metadata->>'es_status' IS NULL AND status = $${pidx+1}::order_status))`);
      params.push(status, dbStatus);
      pidx += 2;
    } else {
      conditions.push(`status = $${pidx++}::order_status`);
      params.push(status);
    }
  }

  if (q) {
    // Búsqueda por email, nombre (en datos JSON) o order_number
    conditions.push(`(
      LOWER(customer_email) LIKE $${pidx}
      OR LOWER(order_number) LIKE $${pidx}
      OR LOWER(customer_data::text) LIKE $${pidx}
    )`);
    params.push('%' + q.toLowerCase() + '%');
    pidx++;
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  // Total filtrado (sin paginación)
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total FROM orders ${where}`, params
  );
  const total = parseInt(countRows[0].total, 10);

  // Órdenes paginadas
  const { rows: orderRows } = await pool.query(
    `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT $${pidx} OFFSET $${pidx+1}`,
    [...params, limit, offset]
  );

  if (!orderRows.length) return { ordenes: [], total };

  const orderIds = orderRows.map(r => r.id);
  const { rows: itemRows } = await pool.query(
    'SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY created_at',
    [orderIds]
  );
  const itemsByOrder = {};
  for (const item of itemRows) {
    if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
    itemsByOrder[item.order_id].push(item);
  }

  return {
    ordenes: orderRows.map(o => rowsToOrden(o, itemsByOrder[o.id] || [])),
    total,
  };
}

/**
 * Stats de órdenes calculadas en SQL — sin cargar todas las filas en memoria.
 * @returns {{ total, hoy, esta_semana, este_mes, por_estado, ingresos }}
 */
async function getOrdenesStats() {
  // Valores reales del enum order_status en la DB:
  // pending, paid, shipped, delivered, cancelled
  // NO usar ::order_status cast — comparar como TEXT para evitar errores de enum
  const { rows: [s] } = await pool.query(`
    SELECT
      COUNT(*)                                                         AS total,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)         AS hoy,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS esta_semana,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())) AS este_mes,

      COUNT(*) FILTER (WHERE status::text = 'pending')   AS pendiente,
      COUNT(*) FILTER (WHERE status::text = 'paid')      AS pagado,
      COUNT(*) FILTER (WHERE status::text = 'shipped')   AS despachado,
      COUNT(*) FILTER (WHERE status::text = 'delivered') AS entregado,
      COUNT(*) FILTER (WHERE status::text = 'cancelled') AS cancelado,

      COUNT(*) FILTER (WHERE status::text = 'pending' AND payment_method = 'transferencia') AS transferencias_sin_confirmar,
      COUNT(*) FILTER (WHERE status::text = 'paid')                                          AS pagadas_sin_despachar,

      COALESCE(SUM(total) FILTER (WHERE status::text IN ('paid','shipped','delivered')), 0)                                                                         AS ingresos_total,
      COALESCE(SUM(total) FILTER (WHERE status::text IN ('paid','shipped','delivered') AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())), 0)       AS ingresos_mes,
      COALESCE(SUM(total) FILTER (WHERE status::text IN ('paid','shipped','delivered') AND created_at >= NOW() - INTERVAL '7 days'), 0)                            AS ingresos_semana,
      COALESCE(SUM(total) FILTER (WHERE status::text IN ('paid','shipped','delivered') AND created_at::date = CURRENT_DATE), 0)                                    AS ingresos_hoy
    FROM orders
  `);

  return {
    ordenes: {
      total:       parseInt(s.total),
      hoy:         parseInt(s.hoy),
      esta_semana: parseInt(s.esta_semana),
      este_mes:    parseInt(s.este_mes),
    },
    por_estado: {
      pendiente:  parseInt(s.pendiente),
      pagado:     parseInt(s.pagado),
      despachado: parseInt(s.despachado),
      entregado:  parseInt(s.entregado),
      cancelado:  parseInt(s.cancelado),
    },
    para_hoy: {
      transferencias_sin_confirmar: parseInt(s.transferencias_sin_confirmar),
      pagadas_sin_despachar:        parseInt(s.pagadas_sin_despachar),
    },
    ingresos: {
      total:       parseFloat(s.ingresos_total),
      este_mes:    parseFloat(s.ingresos_mes),
      esta_semana: parseFloat(s.ingresos_semana),
      hoy:         parseFloat(s.ingresos_hoy),
    },
  };
}

/**
 * Órdenes que llevan más de 24hs en 'pending' (para alertar al admin).
 * Devuelve lo mínimo para armar el mensaje de Telegram.
 */
async function getOrdenesPending24h() {
  const { rows } = await pool.query(`
    SELECT id, order_number, customer_email, customer_name, total, created_at
    FROM orders
    WHERE status::text = 'pending'
      AND created_at < NOW() - INTERVAL '24 hours'
    ORDER BY created_at ASC
  `);
  return rows.map(r => ({
    id:           r.id,
    order_number: r.order_number,
    email:        r.customer_email,
    nombre:       r.customer_name,
    total:        parseFloat(r.total) || 0,
    created_at:   r.created_at,
  }));
}

/**
 * Métricas de salud del soft launch (Fase 2):
 *  - pendientes_24h: órdenes que quedaron en 'pending' hace más de 24hs (acción urgente)
 *  - tasa_pago: % de checkouts iniciados que terminaron pagados (criterio de apertura >40%)
 *  - carritos: capturados vs recuperados → tasa de recuperación
 *  - cupon_soft: usos del cupón trazable del soft launch (alcance de la campaña)
 * @param {string} [cuponSoftLaunch] código del cupón de soft launch a trazar
 */
async function getSoftLaunchStats(cuponSoftLaunch = null) {
  const { rows: [o] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status::text = 'pending' AND created_at < NOW() - INTERVAL '24 hours') AS pendientes_24h,
      COUNT(*) FILTER (WHERE status::text IN ('paid','shipped','delivered','completed'))            AS pagadas,
      COUNT(*)                                                                                      AS total
    FROM orders
  `);

  const { rows: [c] } = await pool.query(`
    SELECT
      COUNT(*)                                       AS capturados,
      COUNT(*) FILTER (WHERE recovered_at IS NOT NULL) AS recuperados
    FROM tienda_carritos_abandonados
  `).catch(() => ({ rows: [{ capturados: 0, recuperados: 0 }] }));

  let cuponUsos = 0;
  if (cuponSoftLaunch) {
    const { rows: [cu] } = await pool.query(
      `SELECT COUNT(*) AS usos FROM orders WHERE UPPER(coupon_code) = UPPER($1)`,
      [cuponSoftLaunch]
    ).catch(() => ({ rows: [{ usos: 0 }] }));
    cuponUsos = parseInt(cu.usos);
  }

  const pagadas    = parseInt(o.pagadas);
  const total      = parseInt(o.total);
  const capturados = parseInt(c.capturados);
  const recuperados = parseInt(c.recuperados);

  return {
    pendientes_24h:       parseInt(o.pendientes_24h),
    tasa_pago:            total > 0 ? Math.round((pagadas / total) * 100) : null,
    carritos_capturados:  capturados,
    carritos_recuperados: recuperados,
    tasa_recuperacion:    capturados > 0 ? Math.round((recuperados / capturados) * 100) : null,
    cupon_soft_code:      cuponSoftLaunch || null,
    cupon_soft_usos:      cuponUsos,
  };
}

// ═══════════════════════════════════════════════════════════════
//  TIENDA SESSIONS — persistencia en DB
// ═══════════════════════════════════════════════════════════════
// La tabla se crea automáticamente si no existe (CREATE TABLE IF NOT EXISTS).
// No requiere ALTER TABLE — solo INSERT/SELECT/DELETE.

async function ensureSessionsTable() {
  // Sin FK a users — wzmallas_app no tiene REFERENCES privilege.
  // La integridad se mantiene: si el user se borra, la sesión simplemente
  // devuelve null cuando db.getUserById() no encuentre el registro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_sessions (
      sid          VARCHAR(128) PRIMARY KEY,
      user_id      UUID         NOT NULL,
      email        TEXT         NOT NULL,
      nombre       TEXT,
      expires_at   TIMESTAMPTZ  NOT NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON tienda_sessions(expires_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user    ON tienda_sessions(user_id)`);
}
// Ejecutar al cargar el módulo (fire-and-forget — si falla, el fallback en memoria sigue)
ensureSessionsTable().catch(e => console.warn('[db] No se pudo crear tienda_sessions:', e.message));

/** Crear sesión en DB */
async function createSession(sid, { user_id, email, nombre, exp }) {
  await pool.query(
    `INSERT INTO tienda_sessions (sid, user_id, email, nombre, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
     ON CONFLICT (sid) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [sid, user_id, email, nombre || null, exp]
  );
}

/** Recuperar sesión por sid — retorna null si no existe o expiró */
async function getSession(sid) {
  if (!sid) return null;
  const { rows: [row] } = await pool.query(
    `SELECT user_id, email, nombre, EXTRACT(EPOCH FROM expires_at)*1000 AS exp
     FROM tienda_sessions
     WHERE sid = $1 AND expires_at > NOW()`,
    [sid]
  );
  if (!row) return null;
  return { user_id: row.user_id, email: row.email, nombre: row.nombre, exp: parseInt(row.exp) };
}

/** Eliminar sesión por sid */
async function deleteSession(sid) {
  if (!sid) return;
  await pool.query('DELETE FROM tienda_sessions WHERE sid = $1', [sid]);
}

/** Limpiar sesiones expiradas (llamar periódicamente) */
async function cleanExpiredSessions() {
  const { rowCount } = await pool.query('DELETE FROM tienda_sessions WHERE expires_at < NOW()');
  if (rowCount > 0) console.log(`  ✓ [sessions] ${rowCount} sesiones expiradas eliminadas`);
}

// ═══════════════════════════════════════════════════════════════
//  PRICE VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Dado un array de ML listing IDs, devuelve un mapa:
 *   mlId → { base_price, variant_prices: [number, ...] }
 *
 * Se usa para validar los precios enviados por el cliente al crear una orden.
 * Si un mlId no está en la DB, no aparece en el mapa (validación se omite).
 */
async function getProductPricesForOrder(mlIds) {
  if (!mlIds || !mlIds.length) return {};

  // Filtrar IDs que no son ML (ej: locales como 'WZ-TEST-PAGO')
  const ids = mlIds.filter(id => id && /^ML[A-Z]\d+$/.test(id));
  if (!ids.length) return {};

  // Traer producto + todas sus variantes en una sola query
  const { rows } = await pool.query(
    `SELECT
       p.ml_listing_id,
       p.base_price::float AS base_price,
       COALESCE(
         array_agg(pv.price::float) FILTER (WHERE pv.price IS NOT NULL AND pv.is_active = TRUE),
         ARRAY[]::float[]
       ) AS variant_prices
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id
     WHERE p.ml_listing_id = ANY($1)
       AND p.deleted_at IS NULL
       AND p.status = 'active'
     GROUP BY p.ml_listing_id, p.base_price`,
    [ids]
  );

  const map = {};
  for (const row of rows) {
    map[row.ml_listing_id] = {
      base_price    : row.base_price,
      variant_prices: row.variant_prices,
      // Todos los precios válidos (base + variantes), deduplicados
      all_prices    : [...new Set([row.base_price, ...row.variant_prices])].filter(p => p > 0),
    };
  }
  return map;
}

// ════════════���═════════════��═══════════════════════════════��════
//  REVIEWS CACHE — persiste entre reinicios del servidor
// ═════════════════════════════��═══════════════════════════��═════

async function ensureReviewsCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ml_reviews_cache (
      item_id    TEXT    NOT NULL,
      offset_val INTEGER NOT NULL DEFAULT 0,
      limit_val  INTEGER NOT NULL DEFAULT 10,
      data       JSONB   NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, offset_val, limit_val)
    )
  `);
}

/**
 * Recupera reseñas cacheadas del DB.
 * @param {string} itemId  - ID de ML (ej: MLA1234567)
 * @param {number} offset
 * @param {number} limit
 * @param {number} maxAgeMs - TTL en ms (default: 7 días). 0 = sin expiración.
 * @returns {object|null} data cacheada, o null si no existe / expiró
 */
async function getReviewsCache(itemId, offset, limit, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const { rows } = await pool.query(
    `SELECT data, fetched_at FROM ml_reviews_cache
     WHERE item_id = $1 AND offset_val = $2 AND limit_val = $3`,
    [itemId, offset, limit]
  );
  if (!rows.length) return null;
  if (maxAgeMs > 0) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age > maxAgeMs) return null; // expirado
  }
  return rows[0].data;
}

/**
 * Guarda (o sobreescribe) las reseñas en la cache del DB.
 */
async function setReviewsCache(itemId, offset, limit, data) {
  await pool.query(
    `INSERT INTO ml_reviews_cache (item_id, offset_val, limit_val, data, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (item_id, offset_val, limit_val) DO UPDATE
       SET data = EXCLUDED.data, fetched_at = NOW()`,
    [itemId, offset, limit, JSON.stringify(data)]
  );
}

// ═════════════════════════════════════════════════════════════════
//  SHIPPING QUOTES CACHE (item_id + zip_code) — persiste reinicios
//  Igual patrón que reviews cache: evita pegarle a la API de ML en
//  cada visita a la ficha de producto (las cotizaciones no cambian
//  segundo a segundo, y así también ahorramos cuota de la API).
// ═════════════════════════════════════════════════════════════════

async function ensureShippingCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ml_shipping_cache (
      item_id    TEXT NOT NULL,
      zip_code   TEXT NOT NULL,
      data       JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, zip_code)
    )
  `);
}

/**
 * Recupera una cotización de envío cacheada.
 * @param {number} maxAgeMs - TTL en ms (default: 6 horas)
 * @returns {object|null}
 */
async function getShippingCache(itemId, zipCode, maxAgeMs = 6 * 60 * 60 * 1000) {
  const { rows } = await pool.query(
    `SELECT data, fetched_at FROM ml_shipping_cache WHERE item_id = $1 AND zip_code = $2`,
    [itemId, zipCode]
  );
  if (!rows.length) return null;
  if (maxAgeMs > 0) {
    const age = Date.now() - new Date(rows[0].fetched_at).getTime();
    if (age > maxAgeMs) return null;
  }
  return rows[0].data;
}

async function setShippingCache(itemId, zipCode, data) {
  await pool.query(
    `INSERT INTO ml_shipping_cache (item_id, zip_code, data, fetched_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (item_id, zip_code) DO UPDATE
       SET data = EXCLUDED.data, fetched_at = NOW()`,
    [itemId, zipCode, JSON.stringify(data)]
  );
}

// ═════════════════════════════════════════════════════════════════
//  PRODUCTO OVERRIDES (admin Tienda — "Productos ABM")
//  Capa de personalización propia sobre los ítems sincronizados
//  desde ML. Los datos de ML (cache/items.json) son de solo lectura
//  — acá se guarda lo que la tienda decide mostrar "encima": video
//  asignado, descripción/portada propias, destacado, oculto, etc.
//  Sobrevive a cada re-sync porque vive en su propia tabla, indexada
//  por ml_item_id (no se pisa con cache/items.json).
// ═════════════════════════════════════════════════════════════════

async function ensureProductOverridesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_producto_overrides (
      id                  SERIAL PRIMARY KEY,
      ml_item_id          TEXT NOT NULL UNIQUE,
      titulo_custom       TEXT,
      descripcion_custom  TEXT,
      imagen_portada_url  TEXT,
      video_url           TEXT,
      video_fuente        TEXT,   -- 'youtube' | 'alibaba' | 'aliexpress' | 'upload'
      video_thumb_url     TEXT,
      destacado           BOOLEAN NOT NULL DEFAULT FALSE,
      oculto              BOOLEAN NOT NULL DEFAULT FALSE,
      notas_admin         TEXT,
      creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tpo_destacado ON tienda_producto_overrides(destacado) WHERE destacado = TRUE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tpo_oculto    ON tienda_producto_overrides(oculto)    WHERE oculto    = TRUE`);
}

const OVERRIDE_FIELDS = [
  'titulo_custom', 'descripcion_custom', 'imagen_portada_url',
  'video_url', 'video_fuente', 'video_thumb_url',
  'destacado', 'oculto', 'notas_admin',
];

/** Devuelve TODOS los overrides como mapa { ml_item_id: override }, para combinar con el cache de ML en listados. */
async function getAllProductOverrides() {
  const { rows } = await pool.query(`SELECT * FROM tienda_producto_overrides`);
  const map = {};
  for (const r of rows) map[r.ml_item_id] = r;
  return map;
}

/** Devuelve el override de un solo ítem (o null si no tiene personalizaciones). */
async function getProductOverride(itemId) {
  const { rows } = await pool.query(
    `SELECT * FROM tienda_producto_overrides WHERE ml_item_id = $1`,
    [itemId]
  );
  return rows[0] || null;
}

/**
 * Crea o actualiza el override de un ítem (upsert parcial — solo pisa
 * los campos presentes en `fields`, dejando el resto intacto).
 * @param {string} itemId
 * @param {object} fields - subconjunto de OVERRIDE_FIELDS
 */
async function setProductOverride(itemId, fields) {
  const keys = Object.keys(fields).filter(k => OVERRIDE_FIELDS.includes(k));
  if (!keys.length) return getProductOverride(itemId);

  // Upsert: insertar fila vacía si no existe, luego actualizar solo los campos provistos
  await pool.query(
    `INSERT INTO tienda_producto_overrides (ml_item_id) VALUES ($1)
     ON CONFLICT (ml_item_id) DO NOTHING`,
    [itemId]
  );

  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map(k => fields[k]);
  await pool.query(
    `UPDATE tienda_producto_overrides
        SET ${setClauses.join(', ')}, actualizado_en = NOW()
      WHERE ml_item_id = $1`,
    [itemId, ...values]
  );
  return getProductOverride(itemId);
}

/** Elimina por completo el override de un ítem (vuelve a mostrarse 100% como en ML). */
async function deleteProductOverride(itemId) {
  await pool.query(`DELETE FROM tienda_producto_overrides WHERE ml_item_id = $1`, [itemId]);
}

// ═════════════════════════════════════════════════════════════════
//  PRODUCTOS PROPIOS (admin Tienda — ABM "alta manual / proveedor")
//  Productos que NO vienen de MercadoLibre — los carga el admin a
//  mano o importándolos desde mensajes de WhatsApp del proveedor
//  (celulares, consolas, smartwatches, etc.). Viven en su propia
//  tabla con ID sintético (prefijo WZ-LOC-) y se mezclan de forma
//  aditiva con el catálogo de ML al armar listados/detalle públicos.
// ═════════════════════════════════════════════════════════════════

async function ensureProductosPropiosTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_productos_propios (
      id                  TEXT PRIMARY KEY,
      titulo              TEXT NOT NULL,
      descripcion         TEXT,
      marca               TEXT,
      categoria           TEXT NOT NULL DEFAULT 'otros',
      condicion           TEXT NOT NULL DEFAULT 'nuevo',
      precio_usd          NUMERIC,
      margen_pct          NUMERIC,
      cotizacion_usd      NUMERIC,
      precio_ars          NUMERIC NOT NULL DEFAULT 0,
      stock_estado        TEXT NOT NULL DEFAULT 'disponible',
      imagen_portada_url  TEXT,
      imagenes            JSONB NOT NULL DEFAULT '[]',
      video_url           TEXT,
      video_fuente        TEXT,
      video_thumb_url     TEXT,
      destacado           BOOLEAN NOT NULL DEFAULT FALSE,
      activo              BOOLEAN NOT NULL DEFAULT TRUE,
      eliminado           BOOLEAN NOT NULL DEFAULT FALSE,
      notas_admin         TEXT,
      origen              TEXT NOT NULL DEFAULT 'manual',
      creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE tienda_productos_propios ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE`);
  // Productos que se pagan ÚNICAMENTE por transferencia (modelo costo+margen,
  // ej. celulares): sin cuotas, sin 5% de descuento, y el checkout oculta MP.
  await pool.query(`ALTER TABLE tienda_productos_propios ADD COLUMN IF NOT EXISTS pago_transferencia BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tpp_activo    ON tienda_productos_propios(activo)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tpp_eliminado ON tienda_productos_propios(eliminado) WHERE eliminado = TRUE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tpp_destacado ON tienda_productos_propios(destacado) WHERE destacado = TRUE`);
}

const PRODUCTO_PROPIO_FIELDS = [
  'titulo', 'descripcion', 'marca', 'categoria', 'condicion',
  'precio_usd', 'margen_pct', 'cotizacion_usd', 'precio_ars',
  'stock_estado', 'imagen_portada_url', 'imagenes', 'variantes',
  'video_url', 'video_fuente', 'video_thumb_url',
  'destacado', 'activo', 'notas_admin', 'origen',
  'envio_gratis', 'costo_envio', 'dias_envio', 'a_pedido',
  'pago_transferencia',
];

// Fields that are JSONB arrays and need explicit JSON serialization
const JSONB_ARRAY_FIELDS = new Set(['imagenes', 'variantes']);

function _mapProductoPropio(r) {
  if (!r) return null;
  return {
    ...r,
    imagenes:  Array.isArray(r.imagenes)  ? r.imagenes  : [],
    variantes: Array.isArray(r.variantes) ? r.variantes : [],
  };
}

/** Lista todos los productos propios (opcionalmente filtrando por activos). */
async function getProductosPropios({ soloActivos = false } = {}) {
  const { rows } = await pool.query(
    soloActivos
      ? `SELECT * FROM tienda_productos_propios WHERE activo = TRUE AND eliminado = FALSE ORDER BY creado_en DESC`
      : `SELECT * FROM tienda_productos_propios WHERE eliminado = FALSE ORDER BY creado_en DESC`
  );
  return rows.map(_mapProductoPropio);
}

/** Devuelve un producto propio por su ID sintético (o null). */
async function getProductoPropioById(id) {
  const { rows } = await pool.query(`SELECT * FROM tienda_productos_propios WHERE id = $1`, [id]);
  return _mapProductoPropio(rows[0]) || null;
}

/**
 * Crea un producto propio nuevo.
 * @param {string} id - ID sintético ya generado (ej. WZ-LOC-xxxxx)
 * @param {object} fields - subconjunto de PRODUCTO_PROPIO_FIELDS (debe incluir al menos "titulo")
 */
async function createProductoPropio(id, fields) {
  const keys = PRODUCTO_PROPIO_FIELDS.filter(k => fields[k] !== undefined);
  const cols = ['id', ...keys];
  const vals = [id, ...keys.map(k => JSONB_ARRAY_FIELDS.has(k) ? JSON.stringify(fields[k] || []) : fields[k])];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  await pool.query(
    `INSERT INTO tienda_productos_propios (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    vals
  );
  return getProductoPropioById(id);
}

/** Actualiza parcialmente un producto propio (solo pisa los campos provistos). */
async function updateProductoPropio(id, fields) {
  const keys = Object.keys(fields).filter(k => PRODUCTO_PROPIO_FIELDS.includes(k));
  if (!keys.length) return getProductoPropioById(id);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = keys.map(k => JSONB_ARRAY_FIELDS.has(k) ? JSON.stringify(fields[k] || []) : fields[k]);
  await pool.query(
    `UPDATE tienda_productos_propios
        SET ${setClauses.join(', ')}, actualizado_en = NOW()
      WHERE id = $1`,
    [id, ...values]
  );
  return getProductoPropioById(id);
}

/** Soft delete: marca el producto como eliminado (no se borra de la DB ni se listan sus archivos). */
async function deleteProductoPropio(id) {
  await pool.query(
    `UPDATE tienda_productos_propios SET eliminado = TRUE, activo = FALSE, actualizado_en = NOW() WHERE id = $1`,
    [id]
  );
}

// ─────────────────────────────────────────────────────────────────────
//  CATEGORÍAS (tienda_categorias)
// ─────────────────────────────────────────────────────────────────────
function _mapCategoria(r) {
  if (!r) return null;
  return { id: r.id, slug: r.slug, label: r.label, emoji: r.emoji || '📦',
           descripcion: r.descripcion || '', orden: r.orden || 0,
           activa: !!r.activa, creado_en: r.creado_en, actualizado_en: r.actualizado_en };
}

async function getCategorias({ soloActivas = false } = {}) {
  const { rows } = await pool.query(
    soloActivas
      ? `SELECT * FROM tienda_categorias WHERE activa = TRUE ORDER BY orden ASC, id ASC`
      : `SELECT * FROM tienda_categorias ORDER BY orden ASC, id ASC`
  );
  return rows.map(_mapCategoria);
}

async function getCategoriaBySlug(slug) {
  const { rows } = await pool.query(`SELECT * FROM tienda_categorias WHERE slug = $1`, [slug]);
  return _mapCategoria(rows[0]) || null;
}

async function getCategoriaById(id) {
  const { rows } = await pool.query(`SELECT * FROM tienda_categorias WHERE id = $1`, [id]);
  return _mapCategoria(rows[0]) || null;
}

async function createCategoria({ slug, label, emoji, descripcion, orden }) {
  const { rows } = await pool.query(
    `INSERT INTO tienda_categorias (slug, label, emoji, descripcion, orden)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [slug, label, emoji || '📦', descripcion || '', orden || 0]
  );
  return _mapCategoria(rows[0]);
}

async function updateCategoria(id, fields) {
  const allowed = ['label', 'emoji', 'descripcion', 'orden', 'activa'];
  const keys    = Object.keys(fields).filter(k => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return getCategoriaById(id);
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map(k => fields[k]);
  const { rows } = await pool.query(
    `UPDATE tienda_categorias SET ${set}, actualizado_en = NOW() WHERE id = $1 RETURNING *`,
    [id, ...vals]
  );
  return _mapCategoria(rows[0]) || null;
}

async function deleteCategoria(id) {
  await pool.query(`DELETE FROM tienda_categorias WHERE id = $1`, [id]);
}

async function reorderCategorias(orderedIds) {
  // orderedIds = [id1, id2, id3, ...] in desired order
  for (let i = 0; i < orderedIds.length; i++) {
    await pool.query(
      `UPDATE tienda_categorias SET orden = $1, actualizado_en = NOW() WHERE id = $2`,
      [i + 1, orderedIds[i]]
    );
  }
}

async function countProductosByCategoria() {
  const { rows } = await pool.query(
    `SELECT categoria, COUNT(*) as total,
            SUM(CASE WHEN activo THEN 1 ELSE 0 END) as activos
     FROM tienda_productos_propios GROUP BY categoria`
  );
  const map = {};
  rows.forEach(r => { map[r.categoria] = { total: parseInt(r.total), activos: parseInt(r.activos) }; });
  return map;
}

// ═════════════════════════════════════════════════════════════════
//  CARRITOS ABANDONADOS (recuperación por email)
//  Se guarda un snapshot del carrito cuando el usuario completa el
//  paso 1 del checkout (nombre+email). Si nunca llega a crear una
//  orden, un cron le manda un email "tu carrito te espera" a las 4hs
//  (máx. 1 vez por carrito) con un deep-link que restaura el carrito.
// ═════════════════════════════════════════════════════════════════
async function ensureCarritosAbandonadosTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_carritos_abandonados (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL,
      nombre        TEXT NOT NULL DEFAULT '',
      items         JSONB NOT NULL DEFAULT '[]',
      total         NUMERIC(12,2) NOT NULL DEFAULT 0,
      token         TEXT NOT NULL UNIQUE,
      email_sent_at TIMESTAMPTZ,
      recovered_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_carritos_abandonados_email ON tienda_carritos_abandonados (LOWER(email))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_carritos_abandonados_pending ON tienda_carritos_abandonados (created_at) WHERE email_sent_at IS NULL AND recovered_at IS NULL`);
}

// Guarda/actualiza el snapshot del carrito de un email. Si ya había uno
// pendiente (sin recuperar) para ese email, lo actualiza y resetea el
// timer de 4hs; si no, crea uno nuevo con un token único para el deep-link.
async function upsertCarritoAbandonado({ email, nombre, items, total }) {
  const { rows } = await pool.query(
    `UPDATE tienda_carritos_abandonados
        SET nombre = $2, items = $3, total = $4, created_at = NOW(),
            email_sent_at = NULL, updated_at = NOW()
      WHERE LOWER(email) = LOWER($1) AND recovered_at IS NULL
      RETURNING id, token`,
    [email, nombre || '', JSON.stringify(items || []), total || 0]
  );
  if (rows.length) return rows[0];
  const token = require('crypto').randomBytes(24).toString('hex');
  const ins = await pool.query(
    `INSERT INTO tienda_carritos_abandonados (email, nombre, items, total, token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, token`,
    [email, nombre || '', JSON.stringify(items || []), total || 0, token]
  );
  return ins.rows[0];
}

// Marca como recuperado el carrito pendiente de un email (no se le manda
// el email de recordatorio porque ya completó la compra).
async function marcarCarritoRecuperado(email) {
  await pool.query(
    `UPDATE tienda_carritos_abandonados
        SET recovered_at = NOW(), updated_at = NOW()
      WHERE LOWER(email) = LOWER($1) AND recovered_at IS NULL`,
    [email]
  );
}

// Carritos abandonados hace más de `minAgeMs` (default 4hs), sin recuperar
// y sin email de recordatorio enviado todavía.
async function getCarritosAbandonadosPendientes(minAgeMs = 4 * 60 * 60 * 1000) {
  const { rows } = await pool.query(
    `SELECT id, email, nombre, items, total, token
       FROM tienda_carritos_abandonados
      WHERE recovered_at IS NULL AND email_sent_at IS NULL
        AND created_at <= NOW() - ($1 || ' milliseconds')::interval`,
    [minAgeMs]
  );
  return rows.map(r => ({ ...r, items: r.items, total: parseFloat(r.total) }));
}

async function marcarCarritoEmailEnviado(id) {
  await pool.query(`UPDATE tienda_carritos_abandonados SET email_sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
}

async function getCarritoAbandonadoPorToken(token) {
  const { rows } = await pool.query(
    `SELECT id, email, nombre, items, total FROM tienda_carritos_abandonados WHERE token = $1`,
    [token]
  );
  if (!rows.length) return null;
  return { ...rows[0], total: parseFloat(rows[0].total) };
}

// ── Alertas de stock (back-in-stock) ──────────────────────────
async function ensureStockAlertsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_stock_alerts (
      id          SERIAL PRIMARY KEY,
      item_id     TEXT NOT NULL,
      variant     TEXT NOT NULL DEFAULT '',
      titulo      TEXT NOT NULL DEFAULT '',
      email       TEXT NOT NULL,
      notified_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_alert_lookup ON tienda_stock_alerts (item_id, variant, LOWER(email)) WHERE notified_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_alert_item ON tienda_stock_alerts (item_id) WHERE notified_at IS NULL`);
}

// Registra una alerta de reposición (dedup por item+variant+email pendiente).
// Devuelve { created:true } si es nueva; { created:false } si ya existía.
async function addStockAlert({ item_id, variant, titulo, email }) {
  const exists = await pool.query(
    `SELECT 1 FROM tienda_stock_alerts
      WHERE item_id = $1 AND variant = $2 AND LOWER(email) = LOWER($3) AND notified_at IS NULL
      LIMIT 1`,
    [item_id, variant || '', email]
  );
  if (exists.rows.length) return { created: false };
  await pool.query(
    `INSERT INTO tienda_stock_alerts (item_id, variant, titulo, email) VALUES ($1, $2, $3, $4)`,
    [item_id, variant || '', titulo || '', email]
  );
  return { created: true };
}

// ── Favoritos / lista de deseos (FASE E) ──────────────────────────
// Un favorito = (user_id, item_id). Los invitados usan localStorage; al
// loguearse se hace merge del localStorage a la DB (idempotente).
async function ensureFavoritosTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_favoritos (
      user_id    UUID NOT NULL,
      item_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, item_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_favoritos_user ON tienda_favoritos (user_id)`);
}

async function getFavoritos(userId) {
  const { rows } = await pool.query(
    `SELECT item_id FROM tienda_favoritos WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]);
  return rows.map(r => r.item_id);
}

async function addFavorito(userId, itemId) {
  await pool.query(
    `INSERT INTO tienda_favoritos (user_id, item_id) VALUES ($1, $2)
       ON CONFLICT (user_id, item_id) DO NOTHING`,
    [userId, String(itemId).slice(0, 80)]);
}

async function removeFavorito(userId, itemId) {
  await pool.query(
    `DELETE FROM tienda_favoritos WHERE user_id = $1 AND item_id = $2`,
    [userId, String(itemId)]);
}

// Merge de una lista de item_ids (del localStorage) a la DB. Devuelve la lista final.
async function mergeFavoritos(userId, itemIds) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(x => String(x).slice(0, 80)).filter(Boolean))].slice(0, 500);
  for (const id of ids) await addFavorito(userId, id);
  return getFavoritos(userId);
}

// ── Reseñas propias del storefront (FASE C) ───────────────────────
// Reseñas dejadas en la web (no ML), con moderación. Las aprobadas se muestran
// en la PDP junto a las de ML. Si traen foto, se premia con un cupón.
async function ensureReviewsPropiasTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_reviews_propias (
      id              SERIAL PRIMARY KEY,
      producto_id     TEXT NOT NULL,
      producto_titulo TEXT NOT NULL DEFAULT '',
      nombre          TEXT NOT NULL DEFAULT '',
      email           TEXT,
      rating          INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
      texto           TEXT NOT NULL DEFAULT '',
      foto_url        TEXT,
      cupon_code      TEXT,
      orden_id        TEXT,
      estado          TEXT NOT NULL DEFAULT 'pendiente',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resenas_item_aprob ON tienda_reviews_propias (producto_id) WHERE estado = 'aprobada'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resenas_estado ON tienda_reviews_propias (estado, created_at DESC)`);
}

async function addResenaPropia(d) {
  const { rows } = await pool.query(
    `INSERT INTO tienda_reviews_propias
       (producto_id, producto_titulo, nombre, email, rating, texto, foto_url, cupon_code, orden_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ String(d.producto_id).slice(0,80), String(d.producto_titulo||'').slice(0,200),
      String(d.nombre||'').slice(0,80), d.email ? String(d.email).slice(0,120) : null,
      Math.max(1, Math.min(5, parseInt(d.rating)||0)), String(d.texto||'').slice(0,2000),
      d.foto_url || null, d.cupon_code || null, d.orden_id ? String(d.orden_id).slice(0,60) : null ]);
  return rows[0].id;
}

// Reseñas aprobadas de un item (para mostrar en la PDP).
async function getResenasAprobadas(itemId) {
  const { rows } = await pool.query(
    `SELECT id, nombre, rating, texto, foto_url, created_at
       FROM tienda_reviews_propias
      WHERE producto_id = $1 AND estado = 'aprobada'
      ORDER BY (foto_url IS NOT NULL) DESC, created_at DESC`,
    [itemId]);
  return rows;
}

// Reseñas para moderar en el admin (por estado).
async function getResenasModeracion({ estado = 'pendiente', limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM tienda_reviews_propias
      ${estado === 'todas' ? '' : 'WHERE estado = $3'}
      ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    estado === 'todas' ? [limit, offset] : [limit, offset, estado]);
  return rows;
}

async function moderarResena(id, estado) {
  const ok = ['aprobada', 'rechazada', 'pendiente'].includes(estado) ? estado : 'pendiente';
  await pool.query(`UPDATE tienda_reviews_propias SET estado = $2 WHERE id = $1`, [parseInt(id), ok]);
}

async function countResenasModeracionPendientes() {
  const { rows } = await pool.query(`SELECT count(*)::int c FROM tienda_reviews_propias WHERE estado = 'pendiente'`);
  return rows[0].c;
}

// Órdenes pagadas hace [diasMin, diasMax] días con al menos un item sin invitación
// de reseña enviada → 1 fila por orden (el primer item) para mandar 1 mail.
async function getOrdenesParaResena({ diasMin = 4, diasMax = 30 } = {}) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (o.id)
           o.id AS orden_id, o.customer_email AS email, o.customer_name AS nombre,
           COALESCE(oi.ml_item_id, oi.product_sku, oi.product_id::text) AS producto_id,
           oi.product_name AS producto_titulo
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE (o.status IN ('paid','delivered','completed') OR o.payment_status = 'paid')
       AND o.created_at BETWEEN NOW() - ($2 || ' days')::interval AND NOW() - ($1 || ' days')::interval
       AND oi.review_invitation_sent_at IS NULL
       AND o.customer_email IS NOT NULL AND o.customer_email <> ''
     ORDER BY o.id, oi.created_at ASC`,
    [diasMin, diasMax]);
  return rows;
}

// Marca todos los items de una orden como "invitación de reseña enviada".
async function markResenaInvitada(ordenId) {
  await pool.query(
    `UPDATE order_items SET review_invitation_sent_at = NOW()
      WHERE order_id = $1 AND review_invitation_sent_at IS NULL`, [ordenId]);
}

// ── Newsletter / campañas (FASE G) ────────────────────────────────
// Suscriptores activos para enviar campañas (id sirve de token de baja).
async function getNewsletterActivos() {
  const { rows } = await pool.query(
    `SELECT id, email, nombre FROM newsletter_subscribers
      WHERE status = 'subscribed' AND email IS NOT NULL AND email <> ''
      ORDER BY created_at ASC`);
  return rows;
}

async function countNewsletter() {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int c FROM newsletter_subscribers GROUP BY status`);
  const out = { subscribed: 0, unsubscribed: 0, total: 0 };
  for (const r of rows) { out[r.status] = r.c; out.total += r.c; }
  return out;
}

// Baja por token (el id del suscriptor). Idempotente.
async function unsubscribeNewsletter(id, motivo) {
  if (!/^[0-9a-f-]{16,}$/i.test(String(id || ''))) return { ok: false };
  const { rows } = await pool.query(
    `UPDATE newsletter_subscribers
        SET status = 'unsubscribed', unsubscribed_at = NOW(),
            unsubscribe_reason = COALESCE($2, unsubscribe_reason), updated_at = NOW()
      WHERE id = $1 RETURNING email`,
    [id, motivo ? String(motivo).slice(0, 200) : null]);
  return { ok: rows.length > 0, email: rows[0]?.email };
}

// Anti-abuso del cupón: ¿esta orden ya generó un cupón por reseña? (1 por orden)
async function ordenPremiadaConResena(ordenId) {
  if (!ordenId) return true; // sin orden → no se premia
  const { rows } = await pool.query(
    `SELECT 1 FROM tienda_reviews_propias WHERE orden_id = $1 AND cupon_code IS NOT NULL LIMIT 1`,
    [String(ordenId)]);
  return rows.length > 0;
}

// Anti-spam: ¿este email ya dejó reseña de este item? (dedup)
async function yaResenoItem(email, itemId) {
  if (!email) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM tienda_reviews_propias WHERE LOWER(email) = LOWER($1) AND producto_id = $2 LIMIT 1`,
    [email, itemId]);
  return rows.length > 0;
}

// Item_ids distintos que algún usuario tiene en favoritos (para el gancho de retención).
async function getFavoritedItemIds() {
  const { rows } = await pool.query(`SELECT DISTINCT item_id FROM tienda_favoritos`);
  return rows.map(r => r.item_id);
}

// Emails de los usuarios que tienen un item en favoritos (para avisar cambios).
async function getFavoritersEmails(itemId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.email
       FROM tienda_favoritos f JOIN users u ON u.id = f.user_id
      WHERE f.item_id = $1 AND u.email IS NOT NULL AND u.email <> ''`,
    [itemId]);
  return rows.map(r => r.email);
}

// ── Watch de estado por item (último stock/precio conocido) ────────
// Alimenta el gancho de favoritos: detecta transiciones agotado→disponible
// y bajas de precio SIN re-notificar (el estado se actualiza tras avisar).
async function ensureItemWatchTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_item_watch (
      item_id       TEXT PRIMARY KEY,
      last_in_stock BOOLEAN,
      last_price    NUMERIC,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAllItemWatch() {
  const { rows } = await pool.query(`SELECT item_id, last_in_stock, last_price FROM tienda_item_watch`);
  const map = {};
  for (const r of rows) map[r.item_id] = { last_in_stock: r.last_in_stock, last_price: r.last_price == null ? null : Number(r.last_price) };
  return map;
}

async function upsertItemWatch(itemId, inStock, price) {
  await pool.query(
    `INSERT INTO tienda_item_watch (item_id, last_in_stock, last_price, updated_at)
       VALUES ($1, $2, $3, NOW())
     ON CONFLICT (item_id) DO UPDATE SET last_in_stock = $2, last_price = $3, updated_at = NOW()`,
    [itemId, inStock, price == null ? null : Number(price)]);
}

// Item_ids que tienen al menos una alerta pendiente (para el job de reposición).
async function getItemsWithPendingAlerts() {
  const { rows } = await pool.query(
    `SELECT DISTINCT item_id FROM tienda_stock_alerts WHERE notified_at IS NULL`);
  return rows.map(r => r.item_id);
}

// Alertas pendientes de un item.
async function getPendingStockAlerts(itemId) {
  const { rows } = await pool.query(
    `SELECT id, email, variant, titulo FROM tienda_stock_alerts
      WHERE item_id = $1 AND notified_at IS NULL`,
    [itemId]);
  return rows;
}

// Marca alertas como avisadas (para no re-enviar).
async function markStockAlertsNotified(ids) {
  if (!ids || !ids.length) return;
  await pool.query(
    `UPDATE tienda_stock_alerts SET notified_at = NOW() WHERE id = ANY($1::int[])`,
    [ids]);
}

// Conteo de alertas pendientes por item (para el badge "🔔 N esperan" del admin).
async function countPendingStockAlertsByItem() {
  const { rows } = await pool.query(
    `SELECT item_id, COUNT(*)::int AS n FROM tienda_stock_alerts
      WHERE notified_at IS NULL GROUP BY item_id`);
  const map = {};
  for (const r of rows) map[r.item_id] = r.n;
  return map;
}


// ══════════════════════════════════════════════════════════════════
//  HISTÓRICO DE STOCK
//  Foto diaria del stock de cada variante. Resuelve la demanda censurada:
//  sin esto, una variante que se agota deja de vender y el sistema lo lee
//  como falta de demanda, cuando en realidad es falta de stock.
//
//  La foto da el NIVEL. El FLUJO (cargas de Alibaba, ventas de ML) se puede
//  cruzar después para reconstruir lo que pasó entre fotos y detectar
//  descuadres — por eso `origen` queda preparado desde el principio.
// ══════════════════════════════════════════════════════════════════
async function ensureStockHistoricoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_historico (
      item_id      TEXT        NOT NULL,
      variation_id TEXT        NOT NULL DEFAULT '',
      fecha        DATE        NOT NULL,
      cantidad     INTEGER     NOT NULL CHECK (cantidad >= 0),
      cuenta       TEXT        NOT NULL DEFAULT '',
      titulo       TEXT        NOT NULL DEFAULT '',
      variante     TEXT        NOT NULL DEFAULT '',
      origen       TEXT        NOT NULL DEFAULT 'snapshot',
      creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, variation_id, fecha)
    )
  `);
  // La consulta típica es "esta variante, últimos N días"
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_hist_var
                    ON stock_historico (item_id, variation_id, fecha DESC)`);
  // …y "todo lo que estuvo sin stock en tal fecha"
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_hist_fecha
                    ON stock_historico (fecha DESC)`);
}

/**
 * Guarda la foto del día. La PK incluye la fecha, así que volver a correrlo
 * el mismo día ACTUALIZA en vez de duplicar: el job puede reintentarse sin
 * ensuciar los datos.
 */
async function guardarSnapshotStock(filas, fecha = null) {
  if (!filas || !filas.length) return 0;
  const dia = fecha || new Date().toISOString().slice(0, 10);
  const cli = await pool.connect();
  let n = 0;
  try {
    await cli.query('BEGIN');
    // De a 500 para no armar una sentencia gigante con 2.246 variantes
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500);
      const vals = [];
      const params = [];
      lote.forEach((f, k) => {
        const b = k * 7;
        vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`);
        params.push(f.item_id, String(f.variation_id || ''), dia,
                    Math.max(0, parseInt(f.cantidad) || 0),
                    String(f.cuenta || ''), String(f.titulo || '').slice(0, 300),
                    String(f.variante || '').slice(0, 200));
      });
      const r = await cli.query(
        `INSERT INTO stock_historico (item_id, variation_id, fecha, cantidad, cuenta, titulo, variante)
         VALUES ${vals.join(',')}
         ON CONFLICT (item_id, variation_id, fecha)
         DO UPDATE SET cantidad = EXCLUDED.cantidad, creado_en = NOW()`, params);
      n += r.rowCount;
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK'); throw e;
  } finally { cli.release(); }
  return n;
}

/**
 * Días CON stock de cada variante en una ventana. Es el denominador que
 * faltaba: la demanda real es unidades vendidas ÷ días que hubo stock,
 * no ÷ días del período.
 */
async function diasConStock(dias = 60) {
  const { rows } = await pool.query(`
    SELECT item_id, variation_id,
           COUNT(*) FILTER (WHERE cantidad > 0)::int AS dias_con_stock,
           COUNT(*)::int                             AS dias_medidos,
           MAX(fecha) FILTER (WHERE cantidad = 0)    AS ultimo_dia_sin_stock
      FROM stock_historico
     WHERE fecha >= CURRENT_DATE - $1::int
     GROUP BY item_id, variation_id`, [dias]);
  const map = {};
  for (const r of rows) map[`${r.item_id}::${r.variation_id}`] = r;
  return map;
}

/** Stock INMÓVIL: variantes que tuvieron stock todos los días medidos y
 *  nunca bajaron una unidad. No es una estimación — es lo que muestra la foto
 *  diaria. Sirve para ver capital parado sin esperar a tener 30 días.
 *  excluirItems: publicaciones espejo de grupos vinculados (no contar 2 veces). */
async function stockInmovil(dias = 60, excluirItems = []) {
  const { rows } = await pool.query(`
    WITH d AS (
      SELECT item_id, variation_id, titulo, variante, cuenta, fecha, cantidad,
             LAG(cantidad) OVER (PARTITION BY item_id, variation_id ORDER BY fecha) prev
        FROM stock_historico
       WHERE fecha >= CURRENT_DATE - $1::int
         AND ($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR NOT (item_id = ANY($2::text[])))
    )
    SELECT item_id, variation_id,
           MAX(titulo)   AS titulo,
           MAX(variante) AS variante,
           MAX(cuenta)   AS cuenta,
           COUNT(*)::int AS dias_medidos,
           MIN(cantidad)::int AS stock_min,
           (ARRAY_AGG(cantidad ORDER BY fecha DESC))[1]::int AS stock_actual,
           COALESCE(SUM(GREATEST(prev - cantidad, 0)), 0)::int AS bajas
      FROM d
     GROUP BY item_id, variation_id
    HAVING MIN(cantidad) > 0
       AND COALESCE(SUM(GREATEST(prev - cantidad, 0)), 0) = 0
       AND COUNT(*) >= 2
     ORDER BY stock_actual DESC`, [dias, excluirItems]);
  return rows;
}

/** Serie de una variante, para graficar o auditar. */
async function serieStock(itemId, variationId = '', dias = 120) {
  const { rows } = await pool.query(
    `SELECT fecha, cantidad FROM stock_historico
      WHERE item_id = $1 AND variation_id = $2 AND fecha >= CURRENT_DATE - $3::int
      ORDER BY fecha`, [itemId, String(variationId || ''), dias]);
  return rows;
}

/** Cobertura del histórico: desde cuándo hay datos y cuántos días. */
// excluirItems: publicaciones ESPEJO de grupos vinculados (mismo producto en
// las dos cuentas). Se guardan igual en el histórico, pero no se cuentan dos
// veces en los totales.
async function coberturaHistorico(excluirItems = []) {
  const { rows } = await pool.query(`
    SELECT MIN(fecha) AS desde, MAX(fecha) AS hasta,
           COUNT(DISTINCT fecha)::int AS dias,
           COUNT(*)::int              AS filas,
           COUNT(DISTINCT (item_id || '::' || variation_id))::int AS variantes
      FROM stock_historico
     WHERE ($1::text[] IS NULL OR cardinality($1::text[]) = 0 OR NOT (item_id = ANY($1::text[])))`,
    [excluirItems]);
  return rows[0] || null;
}

/** Poda: más de un año de detalle diario no aporta a la demanda. */
async function podarHistoricoStock(diasRetencion = 400) {
  const r = await pool.query(
    `DELETE FROM stock_historico WHERE fecha < CURRENT_DATE - $1::int`, [diasRetencion]);
  return r.rowCount;
}

// ── Log de emails enviados (auditoría / detectar sobre-envío al cliente) ──
async function ensureEmailLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tienda_email_log (
      id         SERIAL PRIMARY KEY,
      to_email   TEXT NOT NULL DEFAULT '',
      subject    TEXT NOT NULL DEFAULT '',
      tipo       TEXT NOT NULL DEFAULT 'otro',
      status     TEXT NOT NULL DEFAULT 'sent',
      error      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Cuerpo HTML del mail (para previsualizarlo tal cual se recibió).
  await pool.query(`ALTER TABLE tienda_email_log ADD COLUMN IF NOT EXISTS html TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_log_created ON tienda_email_log (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_log_to ON tienda_email_log (LOWER(to_email))`);
}

async function logEmail({ to_email, subject, tipo, status, error, html }) {
  await pool.query(
    `INSERT INTO tienda_email_log (to_email, subject, tipo, status, error, html) VALUES ($1, $2, $3, $4, $5, $6)`,
    [ (to_email || '').slice(0, 200), (subject || '').slice(0, 300), (tipo || 'otro').slice(0, 40),
      (status || 'sent').slice(0, 20), error ? String(error).slice(0, 400) : null,
      html ? String(html).slice(0, 200000) : null ]);
}

// HTML de un mail puntual (para la previsualización).
async function getEmailHtml(id) {
  const { rows } = await pool.query(`SELECT html, subject FROM tienda_email_log WHERE id = $1`, [parseInt(id) || 0]);
  return rows[0] || null;
}

// Listado paginado con filtros (q por email, tipo, status) + stats (24h/7d/fallidos).
async function getEmailLog({ q = '', tipo = '', status = '', limit = 50, offset = 0 } = {}) {
  const where = [], args = [];
  if (q)      { args.push('%' + String(q).toLowerCase() + '%'); where.push(`LOWER(to_email) LIKE $${args.length}`); }
  if (tipo)   { args.push(tipo);   where.push(`tipo = $${args.length}`); }
  if (status) { args.push(status); where.push(`status = $${args.length}`); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(200, Math.max(1, limit | 0));
  const off = Math.max(0, offset | 0);
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS n FROM tienda_email_log ${wsql}`, args);
  const rowsRes  = await pool.query(
    `SELECT id, to_email, subject, tipo, status, error, created_at
       FROM tienda_email_log ${wsql} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, args);
  const stats = (await pool.query(`
    SELECT COUNT(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::int AS d1,
           COUNT(*) FILTER (WHERE created_at > NOW() - interval '7 days')::int  AS d7,
           COUNT(*) FILTER (WHERE status = 'failed')::int                        AS fallidos
      FROM tienda_email_log`)).rows[0];
  return { rows: rowsRes.rows, total: totalRes.rows[0].n, stats };
}

module.exports = {
  pool,   // expuesto para queries puntuales en server.js
  // Users
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  updateLastLogin,
  // Firebase Auth (modo híbrido)
  ensureUsersAuthColumns,
  getUserByFirebaseUid,
  linkFirebaseUid,
  createUserFromFirebase,
  // Orders
  getOrdenes,
  getOrdenById,
  createOrden,
  updateOrdenStatus,
  getOrdenesByEmail,
  getOrdenesPendientesPago,
  getOrdenesFiltered,
  getOrdenesStats,
  getSoftLaunchStats,
  getOrdenesPending24h,
  // Sessions
  createSession,
  getSession,
  deleteSession,
  cleanExpiredSessions,
  // Price validation
  getProductPricesForOrder,
  // Reviews cache (persistent, survives server restarts)
  ensureReviewsCacheTable,
  getReviewsCache,
  setReviewsCache,
  // Shipping quotes cache (persistent, survives server restarts)
  ensureShippingCacheTable,
  getShippingCache,
  setShippingCache,
  // Producto overrides — admin Tienda (Productos ABM)
  ensureProductOverridesTable,
  getAllProductOverrides,
  getProductOverride,
  setProductOverride,
  deleteProductOverride,
  // Productos propios — admin Tienda (alta manual / proveedor, no-ML)
  ensureProductosPropiosTable,
  getProductosPropios,
  getProductoPropioById,
  createProductoPropio,
  updateProductoPropio,
  deleteProductoPropio,
  // Categorías
  getCategorias,
  getCategoriaBySlug,
  getCategoriaById,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  reorderCategorias,
  countProductosByCategoria,
  // Carritos abandonados
  ensureCarritosAbandonadosTable,
  upsertCarritoAbandonado,
  marcarCarritoRecuperado,
  getCarritosAbandonadosPendientes,
  marcarCarritoEmailEnviado,
  getCarritoAbandonadoPorToken,
  // Alertas de stock (back-in-stock)
  ensureStockAlertsTable,
  addStockAlert,
  ensureFavoritosTable,
  getFavoritos,
  addFavorito,
  removeFavorito,
  mergeFavoritos,
  getFavoritedItemIds,
  getFavoritersEmails,
  ensureItemWatchTable,
  getAllItemWatch,
  upsertItemWatch,
  ensureReviewsPropiasTable,
  addResenaPropia,
  getResenasAprobadas,
  getResenasModeracion,
  moderarResena,
  countResenasModeracionPendientes,
  yaResenoItem,
  ordenPremiadaConResena,
  getNewsletterActivos,
  countNewsletter,
  unsubscribeNewsletter,
  getOrdenesParaResena,
  markResenaInvitada,
  getItemsWithPendingAlerts,
  getPendingStockAlerts,
  markStockAlertsNotified,
  countPendingStockAlertsByItem,
  ensureStockHistoricoTable, guardarSnapshotStock, diasConStock, stockInmovil,
  serieStock, coberturaHistorico, podarHistoricoStock,
  // Log de emails enviados
  ensureEmailLogTable,
  getEmailHtml,
  logEmail,
  getEmailLog,
};

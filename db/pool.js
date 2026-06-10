// ── db/pool.js ────────────────────────────────────────────────
// Pool singleton de PostgreSQL. Importar con: const pool = require('./db/pool');
//
// Credenciales: wzmallas_app (permisos limitados, sin DDL)
// Admin (migraciones): postgres / wzmallas2026
// ─────────────────────────────────────────────────────────────
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB       || 'wzmallas',
  user:     process.env.PG_USER     || 'wzmallas_app',
  password: process.env.PG_PASSWORD || 'wzapp2026',
  max:                 10,     // máximo conexiones concurrentes
  idleTimeoutMillis:   30000,  // cerrar conexiones idle después de 30s
  connectionTimeoutMillis: 3000,
  // Timeouts para evitar queries colgadas que agoten el pool (pool.max=10):
  statement_timeout: 15000,  // PG aborta la query en el servidor si tarda >15s
  query_timeout:     20000,  // cliente node aborta si no recibe respuesta en 20s (un poco más que statement)
});

// Log de errores de pool (no mata el proceso)
pool.on('error', (err) => {
  console.error('[pg] Error inesperado en pool:', err.message);
});

// Test de conexión al arrancar
pool.query('SELECT 1').then(() => {
  console.log('  ✓ [pg] Conectado a PostgreSQL (wzmallas)');
}).catch(err => {
  console.error('  ✗ [pg] No se pudo conectar a PostgreSQL:', err.message);
  console.error('     Verificá que PostgreSQL esté corriendo: pg_ctl start');
});

module.exports = pool;

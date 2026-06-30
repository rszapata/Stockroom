-- ── Migración: columnas de Firebase Auth en users (FASE 9 / A1) ──
-- Correr UNA vez como admin (postgres), porque wzmallas_app no es owner
-- de la tabla users:
--   psql -U postgres -d wzmallas -f db/migrate-firebase-auth.sql
--
-- Idempotente: IF NOT EXISTS en columnas e índice.

ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider    TEXT    NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT false;

-- firebase_uid único (parcial: permite múltiples NULL en cuentas legacy)
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique
  ON users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

-- Asegurar que el app user pueda leer/escribir las columnas nuevas
-- (los GRANT a nivel tabla cubren columnas futuras, pero lo reafirmamos).
GRANT SELECT, INSERT, UPDATE ON users TO wzmallas_app;

-- ══════════════════════════════════════════════════════════════
--  WZMALLAS — Schema PostgreSQL
--  Crear las tablas desde cero en una DB nueva.
--
--  Uso:
--    sudo -u postgres psql -d wzmallas -f db/schema.sql
--  O desde node:
--    node db/schema-run.js
-- ══════════════════════════════════════════════════════════════

-- ── Extensiones ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tipos ENUM ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending', 'paid', 'failed', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'blocked', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── USERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          TEXT          NOT NULL DEFAULT '',
  email           TEXT          NOT NULL,
  password_hash   TEXT          NOT NULL DEFAULT '',
  password_salt   TEXT          NOT NULL DEFAULT '',
  telefono        TEXT          NOT NULL DEFAULT '',
  status          user_status   NOT NULL DEFAULT 'active',
  acepta_terms    BOOLEAN       NOT NULL DEFAULT false,
  login_count     INTEGER       NOT NULL DEFAULT 0,
  orders_count    INTEGER       NOT NULL DEFAULT 0,
  total_spent     NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_order_at   TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  metadata        JSONB         NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (LOWER(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email      ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);

-- ── ORDERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number         TEXT           NOT NULL UNIQUE,
  user_id              UUID,          -- NULL para guest
  is_guest             BOOLEAN        NOT NULL DEFAULT true,

  -- Datos del comprador
  customer_email       TEXT           NOT NULL DEFAULT '',
  customer_name        TEXT           NOT NULL DEFAULT '',
  customer_phone       TEXT           NOT NULL DEFAULT '',

  -- Dirección de envío
  shipping_calle       TEXT           NOT NULL DEFAULT '',
  shipping_piso        TEXT           NOT NULL DEFAULT '',
  shipping_ciudad      TEXT           NOT NULL DEFAULT '',
  shipping_provincia   TEXT           NOT NULL DEFAULT '',
  shipping_cp          TEXT           NOT NULL DEFAULT '',
  shipping_method_name TEXT           NOT NULL DEFAULT '',
  shipping_carrier     TEXT           NOT NULL DEFAULT '',
  shipping_total       NUMERIC(12,2)  NOT NULL DEFAULT 0,

  -- Pago
  payment_method       TEXT           NOT NULL DEFAULT 'mercadopago',
  payment_status       payment_status NOT NULL DEFAULT 'pending',

  -- Totales
  subtotal             NUMERIC(12,2)  NOT NULL DEFAULT 0,
  total                NUMERIC(12,2)  NOT NULL DEFAULT 0,
  items_count          INTEGER        NOT NULL DEFAULT 0,
  items_quantity       INTEGER        NOT NULL DEFAULT 0,

  -- Estado
  status               order_status   NOT NULL DEFAULT 'pending',
  admin_notes          TEXT,

  -- Timestamps de estados
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  paid_at              TIMESTAMPTZ,
  preparing_at         TIMESTAMPTZ,
  shipped_at           TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,

  -- Metadata JSON (tracking, mp_payment_id, es_status, etc.)
  metadata             JSONB          NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at      ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email  ON orders (LOWER(customer_email));
CREATE INDEX IF NOT EXISTS idx_orders_user_id         ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number    ON orders (order_number);

-- ── ORDER ITEMS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ml_item_id      TEXT,
  product_sku     TEXT,
  product_name    TEXT          NOT NULL DEFAULT '',
  product_image   TEXT,
  variant_name    TEXT,
  quantity        INTEGER       NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          TEXT          NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);

-- ── CATEGORIES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  parent_id   UUID    REFERENCES categories(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PRODUCTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  ml_item_id      TEXT           NOT NULL UNIQUE,
  title           TEXT           NOT NULL DEFAULT '',
  slug            TEXT           NOT NULL UNIQUE,
  description     TEXT,
  category_id     UUID           REFERENCES categories(id),
  category_slug   TEXT,
  price           NUMERIC(12,2)  NOT NULL DEFAULT 0,
  original_price  NUMERIC(12,2),
  currency        TEXT           NOT NULL DEFAULT 'ARS',
  stock           INTEGER        NOT NULL DEFAULT 0,
  condition       TEXT           NOT NULL DEFAULT 'new',
  status          TEXT           NOT NULL DEFAULT 'active',
  thumbnail       TEXT,
  permalink       TEXT,
  seller_id       TEXT,
  attributes      JSONB          NOT NULL DEFAULT '[]',
  tags            JSONB          NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  metadata        JSONB          NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_products_ml_item_id    ON products (ml_item_id);
CREATE INDEX IF NOT EXISTS idx_products_category_slug ON products (category_slug);
CREATE INDEX IF NOT EXISTS idx_products_status        ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_price         ON products (price);

-- ── PRODUCT VARIANTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ml_variation_id TEXT,
  attributes      JSONB          NOT NULL DEFAULT '[]',
  attr_key        TEXT,
  price           NUMERIC(12,2),
  stock           INTEGER        NOT NULL DEFAULT 0,
  thumbnail       TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_product_id    ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_ml_variation  ON product_variants (ml_variation_id);

-- ── PRODUCT IMAGES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT    NOT NULL,
  secure_url  TEXT,
  width       INTEGER,
  height      INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_product_id ON product_images (product_id);

-- ── TIENDA SESSIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tienda_sessions (
  sid        VARCHAR(128) PRIMARY KEY,
  user_id    UUID         NOT NULL,
  email      TEXT         NOT NULL,
  nombre     TEXT,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON tienda_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON tienda_sessions (user_id);

-- ── ML REVIEWS CACHE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ml_reviews_cache (
  item_id    TEXT    NOT NULL,
  offset_val INTEGER NOT NULL DEFAULT 0,
  data       JSONB   NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, offset_val)
);

-- ── Permisos para wzmallas_app ────────────────────────────────
GRANT USAGE ON SCHEMA public TO wzmallas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wzmallas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wzmallas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wzmallas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wzmallas_app;

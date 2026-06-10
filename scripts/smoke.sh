#!/bin/bash
# Smoke test: chequeos rápidos de salud contra un server WZMALLAS corriendo.
# Uso: ./smoke.sh [BASE_URL]   (default: http://localhost:3000)
#
# Pensado para correr ANTES y DESPUÉS de cada deploy/refactor (ej. la
# modularización de server.js): si algo se rompe, esto lo detecta en
# segundos sin tocar datos reales (solo GETs + 1 POST de login inválido).
set -u
BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

# check_status URL EXPECTED_STATUS [DESCRIPCION]
check_status() {
  local path="$1" expected="$2" desc="${3:-$1}"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  if [ "$code" = "$expected" ]; then
    echo "  OK   $desc ($code)"
    PASS=$((PASS+1))
  else
    echo "  FAIL $desc — esperado $expected, recibido $code"
    FAIL=$((FAIL+1))
  fi
}

# check_body URL PATTERN [DESCRIPCION] — verifica status 200 + que el body matchee un patrón
check_body() {
  local path="$1" pattern="$2" desc="${3:-$1}"
  local body code
  body=$(curl -s -w '\n%{http_code}' "$BASE$path")
  code=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')
  if [ "$code" = "200" ] && echo "$body" | grep -q "$pattern"; then
    echo "  OK   $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL $desc — status=$code, patrón '$pattern' no encontrado"
    FAIL=$((FAIL+1))
  fi
}

# check_header URL HEADER_REGEX [DESCRIPCION] — verifica que un header matchee
check_header() {
  local path="$1" pattern="$2" desc="${3:-$1}"
  local headers
  headers=$(curl -s -I "$BASE$path")
  if echo "$headers" | grep -qi "$pattern"; then
    echo "  OK   $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL $desc — header '$pattern' no encontrado"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Smoke test: $BASE ==="

echo "--- Tienda pública (HTML) ---"
check_body   "/tienda/index.html"      "<!DOCTYPE html>"     "index.html sirve HTML"
check_body   "/tienda/catalogo.html"   "<!DOCTYPE html>"     "catalogo.html sirve HTML"
check_header "/tienda/index.html"      "cache-control: no-store" "index.html no cacheado"
check_header "/tienda/index.html"      "x-frame-options: DENY"   "index.html tiene X-Frame-Options"
check_header "/tienda/index.html"      "content-security-policy"  "index.html tiene CSP"

echo "--- Assets versionados (cache immutable) ---"
check_header "/tienda/components/cart.js?v=5"        "immutable" "cart.js?v= → immutable"
check_header "/tienda/css/design-system.css?v=6"     "immutable" "design-system.css?v= → immutable"

echo "--- API pública ---"
check_body "/api/tienda/productos"   '"productos"'   "GET /api/tienda/productos"
check_body "/api/tienda/categorias"  '"categorias"\|\['  "GET /api/tienda/categorias"
check_body "/api/tienda/stats"       '{'             "GET /api/tienda/stats"

echo "--- robots / sitemap ---"
check_status "/robots.txt"         200 "robots.txt"
check_status "/tienda/sitemap.xml" 200 "sitemap.xml"

echo "--- Seguridad: archivos bloqueados / paths sensibles ---"
check_status "/config.json"            404 "config.json bloqueado"
check_status "/Stockroom/server.js"    404 "server.js no servible"
check_status "/backups/"               404 "/backups/ no servible"
check_status "/tienda/../server.js"    404 "path traversal bloqueado"

echo "--- Admin ---"
# Nota: desde localhost/IP confiable el panel admin NO pide login (by design,
# ver auth.json trusted_ips). Por eso acá esperamos 200, no 401 — lo que
# importa es que el endpoint responda bien (no 500/crash).
check_body "/api/tienda/admin/audit-log" '{'           "GET admin/audit-log responde"
check_body "/api/tienda/admin/productos" '"productos"' "GET admin/productos responde"

echo ""
echo "=== Resultado: $PASS OK / $FAIL FAIL ==="
[ "$FAIL" -eq 0 ]

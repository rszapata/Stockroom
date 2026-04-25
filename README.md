# Stockroom — Gestión multi-cuenta MercadoLibre

Plataforma web self-hosted para gestionar inventario, ventas y cobros en múltiples cuentas de MercadoLibre Argentina desde una sola interfaz.

## ¿Qué resuelve?

MercadoLibre no ofrece panel multi-cuenta ni herramientas para sincronizar stock entre publicaciones idénticas en distintas cuentas. Este proyecto reemplaza el flujo manual (Excel + panel ML por separado) con una app local que centraliza todo.

## Funcionalidades

| Módulo | Descripción |
|---|---|
| **Dashboard** | KPIs del día, pedidos para despachar (filtrados por estado real de envío) |
| **Stock & Analytics** | Inventario consolidado, gráficos de rotación, generador de órdenes de compra |
| **Vinculaciones** | Sincronización automática de stock entre publicaciones equivalentes en distintas cuentas (dry-run + aprobación manual) |
| **Publicaciones** | Creación y gestión con autocompletado de categorías ML |
| **Migración** | Duplicación de publicaciones entre cuentas con mapeo de variantes |
| **Cobros** | Liquidación cada 10 días (fundas vs socios). Cálculo de **costo Flex** parseando el Excel de ML por CP del comprador |

## Stack

- **Backend**: Node.js puro (sin frameworks) — servidor HTTP proxy con whitelist anti-SSRF
- **Frontend**: HTML5 + Tailwind CSS + Vanilla JS — diseño dark mode, PWA instalable
- **Scripts**: Python 3.12 + openpyxl — procesamiento de Excel de ventas ML
- **Auth**: OAuth 2.0 multi-cuenta con refresh automático de tokens

## Instalación

### Requisitos

- Node.js ≥ 18
- Python 3.12 + pip

```bash
pip install openpyxl pandas
```

### Configuración

1. Clonar el repositorio.
2. Copiar `config.example.json` → `config.json` y completar con tus credenciales ML:

```json
{
  "active": "cuenta1",
  "accounts": [
    {
      "id": "cuenta1",
      "label": "Mi cuenta",
      "client_id": "TU_APP_ID",
      "client_secret": "TU_SECRET",
      "user_id": "",
      "access_token": "",
      "refresh_token": ""
    }
  ]
}
```

3. Registrar la app en [MercadoLibre Developers](https://developers.mercadolibre.com.ar/) con redirect URI `http://localhost:3000/oauth/callback`.

### Ejecutar

```bash
node server.js
```

Abrir [http://localhost:3000](http://localhost:3000).

Para autorizar una cuenta ML, ir a `http://localhost:3000/oauth/start`.

## Seguridad

- Servidor escucha en `0.0.0.0:3000` por defecto — usar detrás de Cloudflare Tunnel o VPN para acceso remoto seguro.
- Whitelist de paths ML permitidos (previene uso del token para requests arbitrarios).
- CSP estricta, HSTS, X-Frame-Options, COOP/CORP en todas las respuestas.
- Archivos sensibles (`config.json`, `*.json` de datos) bloqueados por el servidor y excluidos del repo.

## Archivos generados localmente (no en repo)

| Archivo | Contenido |
|---|---|
| `config.json` | Credenciales OAuth y tokens |
| `vinculaciones.json` | Grupos de publicaciones vinculadas |
| `flex_zones.json` | Mapeo CP → zona de envío Flex |

## Estructura

```
server.js              Servidor Node.js (proxy + endpoints propios)
index.html             Dashboard
analytics.html         Stock & Analytics
publicaciones.html     Gestión de publicaciones
vinculaciones.html     Sincronización de stock multi-cuenta
migracion.html         Migración entre cuentas
cobros.html            Liquidaciones y costo Flex
genera_cobro.py        Script procesamiento Excel ML (cobros)
genera_orden_compra.py Script generador de órdenes de compra
flex_cost.py           Script cálculo costo Flex por Excel ML
sw.js                  Service Worker (PWA)
```

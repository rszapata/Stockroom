# ESTADO — Reestructuración UI Stockroom

Resumen de cambios aplicados sobre la master local (`C:\Users\frexz1\Downloads\ML`).
Objetivo: unificar todas las páginas al mismo look del Dashboard / Vinculaciones
(sidebar fijo + header sticky + acct switcher, paleta neutral-dark, amarillo
`#FFE600`, sin azul, sin tema cyber, bordes redondeados).

---

## 1. Patrón unificado de layout

Todas las páginas migradas siguen la misma estructura inline (ya no dependen de
`shell.js`):

```html
<body class="bg-neutral-950 text-neutral-200 antialiased min-h-screen">

  <aside class="fixed left-0 top-0 bottom-0 w-16 bg-neutral-900 ...">
    <!-- logo brand + nav .side-item + footer oauth/logout -->
  </aside>

  <div class="pl-16 min-h-screen relative z-10">
    <header class="sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-xl
                   border-b border-neutral-800">
      <!-- title + subtitle con .pulse-dot + acct switcher -->
    </header>
    <main> ... </main>
  </div>

</body>
```

CSS común inyectado en cada archivo: `.side-item`, `.side-item.active::before`
(barrita amarilla), `.tip` (tooltip), `.pulse-dot` (verde animado),
`.drp-panel`, reset de `accent-color`/`::selection`/`color-scheme:dark`,
ocultamiento de `.m-bottom-nav` / `.m-drawer` / `.m-fab`.

Fuentes: Inter + JetBrains Mono (se eliminaron Space Mono / DM Sans).
Tailwind CDN con `brand: '#FFE600'` en config.

---

## 2. Archivos modificados

### `vinculaciones.html`
- Rediseño completo al patrón inline (referencia usada para el resto).
- Card de **Log** movido arriba de **Grupos Vinculados** para visibilidad
  inmediata sin scroll.

### `cobros.html`
- Fuentes reemplazadas por Inter + JetBrains Mono.
- Sidebar + header inline (wallet icon activo).
- `--ye` forzado a `#FFE600`.
- `body::before` (grid cyber) deshabilitado (`display:none`).
- CSS legacy del header viejo eliminado (`.logo`, `.logo-dot`, `.live`,
  `.meli-badge`, `.hright`, `.nav-btn`).
- Bloque de *rounded overrides* (cards 14px, botones 10px, inputs 10px, etc.).
- Se removió `<link rel="stylesheet" href="/mobile.css">`.
- Se removió `<script src="/theme.js">` y `<script src="/mobile.js">`.
- `initAccountLabel()` actualiza la inicial del avatar (ya no muestra "?").
- `acct-label` con `class="inline"` (antes `hidden sm:inline` ocultaba el
  nombre en el preview).

### `migracion.html`
- Mismo tratamiento que cobros (shuffle icon activo).
- `--ye: #FFE600`, grid cyber off, CSS legacy eliminado, rounded overrides.
- Sin `mobile.css`, `theme.js`, `mobile.js`.
- Fix: `document.getElementById('updated')` protegido con guard (`if (upd)`)
  — antes crasheaba silenciosamente e impedía la carga de cuentas en los
  selects y el switcher.
- `initAccountLabel()` actualiza inicial del avatar.
- `acct-label` con `class="inline"`.

### `publicaciones.html`
- Mismo tratamiento (+ square icon activo).
- Se quitó `<script src="/shell.js" defer>` — ya no se usa.
- Header `<body data-shell-page="publicaciones" ...>` → body tailwind limpio.
- CSS legacy del header viejo eliminado.
- Sin `theme.js`, `mobile.js`.
- Rounded overrides aplicados.
- `initAccountLabel()` actualiza inicial del avatar.
- `acct-label` con `class="inline"`.

### `theme.js`
- **Sistema de temas completamente neutralizado**. Ahora es un stub que:
  - Borra la clave `stockroom_theme` del localStorage.
  - Elimina `data-theme` del `<html>` y limpia las CSS vars inyectadas.
  - Remueve cualquier `.theme-opt` / `#theme-picker` del DOM.
  - Expone `window.__setTheme` / `window.__getTheme` como no-op.
- **Ya no se carga** desde ninguna página activa (tags `<script>` removidos
  de cobros, migracion, publicaciones y vinculaciones). Solo queda por si
  algún legacy lo referencia.

### `analytics.html`
- `buildAlerts()` convertido en no-op: ya no aparecen las 5 líneas violetas
  ("Alta rotación") al clickear el KPI; sólo se muestra la tabla filtrada.
- **Carga paralela optimizada**: búsqueda de IDs y detalle de items ahora
  lanzan hasta 5 requests en paralelo (antes eran secuenciales). Con 200+
  publicaciones esto da ~4-5x más velocidad.

### `sw.js`
- Cache version bumped a `stockroom-v3`.
- Removidos `/mobile.css` y `/mobile.js` del array de STATIC_ASSETS.
- Agregados `/vinculaciones.html` y `/shell.js`.

### `.claude/launch.json`
- Configurado para `server.js` en puerto 3000.

---

## 3. Colores — antes / después

| Variable | Antes (cyber) | Ahora |
|---|---|---|
| `--ye` | `#e8ff47` (lime) | `#FFE600` (brand) |
| tema `corporate` `--ye` | `#8ab4f8` (azul) | desactivado |
| `.theme-opt.active` bg | `rgba(37,99,235,.06)` (azul) | desactivado |
| `body::before` grid cyber | visible | `display:none` |

Reset global en cada página redesigned:
```css
html, body, input, select, textarea, button { accent-color:#FFE600; color-scheme:dark; }
::selection { background: rgba(255,230,0,.35); color:#fff; }
*:focus-visible { outline: 1px solid #FFE600; outline-offset: 2px; }
```

---

## 4. Bordes redondeados — override aplicado

```css
.card, .kpi, .chart-card, .upload-card, .flex-card,
.setup-box, .bulk-top, .prog-card, .log-wrap { border-radius: 14px !important; }
.btn                                           { border-radius: 10px !important; }
.btn.sm                                        { border-radius: 8px  !important; }
.field input, .field select, .field textarea,
input[type=text|search|number|file],
select, textarea                               { border-radius: 10px !important; }
.items-table, .var-table, .table-wrap          { border-radius: 12px; overflow:hidden; }
.img-zone, .dropzone, .bulk-zone               { border-radius: 12px !important; }
```

---

## 5. Navegación consistente

Sidebar común con orden / iconos fijos:

1. Dashboard (`/`)                        — home
2. Stock & Analytics (`/analytics.html`)  — barras
3. Publicar (`/publicaciones.html`)       — `+` en cuadrado
4. Vinculaciones (`/vinculaciones.html`)  — eslabón
5. Migración (`/migracion.html`)          — shuffle
6. Cobros (`/cobros.html`)                — wallet

Footer sidebar: conectar cuenta ML (`/oauth/start`) + cerrar sesión (`/logout`).

---

## 6. Código muerto eliminado

| Qué | Acción |
|---|---|
| CSS legacy header (`.logo`, `.nav-btn`, etc.) | Eliminado de cobros, migracion, publicaciones |
| `<script src="/theme.js">` | Removido de cobros, migracion, publicaciones, vinculaciones |
| `<script src="/mobile.js">` | Removido de cobros, migracion, publicaciones |
| `<link href="/mobile.css">` | Removido de cobros, migracion, publicaciones |
| `analytics-legacy.html` | Archivo eliminado |
| `index-legacy.html` | Archivo eliminado |
| `/mobile.css` y `/mobile.js` en sw.js | Removidos del cache |

---

## 7. Fondo unificado en todas las páginas

`body::before` con radial-gradient amarillo + azulado, idéntico en las 5
páginas para dar consistencia visual:

```css
body::before {
  content: ''; position: fixed; inset: 0;
  background-image:
    radial-gradient(circle at 20% 10%, rgba(255,230,0,0.04) 0%, transparent 40%),
    radial-gradient(circle at 80% 90%, rgba(120,180,255,0.03) 0%, transparent 40%);
  pointer-events: none; z-index: 0;
}
```

- `index.html`, `vinculaciones.html`: ya lo tenían.
- `analytics.html`: lo inyecta `shell.js` (mismo gradient).
- `cobros.html`, `migracion.html`: tenían `body::before { display:none !important }`
  (legado del tema cyber). Reemplazado por el gradient.
- `publicaciones.html`: no tenía `body::before`. Agregado.

---

## 8. Fix "Pedidos para despachar" — filtrar ya-despachados

El endpoint `GET /despachos-hoy` consultaba ML con
`shipping.status=ready_to_ship`, pero ese estado a veces incluye órdenes cuyo
substatus indica que ya están en camino (`picked_up` cuando el chofer Flex la
retiró, `dropped_off` cuando se entregó al carrier, etc.). Estaban
contaminando el conteo de "para despachar".

Cambios en `server.js`:
- Ahora se hace `await Promise.all(orders.map(o => mlGet('/shipments/' + o.shipping.id)))`
  en paralelo para obtener el estado real del shipment (la flag a nivel order
  queda desactualizada).
- Se filtra excluyendo substatus en `DISPATCHED_SUBSTATUS`: `picked_up`,
  `dropped_off`, `in_hub`, `in_packing_list`, `shipped`, `delivered`,
  `not_delivered`, `cancelled`, `returning_to_sender`, `returned`,
  `forwarded_to_third`. También se descartan órdenes cuyo `shipment.status`
  ya cambió a algo distinto de `ready_to_ship`.
- La respuesta incluye `shipping_status`, `shipping_substatus` por orden y
  un `filtered: N` con el conteo de órdenes excluidas.
- Logs `[despachos-hoy] Filtrado <id>: ...` para auditar.

Cambios en `index.html`:
- Badge sutil junto al título "Pedidos para despachar" mostrando
  "−N ya en camino" cuando se filtra al menos una orden.

---

## 9. Auto-detect (modo dry-run) — vinculaciones

**Modo actual: detección sin aplicar.** El toggle Auto-sync detecta ventas y
propone ajustes pero no toca ML hasta que el usuario clickea "Aplicar".

### Server (`server.js`)
- Endpoint `POST /vinculaciones/check-orders` ahora acepta body
  `{ dryRun: boolean }`.
- Si `dryRun: true`: hace toda la detección (orders recientes + stocks reales)
  pero **no llama a `mlPutAuth`**. Devuelve `{ details: [...] }` con cada
  propuesta (group, groupId, accountId, acctLabel, item, title, thumb, from,
  to, hasVars).
- Si `dryRun: false` (o ausente): comportamiento original — aplica las
  modificaciones via PUT a /items.

### Frontend (`vinculaciones.html`)
- Nueva card naranja "Ajustes pendientes detectados" entre Log y Grupos.
  Visible sólo cuando hay propuestas.
- `autoCheck()` ahora envía `{ dryRun: true }` cada vez que dispara el
  intervalo. Las propuestas nuevas se mergean a `pendingSyncs[]` global
  (sin duplicar por itemId).
- `renderPending()` agrupa las propuestas por grupo y las muestra como
  filas: thumb + cuenta + título + `xFROM → xTO` (rojo→verde).
- Botón **Aplicar todo**: confirma + reenvía el endpoint con
  `dryRun: false`. Limpia `pendingSyncs` y refresca grupos.
- Botón **Descartar**: vacía `pendingSyncs` (no aplica nada).
- Status del header: `"HH:MM · N pendientes"` (naranja) si hay propuestas,
  o `"HH:MM · N desync"` si hay grupos con stocks distintos pero sin venta
  reciente, o `"HH:MM · OK"` (verde).

Una vez confirmado que detecta correctamente las ventas y propone los ajustes
acertados → cambiar `dryRun: true` por `dryRun: false` en `autoCheck()` para
volver al modo automático.

Estado persistente: el toggle ON/OFF y el intervalo se guardan en
`localStorage` (`vinc_autosync`, `vinc_autosync_ms`).

---

## 10. Responsive mobile — vinculaciones

La tabla interna de cada grupo vinculado tenía 7 columnas y `.link-group` con
`overflow: hidden` — en iPhone la columna Stock quedaba recortada sin poder
scrollearse. Cambios:

- Tabla envuelta en `<div class="lg-tbl">` con `overflow-x: auto` +
  `-webkit-overflow-scrolling: touch` y `min-width: 560px`, permitiendo
  scroll horizontal en mobile manteniendo el `border-radius` del card.
- `@media (max-width: 640px)`:
  - `.lg-header` wrapea: nombre del grupo full-width arriba, badge + stock
    en la segunda línea.
  - Columna `ID` oculta (`nth-child(5)`) — el ID queda fuera de vista salvo
    si scrolleas.
  - Paddings/font-size de celdas compactados.
  - `.lg-actions` con botones `flex: 1 1 auto` que llenan la fila.

---

## 11. Account switcher unificado

El dropdown del avatar ahora tiene el mismo formato en las 5 páginas (dashboard,
analytics, publicaciones, vinculaciones, migracion, cobros):

- Header con "Cuenta activa" + label + `user_id` en mono.
- Lista con avatar gradient (inicial), label, user_id, checkmark ✓ brand en la
  activa y badge rojo `SIN TOKEN` cuando aplica.
- Botón `REN` que aparece on-hover para renombrar.
- Footer con `+ Nueva cuenta` → `/oauth/start`.
- Panel: `w-72`, `rounded-xl`, `shadow-pop`, `drp-panel` animación.

Archivos tocados: `publicaciones.html`, `vinculaciones.html`, `migracion.html`,
`cobros.html` (reemplazada la render con `<div style="...">` inline por la
estructura tailwind del dashboard). `vinculaciones.html` ganó además funciones
`switchAcct()` / `renameAcct()` que antes no tenía.

---

## 12. Qué queda activo del stack legacy

- `shell.js` — solo lo usa `analytics.html` (inyecta sidebar+header ahí).
- `mobile.js` y `mobile.css` — archivos existen en disco pero ninguna página
  activa los carga. Se podrían borrar.
- `theme.js` — stub no-op, no se carga desde ninguna página activa.

---

## 13. Costo Flex por período (cobros.html)

Sistema para calcular el gasto de envíos Flex por ventana de cobro
(1-10 / 11-20 / 21-fin). Tarifas hardcoded:

| Zona        | Tarifa |
|-------------|-------:|
| CABA        | 4490   |
| GBA cercano | 6490   |
| GBA lejano  | 8490   |

### Backend (`server.js`)

- `GET /flex-zones` → `{ zones: { cp: zone, ... }, tariffs }`
- `POST /flex-zones` → guarda asignaciones. Body: `{ cp, zone }` (uno) o
  `{ zones: { cp: zone, ... } }` (batch). Zonas válidas: `caba`, `gba_cerca`,
  `gba_lejos`, `sin_zona`. `zone: ''` borra la entrada.
- `GET /flex-cost?from=YYYY-MM-DD&to=YYYY-MM-DD&accountId=all|<id>` →
  - Pagina `/orders/search` por fecha (hasta 1000 órdenes/cuenta).
  - Para cada `shipping.id`, consulta `/shipments/{id}` (chunks de 8 paralelos).
  - Filtra `logistic_type === 'self_service'` (Flex) y excluye cancelados/
    devueltos.
  - Auto-clasifica CABA: CP que matchea `/^C\d{4}/` o numérico 1000-1499.
  - Para todo otro CP, busca en `flex_zones.json`.
  - Devuelve `{ flex_shipments, mapped_count, unmapped_count, total_cost,
    breakdown[], unmapped[], per_account, errors }`.
- Persistencia: `flex_zones.json` (no commiteado, gitignore-safe ya que está
  fuera de la lista BLOCKED_FILES — pero el server bloquea el acceso por
  basename).

### UI (`cobros.html`)

Nueva sección "Costo Flex del período" con:

- Selector mes (últimos 6) + ventana 1-10/11-20/21-31 + cuenta (o todas).
- KPIs: envíos Flex / clasificados / pendientes / costo total.
- Tabla breakdown: CP, zona, dirección de muestra, envíos, tarifa, subtotal.
- Card naranja "CPs PENDIENTES" para CPs sin clasificar:
  - Cada fila muestra CP, dirección de muestra (calle · barrio · ciudad ·
    provincia que devuelve ML), cantidad de envíos, link Google Maps, dropdown
    de zona.
  - Pre-llena la sugerencia automática (CABA si CP empieza con C).
  - Botón "Auto-asignar sugeridos" (forzar GBA cercano para los huérfanos).
  - Botón "Guardar y recalcular" → `POST /flex-zones` batch + recalcula.

### Flujo esperado

1. Usuario selecciona mes + ventana, click "Calcular".
2. Primera vez aparecen muchos CPs en pendientes. Asigna manualmente (con ayuda
   del Maps link para los ambiguos tipo La Plata norte/sur).
3. Click "Guardar y recalcular" → CPs quedan en `flex_zones.json`, tabla se
   recalcula con el costo actualizado.
4. Próximas ventanas, los CPs ya conocidos se clasifican solos. Sólo aparecen
   pendientes los CPs nuevos (compradores de zonas no vistas antes).

---

## 14. Costo Flex — pivot a parseo de Excel (sección 13 obsoleta para uso real)

Después de inspeccionar el Excel de ventas de ML descubrimos que tiene todo lo
que necesitamos sin llamar a la API:

- col 13 "Costos de envío (ARS)" → trae costo para envíos NO-Flex (Correo,
  punto de despacho). Para Flex viene VACÍA, lo que confirma que ML no expone
  costo de Flex en ningún lado.
- col 40 "Código postal" → CP del comprador
- col 42 "Forma de entrega" → contiene literal "Mercado Envíos Flex"
- col 38/39/37 → Ciudad / Estado / Domicilio (para mostrar en pendientes)
- col 2 "Fecha de venta" → formato `"20 de abril de 2026 23:49 hs."` (string,
  necesita parseo manual con `MESES_ES`)

### Backend

- **Nuevo script `flex_cost.py`** (mismo patrón que `genera_cobro.py`):
  - Lee Excel con openpyxl, busca header row dinámicamente.
  - Filtra `Flex` en col 42, excluye estados cancelados/devueltos.
  - Filtra por período (1=días 1-10, 2=11-20, 3=21-31) usando la fecha
    parseada en español.
  - Carga `flex_zones.json` (mismo archivo que el flujo anterior).
  - Auto-clasifica CABA por CP (`/^C\d{4}/` o numérico 1000-1499).
  - Imprime `FLEX_JSON:{...}` en stdout.
- **Nuevo endpoint `POST /flex-cost-excel`** (multipart: `file` + `periodo`).
  Spawn de python igual que `/cobro`, parsea `FLEX_JSON:` del stdout.
- Endpoints `/flex-zones` GET/POST se mantienen (mapa CP→zona compartido).
- Endpoint `/flex-cost` (vía API) sigue existiendo como fallback pero la UI ya
  no lo usa.

### UI (`cobros.html`)

La sección "Costo Flex del período" ahora tiene:

- Dropzone `dz-flex` para subir el mismo Excel de ML.
- Selector de período 1-10/11-20/21-31/Todo.
- Botón "Calcular" → POST a `/flex-cost-excel`.
- KPIs incluyen ahora `Período <date_range[0]> → <date_range[1]>` para
  confirmar al usuario qué fechas detectó el script.
- Resto del flujo idéntico al anterior: tabla breakdown, card naranja con
  pendientes, dropdowns de zona, botón "Guardar y recalcular".

### Beneficios del pivot

- **Velocidad**: instantáneo (parseo local) vs 30-60s con API + paginación.
- **Confiabilidad**: no depende de tokens vivos ni rate limits ML.
- **Retrocompatibilidad**: usuario usa el mismo Excel que ya descarga para
  fundas/otros — un solo archivo cubre los 3 cobros del período.

### Test con archivo real

`20260424_Ventas_AR_*.xlsx` (período 11-20 abril 2026):
- 53 filas totales, 20 envíos Flex, 5 auto-clasificados CABA = $22450, 15
  pendientes (incluye CP 1629 Pilar ×2, CP 1900 La Plata ×2, CP 1669 Del Viso
  ×2, etc.) que requieren clasificación manual la primera vez.

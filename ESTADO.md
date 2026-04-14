# ESTADO ACTUAL - Stockroom

## Ultima actualizacion
**Fecha:** 2026-04-13  
**Cuenta:** Cuenta A (Claude Opus)  
**Commit:** `567f503` en branch `master`

---

## Cambios Criticos Recientes

### 1. Fix filtrado Flex PDF - `server.js` linea ~1209
**Problema:** El PDF de flex de "hoy" incluia envios programados para el dia siguiente.  
**Causa:** La condicion `esDeHoy` usaba 3 criterios con OR (`deliveryDay || handlingDay || updatedDay`), y `updatedDay === today` era demasiado amplio — incluia cualquier envio actualizado hoy aunque su entrega fuera manana.  
**Solucion:** Se cambio a filtrar SOLO por `deliveryDay === today` (fecha de entrega estimada de ML), que respeta el corte de las 12:00hs de MercadoLibre.

### 2. Fix timezone Argentina - `server.js` lineas ~1171 y ~1328
**Problema:** Las ventas de hoy mostraban 13 ventas cuando habia solo 1 en el dia.  
**Causa:** La formula `(argOffset - now.getTimezoneOffset()) * 60000` calculaba mal en PCs con timezone Argentina. En una PC con `getTimezoneOffset() = 180`, el calculo daba `-180 - 180 = -360` (restaba 6 horas en vez de 3), mostrando la fecha de ayer.  
**Solucion:** Se simplifico a `new Date(now.getTime() - 3 * 3600000)` que siempre resta 3 horas de UTC, sin importar el timezone de la PC. Esto afecta tanto `/ventas-hoy` como `/flex-pdf-todos`.

### 3. Fotos de variantes en despachos - `server.js` endpoint `/despachos-hoy`
**Cambio:** El endpoint ahora hace fetch de `/items/{id}` en paralelo para cada item unico, busca la foto especifica de la variacion vendida (`variation.picture_ids[0]`), con fallback a la primera foto del producto o thumbnail. Devuelve el campo `picture` en cada item.

### 4. Frontend despachos con imagenes - `analytics.html` funcion `cargarDespachos()`
**Cambio:** Cada producto en la tabla muestra una imagen de 40x40px a la izquierda del titulo. Se usa el campo `picture` que ahora devuelve el servidor.

### 5. Responsive mobile despachos - `analytics.html`
**Cambio:** En pantallas <768px se ocultan las columnas `#` (numero de venta) y `Comprador` usando clase CSS `dh-hide-mobile`. Se elimino la columna `Cant.` porque la cantidad ya aparecia duplicada en el texto del producto (ej: "2x Producto").

### 6. Fecha en titulo ventas de hoy - `analytics.html` funcion `cargarVentasHoy()`
**Cambio:** El titulo de la seccion ahora muestra "Ventas del DD/MM/YYYY" usando `data.today` que devuelve el servidor, en vez del generico "Ventas de hoy". Se agrego `id="vh-title"` al span del titulo.

---

## Archivos Modificados

| Archivo | Que se toco |
|---|---|
| `server.js` | Fix `esDeHoy` en flex-pdf-todos, fix timezone en ventas-hoy y flex-pdf-todos, fotos de variantes en despachos-hoy |
| `analytics.html` | Imagenes en tabla despachos, responsive mobile despachos, fecha en titulo ventas |

---

## Estado Actual del Proyecto

### Funcionando correctamente
- [x] Login y auth con MercadoLibre
- [x] Dashboard analytics
- [x] Ventas de hoy (filtrado por fecha corregido)
- [x] Despachos para despachar (con fotos de variantes)
- [x] Generacion PDF Flex (filtrado por deliveryDay)
- [x] Proxy ML API con whitelist

### Pendiente / A revisar


---

## Notas Importantes
- El servidor corre en puerto 3000
- Timezone hardcodeado a Argentina UTC-3 (no usa horario de verano porque Argentina no lo usa)
- MercadoLibre API: el corte flex es a las 12:00hs Argentina, ventas despues de esa hora tienen `deliveryDay` del dia siguiente
- Las fotos de variantes se obtienen haciendo fetch paralelo a `/items/{id}` por cada item unico en las ordenes

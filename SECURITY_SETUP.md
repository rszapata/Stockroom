# Stockroom — Quick Tunnel + Auth (sin dominio)

Setup para exponer Stockroom **sin dominio propio**, usando un quick tunnel de Cloudflare (`*.trycloudflare.com`) y notificación de la URL por Telegram cada vez que cambia.

> ⚠ El quick tunnel **no soporta Cloudflare Access**. La protección viene de la **contraseña + sesión httpOnly** que se agregó al servidor. NO arranques el tunnel sin haber configurado `auth.json`.

---

## 1. Instalar dependencias

```bash
winget install --id Cloudflare.cloudflared
```

Verificá: `cloudflared --version`

Node ya lo tenés.

---

## 2. Crear el bot de Telegram

1. Abrí Telegram → buscá **@BotFather** → `/newbot`
2. Elegí un nombre y username. Te devuelve un **bot token** (tipo `123456:ABCdef...`).
3. Buscá tu bot por username en Telegram y mandale `hola` (cualquier mensaje). Esto registra tu chat con el bot.
4. Tu **chat_id** ya lo tenés: `8502065925`.

(Para verificar el chat_id: `https://api.telegram.org/bot<TOKEN>/getUpdates`)

---

## 3. Crear `auth.json`

Copiá `auth.example.json` a `auth.json` y completá:

```json
{
  "password": "una-contraseña-larga-y-única",
  "session_secret": "no-hace-falta-pero-podes-poner-algo-random",
  "telegram": {
    "bot_token": "123456:ABCdef...",
    "chat_id": 8502065925
  }
}
```

`auth.json` ya está en `.gitignore`.

> 💡 Usá una contraseña **única** (no la que usás en otros lados). Mínimo 16 caracteres random.

---

## 4. Probar localmente

```bash
node server.js
```

Abrí http://localhost:3000 — debería redirigir a `/login.html`. Probá la contraseña.

Cuando funciona, cerralo (Ctrl+C).

---

## 5. Encender todo

Doble click en **`start.bat`** — abre dos ventanas:
- **Stockroom Server** (`node server.js`)
- **Stockroom Tunnel** (`node tunnel.js`) — lanza cloudflared y, cuando detecta la URL, te la manda por Telegram.

Mensaje que vas a recibir:
```
🚀 Stockroom online

https://random-words-1234.trycloudflare.com

(Esta URL cambia cada vez que reiniciás el tunnel)
```

Abrí esa URL en tu celular → vas a ver la pantalla de login → metés la contraseña → entrás.

---

## 6. Cerrar todo

Cerrá las dos ventanas (Stockroom Server / Stockroom Tunnel) o Ctrl+C en cada una.

---

## Qué quedó implementado en el código

1. **Bind a `127.0.0.1`** — solo el mismo equipo (cloudflared) habla con el server.
2. **Whitelist de paths del proxy ML** — `/api/`, `/api-as/`, `/api-public/` solo dejan pasar rutas conocidas.
3. **Headers de seguridad**: CSP, X-Frame-Options DENY, HSTS, COOP, CORP, etc.
4. **CORS restringido** (no acepta cross-origin).
5. **Bloqueo de path traversal** + **blocklist de archivos sensibles** (`server.js`, `config.json`, `auth.json`, etc.) + **whitelist de extensiones**.
6. **Auth con contraseña** + **sesión httpOnly** (cookie `sr_sid`, 7 días). Sin sesión, todo redirige a `/login.html` y la API devuelve 401.
7. **Quick tunnel + Telegram** — `tunnel.js` lanza cloudflared, detecta la URL `*.trycloudflare.com` y la manda al chat. Reinicia con backoff si crashea.

---

## Si algo sale mal

- **Cortar el tunnel**: cerrá la ventana "Stockroom Tunnel" o `taskkill /F /IM cloudflared.exe`.
- **Sospechás acceso no autorizado**: cerrá ambas ventanas, cambiá la contraseña en `auth.json`, rotá `client_secret` de ML desde DevCenter.
- **No llega el mensaje de Telegram**: revisá que `bot_token` esté bien y que hayas mandado al menos un mensaje al bot. La ventana "Stockroom Tunnel" muestra el error.
- **Olvidaste la contraseña**: editá `auth.json` y reiniciá el server. Las sesiones activas siguen válidas hasta expirar (o reiniciá el server para invalidarlas todas).

---

## Mejoras opcionales (defensa en profundidad)

- **Rate limiting** en `/login` (ya tiene delay de 800ms; podrías agregar bloqueo por IP tras N fallos).
- **2FA TOTP** — agregar un campo más en `auth.json` con un secreto TOTP.
- **Auditoría** — log de cada login (timestamp + IP + User-Agent).
- **Comprar un dominio** ($10/año) y migrar a tunnel con nombre fijo + Cloudflare Access (auth de Google + email allowlist). Mucho más fuerte que password.

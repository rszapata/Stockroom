// ══════════════════════════════════════════════════════════════
//  STOCKROOM — Cloudflare Quick Tunnel + Telegram notifier
//
//  Uso: node tunnel.js
//  Requiere: cloudflared instalado (winget install Cloudflare.cloudflared)
//  Requiere: auth.json con telegram.bot_token y telegram.chat_id
// ══════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');

const AUTH_PATH = path.join(__dirname, 'auth.json');
const PORT      = parseInt(process.env.PORT) || 3000;

if (!fs.existsSync(AUTH_PATH)) {
  console.error('  ✗ Falta auth.json. Copialo de auth.example.json y completá los valores.');
  process.exit(1);
}

let auth;
try { auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); }
catch(e) { console.error('  ✗ auth.json inválido:', e.message); process.exit(1); }

const TG_TOKEN = auth.telegram && auth.telegram.bot_token;
const TG_CHAT  = auth.telegram && auth.telegram.chat_id;
if (!TG_TOKEN || !TG_CHAT) {
  console.error('  ✗ auth.json: falta telegram.bot_token o telegram.chat_id');
  process.exit(1);
}

// ── Telegram ──────────────────────────────────────────────────
function sendTelegram(text) {
  return new Promise(resolve => {
    const body = JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: false });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) { console.log('  ✓ Telegram enviado'); resolve(true); }
        else { console.error('  ✗ Telegram error:', res.statusCode, d); resolve(false); }
      });
    });
    req.on('error', e => { console.error('  ✗ Telegram error:', e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

// ── Cloudflared ───────────────────────────────────────────────
const URL_RX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
let lastUrl = null;
let restartCount = 0;
let proc = null;

function startCloudflared() {
  console.log('  ⟳ Iniciando cloudflared...');
  proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  const onData = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const m = text.match(URL_RX);
    if (m && m[0] !== lastUrl) {
      lastUrl = m[0];
      console.log('\n  ✓ URL detectada:', lastUrl);
      sendTelegram(`🚀 Stockroom online\n\n${lastUrl}\n\n(Esta URL cambia cada vez que reiniciás el tunnel)`);
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('exit', (code) => {
    console.error(`  ✗ cloudflared salió con código ${code}`);
    lastUrl = null;
    restartCount++;
    const delay = Math.min(60000, 2000 * Math.pow(2, Math.min(restartCount, 5)));
    console.log(`  ⟳ Reintentando en ${delay/1000}s...`);
    setTimeout(startCloudflared, delay);
  });

  proc.on('error', (e) => {
    console.error('  ✗ No se pudo lanzar cloudflared:', e.message);
    console.error('    Instalalo con: winget install --id Cloudflare.cloudflared');
  });
}

// Cierre limpio
function shutdown() {
  console.log('\n  ⟳ Cerrando tunnel...');
  if (proc) { proc.removeAllListeners('exit'); try { proc.kill(); } catch(e){} }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('  ┌──────────────────────────────────────────────┐');
console.log('  │   STOCKROOM TUNNEL — quick tunnel             │');
console.log(`  │   Local: http://localhost:${PORT}              │`);
console.log('  │   Notificación: Telegram                      │');
console.log('  └──────────────────────────────────────────────┘');

startCloudflared();

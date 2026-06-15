// ── Estado del sistema: recursos + salud de servicios ────────────────
// Fuente única de verdad para el panel "Estado del sistema" (dashboard de
// Stockroom y admin de tienda), el endpoint /api/stockroom/system y el comando
// /estado de Telegram. Junta todo en un solo getSystemStatus() para no duplicar
// la lógica en las tres superficies.
//
// Depende de estado mutable del server (pool PG, config, último check de stock,
// vencimiento de tokens ML), así que se inyecta vía factory.
//
// @param {object} pool             - pool de PostgreSQL (db/pool.js)
// @param {() => object} getFullConfig   - devuelve fullConfig actual (.accounts, .telegram…)
// @param {() => string|null} getLastVincCheck - ISO del último check de stock
// @param {(acctId:string) => number} getTokenExpiry - epoch ms de expiración del token ML
const os = require('os');
const { exec } = require('child_process');

// Ejecuta un comando de shell con timeout; nunca rechaza (devuelve null si falla
// o si el binario no existe — ej. df/pm2 en Windows de desarrollo).
function shell(cmd, timeoutMs = 4000) {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function createSystemStatus({ pool, getFullConfig, getLastVincCheck, getTokenExpiry }) {

  // Disco del filesystem raíz (Linux/macOS). En Windows devuelve null.
  async function diskUsage() {
    const out = await shell('df -P -k /');
    if (!out) return null;
    const line = out.trim().split('\n').pop();              // última línea = el mount de /
    const cols = line.trim().split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const totalKb = parseInt(cols[1], 10);
    const usedKb  = parseInt(cols[2], 10);
    const availKb = parseInt(cols[3], 10);
    if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
    return {
      total_bytes: totalKb * 1024,
      used_bytes:  usedKb * 1024,
      avail_bytes: availKb * 1024,
      used_pct:    Math.round((usedKb / totalKb) * 100),
    };
  }

  // Procesos administrados por pm2 (nombre, estado, restarts, mem, cpu).
  async function pm2Status() {
    const out = await shell('pm2 jlist');
    if (!out) return null;
    try {
      const list = JSON.parse(out);
      return list.map(p => ({
        name:     p.name,
        status:   p.pm2_env?.status || 'unknown',
        restarts: p.pm2_env?.restart_time ?? 0,
        cpu:      p.monit?.cpu ?? null,
        mem_bytes: p.monit?.memory ?? null,
        uptime_ms: p.pm2_env?.pm_uptime ? (Date.now() - p.pm2_env.pm_uptime) : null,
      }));
    } catch { return null; }
  }

  // Salud de PostgreSQL: ping + latencia + ocupación del pool.
  async function dbHealth() {
    const t0 = Date.now();
    let ok = false;
    try { await pool.query('SELECT 1'); ok = true; } catch { ok = false; }
    return {
      ok,
      latency_ms: ok ? Date.now() - t0 : null,
      pool: {
        total:   pool.totalCount ?? null,
        idle:    pool.idleCount ?? null,
        waiting: pool.waitingCount ?? null,
        max:     pool.options?.max ?? null,
      },
    };
  }

  // Estado de los tokens ML por cuenta (fresco / por vencer / vencido).
  function mlTokens() {
    const accounts = (getFullConfig().accounts || []);
    const now = Date.now();
    return accounts.map(a => {
      const exp = (getTokenExpiry && getTokenExpiry(a.id)) || (a.token_expiry || 0);
      let status = 'desconocido', expires_in_min = null;
      if (exp) {
        expires_in_min = Math.round((exp - now) / 60000);
        if (expires_in_min <= 0)      status = 'vencido';
        else if (expires_in_min < 15) status = 'por_vencer';
        else                          status = 'fresco';
      } else if (a.refresh_token) {
        status = 'sin_refrescar'; // hay refresh token pero todavía no se pidió access
      }
      return { id: a.id, label: a.label || a.id, status, expires_in_min };
    });
  }

  async function getSystemStatus() {
    const mem = { total: os.totalmem(), free: os.freemem() };
    mem.used = mem.total - mem.free;
    mem.used_pct = Math.round((mem.used / mem.total) * 100);

    const [disk, pm2, db] = await Promise.all([diskUsage(), pm2Status(), dbHealth()]);
    const pm = process.memoryUsage();

    return {
      ts: new Date().toISOString(),
      host: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
      uptime_s: Math.round(process.uptime()),
      cpu: { loadavg: os.loadavg().map(n => +n.toFixed(2)), cores: os.cpus().length },
      mem,
      proc: { rss: pm.rss, heap_used: pm.heapUsed, heap_total: pm.heapTotal, pid: process.pid },
      disk,
      db,
      ml: { accounts: mlTokens() },
      last_stock_check: getLastVincCheck ? getLastVincCheck() : null,
      pm2,
    };
  }

  return { getSystemStatus };
}

// ── Helpers de formato (compartidos por el panel y Telegram) ──────────
function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

// Formatea el estado para Telegram (HTML) con semáforos. Pensado para el /estado.
function formatStatusForTelegram(s) {
  const dot = (ok, warn = false) => (ok ? '🟢' : warn ? '🟡' : '🔴');
  const L = [];
  L.push(`📊 <b>Estado del sistema</b> · <code>${s.host}</code>`);
  L.push(`⏱ Uptime: <b>${fmtUptime(s.uptime_s)}</b> · Node ${s.node}`);
  // CPU (load relativo a la cantidad de cores)
  const load1 = s.cpu.loadavg[0];
  const loadPct = s.cpu.cores ? Math.round((load1 / s.cpu.cores) * 100) : 0;
  L.push(`${dot(loadPct < 80, loadPct < 95)} CPU: load ${load1} (${loadPct}% de ${s.cpu.cores} cores)`);
  // RAM
  L.push(`${dot(s.mem.used_pct < 85, s.mem.used_pct < 95)} RAM: ${s.mem.used_pct}% (${fmtBytes(s.mem.used)}/${fmtBytes(s.mem.total)})`);
  // Disco
  if (s.disk) L.push(`${dot(s.disk.used_pct < 85, s.disk.used_pct < 95)} Disco: ${s.disk.used_pct}% (${fmtBytes(s.disk.avail_bytes)} libres)`);
  // Proceso
  L.push(`🧠 Proceso: RSS ${fmtBytes(s.proc.rss)} · heap ${fmtBytes(s.proc.heap_used)}`);
  // DB
  if (s.db) L.push(`${dot(s.db.ok)} PostgreSQL: ${s.db.ok ? `OK (${s.db.latency_ms}ms)` : 'SIN CONEXIÓN'} · pool ${s.db.pool.idle}/${s.db.pool.max} idle${s.db.pool.waiting ? ` · ${s.db.pool.waiting} en espera` : ''}`);
  // Tokens ML
  for (const a of (s.ml?.accounts || [])) {
    const ok = a.status === 'fresco', warn = a.status === 'por_vencer' || a.status === 'sin_refrescar';
    const det = a.expires_in_min != null ? ` (${a.expires_in_min > 0 ? `vence en ${a.expires_in_min}m` : 'vencido'})` : '';
    L.push(`${dot(ok, warn)} Token ${a.label}: ${a.status}${det}`);
  }
  // Último check de stock
  if (s.last_stock_check) {
    const min = Math.round((Date.now() - new Date(s.last_stock_check).getTime()) / 60000);
    L.push(`🔄 Último check de stock: hace ${fmtUptime(min * 60)}`);
  }
  // pm2
  if (s.pm2 && s.pm2.length) {
    const procs = s.pm2.map(p => `${dot(p.status === 'online')} ${p.name} (${p.restarts}↻)`).join(' · ');
    L.push(`⚙️ pm2: ${procs}`);
  }
  return L.join('\n');
}

module.exports = { createSystemStatus, formatStatusForTelegram, fmtBytes, fmtUptime };

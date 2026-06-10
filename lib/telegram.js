// ── Cliente HTTP de bajo nivel para la API de Telegram Bot ──
const https = require('https');

const HTTP_TIMEOUT_MS = 25000; // 25s — igual que el resto de las llamadas a APIs externas

function tgRequest(botToken, method, params) {
  return new Promise(resolve => {
    const payload = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve({ ok: false }); } });
    });
    // ⚠ Excepción: getUpdates usa long-polling con timeout: 25s del lado de TG.
    // Le damos 35s al socket para que TG pueda responder con el timeout completo.
    const isLongPoll = method === 'getUpdates';
    req.setTimeout(isLongPoll ? 35000 : HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error(`tgRequest ${method} timeout`));
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(payload); req.end();
  });
}

module.exports = { tgRequest };

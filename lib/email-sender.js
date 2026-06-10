// ── Email transaccional ───────────────────────────────────────
//
// Configuración en config.json (opcional — si no está, los emails se omiten silenciosamente):
// "email": {
//   "provider": "resend",          ← "resend" | "brevo" (Brevo usa igual endpoint de Resend-compatible) | "gmail"
//   "api_key":  "re_XXXXXX",
//   "from":     "WZMALLAS <noreply@wzmallas.com.ar>",
//   "admin_email": "contacto@wzmallas.com.ar"
// }
//
// Resend: https://resend.com — free 3000 emails/mes, sin NPM
// Brevo:  https://brevo.com  — free 300 emails/día
//
const https = require('https');

function sendEmail(emailCfg, { to, subject, html, replyTo }) {
  return new Promise((resolve) => {
    // ── Opción Gmail (Nodemailer) ─────────────────────────────
    if (emailCfg?.provider === 'gmail' || (emailCfg?.gmail_user && emailCfg?.gmail_pass)) {
      const nodemailer = require('nodemailer');
      const transport  = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailCfg.gmail_user, pass: emailCfg.gmail_pass },
      });
      transport.sendMail({
        from:    `"WZMALLAS" <${emailCfg.gmail_user}>`,
        to:      Array.isArray(to) ? to.join(',') : to,
        subject,
        html,
        ...(replyTo ? { replyTo } : {}),
      }).then(() => resolve({ ok: true }))
        .catch(e => { console.warn('[email] Gmail error:', e.message); resolve({ error: e.message }); });
      return;
    }

    if (!emailCfg?.api_key || !emailCfg?.from) {
      // Sin config de email → skip silencioso (no interrumpe el flujo)
      return resolve({ skipped: true });
    }

    const provider = emailCfg.provider || 'resend';
    let hostname, apiPath;

    if (provider === 'brevo') {
      hostname = 'api.brevo.com';
      apiPath  = '/v3/smtp/email';
    } else {
      // resend (default)
      hostname = 'api.resend.com';
      apiPath  = '/emails';
    }

    const payload = JSON.stringify({
      from:     emailCfg.from,
      to:       Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    });

    const options = {
      hostname,
      port: 443,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization':  `Bearer ${emailCfg.api_key}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          console.warn(`[email] ${provider} error ${res.statusCode}:`, body.slice(0, 200));
          resolve({ error: body });
        }
      });
    });
    req.on('error', e => {
      console.warn('[email] request error:', e.message);
      resolve({ error: e.message });
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendEmail };

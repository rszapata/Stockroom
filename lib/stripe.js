// ── Cliente HTTP de bajo nivel para la API de Stripe ──
const https = require('https');

function stripeApiCall(secretKey, method, path, params) {
  return new Promise((resolve, reject) => {
    const payload = params
      ? Object.entries(params)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
          .join('&')
      : '';
    const reqOptions = {
      hostname: 'api.stripe.com',
      path: '/v1' + path,
      method,
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };
    if (payload) reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(reqOptions, res2 => {
      let b = '';
      res2.on('data', c => b += c);
      res2.on('end', () => {
        try {
          const json = JSON.parse(b);
          if (json.error) {
            const err = new Error(json.error.message || 'Stripe error');
            err.stripeError = json.error;
            err.status = res2.statusCode;
            return reject(err);
          }
          resolve(json);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { stripeApiCall };

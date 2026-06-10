// ── Cliente HTTP de bajo nivel para la API de Mercado Libre ──
const https = require('https');
const { applyHttpTimeout } = require('./http-client');

const ML_BASE = 'api.mercadolibre.com';

function mlGet(mlPath, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: ML_BASE, path: mlPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode;
            err.body = d;
            reject(err);
          } else resolve(d);
        } catch(e) {
          const err = new Error('JSON parse error');
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    applyHttpTimeout(req, `mlGet ${mlPath}`);
    req.on('error', reject);
    req.end();
  });
}

function mlPut(mlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: ML_BASE, path: mlPath, method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode;
            err.body = d;
            reject(err);
          } else resolve(d);
        } catch(e) {
          const err = new Error('JSON parse error');
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    applyHttpTimeout(req, `mlPut ${mlPath}`);
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function mlPost(mlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = { hostname: ML_BASE, path: mlPath, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'Stockroom/1.0' } };
    const req = https.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (res.statusCode >= 400) {
            const err = new Error(d.message || b);
            err.status = res.statusCode; err.body = d; reject(err);
          } else resolve(d);
        } catch(e) { const err = new Error('JSON parse error'); err.status = res.statusCode; reject(err); }
      });
    });
    applyHttpTimeout(req, `mlPost ${mlPath}`);
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { mlGet, mlPut, mlPost };

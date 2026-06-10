// ── Lectura de body de requests HTTP con límite de tamaño ──

const BODY_LIMIT = 512 * 1024; // 512 KB — suficiente para cualquier orden normal

function readBody(req) {
  return readBodyWithLimit(req, BODY_LIMIT, 'Request body demasiado grande');
}

// Lee el body con un límite personalizado (para uploads base64 de PDFs)
function readBodyWithLimit(req, maxBytes, message) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        const err = new Error(message || `Body demasiado grande (max ${Math.round(maxBytes / 1024 / 1024)}MB)`);
        err.status = 413;
        return reject(err);
      }
      chunks.push(chunk);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { BODY_LIMIT, readBody, readBodyWithLimit };

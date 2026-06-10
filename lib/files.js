// ── Utilidades de archivos: escritura atómica, magic bytes, multipart ──
const fs = require('fs');

// Escritura atómica de JSON: escribe a un archivo temporal y hace rename(),
// evita dejar el archivo truncado/corrupto si el proceso se cae a mitad de
// la escritura (sessions.json, rate_limits.json, etc).
function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

// ── Validación de tipo real de archivo por magic bytes ─────────
// No confiar en la extensión del nombre de archivo: revisa los primeros
// bytes para confirmar que el contenido es realmente una imagen/video
// del tipo esperado (evita subir .html/.php/.svg disfrazados de .jpg).
function detectImageExt(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return '.png';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function detectVideoExt(buf) {
  // MP4/MOV/M4V: caja "ftyp" en el offset 4
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    return brand.startsWith('qt') ? '.mov' : '.mp4';
  }
  // WebM/Matroska: firma EBML
  if (buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return '.webm';
  return null;
}

// ── Multipart parser ──────────────────────────────────────────
function parseMultipart(body, boundary) {
  const parts = {};
  const sep   = Buffer.from('--' + boundary);
  let start   = 0;

  while (true) {
    const idx  = body.indexOf(sep, start);
    if (idx === -1) break;
    const next = body.indexOf(sep, idx + sep.length);
    if (next === -1) break;

    const part      = body.slice(idx + sep.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = next; continue; }

    const headerStr = part.slice(0, headerEnd).toString();
    const content   = part.slice(headerEnd + 4, part.length - 2);
    const nameM     = headerStr.match(/name="([^"]+)"/);
    const fileM     = headerStr.match(/filename="([^"]+)"/);
    if (!nameM) { start = next; continue; }

    parts[nameM[1]] = fileM
      ? { filename: fileM[1], data: content }
      : content.toString().trim();
    start = next;
  }
  return parts;
}

// ── MIME types ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.m4v':  'video/x-m4v',
};

module.exports = { writeJsonAtomic, detectImageExt, detectVideoExt, parseMultipart, MIME };

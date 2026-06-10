// ── Resúmenes de logística (almacén local) ────────────────────
const fs   = require('fs');
const path = require('path');

const RESUMEN_DIR   = path.join(__dirname, '..', 'pdf-resumenes');
const RESUMEN_INDEX = path.join(RESUMEN_DIR, 'index.json');

function loadResumenIndex() {
  try { return JSON.parse(fs.readFileSync(RESUMEN_INDEX, 'utf8')); }
  catch(e) { return []; }
}
function saveResumenIndex(idx) {
  if (!fs.existsSync(RESUMEN_DIR)) fs.mkdirSync(RESUMEN_DIR, { recursive: true });
  fs.writeFileSync(RESUMEN_INDEX, JSON.stringify(idx, null, 2));
}

module.exports = { RESUMEN_DIR, RESUMEN_INDEX, loadResumenIndex, saveResumenIndex };

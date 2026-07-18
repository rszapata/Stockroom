// ── Helpers puros para extraer y parsear texto de PDFs (resúmenes Sinergia) ──
const zlib = require('zlib');

// Decoder ASCII85 (PDF spec, Adobe variant — termina en ~>)
function decodeAscii85(str) {
  const endIdx = str.indexOf('~>');
  const data   = endIdx >= 0 ? str.slice(0, endIdx) : str;
  const clean  = data.replace(/\s/g, '');
  const out = [];
  let i = 0;
  while (i < clean.length) {
    if (clean[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
    let acc = 0, count = 0;
    for (let j = 0; j < 5 && i + j < clean.length; j++) {
      const c = clean.charCodeAt(i + j);
      if (c < 33 || c > 117) break;
      acc = acc * 85 + (c - 33);
      count++;
    }
    if (count === 0) break;
    // Pad con 'u' (84) si grupo parcial
    let padded = acc;
    for (let j = count; j < 5; j++) padded = padded * 85 + 84;
    const b = [
      (padded >>> 24) & 0xFF,
      (padded >>> 16) & 0xFF,
      (padded >>>  8) & 0xFF,
       padded         & 0xFF,
    ];
    const keep = count === 5 ? 4 : count - 1;
    for (let j = 0; j < keep; j++) out.push(b[j]);
    i += count;
  }
  return Buffer.from(out);
}

function extractPdfText(buf, debugInfo) {
  const d = debugInfo || {};
  d.streamsFound = 0;
  d.streamsSkippedImage = 0;
  d.streamsDecompressOk = 0;
  d.streamsDecompressFail = 0;
  d.streamsWithText = 0;
  d.rawSample = '';
  d.streamDicts = [];
  d.streamFilters = [];
  d.bufferOk = buf.length > 100 && buf[0] === 0x25 && buf[1] === 0x50;
  d.bufferSize = buf.length;
  d.pdfHeader = buf.slice(0, 12).toString('latin1');

  let combined = '';

  const STREAM_MARKER    = Buffer.from('stream');
  const ENDSTREAM_MARKER = Buffer.from('endstream');
  const END_PREFIX       = Buffer.from('end');

  let pos = 0;
  while (pos < buf.length) {
    const streamPos = buf.indexOf(STREAM_MARKER, pos);
    if (streamPos === -1) break;

    if (streamPos >= 3 && buf.slice(streamPos - 3, streamPos).equals(END_PREFIX)) {
      pos = streamPos + 6; continue;
    }

    const b6 = buf[streamPos + 6];
    const b7 = buf[streamPos + 7];
    const isCRLF = b6 === 0x0D && b7 === 0x0A;
    const isLF   = b6 === 0x0A;
    if (!isCRLF && !isLF) { pos = streamPos + 1; continue; }

    const dataStart = streamPos + 6 + (isCRLF ? 2 : 1);
    const endPos    = buf.indexOf(ENDSTREAM_MARKER, dataStart);
    if (endPos === -1) { pos = streamPos + 1; continue; }

    let dataEnd = endPos;
    if (dataEnd > 0 && buf[dataEnd - 1] === 0x0A) dataEnd--;
    if (dataEnd > 0 && buf[dataEnd - 1] === 0x0D) dataEnd--;

    d.streamsFound++;

    // Diccionario inmediato
    const lookbackStr = buf.slice(Math.max(0, streamPos - 2000), streamPos).toString('latin1');
    const lastClose   = lookbackStr.lastIndexOf('>>');
    let immDict = '';
    if (lastClose >= 0) {
      const lastOpen = lookbackStr.lastIndexOf('<<', lastClose);
      if (lastOpen >= 0) immDict = lookbackStr.slice(lastOpen, lastClose + 2);
    }
    d.streamDicts.push(immDict.slice(0, 200).replace(/[^\x20-\x7e\n]/g, ' '));

    // Saltar SOLO si es explícitamente una imagen (Subtype /Image)
    if (/\/Subtype\s*\/Image/i.test(immDict)) {
      d.streamsSkippedImage++; pos = endPos + 9; continue;
    }

    // Detectar cadena de filtros
    const hasAscii85 = /ASCII85Decode/i.test(immDict);
    const hasFlate   = /FlateDecode/i.test(immDict);
    d.streamFilters.push((hasAscii85 ? 'A85+' : '') + (hasFlate ? 'Flate' : 'none'));

    let streamData = buf.slice(dataStart, dataEnd);
    let decoded = '';

    try {
      // 1) ASCII85 si corresponde
      if (hasAscii85) {
        const asciiStr = streamData.toString('latin1');
        streamData = decodeAscii85(asciiStr);
      }
      // 2) Flate si corresponde
      if (hasFlate) {
        try {
          decoded = zlib.inflateSync(streamData).toString('latin1');
        } catch(e1) {
          decoded = zlib.inflateRawSync(streamData).toString('latin1');
        }
      } else {
        decoded = streamData.toString('latin1');
      }
      d.streamsDecompressOk++;
    } catch(e) {
      // Último intento: descompresión directa sin ASCII85
      try {
        const orig = buf.slice(dataStart, dataEnd);
        decoded = zlib.inflateSync(orig).toString('latin1');
        d.streamsDecompressOk++;
      } catch(e2) {
        try {
          decoded = zlib.inflateRawSync(buf.slice(dataStart, dataEnd)).toString('latin1');
          d.streamsDecompressOk++;
        } catch(e3) {
          decoded = buf.slice(dataStart, dataEnd).toString('latin1');
          d.streamsDecompressFail++;
        }
      }
    }

    if (!d.rawSample && decoded.length > 10)
      d.rawSample = decoded.slice(0, 500).replace(/[^\x20-\x7e\n\r]/g, '·');

    if (decoded.includes('BT') && (decoded.includes('Tj') || decoded.includes('TJ'))) {
      combined += decoded + '\n';
      d.streamsWithText++;
    }

    pos = endPos + 9;
  }

  return combined;
}

// Decodifica un string PDF (escapes \ddd → char, \( → (, etc.)
function decodePdfString(s) {
  return s
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ');
}

// Extrae todos los strings de texto en orden del content stream
function extractStringsFromStream(streamText) {
  const strings = [];
  // Tj: (string) Tj
  // TJ: [(str) -kern (str) ...] TJ
  const re = /\(([^)]*(?:\\\)[^)]*)*)\)\s*(?:Tj|'|")|(\[[\s\S]*?\])\s*TJ/g;
  let m;
  while ((m = re.exec(streamText)) !== null) {
    if (m[1] !== undefined) {
      const s = decodePdfString(m[1]).trim();
      if (s) strings.push(s);
    } else if (m[2]) {
      // Array TJ: extraer sub-strings
      const inner = m[2];
      const sr = /\(([^)]*(?:\\\)[^)]*)*)\)/g;
      let sm;
      while ((sm = sr.exec(inner)) !== null) {
        const s = decodePdfString(sm[1]).trim();
        if (s) strings.push(s);
      }
    }
  }
  return strings;
}

function parseValueString(s) {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d,.]/g, '');
  if (!cleaned) return 0;
  let raw = cleaned;
  // Distinguir separador decimal: si termina en ",XX" → coma decimal (es-AR)
  if (/,\d{2}$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  // Si termina en ".XX" → punto decimal (formato US)
  else if (/\.\d{2}$/.test(raw)) raw = raw.replace(/,/g, '');
  // Sin decimal: quitar todos los separadores
  else raw = raw.replace(/[,.]/g, '');
  const v = parseFloat(raw);
  return isFinite(v) ? v : 0;
}

// Extrae el importe ($) de un bloque de texto de una fila del resumen.
function _extractValor(text) {
  let valor = 0;
  // Patrón 1: $ seguido de número
  const dolMatch = text.match(/\$\s*([\d]{1,3}(?:[,.]\d{3})+(?:[,.]\d{2})?|\d{4,8}(?:[,.]\d{2})?)/);
  if (dolMatch) valor = parseValueString(dolMatch[1]);
  // Patrón 2: número con separador de miles
  if (!valor) {
    const numMatch = text.match(/\b([\d]{1,3}(?:[,.]\d{3})+(?:[,.]\d{2})?)\b/);
    if (numMatch) valor = parseValueString(numMatch[1]);
  }
  // Patrón 3: cualquier número 1000-200000
  if (!valor) {
    const allNums = text.match(/\b\d{4,7}(?:[,.]\d{2})?\b/g);
    if (allNums) for (const n of allNums) {
      const v = parseValueString(n);
      if (v >= 1000 && v <= 200000) { valor = v; break; }
    }
  }
  // Patrón 4 (último recurso): números separados por espacio que reconstruyan precio
  if (!valor) {
    const concatNoSpace = text.replace(/\s+/g, '');
    const cm = concatNoSpace.match(/\$?(\d{1,3}[,.]\d{3}(?:[,.]\d{2})?)/);
    if (cm) valor = parseValueString(cm[1]);
  }
  return valor;
}

function parseSinergiaTable(streamText, debugInfo) {
  const strings = extractStringsFromStream(streamText);

  const dateRe  = /^\d{2}\/\d{2}\/\d{4}$/;
  // Tracking: prefijo de 2-4 letras + 4+ dígitos (+ alfanumérico opcional).
  // Cubre ML… (Mercado Envíos), SN… y TN… (otros orígenes/carriers) sin matchear
  // el NRO VENTA (solo dígitos), los códigos de 3 cifras ni los domicilios (con espacios).
  const trackRe = /^[A-Z]{2,4}\d{4,}[A-Z0-9]*$/i;
  const SKIP = /^(FECHA|DOMICILIO|TRACKING\s*ID|NRO\s*VENTA|DETALLE|VALOR|RESUMEN|PER[IÍ]ODO|CLIENTE|TOTAL|WZ|MALLAS|SINERGIA|paquete|hasta|\d+k|RESUMEN\s*DE\s*CUENTA|1x)$/i;

  // El parseo se guía por BLOQUES DE FECHA: cada entrega arranca con su fecha.
  // Así se recuperan filas cuyo tracking no se extrajo del PDF o tiene un prefijo
  // no-ML (antes, al guiarse por tracking, esas filas se perdían enteras).
  // OJO: el resumen es MULTIPÁGINA y repite los encabezados por página, así que NO
  // se ancla en "VALOR"; se toman todas las fechas y se descartan (a) el bloque del
  // total/emisión ("N entregas por $X") y (b) bloques sin valor ni tracking (pies).
  const dateIdxs = [];
  for (let i = 0; i < strings.length; i++) {
    if (dateRe.test(strings[i].trim())) dateIdxs.push(i);
  }

  const rows = [];
  const seen = new Set();
  const _blocks = []; // debug

  for (let bi = 0; bi < dateIdxs.length; bi++) {
    const start = dateIdxs[bi];
    const end   = bi + 1 < dateIdxs.length ? dateIdxs[bi + 1] : strings.length;
    const fecha = strings[start].trim();
    const block = strings.slice(start + 1, end);
    const blockText = block.join(' ');

    // Saltar el bloque del total/emisión ("N entregas por $X")
    if (/entregas\s+por/i.test(blockText)) continue;

    // Tracking (opcional): primer token con formato de tracking dentro del bloque
    let tracking = '', trackPos = block.length;
    for (let j = 0; j < block.length; j++) {
      if (trackRe.test(block[j].toUpperCase())) { tracking = block[j].toUpperCase(); trackPos = j; break; }
    }
    // Dedup solo cuando hay tracking (las filas sin tracking no se deduplican)
    if (tracking) { if (seen.has(tracking)) continue; seen.add(tracking); }

    const valor = _extractValor(blockText);

    // Descartar bloques que no son una entrega (fechas de pie de página / emisión):
    // una entrega real siempre tiene importe o tracking.
    if (!valor && !tracking) continue;

    // Domicilio: strings entre la fecha y el tracking (o el fin del bloque si no hay),
    // excluyendo keywords, números sueltos y celdas de valor.
    const domParts = [];
    for (let j = 0; j < trackPos; j++) {
      const s = block[j].trim();
      if (s && !SKIP.test(s) && !/^\d+$/.test(s) && !/^\d+x$/i.test(s) && !/\$/.test(s)) domParts.push(s);
    }
    const domicilio = domParts.join(' ').trim();

    if (_blocks.length < 3) _blocks.push({ fecha, tracking, blockText });
    rows.push({ fecha, tracking, domicilio, valor });
  }

  if (debugInfo) debugInfo.sampleBlocks = _blocks;
  return rows;
}

module.exports = {
  decodeAscii85, extractPdfText, decodePdfString,
  extractStringsFromStream, parseValueString, parseSinergiaTable,
};

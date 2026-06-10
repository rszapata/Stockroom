// ── Parser de listas de precios del proveedor pegadas desde WhatsApp ──
// Formato típico (ver mensajes reales "EQUIPOS IMPORTADOS"):
//   Samsung                                  ← encabezado de marca
//   📲A06 4/128GB u$135-                     ← línea de producto simple
//   📱S25 12/256GB u$675 (Navy, Mint)-       ← producto con variantes de color (mismo precio)
//   📱A37 5G 6/128GB
//   u$320 (Charcoal)-                        ← continuación: variantes con precios distintos
//   u$325 (White, GreyGreen, Violet)-
//   💰Aceptamos pago en USDT                 ← notas/footer → se ignoran
// El resultado es un arreglo de "borradores" para revisión manual —
// el parseo es heurístico y puede no ser perfecto (el admin lo corrige).
const _EMOJI_RE       = /^[\u{1F300}-\u{1FAFF}☀-➿️]+/u;
const _EMOJI_TRAIL_RE = /[\u{1F300}-\u{1FAFF}☀-➿️\s]+$/u;
const _PRICE_RE       = /u\$\s?\*?(\d[\d.,]*)\*?/i;
const _PAREN_RE       = /\(([^)]+)\)/;

// Marcas conocidas: solo si el texto de un encabezado coincide con alguna de estas
// lo recordamos como "marca actual" para prefijar los títulos siguientes. Cualquier
// otro encabezado corto (p.ej. "IPHONE Nuevos Sellados", "Accesorios", "==========")
// se trata como nota/separador de sección y se ignora sin contaminar los títulos.
const MARCAS_CONOCIDAS = [
  { re: /\bsamsung\b/i,            nombre: 'Samsung' },
  { re: /\bmotorola\b/i,           nombre: 'Motorola' },
  { re: /\b(iphone|apple)\b/i,     nombre: 'Apple' },
  { re: /\bxiaomi\b/i,             nombre: 'Xiaomi' },
  { re: /\bhuawei\b/i,             nombre: 'Huawei' },
  { re: /\bplaystation\b/i,        nombre: 'Sony' },
  { re: /\bsony\b/i,               nombre: 'Sony' },
  { re: /\bnintendo\b/i,           nombre: 'Nintendo' },
  { re: /\blg\b/i,                 nombre: 'LG' },
  { re: /\basus\b/i,               nombre: 'Asus' },
  { re: /\blenovo\b/i,             nombre: 'Lenovo' },
  { re: /\brealme\b/i,             nombre: 'Realme' },
  { re: /\boppo\b/i,               nombre: 'Oppo' },
  { re: /\bvivo\b/i,               nombre: 'Vivo' },
  { re: /\b(google|pixel)\b/i,     nombre: 'Google' },
  { re: /\bjbl\b/i,                nombre: 'JBL' },
  { re: /\bxbox\b/i,               nombre: 'Xbox' },
];

function _detectarMarca(texto) {
  const t = String(texto || '');
  for (const m of MARCAS_CONOCIDAS) {
    if (m.re.test(t)) return m.nombre;
  }
  return null;
}

function _parsePrecioUsd(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function _sugerirCategoriaPropia(emoji, titulo) {
  const t = (titulo || '').toLowerCase();
  if (/playstation|ps5|ps4|ps3|xbox|nintendo|switch|consola/.test(t)) return 'consolas';
  if (/watch|reloj|band\b/.test(t)) return 'smartwatches';
  if (/tablet|tab\b|ipad/.test(t)) return 'tablets';
  if (emoji === '📱' || emoji === '📲') return 'celulares';
  if (/buds|auricular|cargador|adaptador|tag|cable/.test(t)) return 'accesorios';
  return 'otros';
}

function parseListaProveedorWhatsApp(texto) {
  const lines = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const borradores = [];
  let marcaActual = '';
  let pending = null;

  for (const lineRaw of lines) {
    const line = lineRaw.replace(/^[-•]\s*/, '').trim();
    if (!line) continue;

    // Líneas de notas/footer → se ignoran y cortan cualquier continuación pendiente
    if (/^(💰|✅|❌|📦|🚚|⏰|Slim\s*=|Garant[ií]a|Aceptamos|Env[ií]o)/i.test(line)) {
      pending = null;
      continue;
    }

    const emojiMatch    = line.match(_EMOJI_RE);
    const priceMatch    = line.match(_PRICE_RE);
    const restoSinEmoji = emojiMatch ? line.replace(_EMOJI_RE, '').trim() : line;

    // Encabezado de sección/marca: línea corta sin precio y sin dígitos relevantes,
    // con o sin emoji decorativo (ej. "SAMSUNG", "🍎IPHONE CPO Sellados", "Accesorios").
    // Requiere al menos una letra para no confundir separadores tipo "==========".
    const pareceEncabezado =
      !priceMatch && !/\d/.test(restoSinEmoji) && restoSinEmoji.length > 0 &&
      restoSinEmoji.length <= 30 && !/[():]/.test(restoSinEmoji) &&
      /[a-zA-Záéíóúñ]/i.test(restoSinEmoji);

    if (pareceEncabezado) {
      // Solo lo recordamos como "marca actual" si reconocemos la marca; de lo contrario
      // es un encabezado de sección genérico y NO debe quedar pegado a los títulos
      // de los productos siguientes (se resetea para no arrastrar la marca anterior).
      marcaActual = _detectarMarca(restoSinEmoji) || '';
      pending = null;
      continue;
    }

    // Línea de continuación (variante con precio propio) de un borrador pendiente
    if (pending && !emojiMatch && priceMatch) {
      const idxP = line.indexOf(priceMatch[0]);
      const descriptor = (idxP >= 0 ? line.slice(0, idxP) : '').replace(/[-*]+\s*$/, '').trim();
      const parenMatch = line.match(_PAREN_RE);
      // Solo tomamos el paréntesis como lista de colores si aparece DESPUÉS del precio;
      // si aparece antes (parte de la descripción/almacenamiento) no se confunde con color.
      const colores = (parenMatch && line.indexOf(parenMatch[0]) > idxP) ? parenMatch[1] : '';
      const etiqueta = [descriptor, colores].filter(Boolean).join(' — ') || `u$${priceMatch[1]}`;
      pending.variantes.push({
        etiqueta,
        precio_usd: _parsePrecioUsd(priceMatch[1]),
      });
      // Si el borrador todavía no tenía precio base, usar el de la primera variante
      if (pending.precio_usd == null) pending.precio_usd = _parsePrecioUsd(priceMatch[1]);
      continue;
    }

    // Línea de producto (con emoji y/o precio, y contenido real — no encabezado)
    if (emojiMatch || priceMatch) {
      const emoji = emojiMatch ? emojiMatch[0] : '';
      let resto = restoSinEmoji.replace(_EMOJI_TRAIL_RE, '').trim();

      let tituloBase = resto;
      let precioUsd  = null;
      let colores    = '';
      if (priceMatch) {
        const idx = resto.indexOf(priceMatch[0]);
        tituloBase = (idx >= 0 ? resto.slice(0, idx) : resto).replace(/[-*]+\s*$/, '').trim();
        precioUsd  = _parsePrecioUsd(priceMatch[1]);
        const parenMatch = resto.match(_PAREN_RE);
        // Igual que en las continuaciones: paréntesis antes del precio = parte del título
        // (ej. "Cargador MagSafe Duo (Original) u$80"), no un color/variante.
        if (parenMatch && resto.indexOf(parenMatch[0]) > idx) colores = parenMatch[1];
      } else {
        tituloBase = resto.replace(/[-*]+\s*$/, '').trim();
      }

      const titulo = [marcaActual, tituloBase].filter(Boolean).join(' ').trim();
      const draft = {
        marca:             marcaActual || '',
        titulo,
        condicion:         /usad[oa]/i.test(line) ? 'usado' : 'nuevo',
        precio_usd:        precioUsd,
        variantes:         colores ? [{ etiqueta: colores, precio_usd: precioUsd }] : [],
        categoria_sugerida: _sugerirCategoriaPropia(emoji, titulo),
        linea_original:    lineRaw,
      };
      borradores.push(draft);
      pending = draft;
      continue;
    }

    // Cualquier otra línea suelta: se ignora (nota, separador, etc.)
    pending = null;
  }

  return borradores;
}

module.exports = {
  _detectarMarca, _parsePrecioUsd, _sugerirCategoriaPropia, parseListaProveedorWhatsApp,
};

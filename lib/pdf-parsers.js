// ── Parsers de texto extraído de PDFs de Alibaba (recibos / contratos) ──

function parsePdfRows(text) {
  if (/ItemQuantityUnit/i.test(text) || /\d+\.00USD\s*[\d.]+USD\s*[\d.]+/.test(text)) {
    return parseReceiptRows(text);
  }
  return parseContractRows(text);
}

// ── Formato Recibo (Receipt_*.pdf) ───────────────────────────────────────────
// El PDF tiene texto embebido; las columnas quedan pegadas: "10.00USD 1.3000USD 13.00"
// La descripción/color/compatible model puede aparecer ANTES o DESPUÉS del marcador
// de qty en el mismo item (artefacto del orden de columnas en el PDF).
function parseReceiptRows(text) {
  const rows = [];

  // Saltar el header "ItemQuantityUnit priceAmount" y texto previo
  const headerIdx = text.search(/ItemQuantityUnit\s*price\s*Amount/i);
  const body = headerIdx >= 0
    ? text.slice(headerIdx).replace(/^[^\n]*\n/, '') // quitar la línea del header
    : text;

  // Cortar antes de sección de totales / datos del comprador
  const cutRe = /\n(?:Subtotal|Sub total|Shipping fee|Total amount|Payment method|Buyer information|Order ID\b)/i;
  const cutMatch = cutRe.exec(body);
  const productText = cutMatch ? body.slice(0, cutMatch.index) : body;

  // Localizar todos los marcadores de qty: "N.00USD X.XXXXUSD X.XX"
  const qtyRe = /(\d+)\.00USD\s*[\d.]+USD\s*[\d.]+/g;
  const hits = [];
  let m;
  while ((m = qtyRe.exec(productText)) !== null) {
    hits.push({ qty: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
  }

  for (let i = 0; i < hits.length; i++) {
    const hit       = hits[i];
    const prevEnd   = i > 0 ? hits[i - 1].end : 0;
    const nextStart = i < hits.length - 1 ? hits[i + 1].start : productText.length;

    // Ventana completa: desde el final del item anterior hasta el inicio del siguiente
    const windowBefore = productText.slice(prevEnd, hit.start);
    const windowAfter  = productText.slice(hit.end, nextStart);
    const fullWindow   = windowBefore + '\n' + windowAfter;

    // ── Compatible model ──────────────────────────────────────────────────────
    // Puede estar en antes o después del marcador qty; puede continuar en la línea siguiente
    let model = '';
    const modelRe = /compatible\s+model:\s*([^\n]+(?:\n(?!\d|,?\s*color:)[^\n]+)*)/gi;
    let mm;
    while ((mm = modelRe.exec(fullWindow)) !== null) {
      model = mm[1].trim().replace(/\s+/g, ' ');
    }
    // Quitar texto suelto después de coma/punto final (p.ej. "For iPhone 16 pro, ...")
    model = model.replace(/[,;].*$/, '').trim();

    // ── Nombre del producto ───────────────────────────────────────────────────
    // Todo el texto hasta la PRIMERA ocurrencia de "color:" (ANTES de la coma si la hay)
    // Patrón: `, color:` (coma + color) o solo `color:` (sin coma)
    const colorIdxComma = fullWindow.search(/,\s*color\s*:/i);
    const colorIdxPlain = fullWindow.search(/color\s*:/i);
    let nameText = fullWindow;

    if (colorIdxComma >= 0) {
      // Hay ", color:" — cortar EN la coma
      nameText = fullWindow.slice(0, colorIdxComma);
    } else if (colorIdxPlain >= 0) {
      // Solo "color:" sin coma — cortar ANTES de "color:"
      nameText = fullWindow.slice(0, colorIdxPlain).trimEnd();
    }

    const nameLines = nameText.split('\n')
      .map(l => l.trim())
      .filter(l =>
        l.length >= 3 &&
        !/^\d/.test(l) &&                             // no empieza con número
        !/^USD/i.test(l) &&                           // no es precio
        !/^(Order|Item|Quantity|Unit|Amount)/i.test(l) // no es header
      );
    const name = nameLines.join(' ').replace(/\s+/g, ' ').trim();

    // ── Construir nombre de display ───────────────────────────────────────────
    let displayName;
    if (name && model) {
      displayName = `${name} — ${model}`;
    } else if (model) {
      displayName = model;
    } else if (name) {
      displayName = name;
    } else {
      continue; // sin datos suficientes
    }

    displayName = displayName.replace(/\s+/g, ' ').trim();

    // ── Color ─────────────────────────────────────────────────────────────────
    let colorVal = '';
    const colorExtRe = /color:\s*([^,\n]+)/i;
    const colorExtM  = fullWindow.match(colorExtRe);
    if (colorExtM) colorVal = colorExtM[1].trim().replace(/\s+/g, ' ');

    const dup = rows.some(r => r.name === displayName && r.qty === hit.qty);
    if (!dup) rows.push({
      name:  displayName,                           // full (para mapping lookup)
      title: name || model,                         // solo el título del producto
      color: colorVal,                              // "Dark Gray"
      model: model,                                 // "For Samsung S26 Ultra"
      qty:   hit.qty,
      raw:   `${displayName} | qty:${hit.qty}`,
    });
  }

  return rows;
}

// ── Formato Contrato/OCR (TA_CONTRACT_*.pdf) ─────────────────────────────────
// Tabla con columnas Product name | Spec/Specs | Unit price | Quantity | Total
// Cada variante tiene: "color: X,compatible model: For Z" + "USD N /Pieces" + "N.00"
function parseContractRows(text) {
  const rows = [];

  // Cortar el texto en la sección de productos (antes de Shipment details / Payment)
  const cutRe = /\n(?:Shipment details|Payment details|View less\s*\n[\s\S]*?Product Quantity)/i;
  const cutMatch = cutRe.exec(text);
  const productText = cutMatch ? text.slice(0, cutMatch.index) : text;

  // Normalizar saltos de línea y limpiar artefactos del header
  const clean = productText
    .replace(/\r/g, '')
    .replace(/Quanti\s*\n\s*ty/gi, 'Quantity')
    .replace(/Product details?\s*\n/gi, '')
    .replace(/Guaranteed delivery[^\n]*\n/gi, '')
    .replace(/Sold by[^\n]*\n/gi, '')
    .replace(/Chat now\s*\n/gi, '')
    .replace(/^Product name\s+Spec\/Specs\s+Unit price\s+Quantity\s+Total\s*\n/mi, '');

  // Anclar en cada precio "USD X.XXXX /Pieces"; la qty (N.00) viene justo después
  const priceRe = /USD\s+[\d.]+\s*\/Pieces/gi;
  const priceHits = [];
  let pm;
  while ((pm = priceRe.exec(clean)) !== null) {
    priceHits.push({ start: pm.index, end: pm.index + pm[0].length });
  }

  let currentProduct = '';

  for (let pi = 0; pi < priceHits.length; pi++) {
    const pp = priceHits[pi];

    const afterPrice = clean.slice(pp.end, pp.end + 50);
    const qtyMatch   = afterPrice.match(/\s*(\d+)\.00\b/);
    if (!qtyMatch) continue;
    const qty = parseInt(qtyMatch[1], 10);
    if (qty < 1 || qty > 99999) continue;

    const windowStart = pi > 0 ? priceHits[pi - 1].end : 0;
    const before      = clean.slice(windowStart, pp.start);

    // Compatible model: última ocurrencia en el bloque de specs antes del precio
    const specBlock = before.replace(/\n(?=[a-z,])/g, ' ');
    const modelRe   = /compatible\s+model:\s*([\s\S]+?)(?=USD|color:|compatible\s+model:|package:|$)/gi;
    let lastModel   = '';
    let mm;
    while ((mm = modelRe.exec(specBlock)) !== null) {
      lastModel = mm[1].trim().replace(/\s+/g, ' ');
    }

    // Nombre del producto: líneas largas antes del primer "color:"
    const colorPos = before.search(/\bcolor:/i);
    if (colorPos > 0) {
      const beforeColor = before.slice(0, colorPos);
      const nameCands = beforeColor.split('\n')
        .map(l => l.trim())
        .filter(l =>
          l.length >= 15 &&
          !/^(USD|color:|package:|compatible|Spec|Product|Guaranteed|Sold|Chat|Total|Quanti|Ship|Pay|Supplier)/i.test(l) &&
          !/^\d+(\.\d+)?$/.test(l)
        );
      if (nameCands.length > 0) {
        const candidate = nameCands[nameCands.length - 1].replace(/\s+/g, ' ');
        if (candidate.length >= 15) currentProduct = candidate;
      }
    }

    let name;
    if (currentProduct && lastModel) {
      name = `${currentProduct} — ${lastModel}`;
    } else if (lastModel) {
      name = lastModel;
    } else if (currentProduct) {
      name = currentProduct;
    } else {
      continue;
    }

    name = name.replace(/\s+/g, ' ').trim();
    const dup = rows.some(r => r.name === name && r.qty === qty);
    if (!dup) rows.push({ name, qty, raw: `${name} | qty:${qty}` });
  }

  return rows;
}

module.exports = { parsePdfRows, parseReceiptRows, parseContractRows };

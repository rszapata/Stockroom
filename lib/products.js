// ── Helpers de consolidación de productos (sync de tienda) ────
const { commonPrefix } = require('./strings');

/** Extrae el nombre de la variante (color o similar) de un item ML */
function extractVariantName(item, baseTitle) {
  // Intentar attributes.COLOR (o similar)
  if (item.attributes && Array.isArray(item.attributes)) {
    const colorAttr = item.attributes.find(a => /^(color|colour|main_color)$/i.test(a.id || ''));
    if (colorAttr && colorAttr.value_name) return colorAttr.value_name;
  }
  // Fallback: parte del título después del prefijo común
  if (baseTitle && item.title && item.title.startsWith(baseTitle)) {
    const tail = item.title.slice(baseTitle.length).replace(/^[\s\-\.\,\:\;\|]+/, '').trim();
    if (tail) return tail;
  }
  return item.title || 'Variante';
}

/**
 * Mergea un grupo de items con el mismo family_id en uno solo con variations[].
 * El primary es el más vendido. El resultado es 100% compatible con ML schema.
 */
function mergeFamilyGroup(group) {
  const sorted  = [...group].sort((a, b) => (b.sold_quantity || 0) - (a.sold_quantity || 0));
  const primary = sorted[0];

  // Título limpio: prefijo común entre todos los miembros
  const titles    = sorted.map(p => p.title || '');
  let baseTitle   = commonPrefix(titles);
  if (baseTitle.length < 15) baseTitle = primary.title || ''; // fallback

  // Pictures unificadas (deduplicadas por id/URL)
  const seenIds  = new Set();
  const seenUrls = new Set();
  const pictures = [];
  for (const p of sorted) {
    for (const pic of (p.pictures || [])) {
      const id  = pic.id;
      const url = pic.secure_url || pic.url;
      if (id  && seenIds.has(id))  continue;
      if (url && seenUrls.has(url)) continue;
      if (id)  seenIds.add(id);
      if (url) seenUrls.add(url);
      pictures.push(pic);
    }
  }

  // Variations sintéticas — una por miembro
  const variations = sorted.map(p => ({
    id                     : p.id,
    available_quantity     : p.available_quantity || 0,
    sold_quantity          : p.sold_quantity      || 0,
    price                  : p.price,
    attribute_combinations : [{
      id         : 'COLOR',
      name       : 'Color',
      value_name : extractVariantName(p, baseTitle),
    }],
    picture_ids: (p.pictures || []).map(pic => pic.id).filter(Boolean),
  }));

  const totalAvail = sorted.reduce((s, p) => s + (p.available_quantity || 0), 0);
  const totalSold  = sorted.reduce((s, p) => s + (p.sold_quantity      || 0), 0);

  return {
    ...primary,
    title              : baseTitle,
    available_quantity : totalAvail,
    sold_quantity      : totalSold,
    pictures,
    variations,
    _family_merged     : true,
    _family_members    : sorted.map(p => p.id),
  };
}

/**
 * Consolida items de la sync:
 *  1. Dedup cross-account vía vinculaciones.json (preferir cuenta WZ)
 *  2. Agrupa items con mismo family_id en uno solo con variations[]
 */
function consolidateItems(allItems, vinculaciones) {
  // ── Pass 1: dedup vinculaciones (preferir WZ) ─────────────
  const skipIds = new Set();
  if (vinculaciones && Array.isArray(vinculaciones.groups)) {
    for (const grp of vinculaciones.groups) {
      const items  = grp.items || [];
      const wzItem = items.find(i => i.accountId === 'wz');
      if (!wzItem || !wzItem.itemId) continue; // sin WZ no hay preferencia, mantener todo
      // Saltear todos los items no-WZ del mismo grupo
      for (const it of items) {
        if (it.accountId !== 'wz' && it.itemId) skipIds.add(it.itemId);
      }
    }
  }
  const filtered = allItems.filter(p => !skipIds.has(p.id));
  const dupSkipped = allItems.length - filtered.length;

  // ── Pass 2: agrupar por family_id ────────────────────────
  // Solo consideramos items SIN variations propias (formato nuevo "una pub por variante")
  const families   = {};
  const standalone = [];
  for (const p of filtered) {
    const noVars = !p.variations || p.variations.length === 0;
    if (p.family_id && noVars) {
      (families[p.family_id] = families[p.family_id] || []).push(p);
    } else {
      standalone.push(p);
    }
  }

  let mergedCount = 0;
  const merged = [];
  for (const group of Object.values(families)) {
    if (group.length < 2) {
      merged.push(group[0]);
    } else {
      merged.push(mergeFamilyGroup(group));
      mergedCount++;
    }
  }

  console.log(`  → consolidate: ${dupSkipped} dups vinculaciones, ${mergedCount} grupos family_id mergeados`);
  return [...standalone, ...merged];
}

module.exports = { extractVariantName, mergeFamilyGroup, consolidateItems };

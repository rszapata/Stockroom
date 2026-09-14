// ── SEO del catálogo: title, H1, descripción, canónica y robots por filtro ──
//
// Hasta ahora todas las combinaciones de catalogo.html declaraban la MISMA
// canónica (catalogo.html a secas) y el mismo título. Eso le decía a Google,
// explícitamente, que ?cat=fundas y ?cat=apple-watch son duplicados de una sola
// página: de todo el catálogo por categoría podía indexar exactamente una.
//
// Acá se decide, para cada combinación de parámetros, qué página es: una que
// merece indexarse por derecho propio, o una variante de otra.
//
// El criterio no es "canonicalizar todo" ni "indexar todo", sino separar los
// filtros que representan una búsqueda real de los que son comodidad de
// navegación:
//
//   cat, sub, compat  →  búsquedas propias ("fundas para iPhone", "malla para
//                        Galaxy Watch"). Canónica a sí mismas, indexan.
//   orden, precio     →  los mismos productos en otro orden. Canónica al padre.
//   page              →  canónica a sí misma para que rastree los productos,
//                        noindex de la 2 en adelante para no indexar "página 4".
//   q                 →  noindex: son infinitas y Google penaliza tener
//                        resultados de búsqueda interna indexados.
//
// Funciones puras: reciben el query string parseado y devuelven qué inyectar.

/* Categorías con página propia. La clave es el valor de ?cat= tal como lo
   emiten el menú y las tarjetas del home.

   Los textos se escriben acá y no se derivan del label del filtro porque son
   cosas distintas: el label es una etiqueta de UI ("Fundas") y el title compite
   en una lista de resultados contra Mercado Libre, donde hace falta decir para
   qué sirve y qué ofrecemos nosotros. */
const CATEGORIAS = {
  'mallas': {
    h1:    'Mallas para smartwatch',
    title: 'Mallas para smartwatch',
    desc:  'Mallas de cuero, acero, silicona y tela para Apple Watch, Samsung Galaxy Watch y otras marcas. Envío en el día en CABA y GBA. Devolución en 10 días.',
  },
  'fundas': {
    h1:    'Fundas para celular',
    title: 'Fundas para iPhone y Samsung',
    desc:  'Fundas de cuero y silicona para iPhone y Samsung Galaxy, con protección de cámara. Envío en el día en CABA y GBA, o Correo Argentino a todo el país.',
  },
  'protectores': {
    h1:    'Protectores de pantalla',
    title: 'Protectores para smartwatch',
    desc:  'Protectores de pantalla y carcasas para Apple Watch y Samsung Galaxy Watch. Colocación sin burbujas, envío a todo el país y devolución en 10 días.',
  },
  'apple-watch': {
    h1:    'Accesorios para Apple Watch',
    title: 'Mallas y protectores para Apple Watch',
    desc:  'Mallas, protectores y accesorios para Apple Watch de 38 a 49 mm, incluido Ultra. Te confirmamos la medida antes de comprar. Envío en el día en CABA y GBA.',
  },
  'samsung-watch': {
    h1:    'Accesorios para Samsung Galaxy Watch',
    title: 'Mallas y protectores para Galaxy Watch',
    desc:  'Mallas, protectores y accesorios para Samsung Galaxy Watch de 20 y 22 mm, incluidas las líneas Classic, Frontier y Ultra. Envío en el día en CABA y GBA.',
  },
  'combos': {
    h1:    'Combos',
    title: 'Combos de malla y protector',
    desc:  'Malla y protector juntos, más barato que por separado. Para Apple Watch y Samsung Galaxy Watch. Envío en el día en CABA y GBA, devolución en 10 días.',
  },
  'cables': {
    h1:    'Cables y cargadores',
    title: 'Cables y cargadores',
    desc:  'Cables, cargadores y adaptadores para celular y smartwatch. Stock en Buenos Aires, envío en el día en CABA y GBA, o Correo Argentino a todo el país.',
  },
  'luces-auto': {
    h1:    'Luces para autos',
    title: 'Luces LED para autos',
    desc:  'Luces LED y accesorios de iluminación para autos. Stock en Buenos Aires, envío en el día en CABA y GBA, o Correo Argentino a todo el país.',
  },
  'accesorios': {
    h1:    'Accesorios',
    title: 'Accesorios para celular y smartwatch',
    desc:  'Accesorios para celular y smartwatch con stock en Buenos Aires. Envío en el día en CABA y GBA, o Correo Argentino a todo el país. Devolución en 10 días.',
  },
};

/* Dispositivos con página propia (?compat=).
 *
 * Sólo los que tienen catálogo suficiente para sostener una página. Los que
 * devuelven dos o tres productos quedan afuera a propósito: una categoría casi
 * vacía es una mala página de aterrizaje —el visitante rebota— y Google la lee
 * como contenido pobre. Cuando crezca el catálogo se agregan acá.
 *
 * Medido sobre 409 publicaciones: Galaxy Watch 169, Apple Watch 60, iPhone 17
 * 18, iPhone 17 Pro Max 16, iPhone 16 13. El resto queda entre 0 y 6.
 */
const DISPOSITIVOS = {
  'Apple Watch': {
    h1:    'Accesorios para Apple Watch',
    title: 'Mallas para Apple Watch',
    desc:  'Todo lo compatible con tu Apple Watch: mallas, protectores y combos de 38 a 49 mm. Te confirmamos la medida antes de comprar. Envío en el día en CABA y GBA.',
  },
  'Galaxy Watch': {
    h1:    'Accesorios para Samsung Galaxy Watch',
    title: 'Mallas para Samsung Galaxy Watch',
    desc:  'Todo lo compatible con tu Galaxy Watch: mallas de 20 y 22 mm, protectores y combos, para Classic, Frontier y Ultra. Envío en el día en CABA y GBA.',
  },
  'iPhone 17': {
    h1:    'Fundas para iPhone 17',
    title: 'Fundas para iPhone 17',
    desc:  'Fundas de cuero y silicona para iPhone 17, con protección de cámara. Stock en Buenos Aires, envío en el día en CABA y GBA. Devolución en 10 días.',
  },
  'iPhone 17 Pro Max': {
    h1:    'Fundas para iPhone 17 Pro Max',
    title: 'Fundas para iPhone 17 Pro Max',
    desc:  'Fundas de cuero y silicona para iPhone 17 Pro Max, con protección de cámara. Stock en Buenos Aires, envío en el día en CABA y GBA. Devolución en 10 días.',
  },
  'iPhone 16': {
    h1:    'Fundas para iPhone 16',
    title: 'Fundas para iPhone 16',
    desc:  'Fundas de cuero y silicona para iPhone 16, con protección de cámara. Stock en Buenos Aires, envío en el día en CABA y GBA. Devolución en 10 días.',
  },
};

const BASE = 'https://wzmallas.com/tienda/catalogo.html';

/* Qué inyectar para un catálogo con estos parámetros.
   Devuelve { title, h1, desc, canonical, robots }. */
function buildCatalogSeo(q) {
  const cat    = String((q && q.cat)    || '').trim();
  const compat = String((q && q.compat) || '').trim();
  const sub    = String((q && q.sub)    || '').trim();
  const page   = parseInt(String((q && q.page) || '1'), 10) || 1;
  const busca  = String((q && q.q) || '').trim();

  /* Búsqueda interna: nunca indexa. Son infinitas, no aportan nada que no
     aporte la categoría, y Google desaconseja explícitamente indexarlas.
     follow sí: que siga los enlaces a los productos. */
  if (busca) {
    return {
      title:     'Resultados de búsqueda',
      h1:        null,
      desc:      'Resultados de búsqueda en el catálogo de WZMALLAS.',
      canonical: BASE,
      robots:    'noindex, follow',
      estado:    'q',
    };
  }

  const ficha = CATEGORIAS[cat] || DISPOSITIVOS[compat] || null;

  /* Ni categoría ni dispositivo conocidos: es el catálogo completo, o un filtro
     que no tiene página propia (precio, orden, un cat inventado a mano). Todos
     caen al catálogo pelado, que es de lo que son una variante. */
  if (!ficha) {
    return {
      title:     'Catálogo de accesorios',
      h1:        'Todos los productos',
      desc:      'Mallas, fundas, protectores y accesorios para Apple Watch, Samsung Galaxy Watch, iPhone y Galaxy. Envío en el día en CABA y GBA. Devolución en 10 días.',
      canonical: BASE,
      robots:    cat || compat ? 'noindex, follow' : 'index, follow',
      estado:    '',
    };
  }

  /* La canónica lleva SÓLO el parámetro que define la página. El orden, el
     rango de precio y la subcategoría son variantes de ella y caen acá: son los
     mismos productos ordenados o recortados de otra forma. */
  const propio = cat ? 'cat=' + encodeURIComponent(cat)
                     : 'compat=' + encodeURIComponent(compat);

  /* La paginación es la excepción: cada página tiene productos distintos, así
     que canoniza a sí misma —si no, Google no rastrea los productos de la
     página 3—. Pero de la 2 en adelante no se indexa: nadie busca "página 4 de
     mallas", y son las que compiten con la 1 sin aportar nada. */
  const esPaginada = page > 1;
  const canonical  = BASE + '?' + propio + (esPaginada ? '&page=' + page : '');

  return {
    title:     ficha.title,
    h1:        ficha.h1,
    desc:      ficha.desc,
    canonical,
    robots:    esPaginada ? 'noindex, follow' : 'index, follow',
    /* Huella del filtro que se renderizó. El cliente la compara con su propio
       estado: mientras coincidan mandan estos textos, y en cuanto el visitante
       cambia un filtro el catálogo pasa a titular por su cuenta. */
    estado:    cat ? 'cat=' + cat : 'compat=' + compat,
    // sub no cambia el título: es un recorte de la misma categoría.
    sub:       sub || null,
  };
}

/* Las URLs del catálogo que van al sitemap: las que tienen página propia. */
function catalogSitemapUrls() {
  return [
    ...Object.keys(CATEGORIAS).map(c => BASE + '?cat=' + encodeURIComponent(c)),
    ...Object.keys(DISPOSITIVOS).map(d => BASE + '?compat=' + encodeURIComponent(d)),
  ];
}

module.exports = { buildCatalogSeo, catalogSitemapUrls, CATEGORIAS, DISPOSITIVOS };

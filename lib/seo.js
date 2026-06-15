// ── SEO de productos: meta description + JSON-LD (schema.org/Product) ──
// Funciones puras (sin estado de módulo): reciben el producto y devuelven
// el texto/objeto listo para inyectar en el HTML de la PDP.

function buildProductMetaDescription(p) {
  const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const d = clean(p.wz_descripcion || p.plain_text || p.descripcion || '');
  if (d.length >= 50) return d.slice(0, 500);
  const title = (clean(p.title) || 'Producto').replace(/[.\s]+$/, ''); // sin punto/espacio final
  return `${title}. Comprá en WZMALLAS, tienda oficial: envío a todo el país, garantía y devolución en 10 días. Pagá con Mercado Pago en cuotas o por transferencia.`.slice(0, 500);
}

function buildProductJsonLd(p, id, host, description) {
  const pics = Array.isArray(p.pictures) ? p.pictures : [];
  let img = (pics[0] && (pics[0].secure_url || pics[0].url)) || p.thumbnail || '';
  img = String(img).replace(/^http:\/\//, 'https://');
  // Dominio canónico fijo: el sitio público siempre es wzmallas.com (el host del
  // request puede ser localhost/IP en acceso directo y no debe filtrarse al schema).
  const url = 'https://wzmallas.com/tienda/producto.html?id=' + encodeURIComponent(id);
  const inStock = (p.available_quantity || 0) > 0;
  return {
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:        p.title || '',
    description: description || buildProductMetaDescription(p),
    image:       img,
    sku:         id,
    brand:       { '@type': 'Brand', name: 'WZMALLAS' },
    offers: {
      '@type':        'Offer',
      url,
      priceCurrency:  'ARS',
      price:          p.price || 0,
      itemCondition:  'https://schema.org/NewCondition',
      availability:   inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller:         { '@type': 'Organization', name: 'WZMALLAS' },
      // Devolución: 10 días, AR, flete de regreso a cargo de WZMALLAS (Art. 34 Ley 24.240).
      hasMerchantReturnPolicy: {
        '@type':              'MerchantReturnPolicy',
        applicableCountry:    'AR',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays:   10,
        returnMethod:         'https://schema.org/ReturnByMail',
        returnFees:           'https://schema.org/FreeReturn'
      },
      // Envío gratis (oferta destacada >$33.000), 0-1 día prep + 2-7 días tránsito.
      shippingDetails: {
        '@type':             'OfferShippingDetails',
        shippingRate:        { '@type': 'MonetaryAmount', value: 0, currency: 'ARS' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'AR' },
        deliveryTime: {
          '@type':      'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime:  { '@type': 'QuantitativeValue', minValue: 2, maxValue: 7, unitCode: 'DAY' }
        }
      }
    }
  };
}

module.exports = { buildProductMetaDescription, buildProductJsonLd };

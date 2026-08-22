"""
genera_orden_compra.py — Stockroom
Uso: python genera_orden_compra.py <csv_input> --output <xlsx_output> [--tc 1532] [--flete 800000] [--units 415]
"""
import csv, sys, math, argparse, json, io
from datetime import date, timedelta
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage

def _descargar_miniatura(url, cache, lado=72):
    """Baja la foto y la deja lista para incrustar en el xlsx.

    Se INCRUSTA la imagen en vez de usar la fórmula =IMAGE(): esa función es
    exclusiva de Excel 365 y en Excel 2021 muestra #NAME?. Incrustada se ve en
    cualquier versión y no depende de tener internet al abrir el archivo.

    Devuelve un BytesIO con un PNG cuadrado, o None si falla (una foto que no
    carga nunca debe romper la generación de la orden).

    OJO: el cache guarda los BYTES, no el buffer. openpyxl lee cada imagen recién
    al guardar el archivo, y PIL cierra el buffer después de leerlo — si dos
    celdas comparten el mismo BytesIO (la misma publicación aparece una vez por
    variante), la segunda explota con "I/O operation on closed file" y se pierde
    el xlsx entero. Cada celda necesita su propio buffer.
    """
    if not url:
        return None
    if url in cache:
        data = cache[url]
        return io.BytesIO(data) if data is not None else None
    try:
        import urllib.request
        from PIL import Image as PILImage
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read()
        im = PILImage.open(io.BytesIO(raw)).convert('RGB')
        im.thumbnail((lado, lado), PILImage.LANCZOS)
        # Lienzo cuadrado blanco: si no, las fotos apaisadas descolocan la fila
        lienzo = PILImage.new('RGB', (lado, lado), (255, 255, 255))
        lienzo.paste(im, ((lado - im.width) // 2, (lado - im.height) // 2))
        buf = io.BytesIO()
        lienzo.save(buf, format='PNG')
        cache[url] = buf.getvalue()
        return io.BytesIO(cache[url])
    except Exception as e:
        print(f"  [foto] no se pudo bajar {url[:60]}: {e}", file=sys.stderr)
        cache[url] = None
        return None


def _conteos_urgencia(lista, fundas, desde_json, todos, dias_autonomia, lead):
    """Conteos del resumen, medidos en autonomía y no en stock absoluto.

    Antes decía "con stock CRÍTICO (≤4)", que es el criterio que justamente
    dejaba pasar fundas que se agotan antes de que llegue el pedido. Lo que
    importa al comprar es si aguanta hasta la llegada.
    """
    def dias(r):
        return dias_autonomia(r['Stock'], r['Vendidos'], r.get('VendRec'))
    sin_stock = sum(1 for r in lista if r['Stock'] == 0)
    quiebre   = sum(1 for r in lista
                    if r['Stock'] > 0 and lead and (dias(r) is not None) and dias(r) <= lead)
    pronto    = sum(1 for r in lista
                    if r['Stock'] > 0 and (dias(r) is not None) and lead < (dias(r) or 0) <= 30)
    filas = [
        ("Variantes en el pedido", len(lista)),
        ("Ya sin stock", sin_stock),
        (f"Se agotan antes de que llegue el pedido", quiebre),
        ("Se agotan dentro de los 30 días", pronto),
    ]
    if not desde_json:
        filas.insert(0, (f"{'Publicaciones' if todos else 'Fundas'} analizadas", len(fundas)))
    return filas


def main():
    p = argparse.ArgumentParser()
    p.add_argument('csv_input', nargs='?')
    p.add_argument('--output', required=True)
    p.add_argument('--from-json', dest='from_json', help='Genera el xlsx desde un borrador editado (JSON), usando cant/costo editados')
    p.add_argument('--tc',     type=float, default=1532,   help='Tipo de cambio ARS/USD')
    p.add_argument('--flete',  type=float, default=800000, help='Flete + impuestos ARS')
    p.add_argument('--units',  type=int,   default=415,    help='Unidades de referencia para prorrateo')
    p.add_argument('--vendidos-min', type=int, default=5,  help='Umbral mínimo de vendidos para incluir (default 5)')
    p.add_argument('--stock-max',    type=int, default=7,  help='Umbral máximo de stock para incluir (default 7)')
    p.add_argument('--dias-stock-max', dest='dias_stock_max', type=int, default=0, help='Autonomía máxima en días para incluir: entra si el stock actual se agota en <= N días al ritmo de venta actual, AUNQUE supere --stock-max. 0 = desactivado. Sirve para no dejar afuera productos de alta rotación con stock aparentemente "sano" (ej. 5 unidades que se venden en 17 días)')
    p.add_argument('--all-products', action='store_true', help='Incluir todas las publicaciones, no solo fundas')
    p.add_argument('--json', action='store_true', help='Emitir las filas calculadas como JSON (modo borrador) en vez de generar xlsx')
    p.add_argument('--cobertura', type=float, default=0, help='Meses de cobertura objetivo: si >0, pide lo necesario para cubrir N meses (demanda mensual ≈ vendidas/4) descontando el stock actual. 0 = heurística automática')
    p.add_argument('--lead-dias', dest='lead_dias', type=int, default=0, help='Días que tarda en llegar el pedido desde que se hace. Se suma a la cobertura objetivo: durante el viaje se sigue vendiendo, así que pedir solo "cobertura" llega con el stock ya consumido. 0 = no considerar')
    p.add_argument('--dias-rec', dest='dias_rec', type=int, default=0, help='Ventana en días de la columna VendRec (ventas reales recientes). Si >0 y el CSV trae VendRec, la demanda mensual se calcula como VendRec/(dias/30) en vez de Vendidos/4')
    args = p.parse_args()

    TC         = args.tc
    FLETE_UNIT = round(args.flete / args.units)
    VEND_MIN   = args.vendidos_min
    STOCK_MAX  = args.stock_max
    DIAS_MAX   = args.dias_stock_max  # autonomía máx. en días (0 = desactivado)
    COBERTURA  = args.cobertura   # meses objetivo (0 = auto)
    LEAD_DIAS  = args.lead_dias   # plazo de entrega en días (0 = no considerar)
    DIAS_REC   = args.dias_rec    # ventana de VendRec (0 = sin datos reales)

    # Costos USD conocidos por línea de producto (fundas)
    COSTOS_USD = {
        'con_costura':   1.51,
        'samsung_s_cu':  1.51,
        's25_magnetica': 1.60,
        'iphone17_mag':  1.33,
        'magsafe':       0.85,
    }

    # Si contiene estas palabras, NO es funda (productos accesorios o protectores que no son fundas)
    PATRONES_NO_FUNDA = [
        'vidrio templado', 'vidrio protector', 'film protector',
        'protector pantalla', 'protector de pantalla', 'cubre pantalla', 'cubrepantalla',
        'protector lente', 'protector de lente', 'protector camara', 'protector de cámara',
        'protector watch', 'protector para watch', 'protector para samsung watch',
        'protector para apple watch', 'protector reloj', 'protector para reloj',
        'cargador', 'cable', 'auricular', 'auriculares',
        'soporte', 'tripode', 'trípode', 'malla', 'pulsera', 'correa',
        'lente', 'palo selfie', 'powerbank', 'power bank',
        'watch', 'reloj',
    ]
    # Patrones que indican fuertemente que ES una funda
    PATRONES_FUNDA = [
        'funda', 'case', 'carcasa',
        'magsafe', 'magnét', 'magnet',
        'con costura', 'silicona', 'silicone',
    ]
    def es_funda(titulo):
        """True si el producto es una funda (por palabra explícita o patrón típico)."""
        t = titulo.lower()
        if any(p in t for p in PATRONES_NO_FUNDA): return False
        if any(p in t for p in PATRONES_FUNDA): return True
        # Patrón: línea típica del catálogo (S22/S23/S24, S25 Ultra/Premium)
        if 's22' in t and 's23' in t: return True
        if 's25' in t and ('ultra' in t or 'premi' in t): return True
        return False

    def clasificar(titulo):
        """Devuelve clave de costo para la línea de funda."""
        t = titulo.lower()
        if 'con costura' in t and ('iphone' in t or '17' in t): return 'con_costura'
        if 's22 s23 s24' in t:                                   return 'samsung_s_cu'
        if 's25' in t and ('premium' in t or 'premi' in t):      return 'samsung_s_cu'
        if 's25' in t and 'magnét' in t:                         return 's25_magnetica'
        if '17' in t and ('magnét' in t or 'magsafe' in t):      return 'iphone17_mag'
        return 'magsafe'  # iPhone MagSafe u otras fundas

    def costo_unit(titulo):
        """Devuelve costo unitario en ARS."""
        tipo = clasificar(titulo)
        return round(COSTOS_USD[tipo] * TC + FLETE_UNIT)

    def demanda_mensual(vendidos, vend_rec=None):
        # Demanda REAL si hay ventana de ventas recientes (VendRec, /orders de ML);
        # si no, proxy histórico: vendidas de vida / 4.
        if DIAS_REC > 0 and vend_rec is not None:
            return float(vend_rec) / (DIAS_REC / 30.0)
        return vendidos / 4.0

    def dias_autonomia(stock, vendidos, vend_rec=None):
        # Cuántos días dura el stock actual al ritmo de venta vigente.
        # None = no se vende (no tiene sentido decir que "se agota").
        dm = demanda_mensual(vendidos, vend_rec)
        if dm <= 0:
            return None
        return stock / (dm / 30.0)

    def _cobertura_qty(stock, vendidos, vend_rec=None):
        # Pedido para cubrir COBERTURA meses CONTADOS DESDE QUE LLEGA, no desde
        # que se pide: durante el viaje se sigue vendiendo, así que hay que
        # sumar el consumo del plazo de entrega o la mercadería llega a un
        # depósito ya vacío. Redondeado hacia arriba a pack de 5.
        meses = COBERTURA + (LEAD_DIAS / 30.0)
        objetivo = demanda_mensual(vendidos, vend_rec) * meses
        return max(0, math.ceil(max(0.0, objetivo - stock) / 5) * 5)

    def cant_sug(stock, vendidos, vend_rec=None):
        if COBERTURA > 0:
            return _cobertura_qty(stock, vendidos, vend_rec)
        target = max(10, math.ceil(vendidos * 0.8 / 5) * 5)
        return max(0, target - stock)

    def cant_adj(vendidos, stock=0, vend_rec=None):
        if COBERTURA > 0:
            return _cobertura_qty(stock, vendidos, vend_rec)
        return max(5, math.ceil(vendidos / 4 / 5) * 5)

    NETO_RATIO      = None
    NETO_POR_TITULO = {}
    NETO_VENTAS     = 0
    NETO_CUENTAS    = []
    VENTAS_EXTRA    = None

    if args.from_json:
        # ── Modo EXPORT: armar xlsx desde un borrador EDITADO (JSON) ──
        # Usa los cant_ajustada / costo_unit editados por el usuario (vía '_cu/_csug/_cadj').
        # El orden de los items se respeta tal cual viene del borrador (ya ordenado).
        with open(args.from_json, 'r', encoding='utf-8') as f:
            draft = json.load(f)
        prm = draft.get('params', {}) or {}
        TC         = float(prm.get('tc', TC))
        FLETE_UNIT = int(round(float(prm.get('flete_unit', FLETE_UNIT))))
        VEND_MIN   = int(prm.get('vendidos_min', VEND_MIN))
        STOCK_MAX  = int(prm.get('stock_max', STOCK_MAX))
        DIAS_MAX   = int(prm.get('dias_stock_max', DIAS_MAX) or 0)
        relaxed_used = bool((draft.get('diagnostico', {}) or {}).get('relaxed_used', False))
        NETO_RATIO      = prm.get('neto_ratio')            # neto/bruto real de las liquidaciones
        NETO_POR_TITULO = prm.get('neto_ratio_por_titulo', {}) or {}
        NETO_VENTAS     = prm.get('neto_ratio_ventas', 0)
        NETO_CUENTAS    = prm.get('neto_ratio_cuentas', []) or []
        VENTAS_EXTRA    = prm.get('ventas_extra') or None
        DIAS_REC        = int(prm.get('dias_rec', DIAS_REC) or 0)
        # Sin estos dos el Excel final perdía el plazo de entrega y la cobertura:
        # quedaba sin "llegada estimada" y la urgencia no podía marcar QUIEBRE
        # (que es justamente "se agota antes de que llegue el pedido").
        COBERTURA       = float(prm.get('cobertura', COBERTURA) or 0)
        LEAD_DIAS       = int(prm.get('lead_dias', LEAD_DIAS) or 0)
        lista = []
        for it in draft.get('items', []):
            if not it.get('incluido', True):
                continue   # item quitado de la orden por el usuario
            cadj = int(round(float(it.get('cant_ajustada', 0) or 0)))
            if cadj <= 0:
                continue   # cantidad 0 = no se pide (consistente con el total del front)
            lista.append({
                'Título':   it.get('producto', ''),
                'Variante': it.get('variante', ''),
                'Stock':    int(float(it.get('stock_actual', 0) or 0)),
                'Vendidos': int(float(it.get('vendidas', 0) or 0)),
                'Foto':     it.get('foto', '') or '',
                'Precio':   float(it.get('precio', 0) or 0),
                'VendRec':  (int(float(it['vend_rec'])) if it.get('vend_rec') not in (None, '') else None),
                '_prov_url':    it.get('prov_url', '') or '',
                '_prov_nombre': it.get('prov_nombre', '') or '',
                '_origen':  it.get('costo_origen', '') or '',
                # Precio de MERCADERÍA en USD (sin flete ni impuestos): es lo que
                # se le paga al proveedor y lo que hay que ver en la factura.
                '_usd':     (float(it['precio_usd']) if it.get('precio_usd') not in (None, '') else None),
                '_usd_ok':  bool(it.get('precio_usd_exacto')),
                '_cu':      int(round(float(it.get('costo_unit', 0) or 0))),
                '_csug':    int(round(float(it.get('cant_sugerida', 0) or 0))),
                '_cadj':    cadj,
            })
        fundas = lista
        variantes = lista
        pass_vend = len(lista); pass_stock = len(lista); pass_dias = 0
    else:
        if not args.csv_input:
            p.error('se requiere csv_input (o --from-json)')
        # ── Leer CSV ────────────────────────────────────────────────
        with open(args.csv_input, 'r', encoding='utf-8-sig') as f:
            rows = list(csv.DictReader(f))

        variantes = [r for r in rows if r['Variante'] != '(total)']
        for r in variantes:
            r['Stock']   = int(float(r['Stock']))
            r['Vendidos']= int(float(r['Vendidos']))
            r['Precio']  = round(float(r['Precio']))
            # VendRec: ventas reales de los últimos DIAS_REC días (columna opcional)
            try:
                r['VendRec'] = int(float(r['VendRec'])) if (r.get('VendRec') or '') != '' else None
            except (ValueError, KeyError):
                r['VendRec'] = None

        fundas = variantes if args.all_products else [r for r in variantes if es_funda(r['Título'])]

        # ── Puerta de entrada ────────────────────────────────────────
        # Dos criterios en OR, porque "stock bajo" y "se agota pronto" NO son
        # lo mismo: una funda con 5 unidades que vende 2 por semana se agota en
        # 17 días, pero un umbral de stock absoluto la deja afuera. El segundo
        # criterio la rescata sin tener que bajar --stock-max para todos.
        def agota_pronto(r):
            if DIAS_MAX <= 0:
                return False
            d = dias_autonomia(r['Stock'], r['Vendidos'], r.get('VendRec'))
            return d is not None and d <= DIAS_MAX

        def entra_umbrales(r):
            return r['Vendidos'] >= VEND_MIN and (r['Stock'] <= STOCK_MAX or agota_pronto(r))

        # Con cobertura objetivo, la puerta de entrada ES la cobertura: entra
        # todo lo que NO llega a cubrir (cobertura + plazo de entrega). Los
        # umbrales manuales quedan ignorados a propósito.
        #
        # `Vendidos` son las ventas de TODA LA VIDA de la publicación, así que
        # una recién publicada que vende rápido nunca llegaba al umbral y se
        # quedaba afuera aunque se agotara antes de que llegue el pedido. Al
        # revés, una vieja con muchas ventas históricas pero parada entraba
        # igual. Ese doble error es el que hacía perder fundas del pedido.
        #
        # La cobertura mira RITMO (VendRec / ventana), no acumulado, así que no
        # castiga a las nuevas y no premia a las que ya no rotan.
        por_cobertura = COBERTURA > 0
        def entra(r):
            if por_cobertura:
                return cant_adj(r['Vendidos'], r['Stock'], r.get('VendRec')) > 0
            return entra_umbrales(r)

        # Diagnóstico de filtros
        pass_vend  = sum(1 for r in fundas if r['Vendidos'] >= VEND_MIN)
        pass_stock = sum(1 for r in fundas if r['Stock'] <= STOCK_MAX)
        # Los que SOLO entran por autonomía (los que el umbral de stock perdía)
        pass_dias  = sum(1 for r in fundas
                         if r['Vendidos'] >= VEND_MIN and r['Stock'] > STOCK_MAX and agota_pronto(r))
        lista = [r for r in fundas if entra(r)]
        # Cuántas habría perdido el criterio viejo de umbrales — es el número que
        # responde "¿me estoy quedando sin stock de algo que no entró?"
        rescatadas = sum(1 for r in lista if not entra_umbrales(r)) if por_cobertura else 0

        # Fallback automático: si lista vacía y los umbrales son los default, relajar
        relaxed_used = False
        if not lista and not por_cobertura and VEND_MIN == 5 and STOCK_MAX == 7:
            VEND_MIN_R, STOCK_MAX_R = 1, 15
            lista = [r for r in fundas if r['Vendidos'] >= VEND_MIN_R and r['Stock'] <= STOCK_MAX_R]
            if lista:
                VEND_MIN, STOCK_MAX = VEND_MIN_R, STOCK_MAX_R
                relaxed_used = True

        # Ordenar por publicación luego por vendidos desc
        orden = [
            "iPhone 17 Pro Max Air | Con Costura",
            "iPhone 17 Pro Max Air Magnética",
            "iPhone 17 Pro Max Air Magsafe",
            "iPhone 16/15/14/13/12 | Con Costura",
            "iPhone 16/15/14/13/12 Magnética Magsafe",
            "S25 Ultra | Magnética",
            "S25 Ultra | Premium",
            "S22 S23 S24 Ultra",
        ]
        def sort_key(r):
            t = r['Título']
            for i, o in enumerate(orden):
                if o.lower() in t.lower(): return (i, -r['Vendidos'], r['Stock'])
            return (99, -r['Vendidos'], r['Stock'])

        lista.sort(key=sort_key)

    # ══ MODO BORRADOR (--json): emitir filas calculadas, sin xlsx ══
    # Reusa las MISMAS funciones de cálculo (costo_unit / cant_sug / cant_adj)
    # y el mismo filtrado/orden que el Excel → números idénticos garantizados.
    if args.json:
        items_out = []
        ya_cubiertas = 0   # entraron por el filtro pero no hay nada que pedir
        for idx, r in enumerate(lista, 1):
            titulo   = r['Título']
            variante = r['Variante']
            color = ""; modelo = variante
            if '·' in variante:
                pts = variante.split('·')
                color = pts[0].replace('Color:', '').strip()
                modelo = pts[1].replace('Nombre del diseño:', '').strip() if len(pts) > 1 else ''
            stock = r['Stock']; vendidos = r['Vendidos']
            vrec = r.get('VendRec')
            cu   = costo_unit(titulo)
            csug = cant_sug(stock, vendidos, vrec)
            cadj = cant_adj(vendidos, stock, vrec)
            # El filtro de entrada (stock <= STOCK_MAX) y el cálculo de cantidad
            # son independientes: una variante con stock 7 que vende 1 por mes
            # pasa el umbral, pero su stock ya cubre los meses objetivo, así que
            # no hay nada que pedir. Antes esas filas llenaban la
            # previsualización y después DESAPARECÍAN del Excel (que saltea las
            # de cantidad 0), que es justo lo que hacía dudar del listado.
            if cadj <= 0:
                ya_cubiertas += 1
                continue
            dias = dias_autonomia(stock, vendidos, vrec)
            items_out.append({
                "id":             f"{r.get('Item ID', '')}::{variante}",
                "item_id":        r.get('Item ID', ''),
                "producto":       titulo,
                "variante":       variante,
                "color":          color,
                "modelo":         modelo,
                "categoria":      r.get('Categoría', ''),
                "foto":           r.get('Foto', ''),
                # Con el criterio de autonomía activo la urgencia se mide en días,
                # no en unidades: 25 fundas que se agotan en 17 días son más
                # urgentes que 3 que duran 45. Si no hay ventas para estimar
                # días, se cae al criterio viejo de stock bajo.
                "prioridad":      (("critico" if dias <= DIAS_MAX else "bajo")
                                   if (DIAS_MAX > 0 and dias is not None)
                                   else ("critico" if stock <= 4 else "bajo")),
                "stock_actual":   stock,
                # Si hoy está en 0, VendRec está CENSURADO: vendió poco porque
                # no había qué vender, no porque no lo quieran. La demanda real
                # es mayor que la calculada, pero cuánto más no se puede saber
                # sin historial de stock (no lo guardamos) → se marca para que
                # se revise a mano en vez de inventar un número.
                "demanda_censurada": stock == 0,
                "dias_autonomia": (round(dias, 1) if dias is not None else None),
                # Por qué entró: 'stock' (umbral clásico), 'dias' (solo por autonomía) o 'ambos'
                "entro_por":      ("cobertura" if por_cobertura
                                   else "ambos" if (stock <= STOCK_MAX and DIAS_MAX > 0 and dias is not None and dias <= DIAS_MAX)
                                   else "stock" if stock <= STOCK_MAX else "dias"),
                "vendidas":       vendidos,
                "vend_rec":       vrec,
                "precio":         r.get('Precio', 0),
                "cant_sugerida":  csug,
                "cant_ajustada":  cadj,
                "costo_unit":     cu,
                "costo_total":    cadj * cu,   # total de la fila usando la cantidad AJUSTADA (lo que se pide)
                "incluido":       True,
            })
        payload = {
            "params": {
                "tc": TC, "flete": args.flete, "flete_unit": FLETE_UNIT, "units": args.units,
                "vendidos_min": VEND_MIN, "stock_max": STOCK_MAX, "all_products": bool(args.all_products),
                "dias_stock_max": DIAS_MAX, "lead_dias": LEAD_DIAS,
                "cobertura": COBERTURA, "dias_rec": DIAS_REC,
            },
            "totales": {
                "items":        len(items_out),
                "unidades_sug": sum(i["cant_sugerida"] for i in items_out),
                "unidades_aj":  sum(i["cant_ajustada"] for i in items_out),
                "inversion_sug": sum(i["cant_sugerida"] * i["costo_unit"] for i in items_out),
                "inversion_aj":  sum(i["costo_total"] for i in items_out),
            },
            "diagnostico": {
                "variantes_total": len(variantes), "fundas_total": len(fundas),
                "pass_vendidos": pass_vend, "pass_stock": pass_stock,
                "pass_dias": pass_dias,     # rescatados SOLO por autonomía
                "ya_cubiertas": ya_cubiertas,   # pasaron el filtro pero el stock ya cubre el objetivo
                "por_cobertura": bool(por_cobertura),   # la entrada la decide la cobertura, no los umbrales
                "rescatadas": rescatadas,       # entran por cobertura y los umbrales las perdían
                "vendidos_min": VEND_MIN, "stock_max": STOCK_MAX, "dias_stock_max": DIAS_MAX,
                "all_products": bool(args.all_products), "relaxed_used": relaxed_used,
            },
            "items": items_out,
        }
        print(f"ORDEN_JSON:{json.dumps(payload, ensure_ascii=False)}")
        return

    # ── Sistema visual ───────────────────────────────────────────
    # Un solo acento y color semántico SOLO en la columna de urgencia. El diseño
    # anterior tenía ocho rellenos compitiendo (azul, rosa, amarillo, verde,
    # naranja y un color de costo por línea de producto): con todo resaltado,
    # nada resalta. Acá el resto es neutro y la vista va sola a lo que urge.
    INK    = "111827"   # casi negro azulado — encabezados
    ACCENT = "155E75"   # teal oscuro — totales y links
    BAND   = "F3F4F6"   # banda de producto
    LINE   = "E5E7EB"   # divisores
    MUTED  = "6B7280"   # texto secundario
    TEXT   = "111827"
    WHITE  = "FFFFFF"
    # Escala de urgencia (único lugar con color)
    # 'ok' va SIN relleno a propósito: si el caso normal también lleva color, el
    # color deja de significar algo. Acá solo se pinta lo que necesita acción.
    URG = {
        'critico': ("FEE2E2", "991B1B"),
        'pronto':  ("FEF3C7", "92400E"),
        'ok':      (None,     MUTED),
    }
    FUENTE = 'Calibri'

    # Sin cuadrícula completa: solo una línea horizontal fina. Es lo que separa
    # una planilla que parece un formulario de una que parece un informe.
    hair = Side(style='thin', color=LINE)
    b_bot = Border(bottom=hair)
    b_none = Border()

    def celda(c, valor=None, *, bold=False, size=10, color=TEXT, bg=None,
              align='left', fmt=None, wrap=False, borde=b_bot):
        if valor is not None:
            c.value = valor
        c.font = Font(name=FUENTE, size=size, bold=bold, color=color)
        if bg:
            c.fill = PatternFill('solid', start_color=bg)
        c.alignment = Alignment(horizontal=align, vertical='center', wrap_text=wrap)
        c.border = borde
        if fmt:
            c.number_format = fmt
        return c

    def pintar(ws_, fila, cols, bg, borde=b_bot):
        for col in cols:
            c = ws_.cell(row=fila, column=col)
            if bg:
                c.fill = PatternFill('solid', start_color=bg)
            c.border = borde

    wb = Workbook()

    # ══ HOJA 1: ORDEN DE COMPRA ═════════════════════════════════
    ws = wb.active
    ws.title = "Orden de compra"
    ws.sheet_view.showGridLines = False

    NCOL = 16
    ULT  = get_column_letter(NCOL)

    hoy = date.today()
    llegada = hoy + timedelta(days=LEAD_DIAS) if LEAD_DIAS else None

    # ── Encabezado ───────────────────────────────────────────────
    ws.merge_cells(f'A1:{ULT}1')
    celda(ws['A1'], "ORDEN DE COMPRA", bold=True, size=18, color=WHITE, bg=INK,
          align='left', borde=b_none)
    ws.row_dimensions[1].height = 38

    grupo = "todas las publicaciones" if args.all_products else "fundas"
    partes = [f"Emitida {hoy.strftime('%d/%m/%Y')}", f"Alcance: {grupo}"]
    if COBERTURA > 0:
        partes.append(f"Cobertura objetivo: {COBERTURA:g} meses")
    if LEAD_DIAS:
        partes.append(f"Entrega: {LEAD_DIAS} días (llega ~{llegada.strftime('%d/%m')})")
    partes.append(f"TC ${TC:,.0f}".replace(",", "."))
    partes.append(f"Envío+impuestos ${FLETE_UNIT:,}/u".replace(",", "."))
    if relaxed_used:
        partes.append("umbrales relajados automáticamente")
    ws.merge_cells(f'A2:{ULT}2')
    celda(ws['A2'], "   ·   ".join(partes), size=9, color=MUTED, bg=WHITE,
          align='left', borde=b_none)
    ws.row_dimensions[2].height = 20

    # ── Cifras del pedido (se completan al final, cuando están los totales) ──
    fila_kpi = 3
    ws.row_dimensions[fila_kpi].height = 34
    ws.row_dimensions[4].height = 8

    # ── Cabecera de la tabla ─────────────────────────────────────
    HDR = 5
    encabezados = [
        ("#", 5), ("Urgencia", 11), ("Producto", 32), ("Color", 14), ("Modelo", 16),
        ("Stock", 7), ("Venta\nmensual", 9), ("Autonomía\ndías", 10), ("Quiebre\nestimado", 11),
        ("Sugerido", 9), ("A pedir", 9),
        ("USD unit.\nproveedor", 11), ("USD total\nproveedor", 12),
        ("Costo puesto\nunitario", 12), ("Costo puesto\ntotal", 13), ("Precio\nsegún", 11),
    ]
    ws.row_dimensions[HDR].height = 30
    borde_hdr = Border(bottom=Side(style='medium', color=INK))
    for i, (h, w) in enumerate(encabezados, 1):
        alin = 'left' if i in (3, 4, 5) else ('center' if i in (1, 2, 9, 16) else 'right')
        celda(ws.cell(row=HDR, column=i, value=h), bold=True, size=9, color=INK,
              bg=WHITE, align=alin, wrap=True, borde=borde_hdr)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = f'A{HDR + 1}'

    ORIGEN_LBL = {'medido': 'recibo', 'proveedor': 'proveedor',
                  'manual': 'manual', 'estimado': 'estimado'}

    titulo_ant = None
    row_actual = HDR + 1
    num = 1
    _fotos_cache = {}
    total_sug = 0; total_adj = 0; total_costo_sug = 0; total_costo_adj = 0
    total_usd = 0.0; usd_aprox = 0

    for r in lista:
        titulo = r['Título']
        if titulo != titulo_ant:
            # Banda de producto: foto + título + link, una vez por publicación.
            foto = r.get('Foto', '')
            prov = r.get('_prov_url', '')
            ws.row_dimensions[row_actual].height = 40 if foto else 22
            pintar(ws, row_actual, range(1, NCOL + 1), BAND, b_none)

            ws.merge_cells(start_row=row_actual, start_column=1, end_row=row_actual, end_column=1)
            buf = _descargar_miniatura(foto, _fotos_cache)
            if buf is not None:
                img = XLImage(buf)
                img.width = img.height = 34
                ws.add_image(img, f'A{row_actual}')

            ws.merge_cells(start_row=row_actual, start_column=2, end_row=row_actual, end_column=13)
            celda(ws.cell(row=row_actual, column=2, value=titulo), bold=True, size=10,
                  color=INK, bg=BAND, align='left', borde=b_none)

            ws.merge_cells(start_row=row_actual, start_column=14, end_row=row_actual, end_column=NCOL)
            cl = ws.cell(row=row_actual, column=14,
                         value=(r.get('_prov_nombre') or 'Ver en proveedor') if prov else '')
            if prov:
                cl.hyperlink = prov
                cl.font = Font(name=FUENTE, size=9, color=ACCENT, underline='single')
            else:
                cl.font = Font(name=FUENTE, size=9, color=MUTED)
            cl.fill = PatternFill('solid', start_color=BAND)
            cl.alignment = Alignment(horizontal='right', vertical='center')
            cl.border = b_none

            row_actual += 1; titulo_ant = titulo

        ws.row_dimensions[row_actual].height = 20
        stock = r['Stock']
        vrec  = r.get('VendRec')
        dm    = demanda_mensual(r['Vendidos'], vrec)
        dias  = dias_autonomia(stock, r['Vendidos'], vrec)

        variante = r['Variante']
        color = ""; modelo = variante
        if '·' in variante:
            pts = variante.split('·')
            color = pts[0].replace('Color:', '').strip()
            modelo = pts[1].replace('Nombre del diseño:', '').strip() if len(pts) > 1 else ''

        cu   = r.get('_cu',   costo_unit(titulo))
        csug = r.get('_csug', cant_sug(stock, r['Vendidos'], vrec))
        cadj = r.get('_cadj', cant_adj(r['Vendidos'], stock, vrec))

        # Urgencia = ¿aguanta hasta que llegue el pedido? Es la pregunta que
        # importa al comprar, y no la contesta el stock absoluto.
        if stock == 0:
            urg, urg_txt = 'critico', 'SIN STOCK'
        elif dias is not None and LEAD_DIAS and dias <= LEAD_DIAS:
            urg, urg_txt = 'critico', 'QUIEBRE'
        elif dias is not None and dias <= 30:
            urg, urg_txt = 'pronto', 'PRONTO'
        else:
            urg, urg_txt = 'ok', 'a tiempo'
        urg_bg, urg_fg = URG[urg]

        celda(ws.cell(row=row_actual, column=1, value=num), size=9, color=MUTED, align='center')
        celda(ws.cell(row=row_actual, column=2, value=urg_txt), bold=(urg != 'ok'), size=8,
              color=urg_fg, bg=urg_bg, align='center')
        celda(ws.cell(row=row_actual, column=3, value=titulo), size=9, color=MUTED, align='left')
        celda(ws.cell(row=row_actual, column=4, value=color), size=10, align='left')
        celda(ws.cell(row=row_actual, column=5, value=modelo), size=10, align='left')
        celda(ws.cell(row=row_actual, column=6, value=stock), size=10, align='right',
              bold=(stock == 0), color=(urg_fg if stock == 0 else TEXT), fmt='#,##0')
        celda(ws.cell(row=row_actual, column=7, value=round(dm, 1) if dm else 0),
              size=10, align='right', color=MUTED, fmt='#,##0.0')
        celda(ws.cell(row=row_actual, column=8, value=(round(dias) if dias is not None else '—')),
              size=10, align='right', color=(urg_fg if urg != 'ok' else TEXT),
              bold=(urg == 'critico'), fmt=('#,##0' if dias is not None else None))
        celda(ws.cell(row=row_actual, column=9,
                      value=(hoy + timedelta(days=int(min(dias, 3650))) if dias is not None else '—')),
              size=9, align='center', color=MUTED,
              fmt=('dd/mm/yy' if dias is not None else None))
        celda(ws.cell(row=row_actual, column=10, value=csug), size=10, align='right',
              color=MUTED, fmt='#,##0')
        celda(ws.cell(row=row_actual, column=11, value=cadj), bold=True, size=10,
              align='right', fmt='#,##0')
        # USD de mercadería — lo que se le paga al proveedor y lo que tiene que
        # coincidir con la factura de Alibaba. NO incluye flete ni impuestos.
        usd_u = r.get('_usd')
        if usd_u is None:
            usd_u = max(0.0, (cu - FLETE_UNIT) / TC) if TC else None
        exacto = bool(r.get('_usd_ok'))
        usd_t = (usd_u * cadj) if usd_u is not None else None
        celda(ws.cell(row=row_actual, column=12, value=(usd_u if usd_u is not None else '—')),
              size=10, align='right', color=(TEXT if exacto else MUTED),
              fmt=('"US$"#,##0.00' if usd_u is not None else None))
        celda(ws.cell(row=row_actual, column=13, value=(usd_t if usd_t is not None else '—')),
              bold=True, size=10, align='right', color=(TEXT if exacto else MUTED),
              fmt=('"US$"#,##0.00' if usd_t is not None else None))
        celda(ws.cell(row=row_actual, column=14, value=cu), size=10, align='right',
              color=MUTED, fmt='$#,##0')
        celda(ws.cell(row=row_actual, column=15, value=cadj * cu), bold=True, size=10,
              align='right', fmt='$#,##0')
        celda(ws.cell(row=row_actual, column=16,
                      value=ORIGEN_LBL.get(r.get('_origen', ''), '—')),
              size=8, align='center',
              color=(MUTED if exacto else "92400E"))

        total_sug += csug; total_adj += cadj
        total_costo_sug += csug * cu; total_costo_adj += cadj * cu
        if usd_t is not None:
            total_usd += usd_t
            if not exacto:
                usd_aprox += 1
        row_actual += 1; num += 1

    # ── Total ────────────────────────────────────────────────────
    tr = row_actual
    ws.row_dimensions[tr].height = 28
    borde_tot = Border(top=Side(style='medium', color=INK))
    pintar(ws, tr, range(1, NCOL + 1), WHITE, borde_tot)
    ws.merge_cells(start_row=tr, start_column=1, end_row=tr, end_column=9)
    celda(ws.cell(row=tr, column=1, value=f"TOTAL — {num - 1} variantes"), bold=True,
          size=10, color=INK, align='left', borde=borde_tot)
    celda(ws.cell(row=tr, column=10, value=total_sug), size=10, color=MUTED,
          align='right', fmt='#,##0', borde=borde_tot)
    celda(ws.cell(row=tr, column=11, value=total_adj), bold=True, size=11,
          align='right', fmt='#,##0', borde=borde_tot)
    # El total en USD es el número que se controla contra la factura del proveedor
    celda(ws.cell(row=tr, column=13, value=total_usd), bold=True, size=12,
          color=ACCENT, align='right', fmt='"US$"#,##0.00', borde=borde_tot)
    celda(ws.cell(row=tr, column=15, value=total_costo_adj), bold=True, size=12,
          color=ACCENT, align='right', fmt='$#,##0', borde=borde_tot)

    # ── Cifras del pedido (ahora sí, con los totales calculados) ──
    _uds = total_adj or 1
    kpis_top = [
        ("Unidades a pedir", f"{total_adj:,}".replace(",", "."), 1, 3),
        ("A pagar al proveedor (mercadería)", f"US$ {total_usd:,.2f}", 4, 6),
        ("Costo puesto total", f"${total_costo_adj:,.0f}".replace(",", "."), 7, 10),
        ("Llegada estimada", llegada.strftime('%d/%m/%Y') if llegada else "—", 11, NCOL),
    ]
    for lbl, val, c1, c2 in kpis_top:
        ws.merge_cells(start_row=fila_kpi, start_column=c1, end_row=fila_kpi, end_column=c2)
        c = ws.cell(row=fila_kpi, column=c1)
        c.value = f"{lbl}\n{val}"
        c.font = Font(name=FUENTE, size=9, color=MUTED)
        c.fill = PatternFill('solid', start_color=BAND)
        c.alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
        c.border = b_none
        pintar(ws, fila_kpi, range(c1, c2 + 1), BAND, b_none)

    # ── Nota al pie ──────────────────────────────────────────────
    nota_row = tr + 2
    ws.merge_cells(f'A{nota_row}:{ULT}{nota_row}')
    celda(ws.cell(row=nota_row, column=1),
          "Urgencia: SIN STOCK / QUIEBRE = se agota antes de que llegue el pedido · PRONTO = menos de 30 días · "
          "Autonomía y venta mensual salen del ritmo real de los últimos "
          f"{DIAS_REC} días. " if DIAS_REC else
          "Urgencia: SIN STOCK / QUIEBRE = se agota antes de que llegue el pedido · PRONTO = menos de 30 días. ",
          size=8, color=MUTED, bg=WHITE, align='left', borde=b_none)
    ws.row_dimensions[nota_row].height = 16
    nota2 = nota_row + 1
    ws.merge_cells(f'A{nota2}:{ULT}{nota2}')
    celda(ws.cell(row=nota2, column=1),
          f"USD = solo la MERCADERÍA, lo que se le paga al proveedor: la factura tiene que dar US$ {total_usd:,.2f}. "
          f"No incluye envío ni impuestos (${FLETE_UNIT:,}/u aparte), que sí están en el costo puesto. "
          "Precio según: proveedor = precio del link cargado · recibo = precio realmente pagado en un pedido anterior · "
          + (f"estimado = tabla por tipo de funda, {usd_aprox} fila(s) con USD aproximado — confirmalos con el proveedor."
             if usd_aprox else "estimado = tabla por tipo de funda."),
          size=8, color=MUTED, bg=WHITE, align='left', borde=b_none)
    ws.row_dimensions[nota2].height = 16


    # ══ HOJA 2: RESUMEN ═════════════════════════════════════════
    ws2 = wb.create_sheet("Resumen")
    ws2.sheet_view.showGridLines = False
    ws2.merge_cells('A1:E1')
    celda(ws2['A1'], "RESUMEN DEL PEDIDO", bold=True, size=16, color=WHITE, bg=INK,
          align='left', borde=b_none)
    ws2.row_dimensions[1].height = 34

    # ── Proyección financiera ────────────────────────────────────────────
    # El retorno se estima con la relación NETO/BRUTO real de las liquidaciones
    # ya cobradas: ML descuenta comisión + envío, y eso ya viene descontado en
    # el `neto` de cada venta. Se usa el ratio de la propia publicación cuando
    # hay volumen suficiente; si no, el promedio general.
    inv_total = 0; bruto = 0; neto = 0; uds = 0; uds_dia = 0.0
    for r in lista:
        cadj = r.get('_cadj', cant_adj(r['Vendidos'], r['Stock'], r.get('VendRec')))
        if cadj <= 0: continue
        cu    = r.get('_cu', costo_unit(r['Título']))
        precio = float(r.get('Precio', 0) or 0)
        ratio  = NETO_POR_TITULO.get(r['Título'], NETO_RATIO)
        inv_total += cu * cadj
        uds       += cadj
        if precio > 0:
            bruto += precio * cadj
            if ratio: neto += precio * cadj * ratio
        # Ritmo de venta actual, para estimar en cuánto se liquida el pedido
        if DIAS_REC > 0 and r.get('VendRec') is not None:
            uds_dia += float(r['VendRec']) / DIAS_REC
        else:
            uds_dia += r['Vendidos'] / 4.0 / 30.0

    ganancia   = (neto - inv_total) if neto else None
    margen     = (ganancia / neto * 100) if (neto and ganancia is not None) else None
    roi        = (ganancia / inv_total * 100) if (inv_total and ganancia is not None) else None
    dias_vender = (uds / uds_dia) if uds_dia > 0 else None
    # Recuperás la inversión cuando lo COBRADO iguala lo invertido, no al vender todo
    neto_dia    = (neto / dias_vender) if (neto and dias_vender) else 0
    dias_recup  = (inv_total / neto_dia) if neto_dia > 0 else None

    def _m(v): return f"${v:,.0f}".replace(",", ".") if v is not None else "—"
    def _d(v): return f"{v:,.0f} días".replace(",", ".") if v is not None else "—"
    def _p(v): return f"{v:.1f}%" if v is not None else "—"

    kpis=[
        ("INVERSIÓN — lo que sale del bolsillo", _m(inv_total)),
        ("Unidades a pedir", f"{uds:,.0f}".replace(",", ".")),
        ("Costo puesto promedio por unidad", _m(inv_total / uds if uds else None)),
        ("", ""),
        ("RETORNO — si se vende todo al precio actual", ""),
        ("Facturación bruta esperada", _m(bruto if bruto else None)),
        (f"Neto que deposita ML ({_p(neto/bruto*100) if (neto and bruto) else 'sin dato'} del bruto)", _m(neto if neto else None)),
        ("GANANCIA esperada (neto − inversión)", _m(ganancia)),
        ("Margen sobre el neto", _p(margen)),
        ("Retorno sobre la inversión (ROI)", _p(roi)),
        ("", ""),
        ("TIEMPOS — al ritmo de venta actual", ""),
        ("Ritmo de venta", f"{uds_dia:.1f} u/día" if uds_dia else "—"),
        ("Vender todo el pedido", _d(dias_vender)),
        ("RECUPERAR la inversión", _d(dias_recup)),
        ("", ""),
        ("DE DÓNDE SALEN ESTOS NÚMEROS", ""),
    ] + [
        (f"Neto medido en {c['label']} ({c['fiscal']})",
         f"{c['ratio']*100:.1f}% · {c['ventas']} ventas") for c in NETO_CUENTAS
    ] + ([
        ("⚠ El ritmo de venta incluye " + ", ".join(VENTAS_EXTRA.get('cuentas', []) or ['otra cuenta']),
         f"+{VENTAS_EXTRA.get('unidades', 0)} u"),
        ("⚠ Pero el neto se estima con la economía de la cuenta de arriba", "revisar"),
    ] if VENTAS_EXTRA else []) + [
        ("", ""),
    ] + _conteos_urgencia(lista, fundas, args.from_json, args.all_products,
                          dias_autonomia, LEAD_DIAS)
    # ── Render del resumen ───────────────────────────────────────
    # Mismo sistema visual que la hoja 1: neutro, una sola línea divisoria y el
    # acento reservado para las tres cifras que se miran de verdad.
    ws2.column_dimensions['A'].width = 3
    ws2.column_dimensions['B'].width = 46
    ws2.column_dimensions['C'].width = 20
    ws2.column_dimensions['D'].width = 22
    ws2.column_dimensions['E'].width = 3

    fila = 2
    for lbl, val in kpis:
        fila += 1
        row = fila
        if lbl == "":
            ws2.row_dimensions[row].height = 10
            continue
        es_titulo = (val == "")
        es_clave  = lbl.startswith(("INVERSIÓN", "GANANCIA", "RECUPERAR"))
        es_alerta = lbl.startswith("⚠")
        if es_titulo:
            ws2.row_dimensions[row].height = 26
            ws2.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
            # Solo la inicial en mayúscula: .title() dejaba "Si Se Vende Todo Al Precio"
            titulo_sec = lbl[:1] + lbl[1:].lower()
            celda(ws2.cell(row=row, column=2, value=titulo_sec), bold=True, size=10,
                  color=INK, bg=WHITE, align='left',
                  borde=Border(bottom=Side(style='medium', color=INK)))
            continue
        ws2.row_dimensions[row].height = 24 if es_clave else 20
        pintar(ws2, row, range(2, 5), WHITE)
        celda(ws2.cell(row=row, column=2, value=lbl), bold=es_clave, size=10,
              color=("92400E" if es_alerta else (INK if es_clave else MUTED)), align='left')
        celda(ws2.cell(row=row, column=3, value=val), bold=True,
              size=13 if es_clave else 10,
              color=(ACCENT if es_clave else INK), align='right')
        ws2.cell(row=row, column=4).border = b_bot

    # ── Desglose de la inversión ─────────────────────────────────
    # Qué parte de la plata es mercadería y qué parte es logística: el envío y
    # los impuestos fueron el 50% del último pedido, así que verlo separado
    # cambia la conversación sobre el tamaño del pedido.
    base = fila + 3
    ws2.row_dimensions[base].height = 26
    ws2.merge_cells(start_row=base, start_column=2, end_row=base, end_column=4)
    celda(ws2.cell(row=base, column=2, value="En qué se va la inversión"), bold=True,
          size=10, color=INK, bg=WHITE, align='left',
          borde=Border(bottom=Side(style='medium', color=INK)))
    merc_unit = max(0, (inv_total / uds if uds else 0) - FLETE_UNIT)
    desglose = [
        ("Mercadería — lo que se le paga al proveedor", merc_unit * uds,
         f"US$ {total_usd:,.2f}"),
        ("Envío e impuestos", FLETE_UNIT * uds, None),
    ]
    f = base
    for lbl, monto, extra_usd in desglose:
        f += 1
        ws2.row_dimensions[f].height = 20
        pintar(ws2, f, range(2, 5), WHITE)
        celda(ws2.cell(row=f, column=2, value=lbl), size=10, color=MUTED, align='left')
        celda(ws2.cell(row=f, column=3, value=_m(monto)), bold=True, size=10,
              color=INK, align='right')
        pct_txt = f"{monto / inv_total * 100:.0f}% de la inversión" if inv_total else "—"
        celda(ws2.cell(row=f, column=4,
                       value=(f"{extra_usd}  ·  {pct_txt}" if extra_usd else pct_txt)),
              size=9, color=(ACCENT if extra_usd else MUTED), bold=bool(extra_usd), align='right')

    # ── Top productos ────────────────────────────────────────────
    by_prod = defaultdict(lambda: {'v': 0, 'u': 0, 'inv': 0})
    for r in lista:
        cadj = r.get('_cadj', cant_adj(r['Vendidos'], r['Stock'], r.get('VendRec')))
        if cadj <= 0:
            continue
        cu = r.get('_cu', costo_unit(r['Título']))
        d = by_prod[r['Título']]
        d['v'] += 1; d['u'] += cadj; d['inv'] += cadj * cu

    base2 = f + 3
    ws2.row_dimensions[base2].height = 26
    ws2.merge_cells(start_row=base2, start_column=2, end_row=base2, end_column=4)
    celda(ws2.cell(row=base2, column=2, value="Qué se pide, por publicación"), bold=True,
          size=10, color=INK, bg=WHITE, align='left',
          borde=Border(bottom=Side(style='medium', color=INK)))
    ws2.row_dimensions[base2 + 1].height = 18
    for col, h, al in ((2, "Publicación", 'left'), (3, "Unidades", 'right'), (4, "Inversión", 'right')):
        celda(ws2.cell(row=base2 + 1, column=col, value=h), bold=True, size=8,
              color=MUTED, bg=WHITE, align=al)
    for i, (prod, d) in enumerate(sorted(by_prod.items(), key=lambda x: -x[1]['inv']), 1):
        row = base2 + 1 + i
        ws2.row_dimensions[row].height = 19
        pintar(ws2, row, range(2, 5), WHITE)
        celda(ws2.cell(row=row, column=2, value=prod), size=9, color=INK, align='left')
        celda(ws2.cell(row=row, column=3, value=d['u']), size=10, align='right', fmt='#,##0')
        celda(ws2.cell(row=row, column=4, value=d['inv']), size=10, align='right', fmt='$#,##0')


    wb.save(args.output)

    # Si la lista quedó vacía, escribir un mensaje informativo en la hoja
    if not lista:
        info_row = 4
        ws.merge_cells(f'A{info_row}:{ULT}{info_row}')
        c = ws.cell(row=info_row, column=1,
            value=f"⚠ Ningún item cumple los criterios (Vendidos≥{VEND_MIN}, Stock≤{STOCK_MAX}"
                  + (f" o se agota en ≤{DIAS_MAX} días" if DIAS_MAX > 0 else "") + "). "
                  f"De {len(fundas)} {'productos' if args.all_products else 'fundas'} analizados, "
                  f"{pass_vend} cumplen el umbral de vendidos y {pass_stock} el de stock. "
                  f"Probá bajar los umbrales o activar 'todos los productos'.")
        c.font = Font(name=FUENTE, size=10, color='92400E')
        c.fill = PatternFill('solid', start_color='FEF3C7')
        c.alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
        c.border = b_none
        ws.row_dimensions[info_row].height = 60

    resumen = {
        "items": len(lista),
        "total_sug": total_sug,
        "total_adj": total_adj,
        "inversion_sug": total_costo_sug,
        "inversion_adj": total_costo_adj,
        "tc": TC,
        "flete_unit": FLETE_UNIT,
        # Diagnóstico para el frontend
        "variantes_total": len(variantes),
        "fundas_total": len(fundas),
        "pass_vendidos": pass_vend,
        "pass_stock": pass_stock,
        "pass_dias": pass_dias,
        "vendidos_min": VEND_MIN,
        "stock_max": STOCK_MAX,
        "dias_stock_max": DIAS_MAX,
        "all_products": bool(args.all_products),
        "relaxed_used": relaxed_used,
    }
    print(f"RESUMEN_JSON:{json.dumps(resumen)}")

if __name__ == '__main__':
    main()

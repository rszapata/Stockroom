"""
flex_cost.py
------------
Lee el Excel de ventas de MercadoLibre y calcula el costo total de los envíos
Flex del período (filtra por columna "Forma de entrega" = "Mercado Envíos Flex").

Salida: JSON por stdout con breakdown por CP, lista de pendientes (CPs sin
zona asignada) y costo total.

Uso:
    python flex_cost.py <archivo_ml.xlsx> [--periodo 1|2|3] [--zones flex_zones.json]
"""
import sys, os, json, argparse, re
from pathlib import Path
from datetime import datetime

import openpyxl

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TARIFFS = {'caba': 4490, 'gba_cerca': 6490, 'gba_lejos': 8490, 'sin_zona': 0}

# Columnas (1-indexed) — segun análisis del Excel ML 2026
COL_VENTA   = 1   # # de venta
COL_FECHA   = 2   # Fecha de venta
COL_ESTADO  = 3   # Estado
COL_DESC    = 4   # Descripción del estado
COL_TITULO  = 26  # Título de la publicación
COL_CIUDAD  = 38  # Ciudad
COL_PROV    = 39  # Estado (provincia)
COL_CP      = 40  # Código postal
COL_FORMA   = 42  # Forma de entrega
COL_DOM     = 37  # Domicilio

PERIODOS = {'1': (1,10), '2': (11,20), '3': (21,31)}

# Estados que excluimos (cancelados, no entregados): nos guiamos por la columna
# "Estado" / "Descripción del estado" — incluimos todo lo que no sea cancelado.
ESTADOS_EXCLUIR = {'Cancelada', 'Cancelado', 'Reclamo cerrado con reembolso al comprador'}


def auto_zone(cp):
    if not cp: return None
    s = str(cp).strip().upper()
    if re.match(r'^C\d{4}', s): return 'caba'
    if s.isdigit():
        n = int(s)
        if 1000 <= n <= 1499: return 'caba'
    return None


MESES_ES = {
    'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,
    'julio':7,'agosto':8,'septiembre':9,'setiembre':9,'octubre':10,
    'noviembre':11,'diciembre':12
}

def parse_date(v):
    if v is None: return None
    if isinstance(v, datetime): return v
    s = str(v).strip().lower().replace('hs.', '').replace(' hs', '').strip()
    # Formato ML 2026: "20 de abril de 2026 23:49"
    m = re.match(r'^(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?', s)
    if m:
        d = int(m.group(1)); mes_name = m.group(2); y = int(m.group(3))
        mes = MESES_ES.get(mes_name)
        if mes:
            hh = int(m.group(4) or 0); mm = int(m.group(5) or 0)
            try: return datetime(y, mes, d, hh, mm)
            except: pass
    for fmt in ('%d/%m/%Y %H:%M hs', '%d/%m/%Y %H:%M', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try: return datetime.strptime(str(v).strip(), fmt)
        except: pass
    return None


def find_header_row(ws):
    """Busca la fila que contiene '# de venta' en la columna 1."""
    for r in range(1, 15):
        v = ws.cell(r, 1).value
        if v and '# de venta' in str(v).lower():
            return r
    return 6  # default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('excel')
    ap.add_argument('--periodo', default='', choices=['1','2','3',''])
    ap.add_argument('--zones', default='')
    args = ap.parse_args()

    zones_map = {}
    if args.zones and os.path.exists(args.zones):
        try:
            with open(args.zones, 'r', encoding='utf-8') as f:
                zones_map = json.load(f)
        except Exception as e:
            pass

    wb = openpyxl.load_workbook(args.excel, data_only=True)
    ws = wb.active
    header_row = find_header_row(ws)
    data_start = header_row + 1

    pmin, pmax = PERIODOS.get(args.periodo, (1, 31))

    breakdown = {}   # cp → { count, sample_address, zone, sample_venta }
    unmapped  = {}   # cp → { count, sample_address, sample_venta }
    flex_total = 0
    skipped_period = 0
    skipped_estado = 0
    rows_seen = 0
    sample_dates = []

    for r in range(data_start, ws.max_row + 1):
        venta = ws.cell(r, COL_VENTA).value
        if not venta: continue
        rows_seen += 1
        forma = ws.cell(r, COL_FORMA).value or ''
        if 'Flex' not in str(forma): continue

        # Filtro por estado
        estado = ws.cell(r, COL_ESTADO).value or ''
        desc   = ws.cell(r, COL_DESC).value or ''
        st = str(estado).strip()
        ds = str(desc).strip()
        if st in ESTADOS_EXCLUIR or ds in ESTADOS_EXCLUIR:
            skipped_estado += 1
            continue
        # También saltar si dice "cancel"
        combined = (st + ' ' + ds).lower()
        if 'cancel' in combined or 'devuelto' in combined or 'reembolso al comprador' in combined:
            skipped_estado += 1
            continue

        # Filtro por período (día del mes)
        if args.periodo:
            fecha = parse_date(ws.cell(r, COL_FECHA).value)
            if fecha:
                sample_dates.append(fecha.strftime('%Y-%m-%d'))
                if not (pmin <= fecha.day <= pmax):
                    skipped_period += 1
                    continue

        cp = str(ws.cell(r, COL_CP).value or '').strip()
        ciudad = ws.cell(r, COL_CIUDAD).value or ''
        prov = ws.cell(r, COL_PROV).value or ''
        dom = ws.cell(r, COL_DOM).value or ''
        addr = ' · '.join(str(x) for x in [dom, ciudad, prov] if x)

        flex_total += 1
        zone = zones_map.get(cp) or auto_zone(cp)
        if zone and zone in TARIFFS:
            entry = breakdown.setdefault(cp, {
                'count': 0, 'sample_address': addr, 'zone': zone,
                'sample_venta': str(venta),
            })
            entry['count'] += 1
            if not entry['sample_address']: entry['sample_address'] = addr
        else:
            entry = unmapped.setdefault(cp, {
                'count': 0, 'sample_address': addr, 'sample_venta': str(venta),
            })
            entry['count'] += 1
            if not entry['sample_address']: entry['sample_address'] = addr

    breakdown_arr = []
    for cp, v in breakdown.items():
        tariff = TARIFFS[v['zone']]
        breakdown_arr.append({
            'cp': cp, 'count': v['count'], 'zone': v['zone'],
            'tariff': tariff, 'subtotal': v['count'] * tariff,
            'sample_address': v['sample_address'],
            'sample_venta': v['sample_venta'],
        })
    breakdown_arr.sort(key=lambda x: -x['subtotal'])

    unmapped_arr = []
    for cp, v in unmapped.items():
        unmapped_arr.append({
            'cp': cp, 'count': v['count'],
            'sample_address': v['sample_address'],
            'sample_venta': v['sample_venta'],
            'auto_suggest': auto_zone(cp),
        })
    unmapped_arr.sort(key=lambda x: -x['count'])

    total_cost = sum(b['subtotal'] for b in breakdown_arr)

    out = {
        'ok': True,
        'flex_shipments': flex_total,
        'mapped_count': sum(b['count'] for b in breakdown_arr),
        'unmapped_count': sum(u['count'] for u in unmapped_arr),
        'total_cost': total_cost,
        'tariffs': TARIFFS,
        'breakdown': breakdown_arr,
        'unmapped': unmapped_arr,
        'periodo': args.periodo or 'todo',
        'rows_seen': rows_seen,
        'skipped_period': skipped_period,
        'skipped_estado': skipped_estado,
        'date_range': [min(sample_dates), max(sample_dates)] if sample_dates else None,
    }
    print('FLEX_JSON:' + json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('FLEX_ERROR:' + json.dumps({'error': str(e)}))
        sys.exit(1)

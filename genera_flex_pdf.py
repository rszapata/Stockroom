"""
genera_flex_pdf.py
──────────────────
Genera un PDF de despacho Flex para la logística.
Recibe un JSON con los datos de los envíos y produce un PDF
con una página por envío, replicando el formato de MercadoLibre.

Uso:
    python genera_flex_pdf.py <datos.json> <output.pdf>

El JSON de entrada es un array de objetos con esta estructura:
[
  {
    "pack_id": "2000012171832587",    // o null
    "venta_id": "2000015658485260",   // # de venta (si no hay pack)
    "envio_id": "46708520282",
    "vendedor_nombre": "WALTER JORGE ZAPATA",
    "vendedor_direccion": "Iparraguirre 169",
    "vendedor_ciudad": "Presidente Derqui CP 1635",
    "entrega_fecha": "23-Mar",
    "zip_code": "1417",
    "estado": "CABA",
    "barrio_zona": "MONTE CASTRO",
    "tipo_zona": "RESIDENCIAL",
    "calle": "Calle Sanabria 2555",
    "referencia": "2 A",
    "barrio": "Monte Castro",
    "destinatario": "Paz muñoz (FEDE.BRESCIA)",
    "tracking_number": "46708520282"
  }
]
"""

import sys
import json
import io
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT


# ── Medidas de página ──────────────────────────────────────────
W, H = A4   # 595 x 842 pts
M    = 15 * mm   # margen lateral

# ── Colores ────────────────────────────────────────────────────
NEGRO    = colors.black
BLANCO   = colors.white
GRIS_LN  = colors.HexColor('#cccccc')

def pt(x_mm): return x_mm * mm


def dibujar_envio(c, envio, num, total):
    """Dibuja una página completa para un envío Flex."""

    c.setPageSize(A4)

    # ── HEADER ────────────────────────────────────────────────
    header_h = pt(35)
    header_y = H - header_h

    # Borde del header
    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, header_y, W - 2*M, header_h)

    # Logo ML (círculo amarillo con manos)
    logo_x = M + pt(4)
    logo_y = header_y + pt(8)
    logo_r = pt(10)

    c.setFillColor(colors.HexColor('#FFE600'))
    c.circle(logo_x + logo_r, logo_y + logo_r, logo_r, fill=1, stroke=0)

    # Manos simplificadas (dos arcos)
    c.setStrokeColor(colors.HexColor('#3C4E9E'))
    c.setLineWidth(2)
    c.arc(logo_x + pt(3), logo_y + pt(5), logo_x + pt(17), logo_y + pt(15), 10, 160)
    c.arc(logo_x + pt(3), logo_y + pt(5), logo_x + pt(17), logo_y + pt(15), 190, 350)

    # Datos del vendedor
    txt_x = logo_x + logo_r * 2 + pt(4)
    txt_y = header_y + header_h - pt(7)

    c.setFillColor(NEGRO)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(txt_x, txt_y, envio.get('vendedor_nombre', ''))

    c.setFont('Helvetica', 8)
    c.drawString(txt_x, txt_y - pt(5), envio.get('vendedor_direccion', ''))
    c.drawString(txt_x, txt_y - pt(10), envio.get('vendedor_ciudad', ''))

    # Pack ID / Venta + Envio
    pack_id  = envio.get('pack_id')
    venta_id = envio.get('venta_id', '')
    envio_id = str(envio.get('envio_id', ''))

    label = 'Pack ID:' if pack_id else 'Venta:'
    id_val = str(pack_id if pack_id else venta_id)

    # Negrita en los últimos dígitos del ID y envio
    id_short  = id_val[-10:] if len(id_val) > 10 else id_val
    id_prefix = id_val[:-10] if len(id_val) > 10 else ''
    env_short = envio_id[-4:] if len(envio_id) > 4 else envio_id
    env_prefix= envio_id[:-4] if len(envio_id) > 4 else ''

    pack_y = txt_y - pt(15)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(txt_x, pack_y, label)
    offset = c.stringWidth(label, 'Helvetica-Bold', 8) + pt(1)

    c.setFont('Helvetica', 8)
    c.drawString(txt_x + offset, pack_y, ' ' + id_prefix)
    offset2 = offset + pt(1) + c.stringWidth(' ' + id_prefix, 'Helvetica', 8)

    c.setFont('Helvetica-Bold', 8)
    c.drawString(txt_x + offset2, pack_y, id_short)
    offset3 = offset2 + c.stringWidth(id_short, 'Helvetica-Bold', 8) + pt(4)

    c.setFont('Helvetica', 8)
    c.drawString(txt_x + offset3, pack_y, '  Envio: ' + env_prefix)
    offset4 = offset3 + c.stringWidth('  Envio: ' + env_prefix, 'Helvetica', 8)

    c.setFont('Helvetica-Bold', 8)
    c.drawString(txt_x + offset4, pack_y, env_short)

    current_y = header_y - pt(2)

    # ── BANDA "Envío Flex" ────────────────────────────────────
    banda_h = pt(14)
    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, current_y - banda_h, W - 2*M, banda_h)

    c.setFont('Helvetica-Bold', 18)
    c.setFillColor(NEGRO)
    texto_flex = 'Envío Flex'
    tw = c.stringWidth(texto_flex, 'Helvetica-Bold', 18)
    c.drawString(M + (W - 2*M - tw) / 2, current_y - banda_h + pt(3), texto_flex)

    current_y -= banda_h + pt(1)

    # ── BANDA "Entrega" ───────────────────────────────────────
    ent_h = pt(16)
    col_mid = (W - 2*M) / 2

    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, current_y - ent_h, W - 2*M, ent_h)
    c.line(M + col_mid, current_y, M + col_mid, current_y - ent_h)

    c.setFont('Helvetica', 15)
    txt = 'Entrega:'
    c.drawString(M + col_mid / 2 - c.stringWidth(txt, 'Helvetica', 15) / 2,
                 current_y - ent_h + pt(4), txt)

    fecha = envio.get('entrega_fecha', '')
    c.setFont('Helvetica-Bold', 22)
    fw = c.stringWidth(fecha, 'Helvetica-Bold', 22)
    c.drawString(M + col_mid + (col_mid - fw) / 2, current_y - ent_h + pt(2), fecha)

    current_y -= ent_h + pt(1)

    # ── BLOQUE QR + DIRECCIÓN ─────────────────────────────────
    qr_block_h = pt(58)

    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, current_y - qr_block_h, W - 2*M, qr_block_h)

    # QR a la izquierda
    tracking = str(envio.get('tracking_number', envio.get('envio_id', '')))
    qr_size  = pt(50)
    qr_x     = M + pt(5)
    qr_y     = current_y - qr_block_h + pt(4)

    try:
        qr_widget = QrCodeWidget(tracking)
        qr_bounds = qr_widget.getBounds()
        qr_w      = qr_bounds[2] - qr_bounds[0]
        qr_h_orig = qr_bounds[3] - qr_bounds[1]
        d = Drawing(qr_size, qr_size,
                    transform=[qr_size / qr_w, 0, 0, qr_size / qr_h_orig, 0, 0])
        d.add(qr_widget)
        renderPDF.draw(d, c, qr_x, qr_y)
    except Exception:
        c.setFont('Helvetica', 7)
        c.drawString(qr_x, qr_y + qr_size / 2, '[QR]')

    # Dirección a la derecha
    dir_x = M + pt(60)
    dir_y = current_y - pt(12)
    dir_w = W - M - dir_x - pt(2)

    cp     = envio.get('zip_code', '')
    estado = envio.get('estado', '')
    barrio_zona = envio.get('barrio_zona', '')

    c.setFont('Helvetica-Bold', 14)
    c.drawString(dir_x, dir_y, f'CP: {cp}')
    c.setFont('Helvetica-Bold', 14)
    c.drawString(dir_x, dir_y - pt(9), estado)
    c.setFont('Helvetica-Bold', 14)
    # Partir barrio_zona si es muy largo
    if c.stringWidth(barrio_zona, 'Helvetica-Bold', 14) > dir_w:
        words = barrio_zona.split()
        mid   = len(words) // 2
        line1 = ' '.join(words[:mid])
        line2 = ' '.join(words[mid:])
        c.drawString(dir_x, dir_y - pt(18), line1)
        c.drawString(dir_x, dir_y - pt(27), line2)
    else:
        c.drawString(dir_x, dir_y - pt(18), barrio_zona)

    current_y -= qr_block_h + pt(1)

    # ── BANDA TIPO DE ZONA ────────────────────────────────────
    zona_h = pt(14)
    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, current_y - zona_h, W - 2*M, zona_h)

    tipo_zona = envio.get('tipo_zona', 'RESIDENCIAL').upper()
    c.setFont('Helvetica-Bold', 16)
    tz_w = c.stringWidth(tipo_zona, 'Helvetica-Bold', 16)
    c.drawString(M + (W - 2*M - tz_w) / 2, current_y - zona_h + pt(3), tipo_zona)

    current_y -= zona_h + pt(1)

    # ── BLOQUE DIRECCIÓN DETALLE ──────────────────────────────
    det_h = pt(72)
    c.setStrokeColor(GRIS_LN)
    c.setLineWidth(0.5)
    c.rect(M, current_y - det_h, W - 2*M, det_h)

    campos = [
        ('Direccion', envio.get('calle', '')),
        ('Referencia', envio.get('referencia', '')),
        ('Barrio', envio.get('barrio', '')),
        ('Destinatario', envio.get('destinatario', '')),
    ]

    campo_y = current_y - pt(8)
    for label_c, valor in campos:
        if campo_y < current_y - det_h + pt(4):
            break

        # Label en negrita
        c.setFont('Helvetica-Bold', 10)
        c.setFillColor(NEGRO)
        lw = c.stringWidth(label_c + ': ', 'Helvetica-Bold', 10)
        c.drawString(M + pt(4), campo_y, label_c + ': ')

        # Valor normal — wrap si es largo
        c.setFont('Helvetica', 10)
        val_x = M + pt(4) + lw
        val_w = W - M - val_x - pt(4)
        val_str = str(valor) if valor else ''

        if c.stringWidth(val_str, 'Helvetica', 10) > val_w:
            # Partir en líneas
            words = val_str.split()
            lines = []
            cur_l = ''
            for w in words:
                test = (cur_l + ' ' + w).strip()
                if c.stringWidth(test, 'Helvetica', 10) <= val_w:
                    cur_l = test
                else:
                    if cur_l:
                        lines.append(cur_l)
                    cur_l = w
            if cur_l:
                lines.append(cur_l)

            c.drawString(val_x, campo_y, lines[0] if lines else val_str)
            for extra in lines[1:]:
                campo_y -= pt(5)
                c.drawString(M + pt(4), campo_y, extra)
        else:
            c.drawString(val_x, campo_y, val_str)

        campo_y -= pt(14)

    # ── NÚMERO DE PÁGINA ──────────────────────────────────────
    c.setFont('Helvetica', 7)
    c.setFillColor(colors.grey)
    c.drawRightString(W - M, pt(6), f'{num} / {total}')

    c.showPage()


def generar_pdf(envios, output_path):
    c = canvas.Canvas(str(output_path), pagesize=A4)
    total = len(envios)
    for i, envio in enumerate(envios, 1):
        dibujar_envio(c, envio, i, total)
    c.save()
    print(f"PDF generado: {output_path} ({total} páginas)")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Uso: python genera_flex_pdf.py datos.json output.pdf")
        sys.exit(1)

    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        datos = json.load(f)

    generar_pdf(datos, sys.argv[2])

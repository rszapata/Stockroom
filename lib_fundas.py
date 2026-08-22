"""
lib_fundas.py — qué cuenta como "funda", en un solo lugar (lado Python).

Hoy esta misma regla está escrita tres veces: acá, dentro de main() en
genera_orden_compra.py y en genera_cobro.py — más la versión JS de
lib/costos-fundas.js. Si se agrega una línea de producto y se actualiza una
sola, el cobro, el pedido y la rentabilidad empiezan a contar cosas distintas.

Este módulo es el destino al que hay que migrar las otras dos. Se creó acá para
no sumar una cuarta copia ad-hoc al generar la lista mayorista.
"""

# Si contiene alguna de estas, NO es funda (accesorios y protectores)
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

# Indican fuertemente que SÍ es funda
PATRONES_FUNDA = [
    'funda', 'case', 'carcasa',
    'magsafe', 'magnét', 'magnet',
    'con costura', 'silicona', 'silicone',
]


def es_funda(titulo):
    t = str(titulo or '').lower()
    if any(p in t for p in PATRONES_NO_FUNDA):
        return False
    if any(p in t for p in PATRONES_FUNDA):
        return True
    # Líneas típicas del catálogo
    if 's22' in t and 's23' in t:
        return True
    if 's25' in t and ('ultra' in t or 'premi' in t):
        return True
    return False

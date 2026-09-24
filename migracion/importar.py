#!/usr/bin/env python3
"""Migra el histórico de la planilla `cinniminies_gestion` (.xlsx) a Supabase.

Uso:
    python3 migracion/importar.py migracion/datos/cinniminies_gestion.xlsx            # prueba: muestra conciliación
    python3 migracion/importar.py migracion/datos/cinniminies_gestion.xlsx --aplicar  # carga en Supabase

Solo usa la biblioteca estándar. Para --aplicar lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
de `.env.local` (en la raíz del repo) o del entorno. Nunca commitees ese archivo.

Es idempotente: la función `importar_planilla` borra lo importado antes y lo vuelve a cargar,
todo en una transacción. Se niega a correr si ya hay datos cargados desde la app.

Reglas (sección 7, Etapa 1 del handoff):
- Hojas y columnas se buscan por nombre normalizado, nunca por posición.
- Precio cobrado, costo de producción y costo de caja se congelan tal como están en la planilla.
- Cajas sin detalle de sabores -> sabor "Sin detalle". "Box de 6 Oreo" -> un solo sabor.
- Filas sin formato y ventas de "Dueña 1" -> consumo propio. Fila 110 -> Box de 12 con 12 Canela.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xlsx import hoja, leer_libro, normalizar  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
ZONA = "-03:00"  # Uruguay no tiene horario de verano desde 2015
EPOCA = dt.datetime(1899, 12, 30)

# Nombres del catálogo (tienen que coincidir con supabase/migrations/*_catalogo_inicial.sql)
SABORES = {"canela": "Canela", "ddl": "Dulce de Leche", "dulcedeleche": "Dulce de Leche",
           "oreo": "Oreo", "nutella": "Nutella"}
SIN_DETALLE = "Sin detalle"
INSUMOS = {normalizar(n): n for n in [
    "Harina", "Levadura seca", "Azúcar", "Leche", "Huevos", "Manteca", "Canela",
    "Azúcar impalpable", "Dulce de leche", "Galletitas Oreo", "Nutella",
    "Caja Box de 6", "Caja Box de 12", "Papel manteca", "Stickers"]}
INSUMOS.update({"cajasboxde6": "Caja Box de 6", "cajasboxde12": "Caja Box de 12",
                "papelmantecahojas": "Papel manteca"})
UNIDAD_BASE = {"Leche": "ml", "Huevos": "un", "Galletitas Oreo": "paq", "Caja Box de 6": "un",
               "Caja Box de 12": "un", "Papel manteca": "un", "Stickers": "un"}  # el resto: g
PACKAGING = {"Caja Box de 6", "Caja Box de 12", "Papel manteca", "Stickers"}
CAJA_POR_PRECIO = {25: "Caja Box de 3", 30: "Caja Box de 6", 35: "Caja Box de 12"}
CAJA_DE_FORMATO = {4: "Caja Box de 6", 6: "Caja Box de 6", 10: "Caja Box de 12", 12: "Caja Box de 12"}
# Costo por roll al 22/09 (solo como peso para repartir el costo congelado entre sabores)
PESO_COSTO = {"Canela": 9.5096, "Dulce de Leche": 9.5458, "Oreo": 15.0061, "Nutella": 17.5427,
              SIN_DETALLE: 9.5096}

# Correcciones confirmadas con los dueños
ALIAS_CLIENTES = {"rominamuller": "Romina Salinas"}
CLIENTES_DESCARTADOS = {"hola"}
FILA_BOX12_CANELA = 110  # "Box de 12 Canela" con 2/2/2 cargado: se entregó 12 Canela

avisos = []


def aviso(hoja_nombre, fila, texto):
    avisos.append(f"{hoja_nombre} fila {fila}: {texto}")


# ---------------------------------------------------------------- utilidades

def fecha_y_hora(serial, fila):
    """Número de serie de Sheets -> (date ISO, timestamptz ISO). Sin hora: mediodía + fila (orden)."""
    momento = EPOCA + dt.timedelta(days=float(serial))
    if float(serial).is_integer():
        momento += dt.timedelta(hours=12, seconds=fila)
    return momento.date().isoformat(), momento.strftime("%Y-%m-%dT%H:%M:%S") + ZONA


def texto(v):
    if v is None:
        return None
    v = str(v).strip()
    return v or None


def numero(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def tabla(filas, requeridas, desde=0):
    """Encuentra la fila de encabezados que contiene todas las columnas `requeridas`.
    Devuelve (índice de esa fila, {encabezado_normalizado: columna})."""
    req = [normalizar(r) for r in requeridas]
    for i in range(desde, len(filas)):
        cols = {normalizar(v): j for j, v in enumerate(filas[i]) if texto(v)}
        if all(r in cols for r in req):
            return i, cols
    raise KeyError(f"No encuentro una tabla con columnas {requeridas}")


def celda(fila, cols, *nombres):
    for n in nombres:
        j = cols.get(normalizar(n))
        if j is not None and j < len(fila):
            return fila[j]
    return None


def nombre_cliente(nombre):
    n = normalizar(nombre)
    if n in CLIENTES_DESCARTADOS:
        return None
    return ALIAS_CLIENTES.get(n, " ".join(str(nombre).split()))


def limpiar_origen(origen):
    origen = texto(origen)
    if origen is None:
        return None
    return re.sub(r"\s*\(\s*", " (", origen)


# ---------------------------------------------------------------- VENTAS

def leer_ventas(libro):
    filas = hoja(libro, "ventas")
    enc, cols = tabla(filas, ["Fecha", "Cliente", "Box", "Precio Cobrado ($)"])
    columnas_sabor = {}
    for encabezado, j in cols.items():
        m = re.fullmatch(r"(.+)u", encabezado)
        if m and m.group(1) in SABORES:
            columnas_sabor[SABORES[m.group(1)]] = j
    hay_cobro_envio = normalizar("Cobro envío ($)") in cols

    ventas = []
    for i in range(enc + 1, len(filas)):
        fila, nro = filas[i], i + 1
        serial = celda(fila, cols, "Fecha")
        if not isinstance(serial, (int, float)):
            continue
        fecha, creado = fecha_y_hora(serial, nro)
        cliente = texto(celda(fila, cols, "Cliente"))
        origen = limpiar_origen(celda(fila, cols, "Origen"))
        box = texto(celda(fila, cols, "Box"))
        cant = int(numero(celda(fila, cols, "Cant. Box")) or 1)
        cobrado = numero(celda(fila, cols, "Precio Cobrado ($)", "Precio Cobrado")) or 0
        descuento = numero(celda(fila, cols, "Descuento")) or 0
        costo_prod = numero(celda(fila, cols, "Costo Prod. ($)", "Costo Prod.")) or 0
        costo_caja = numero(celda(fila, cols, "Costo Caja ($)", "Costo Caja")) or 0
        caja_usada = texto(celda(fila, cols, "Caja usada"))
        unidades = {s: int(numero(fila[j]) or 0) for s, j in columnas_sabor.items() if j < len(fila)}
        unidades = {s: u for s, u in unidades.items() if u > 0}

        envio_txt = normalizar(celda(fila, cols, "ENVIO"))
        entrega = {"envio": "envio", "pickup": "retiro", "retiro": "retiro"}.get(envio_txt, "sin_envio")
        if hay_cobro_envio:
            cobro_envio = numero(celda(fila, cols, "Cobro envío ($)")) or 0
        else:
            cobro_envio = 25 if entrega == "envio" else 0

        tipo = "venta"
        if normalizar(origen) == "duena1" or box is None:
            tipo = "consumo_propio"

        # Formato y sabores de la línea
        m = re.fullmatch(r"box de (\d+)\s*(.*)", (box or "").lower())
        if m:
            rolls_caja = int(m.group(1))
            formato = f"Box de {rolls_caja}"
            total_rolls = rolls_caja * cant
            sabor_unico = SABORES.get(normalizar(m.group(2))) if m.group(2) else None
            if m.group(2) and not sabor_unico:
                aviso("VENTAS", nro, f"no reconozco el sabor de {box!r}; va como {SIN_DETALLE}")
            if sabor_unico:
                if unidades and unidades != {sabor_unico: total_rolls}:
                    aviso("VENTAS", nro, f"{box} con unidades {unidades}: se toma {total_rolls} {sabor_unico} "
                                         "y se recalcula el costo (confirmado por los dueños)")
                    costo_prod = total_rolls * PESO_COSTO[sabor_unico]
                sabores = {sabor_unico: total_rolls}
            elif unidades and sum(unidades.values()) == total_rolls:
                sabores = unidades
            else:
                if unidades:
                    aviso("VENTAS", nro, f"{box} × {cant} con unidades {unidades} que no suman "
                                         f"{total_rolls}: va como {SIN_DETALLE}")
                sabores = {SIN_DETALLE: total_rolls}
            cajas = cant
        else:
            if box is not None and normalizar(box) != "personalizado":
                aviso("VENTAS", nro, f"formato desconocido {box!r}; va como Personalizado")
            formato = "Personalizado"
            sabores = unidades or {SIN_DETALLE: cant}
            rolls_caja = None
            cajas = 1

        # Caja usada (el costo de caja queda congelado igual)
        if caja_usada and normalizar(caja_usada) == "sincaja":
            caja = None
        elif caja_usada:
            caja = INSUMOS.get(normalizar("Caja " + caja_usada))
            if caja is None:
                aviso("VENTAS", nro, f"caja usada desconocida {caja_usada!r}")
        elif box is None:
            caja = None  # filas sin formato: confirmado "sin caja"
            if costo_caja:
                aviso("VENTAS", nro, f"sin formato: no llevó caja (confirmado), se corrige el costo de "
                                     f"caja de ${costo_caja:g} a $0")
                costo_caja = 0
        elif rolls_caja:
            caja = CAJA_DE_FORMATO.get(rolls_caja)
        else:
            caja = CAJA_POR_PRECIO.get(costo_caja)
            if costo_caja and caja is None:
                aviso("VENTAS", nro, f"personalizado con costo de caja ${costo_caja:g} que no corresponde "
                                     "a ninguna caja: se mantiene el costo, sin descontar stock de cajas")

        # Repartir el costo congelado entre los sabores, en proporción al costo por roll
        peso_total = sum(u * PESO_COSTO[s] for s, u in sabores.items())
        lista_sabores = [
            {"sabor": s, "unidades": u,
             "costo_unitario": round(costo_prod * PESO_COSTO[s] / peso_total, 6) if peso_total else 0}
            for s, u in sabores.items()
        ]

        ventas.append({
            "fila": nro, "fecha": fecha, "creado_en": creado,
            "cliente": nombre_cliente(cliente) if cliente else None,
            "origen": origen, "entrega": entrega, "cobro_envio": cobro_envio,
            "medio_pago": (normalizar(celda(fila, cols, "Tipo")) or None),
            "estado_pago": normalizar(celda(fila, cols, "Estado Pago")) or "pagado",
            "tipo": tipo, "precio_lista": cobrado + descuento, "precio_cobrado": cobrado,
            "notas": texto(celda(fila, cols, "Notas")),
            "lineas": [{"formato": formato, "cantidad": cajas, "caja": caja,
                        "precio_lista": cobrado + descuento, "costo_caja": costo_caja,
                        "sabores": lista_sabores}],
        })
    return ventas


# ---------------------------------------------------------------- CLIENTES

def leer_clientes(libro, ventas):
    filas = hoja(libro, "clientes")
    enc, cols = tabla(filas, ["Nombre / Apodo", "Teléfono / IG"])
    clientes = {}
    for i in range(enc + 1, len(filas)):
        fila, nro = filas[i], i + 1
        nombre = texto(celda(fila, cols, "Nombre / Apodo"))
        if not nombre:
            continue
        final = nombre_cliente(nombre)
        if final is None:
            aviso("CLIENTES", nro, f"descartado {nombre!r}")
            continue
        if normalizar(nombre) != normalizar(final):
            aviso("CLIENTES", nro, f"{nombre!r} pasa a llamarse {final!r}")
        clave = normalizar(final)
        notas = [texto(celda(fila, cols, "Notas / Preferencias"))]
        favorito = texto(celda(fila, cols, "Formato favorito"))
        if favorito:
            notas.append(f"Formato favorito: {favorito}")
        nuevo = {"ref": clave, "nombre": final, "fila": nro,
                 "contacto": texto(celda(fila, cols, "Teléfono / IG")),
                 "origen_libreta": limpiar_origen(celda(fila, cols, "Cómo llegó")),
                 "notas": "; ".join(n for n in notas if n) or None}
        if clave in clientes:
            previo = clientes[clave]
            aviso("CLIENTES", nro, f"{nombre!r} se fusiona con la fila {previo['fila']}")
            previo["contacto"] = previo["contacto"] or nuevo["contacto"]
            previo["notas"] = "; ".join(n for n in (previo["notas"], nuevo["notas"]) if n) or None
            if normalizar(nombre) == normalizar(final):  # la fila "correcta" manda
                previo["fila"], previo["origen_libreta"] = nro, nuevo["origen_libreta"]
        else:
            clientes[clave] = nuevo

    # Origen habitual = el más usado en sus ventas; si no tiene, el de la libreta
    origenes = defaultdict(Counter)
    for v in ventas:
        if v["cliente"]:
            origenes[normalizar(v["cliente"])][v["origen"]] += 1
    for v in ventas:
        if v["cliente"] and normalizar(v["cliente"]) not in clientes:
            clave = normalizar(v["cliente"])
            aviso("VENTAS", v["fila"], f"cliente {v['cliente']!r} no está en la libreta: se crea")
            clientes[clave] = {"ref": clave, "nombre": v["cliente"], "fila": v["fila"],
                               "contacto": None, "origen_libreta": None, "notas": None}
    for clave, c in clientes.items():
        c["origen"] = (origenes[clave].most_common(1)[0][0] if origenes[clave] else c["origen_libreta"])
        del c["origen_libreta"]
    for v in ventas:
        v["cliente_ref"] = normalizar(v.pop("cliente")) if v["cliente"] else None
    return list(clientes.values())


# ---------------------------------------------------------------- COMPRAS

def cantidad_base(cantidad, unidad, insumo):
    """('5kg', None) -> (5, 'kg', 5000). Devuelve cantidad_base None si no se puede saber."""
    base = UNIDAD_BASE.get(insumo, "g")
    if isinstance(cantidad, str):
        m = re.fullmatch(r"\s*([\d.,]+)\s*([a-zA-Z]*)\s*", cantidad)
        if not m:
            return None, cantidad, None
        cantidad, unidad = float(m.group(1).replace(",", ".")), (m.group(2) or unidad)
    if cantidad is None:
        return None, unidad, None
    u = normalizar(unidad)
    factores = {"g": ("g", 1), "gr": ("g", 1), "kg": ("g", 1000), "ml": ("ml", 1), "l": ("ml", 1000),
                "un": ("un", 1), "ud": ("un", 1), "paq": ("paq", 1)}
    if u in factores:
        dim, factor = factores[u]
        if dim != base:
            return cantidad, unidad, None
        return cantidad, unidad, cantidad * factor
    if not u and base == "un":
        return cantidad, "un", cantidad
    return cantidad, unidad, None


def leer_compras(libro):
    filas = hoja(libro, "compras")
    enc, cols = tabla(filas, ["Fecha", "Producto", "Cantidad"])
    compras = []
    for i in range(enc + 1, len(filas)):
        fila, nro = filas[i], i + 1
        serial = celda(fila, cols, "Fecha")
        if not isinstance(serial, (int, float)):
            continue
        fecha, creado = fecha_y_hora(serial, nro)
        producto = texto(celda(fila, cols, "Producto")) or ""
        total = numero(celda(fila, cols, "Total Gastado ($)", "Total")) or 0
        cant_txt = celda(fila, cols, "Cantidad")
        unidad = texto(celda(fila, cols, "Unidad"))
        base_planilla = numero(celda(fila, cols, "Cant. base"))
        base = dict(fecha=fecha, creado_en=creado, fila=nro, total=total, descripcion=producto,
                    proveedor=texto(celda(fila, cols, "Lugar / Proveedor", "Proveedor")),
                    notas=texto(celda(fila, cols, "Notas")))

        ingrediente = None
        for col in ("Ingrediente (final)", "Ingrediente"):
            v = texto(celda(fila, cols, col))
            if v and normalizar(v) in INSUMOS:
                ingrediente = INSUMOS[normalizar(v)]
                break
        p = normalizar(producto)
        if ingrediente is None:
            if "sticker" in p:
                ingrediente = "Stickers"
            elif "papelmanteca" in p:
                ingrediente = "Papel manteca"
            elif "caja" in p:
                compras.extend(separar_cajas(base, numero(cant_txt), total, nro))
                continue
            elif "balanza" in p:
                compras.append({**base, "insumo": None, "categoria": "equipamiento",
                                "cantidad": numero(cant_txt), "unidad": unidad, "cantidad_base": None})
                continue
            else:
                aviso("COMPRAS", nro, f"no sé qué insumo es {producto!r}: va como 'otro'")
                compras.append({**base, "insumo": None, "categoria": "otro",
                                "cantidad": numero(cant_txt), "unidad": unidad, "cantidad_base": None})
                continue

        cantidad, unidad, cbase = cantidad_base(cant_txt, unidad, ingrediente)
        if base_planilla:
            cbase = base_planilla
        if cbase is None:
            aviso("COMPRAS", nro, f"{producto!r} cantidad {cant_txt!r} sin unidad clara: queda sin "
                                  "cantidad base (no se usa para costos)")
        compras.append({**base, "insumo": ingrediente,
                        "categoria": "packaging" if ingrediente in PACKAGING else "ingrediente",
                        "cantidad": cantidad, "unidad": unidad, "cantidad_base": cbase})
    return compras


def separar_cajas(base, n, total, nro):
    """Cajas sin tamaño: $30 = de 6, $35 = de 12. Resuelve 30a + 35b = total con a + b = n."""
    if n and total:
        b = (total - 30 * n) / 5
        if b.is_integer() and 0 <= b <= n:
            b, a = int(b), int(n - b)
            partes = [(a, "Caja Box de 6", 30 * a), (b, "Caja Box de 12", 35 * b)]
            return [{**base, "insumo": caja, "categoria": "packaging", "cantidad": q, "unidad": "un",
                     "cantidad_base": q, "total": t,
                     "notas": "; ".join(x for x in (base["notas"], f"separado de {int(n)} cajas por "
                                                    "precio unitario" if a and b else None) if x) or None}
                    for q, caja, t in partes if q]
    aviso("COMPRAS", nro, f"{int(n or 0)} cajas por ${total:g} no se pueden separar en $30/$35: "
                          "tamaños combinados sin detalle (confirmado), quedan sin tamaño")
    return [{**base, "insumo": None, "categoria": "packaging", "cantidad": n, "unidad": "un",
             "cantidad_base": None,
             "notas": "; ".join(x for x in (base["notas"], "Cajas de tamaños combinados, sin detalle")
                                if x)}]


# ---------------------------------------------------------------- TANDAS

def leer_tandas(libro):
    filas = hoja(libro, "tandas")
    enc, cols = tabla(filas, ["Fecha", "Sabor", "Rolls"])
    columnas_insumo = {INSUMOS[k]: j for k, j in cols.items() if k in INSUMOS}
    tandas = []
    for i in range(enc + 1, len(filas)):
        fila, nro = filas[i], i + 1
        serial = celda(fila, cols, "Fecha")
        if not isinstance(serial, (int, float)):
            continue
        fecha, creado = fecha_y_hora(serial, nro)
        sabor = SABORES.get(normalizar(celda(fila, cols, "Sabor")))
        if sabor is None:
            aviso("TANDAS", nro, f"sabor desconocido {celda(fila, cols, 'Sabor')!r}: se omite")
            continue
        rolls = int(numero(celda(fila, cols, "Rolls")) or 12)
        consumos = [{"insumo": ins, "cantidad": numero(fila[j])}
                    for ins, j in columnas_insumo.items() if j < len(fila) and numero(fila[j])]
        tandas.append({"fila": nro, "fecha": fecha, "creado_en": creado, "sabor": sabor,
                       "cantidad": round(rolls / 12, 4), "rolls": rolls,
                       "notas": texto(celda(fila, cols, "Notas")), "consumos": consumos})
    return tandas


# ---------------------------------------------------------------- MERMAS -> gastos

def tipo_gasto(tipo, descripcion):
    t, d = normalizar(tipo), normalizar(descripcion)
    if t == "retirosocios" or any(x in d for x in ("cine", "hamburg", "gustito", "comida", "spiderman")):
        return "retiro_socios"
    if t == "tandadescartada":
        return "tanda_descartada"
    if t in ("comision", "transferencia"):
        return "comision"
    if t == "balance" or "acomododeplata" in d:
        return "ajuste_caja"
    if t == "extra" or d.startswith("bolsa"):
        return "gasto_operativo"
    if t == "merma":
        return "merma"
    if d.startswith("cobramosmenos"):
        return "otro"
    return None


def leer_gastos(libro):
    filas = hoja(libro, "mermas")
    enc, cols = tabla(filas, ["Fecha", "Descripción", "Tipo"])
    gastos, ultimo_serial = [], None
    for i in range(enc + 1, len(filas)):
        fila, nro = filas[i], i + 1
        descripcion = texto(celda(fila, cols, "Descripción"))
        monto = numero(celda(fila, cols, "Costo Estimado ($)", "Costo"))
        if not descripcion or not monto:
            continue
        serial = celda(fila, cols, "Fecha")
        if not isinstance(serial, (int, float)):
            if ultimo_serial is None:
                aviso("MERMAS", nro, f"{descripcion!r} sin fecha y sin fila anterior: se omite")
                continue
            serial = int(ultimo_serial)
            aviso("MERMAS", nro, f"{descripcion!r} sin fecha: se usa la de la fila anterior")
            sin_fecha = True
        else:
            sin_fecha = False
        ultimo_serial = serial
        fecha, creado = fecha_y_hora(serial, nro)
        tipo_txt = texto(celda(fila, cols, "Tipo"))
        tipo = tipo_gasto(tipo_txt, descripcion)
        if tipo is None:
            aviso("MERMAS", nro, f"tipo desconocido {tipo_txt!r} para {descripcion!r}: va como 'otro'")
            tipo = "otro"
        if normalizar(descripcion).startswith("cobramosmenos") and tipo != "otro":
            aviso("MERMAS", nro, f"{descripcion!r} tiene tipo {tipo_txt!r} en la planilla: se respeta ({tipo})")
        rolls = numero(celda(fila, cols, "Cant. Rolls"))
        gastos.append({"fila": nro, "fecha": fecha, "creado_en": creado, "descripcion": descripcion,
                       "tipo": tipo, "monto": monto, "rolls": int(rolls) if rolls else None,
                       "notas": "; ".join(x for x in (texto(celda(fila, cols, "Motivo")),
                                                       "Fecha incierta (sin fecha en la planilla)"
                                                       if sin_fecha else None) if x) or None})
    return gastos


# ---------------------------------------------------------------- STOCK -> conteos

def leer_conteos(libro, momento):
    filas = hoja(libro, "stock")
    fecha, creado = momento.date().isoformat(), momento.strftime("%Y-%m-%dT%H:%M:%S") + ZONA
    conteos = []
    enc, cols = tabla(filas, ["Ingrediente", "Stock real"])
    for i in range(enc + 1, len(filas)):
        nombre = texto(celda(filas[i], cols, "Ingrediente"))
        if not nombre:
            break
        insumo = INSUMOS.get(normalizar(nombre))
        cantidad = numero(celda(filas[i], cols, "Stock real"))
        if insumo is None or cantidad is None:
            aviso("STOCK", i + 1, f"se omite {nombre!r}")
            continue
        conteos.append({"fila": i + 1, "fecha": fecha, "creado_en": creado, "insumo": insumo,
                        "cantidad": cantidad})
    enc, cols = tabla(filas, ["Producto", "Compradas", "Usadas"], desde=enc)
    for i in range(enc + 1, len(filas)):
        nombre = texto(celda(filas[i], cols, "Producto"))
        if not nombre:
            break
        insumo = INSUMOS.get(normalizar(nombre))
        compradas = numero(celda(filas[i], cols, "Compradas"))
        usadas = numero(celda(filas[i], cols, "Usadas")) or 0
        if insumo is None or compradas is None:
            aviso("STOCK", i + 1, f"se omite {nombre!r}")
            continue
        conteos.append({"fila": i + 1, "fecha": fecha, "creado_en": creado, "insumo": insumo,
                        "cantidad": compradas - usadas})
    return conteos


# ---------------------------------------------------------------- principal

def conciliacion(datos):
    ventas = datos["ventas"]
    tandas = Counter(t["sabor"] for t in datos["tandas"])
    gastos = datos["gastos"]
    filas = [
        ("Ventas", len(ventas), "108"),
        ("Σ Precio cobrado", sum(v["precio_cobrado"] for v in ventas), "31130"),
        ("Σ Costo producción", sum(s["unidades"] * s["costo_unitario"] for v in ventas
                                   for l in v["lineas"] for s in l["sabores"]), "8145.16"),
        ("Σ Costo caja", sum(l["costo_caja"] for v in ventas for l in v["lineas"]), "3265"),
        ("Pendiente de cobro", sum(v["precio_cobrado"] + v["cobro_envio"] for v in ventas
                                   if v["estado_pago"] == "pendiente"), "900"),
        ("Ventas con envío", sum(v["entrega"] == "envio" for v in ventas), "30"),
        ("Σ Envíos", sum(v["cobro_envio"] for v in ventas), "750"),
        ("Compras", sum(c["total"] for c in datos["compras"]), "14578.87"),
        ("Gastos (MERMAS)", sum(g["monto"] for g in gastos), "3771.60"),
        ("  de los cuales retiros", sum(g["monto"] for g in gastos if g["tipo"] == "retiro_socios"), "2795"),
        ("Tandas", f"{len(datos['tandas'])} " + str(dict(tandas)), "23 (Canela 12, Oreo 8, DDL 3)"),
        ("Clientes", len(datos["clientes"]), "-"),
        ("Conteos de stock", len(datos["conteos"]), "-"),
    ]
    print(f"\n{'Control':26} {'Planilla -> import':>34}   Esperado")
    for nombre, valor, esperado in filas:
        valor = f"{valor:,.2f}" if isinstance(valor, float) else str(valor)
        print(f"{nombre:26} {valor:>34}   {esperado}")


def cargar_env():
    env = {}
    archivo = RAIZ / ".env.local"
    if archivo.exists():
        for linea in archivo.read_text().splitlines():
            if "=" in linea and not linea.lstrip().startswith("#"):
                k, v = linea.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return env


def aplicar(datos):
    env = cargar_env()
    url, clave = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not clave:
        sys.exit("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local")
    pedido = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/rpc/importar_planilla",
        data=json.dumps({"p": datos}).encode(),
        headers={"apikey": clave, "Authorization": f"Bearer {clave}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(pedido, timeout=120) as r:
            print("\nCargado en Supabase:", r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"\nError de Supabase ({e.code}): {e.read().decode()}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("xlsx", type=Path)
    ap.add_argument("--aplicar", action="store_true", help="cargar en Supabase (si no, solo prueba)")
    ap.add_argument("--fecha-conteo", help="momento del conteo de stock, AAAA-MM-DDTHH:MM "
                    "(por defecto, la fecha de modificación del .xlsx)")
    ap.add_argument("--json", type=Path, help="guardar el payload en este archivo (tiene datos de clientes)")
    args = ap.parse_args()

    libro = leer_libro(args.xlsx)
    momento = (dt.datetime.fromisoformat(args.fecha_conteo) if args.fecha_conteo
               else dt.datetime.fromtimestamp(args.xlsx.stat().st_mtime))
    ventas = leer_ventas(libro)
    datos = {
        "clientes": leer_clientes(libro, ventas),
        "ventas": ventas,
        "compras": leer_compras(libro),
        "tandas": leer_tandas(libro),
        "gastos": leer_gastos(libro),
        "conteos": leer_conteos(libro, momento),
    }

    print(f"Avisos ({len(avisos)}):")
    for a in avisos:
        print("  -", a)
    conciliacion(datos)

    if args.json:
        args.json.write_text(json.dumps(datos, ensure_ascii=False, indent=1))
        print(f"\nPayload guardado en {args.json}")
    if args.aplicar:
        aplicar(datos)
    else:
        print("\nPrueba: no se cargó nada. Usá --aplicar para cargar en Supabase.")


if __name__ == "__main__":
    main()

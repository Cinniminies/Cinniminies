"""Lector mínimo de .xlsx con la biblioteca estándar (sin openpyxl).

Devuelve los valores cacheados de cada celda (el resultado de las fórmulas,
tal como los guardó Google Sheets al exportar). Las fechas vienen como número
de serie (días desde el 30/12/1899); convertirlas es responsabilidad de quien
llama, porque el lector no sabe qué columnas son fechas.
"""

import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def normalizar(texto):
    """Minúsculas, sin acentos y sin espacios ni signos: ' VENTAS' -> 'ventas'."""
    if texto is None:
        return ""
    texto = unicodedata.normalize("NFKD", str(texto))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", texto.lower())


def _col_a_indice(ref):
    letras = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for c in letras:
        n = n * 26 + ord(c) - 64
    return n - 1


def leer_libro(ruta):
    """{nombre_de_hoja: [[valor, ...], ...]} con filas y columnas desde 0."""
    with zipfile.ZipFile(ruta) as z:
        compartidas = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                compartidas.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).findall("rel:Relationship", NS)
        }
        libro = ET.fromstring(z.read("xl/workbook.xml"))
        hojas = {}
        for hoja in libro.find("m:sheets", NS):
            destino = rels[hoja.get(f"{{{NS['r']}}}id")].lstrip("/")
            if not destino.startswith("xl/"):
                destino = "xl/" + destino
            hojas[hoja.get("name")] = _leer_hoja(z.read(destino), compartidas)
        return hojas


def _leer_hoja(xml, compartidas):
    filas = []
    for fila in ET.fromstring(xml).iter(f"{{{NS['m']}}}row"):
        nro = int(fila.get("r")) - 1
        while len(filas) <= nro:
            filas.append([])
        valores = filas[nro]
        for celda in fila.findall("m:c", NS):
            col = _col_a_indice(celda.get("r"))
            tipo = celda.get("t")
            v = celda.find("m:v", NS)
            if tipo == "inlineStr":
                valor = "".join(t.text or "" for t in celda.iter(f"{{{NS['m']}}}t"))
            elif v is None or v.text is None:
                valor = None
            elif tipo == "s":
                valor = compartidas[int(v.text)]
            elif tipo in ("str", "e"):
                valor = v.text
            elif tipo == "b":
                valor = v.text == "1"
            else:
                num = float(v.text)
                valor = int(num) if num.is_integer() else num
            while len(valores) <= col:
                valores.append(None)
            valores[col] = valor
    return filas


def hoja(libro, nombre):
    """Busca una hoja por nombre normalizado (' VENTAS' == 'ventas')."""
    buscado = normalizar(nombre)
    for n, filas in libro.items():
        if normalizar(n) == buscado:
            return filas
    raise KeyError(f"No encuentro la hoja {nombre!r}. Hay: {list(libro)}")

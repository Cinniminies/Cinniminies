/**
 * ARREGLOS DE LA PLANILLA — se corre UNA sola vez
 * ===============================================
 *
 * Cómo usarlo:
 *   1. Reemplazá Código.gs por la versión nueva (trae las fórmulas plantilla
 *      y el congelado de precios que este archivo usa).
 *   2. Agregá este archivo al mismo proyecto: "+" → Secuencia de comandos → "Arreglos".
 *   3. Arriba elegí la función aplicarArreglos y tocá Ejecutar.
 *
 * Antes de tocar nada guarda una copia completa de la planilla en tu Drive
 * ("... (respaldo antes de arreglos ...)"). Además queda el historial de
 * versiones de Sheets. Si se corre dos veces, la segunda no hace nada.
 *
 * Qué arregla (numerado como en el análisis):
 *   1. Precio y costos de cada venta quedan congelados (ya no cambian solos).
 *   2. K2/L2 de VENTAS: ahora suman Efectivo y Transferencia.
 *   3. Envío: columna "Cobro envío ($)" con 25 solo si hubo envío, y el panel lo suma.
 *   4. MERMAS: cine/comida/hamburguesas pasan a "Retiro socios" y salen del gasto.
 *   5. STOCK: "Usado" filtra por la fecha de control igual que "Comprado".
 *   6. Costo de ingredientes: precio y cantidad salen de la MISMA última compra.
 *   7. VENTAS: columna "Control" que marca cajas mal cargadas.
 *   8. Totales arriba y rangos hasta la fila 2000 (la app ya no pisa los totales).
 *   9. CLIENTES: fila "Hola" y la Romina duplicada; STOCK: cajas usadas automáticas.
 */

var FILAS_TOPE = 2000;   // hasta dónde miran ahora todas las sumas y búsquedas

function aplicarArreglos() {
  var props = PropertiesService.getDocumentProperties();
  var yaAplicado = props.getProperty('ARREGLOS_APLICADOS');
  if (yaAplicado) {
    throw new Error('Los arreglos ya se aplicaron el ' + yaAplicado + '. No hace falta correrlo de nuevo.');
  }
  if (typeof formulasVenta !== 'function') {
    throw new Error('Primero reemplazá Código.gs por la versión nueva (falta formulasVenta).');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ahora = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');

  var respaldo = ss.copy(ss.getName() + ' (respaldo antes de arreglos ' + ahora + ')');
  console.log('Respaldo guardado: ' + respaldo.getUrl());

  var h = {
    ventas:   hojaVentas(ss),
    inicio:   hojaObligatoria(ss, ['INICIO']),
    compras:  hojaObligatoria(ss, ['COMPRAS']),
    stock:    hojaObligatoria(ss, ['STOCK']),
    mermas:   hojaObligatoria(ss, ['MERMAS']),
    tandas:   hojaObligatoria(ss, ['TANDAS']),
    clientes: hojaObligatoria(ss, HOJA_CLIENTES)
  };

  crearPrecioEnvio(ss, h.inicio);
  var ventas  = arreglarVentas(h.ventas);
  var compras = arreglarCompras(h.compras);
  var mermas  = arreglarMermas(h.mermas);
  arreglarInicio(h, compras, mermas);
  arreglarStock(h, compras, ventas);
  arreglarClientes(h.clientes);

  SpreadsheetApp.flush();
  props.setProperty('ARREGLOS_APLICADOS', ahora);
  console.log('Listo.');
  ss.toast('Respaldo guardado en tu Drive.', 'Arreglos aplicados', 10);
}


/* ------------------------------------------------------------------ */
/* 3. Precio del envío en una sola celda (INICIO!B19)                  */
/* ------------------------------------------------------------------ */

function crearPrecioEnvio(ss, inicio) {
  if (ss.getRangeByName('PRECIO_ENVIO')) return;
  var celdas = inicio.getRange('A19:B19');
  if (celdas.getDisplayValues()[0].join('') !== '') {
    throw new Error('INICIO!A19:B19 no está vacío; no quiero pisar nada.');
  }
  inicio.getRange('A18:B18').copyTo(celdas, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  celdas.setValues([['Envío (lo paga el cliente)', 25]]);
  ss.setNamedRange('PRECIO_ENVIO', inicio.getRange('B19'));
}


/* ------------------------------------------------------------------ */
/* VENTAS: 1, 2, 3, 7, 8                                               */
/* ------------------------------------------------------------------ */

function arreglarVentas(hoja) {
  var est = estructura(hoja);
  var col = est.columnas;
  var enc = est.filaEncabezado;
  var primera = enc + 1;
  var ultima = proximaFilaLibre(hoja, est) - 1;   // última venta cargada
  var n = ultima - primera + 1;

  // 3. La columna sin título entre ENVIO y Precio Cobrado pasa a llamarse así.
  if (!col.cobroEnvio) {
    var cEnvio = col.precioCobrado - 1;
    if (texto(hoja.getRange(enc, cEnvio).getValue()) !== '') {
      throw new Error('Esperaba la columna del envío sin título justo antes de Precio Cobrado.');
    }
    hoja.getRange(enc, col.precioCobrado)
      .copyTo(hoja.getRange(enc, cEnvio), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    hoja.getRange(enc, cEnvio).setValue('Cobro envío ($)');
  }

  // 7. Columna "Control" al final.
  if (!col.control) {
    var cControl = est.ultimaColumna + 1;
    hoja.getRange(enc, est.ultimaColumna)
      .copyTo(hoja.getRange(enc, cControl), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    hoja.getRange(enc, cControl).setValue('Control');
  }

  est = estructura(hoja);
  col = est.columnas;
  if (!col.cobroEnvio || !col.control) throw new Error('Código.gs no reconoce "Cobro envío" o "Control": ¿lo reemplazaste por la versión nueva?');

  // 8. Los totales estaban abajo de todo (filas 212-213). La app escribe en la
  //    primera fila libre, así que al llegar ahí los iba a pisar.
  var filasTotales = [];
  var hasta = hoja.getLastRow();
  if (hasta > ultima) {
    var f = hoja.getRange(ultima + 1, col.precioCobrado, hasta - ultima, 1).getFormulas();
    for (var i = 0; i < f.length; i++) {
      if (/^=SUM/i.test(f[i][0])) filasTotales.push(ultima + 1 + i);
    }
  }
  var finPlantilla = filasTotales.length ? filasTotales[0] - 1 : hasta;

  var L = function (clave) { return letra(col[clave]); };
  var rango = function (clave) {
    return L(clave) + primera + ':' + L(clave) + FILAS_TOPE;
  };

  // Fila 3: totales por columna. Fila 2: resumen. Fila 1: títulos del resumen.
  var libres = hoja.getRange(3, col.cobroEnvio, 1, col.control - col.cobroEnvio + 1).getDisplayValues()[0].join('') +
               hoja.getRange(1, col.precioCobrado, 1, 5).getDisplayValues()[0].join('');
  if (libres !== '') throw new Error('VENTAS: las filas 1 y 3 no están vacías donde van los totales.');

  if (filasTotales.length) {
    hoja.getRange(filasTotales[0], col.cobroEnvio, 1, col.control - col.cobroEnvio + 1)
      .copyTo(hoja.getRange(3, col.cobroEnvio), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  hoja.getRange(3, col.envio).setValue('TOTALES');
  hoja.getRange(3, col.cobroEnvio).setFormula('=SUMIF(' + rango('envio') + ',"Envio",' + rango('cobroEnvio') + ')');
  ['precioCobrado', 'costoProd', 'costoCaja', 'ganancia', 'canela', 'ddl', 'oreo', 'descuento'].forEach(function (k) {
    if (col[k]) hoja.getRange(3, col[k]).setFormula('=SUM(' + rango(k) + ')');
  });

  var envioSi = function (cond, rangoCond) {
    return 'SUMIFS(' + rango('cobroEnvio') + ',' + rangoCond + ',"' + cond + '",' + rango('envio') + ',"Envio")';
  };
  hoja.getRange(1, col.precioCobrado, 1, 5).setValues([[
    'Cobrado (pagado)', 'Efectivo', 'Transferencia', 'Nº ventas', 'Ganancia pendiente'
  ]]).setFontSize(9).setFontColor('#8a7364');
  hoja.getRange(2, col.precioCobrado, 1, 5).setFormulas([[
    // 2. Antes K2/L2 buscaban "Venta"/"Muestra" en la columna de pago y daban 0.
    '=SUMIF(' + rango('estadoPago') + ',"Pagado",' + rango('precioCobrado') + ')+' + envioSi('Pagado', rango('estadoPago')),
    '=SUMIF(' + rango('tipo') + ',"Efectivo",' + rango('precioCobrado') + ')+' + envioSi('Efectivo', rango('tipo')),
    '=SUMIF(' + rango('tipo') + ',"Transferencia",' + rango('precioCobrado') + ')+' + envioSi('Transferencia', rango('tipo')),
    '=COUNTA(' + rango('fecha') + ')',
    '=SUMIF(' + rango('estadoPago') + ',"Pendiente",' + rango('ganancia') + ')'
  ]]);

  for (var t = 0; t < filasTotales.length; t++) {
    hoja.getRange(filasTotales[t], 1, 1, col.control).clear();
  }

  if (n > 0) {
    // 3. Cobro de envío: 25 solo donde hubo envío (antes decía 25 en todas).
    var envios = hoja.getRange(primera, col.envio, n, 1).getValues();
    var cobro = hoja.getRange(primera, col.cobroEnvio, n, 1).getValues();
    hoja.getRange(primera, col.cobroEnvio, n, 1).setValues(envios.map(function (e, i) {
      if (norm(e[0]) !== 'envio') return [0];
      return [typeof cobro[i][0] === 'number' && cobro[i][0] > 0 ? cobro[i][0] : 25];
    }));

    // 1. Congelar precio, costos y descuento de las ventas ya cargadas.
    congelarFilas(hoja, col, primera, n);

    // 7. Control en todas las filas cargadas.
    var controles = [];
    for (var r = primera; r <= ultima; r++) controles.push([formulasVenta(col, r).control]);
    hoja.getRange(primera, col.control, n, 1).setFormulas(controles);
  }

  // Filas de abajo que ya venían con fórmulas: quedan con las fórmulas nuevas,
  // así una venta cargada a mano en la planilla también calcula bien.
  if (finPlantilla > ultima) {
    var claves = ['cobroEnvio', 'precioCobrado', 'costoProd', 'costoCaja', 'descuento', 'control'];
    claves.forEach(function (k) {
      var filas = [];
      for (var r = ultima + 1; r <= finPlantilla; r++) filas.push([formulasVenta(col, r)[k]]);
      hoja.getRange(ultima + 1, col[k], filas.length, 1).setFormulas(filas);
    });
  }

  return { col: col, ultima: ultima };
}


/* ------------------------------------------------------------------ */
/* COMPRAS: 6, 8                                                        */
/* ------------------------------------------------------------------ */

function arreglarCompras(hoja) {
  var enc = filaConEncabezado(hoja, 'fecha', 'ingredientefinal');
  var c = columnasPorNombre(hoja, enc, {
    fecha: 'fecha', ingrediente: 'ingrediente', cantBase: 'cantbase',
    total: 'totalgastado', final: 'ingredientefinal', unidad: 'unidad'
  });
  var primera = enc + 1;

  // 8. Sacar la fila "TOTAL INVERTIDO" de abajo: el total ya está arriba (I2).
  var colA = hoja.getRange(primera, 1, hoja.getLastRow() - enc, 1).getDisplayValues();
  for (var i = 0; i < colA.length; i++) {
    if (norm(colA[i][0]).indexOf('totalinvertido') === 0) {
      hoja.getRange(primera + i, 1, 1, c.final).clear();
    }
  }
  hoja.getRange(2, c.total).setFormula('=SUM(' + letra(c.total) + primera + ':' + letra(c.total) + FILAS_TOPE + ')');

  var fin = Math.min(hoja.getMaxRows(), FILAS_TOPE);
  var alto = fin - primera;

  // Nutella no estaba en la lista de palabras clave y quedaba como "(otro)".
  var fk = hoja.getRange(primera, c.final).getFormula();
  if (fk && fk.indexOf('Nutella') === -1) {
    fk = fk.replace('TRUE(),', 'ISNUMBER(SEARCH("Nutella",' + letra(3) + primera + ')),"Nutella",TRUE(),');
    hoja.getRange(primera, c.final).setFormula(fk);
  }

  // Extender fórmulas y desplegables hasta el final de la hoja.
  if (alto > 0) {
    [c.cantBase, c.final].forEach(function (k) {
      hoja.getRange(primera, k).copyTo(hoja.getRange(primera + 1, k, alto, 1),
        SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    });
    [c.ingrediente, c.unidad].forEach(function (k) {
      var dv = hoja.getRange(primera, k).getDataValidation();
      if (dv) hoja.getRange(primera, k, alto + 1, 1).setDataValidation(dv);
    });
  }

  // 6. Columna auxiliar: número de fila si la compra tiene cantidad base.
  //    INICIO busca con ella la última compra "completa" de cada ingrediente,
  //    y saca de esa MISMA fila el precio y la cantidad.
  var cAux = c.final + 1;
  if (texto(hoja.getRange(enc, cAux).getValue()) === '') {
    hoja.getRange(enc, cAux).setValue('Aux (no tocar)');
    var aux = [];
    for (var r = primera; r <= fin; r++) aux.push(['=IF(ISNUMBER(' + letra(c.cantBase) + r + '),ROW(),0)']);
    hoja.getRange(primera, cAux, aux.length, 1).setFormulas(aux).setFontColor('#b7a89c');
  }

  c.aux = cAux;
  c.primera = primera;
  c.hoja = "'" + hoja.getName().replace(/'/g, "''") + "'";
  return c;
}


/* ------------------------------------------------------------------ */
/* MERMAS: 4, 8                                                         */
/* ------------------------------------------------------------------ */

function arreglarMermas(hoja) {
  var enc = filaConEncabezado(hoja, 'fecha', 'descripcion');
  var c = columnasPorNombre(hoja, enc, { tipo: 'tipo', costo: 'costoestimado', desc: 'descripcion' });
  var primera = enc + 1;
  var ultimaFila = Math.max(hoja.getLastRow(), primera);
  var datos = hoja.getRange(primera, 1, ultimaFila - primera + 1, c.costo).getDisplayValues();

  var PERSONALES = ['gustito', 'cine', 'comida'];
  for (var i = 0; i < datos.length; i++) {
    var fila = primera + i;
    // 8. Total de abajo (fila 56): se sube a la fila de arriba del encabezado.
    if (norm(datos[i][0]).indexOf('total') === 0) {
      hoja.getRange(fila, c.desc, 1, c.costo - c.desc + 1)
        .copyTo(hoja.getRange(enc - 1, c.desc), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      hoja.getRange(fila, 1, 1, c.costo + 1).clear();
      continue;
    }
    // 4. Gastos personales de ustedes dos: no son mermas, son retiros.
    if (PERSONALES.indexOf(norm(datos[i][c.tipo - 1])) !== -1) {
      hoja.getRange(fila, c.tipo).setValue('Retiro socios');
    }
  }

  var rangoCosto = letra(c.costo) + primera + ':' + letra(c.costo) + FILAS_TOPE;
  var rangoTipo  = letra(c.tipo) + primera + ':' + letra(c.tipo) + FILAS_TOPE;
  hoja.getRange(enc - 1, c.costo - 1, 1, 2).setValues([['TOTAL (sin retiros)', '']]);
  hoja.getRange(enc - 1, c.costo).setFormula('=SUMIFS(' + rangoCosto + ',' + rangoTipo + ',"<>Retiro socios")');

  var lista = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Retiro socios', 'Tanda descartada', 'Merma', 'Comisión', 'Gasto operativo', 'EXTRA', 'Balance'], true)
    .setAllowInvalid(true)
    .setHelpText('"Retiro socios" = plata que sacan ustedes. No cuenta como gasto del negocio.')
    .build();
  hoja.getRange(primera, c.tipo, Math.min(hoja.getMaxRows(), FILAS_TOPE) - primera + 1, 1).setDataValidation(lista);

  return {
    hoja: "'" + hoja.getName().replace(/'/g, "''") + "'",
    costo: rangoCosto, tipo: rangoTipo
  };
}


/* ------------------------------------------------------------------ */
/* INICIO: panel (3, 4, 8) y costo de ingredientes (6)                 */
/* ------------------------------------------------------------------ */

function arreglarInicio(h, compras, mermas) {
  var hoja = h.inicio;
  var V = "'" + h.ventas.getName().replace(/'/g, "''") + "'";
  var T = "'" + h.tandas.getName().replace(/'/g, "''") + "'";
  var est = estructura(h.ventas);
  var col = est.columnas;
  var p = est.filaEncabezado + 1;

  var esperados = ['totalvendido', 'totalgastado', 'ganancianeta', 'ventastotales', 'pendienteacobrar',
                   'tandashechas', 'stockingredientes', 'stockpackaging', 'cajateoria', 'capital'];
  var titulos = hoja.getRange('A5:J5').getDisplayValues()[0].map(norm);
  for (var i = 0; i < esperados.length; i++) {
    if (titulos[i].indexOf(esperados[i]) !== 0) throw new Error('INICIO fila 5 no tiene los títulos esperados (' + titulos[i] + ').');
  }
  if (hoja.getRange('K5:K6').getDisplayValues().join('') !== '') throw new Error('INICIO!K5:K6 no está vacío.');

  hoja.getRange('J5:J6').copyTo(hoja.getRange('K5:K6'), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  hoja.getRange('K5').setValue('Retiros socios');

  var M = mermas.hoja;
  hoja.getRange('A6').setFormula('=' + V + '!' + letra(col.precioCobrado) + '3+' + V + '!' + letra(col.cobroEnvio) + '3');
  hoja.getRange('B6').setFormula('=' + compras.hoja + '!' + letra(compras.total) + '2+SUMIFS(' +
    M + '!' + mermas.costo + ',' + M + '!' + mermas.tipo + ',"<>Retiro socios")');
  hoja.getRange('D6').setFormula('=COUNTA(' + V + '!' + letra(col.fecha) + p + ':' + letra(col.fecha) + FILAS_TOPE + ')');
  hoja.getRange('E6').setFormula('=A6-' + V + '!' + letra(col.precioCobrado) + '2');
  hoja.getRange('F6').setFormula('=COUNTA(' + T + '!B3:B' + FILAS_TOPE + ')');
  hoja.getRange('K6').setFormula('=SUMIF(' + M + '!' + mermas.tipo + ',"Retiro socios",' + M + '!' + mermas.costo + ')');
  hoja.getRange('I6').setFormula('=A6-B6-E6-K6');

  // 6. Precio y cantidad de la misma compra: la última que tenga cantidad base.
  var CO = compras.hoja;
  var bloques = [
    { nombre: 'A', precio: 'C', cant: 'D', desde: 22, hasta: 29 },   // Canela
    { nombre: 'H', precio: 'J', cant: 'K', desde: 22, hasta: 30 },   // Oreo
    { nombre: 'A', precio: 'C', cant: 'D', desde: 35, hasta: 41 },   // DDL
    { nombre: 'A', precio: 'C', cant: 'D', desde: 46, hasta: 52 }    // Nutella
  ];
  bloques.forEach(function (b) {
    for (var r = b.desde; r <= b.hasta; r++) {
      var nombre = texto(hoja.getRange(b.nombre + r).getValue());
      if (!nombre) continue;
      var viejoP = hoja.getRange(b.precio + r).getValue();
      var viejoC = hoja.getRange(b.cant + r).getValue();
      if (typeof viejoC !== 'number') continue;   // no es una fila de ingrediente
      var fila = 'ROUND(1/(1/MAXIFS(' +
        CO + '!$' + letra(compras.aux) + '$' + compras.primera + ':$' + letra(compras.aux) + '$' + FILAS_TOPE + ',' +
        CO + '!$' + letra(compras.final) + '$' + compras.primera + ':$' + letra(compras.final) + '$' + FILAS_TOPE +
        ',$' + b.nombre + r + ')),0)';
      var respaldoP = typeof viejoP === 'number' ? viejoP : '""';
      hoja.getRange(b.precio + r).setFormula('=IFERROR(INDEX(' + CO + '!$' + letra(compras.total) + '$1:$' +
        letra(compras.total) + '$' + FILAS_TOPE + ',' + fila + '),' + respaldoP + ')');
      hoja.getRange(b.cant + r).setFormula('=IFERROR(INDEX(' + CO + '!$' + letra(compras.cantBase) + '$1:$' +
        letra(compras.cantBase) + '$' + FILAS_TOPE + ',' + fila + '),' + viejoC + ')');
    }
  });
}


/* ------------------------------------------------------------------ */
/* STOCK: 5 y cajas usadas (9)                                          */
/* ------------------------------------------------------------------ */

function arreglarStock(h, compras, ventas) {
  var hoja = h.stock;
  var CO = compras.hoja;
  var T = "'" + h.tandas.getName().replace(/'/g, "''") + "'";

  var enc = filaConEncabezado(hoja, 'ingrediente', 'comprado');
  var c = columnasPorNombre(hoja, enc, { comprado: 'comprado', usado: 'usado' });
  var rCO = function (col) {
    return CO + '!$' + letra(col) + '$' + compras.primera + ':$' + letra(col) + '$' + FILAS_TOPE;
  };

  var r = enc + 1;
  var comprado = [], usado = [];
  while (texto(hoja.getRange(r, 1).getValue()) !== '') {
    comprado.push(['=IFERROR(SUMIFS(' + rCO(compras.cantBase) + ',' + rCO(compras.final) + ',$A' + r + ',' +
      rCO(compras.fecha) + ',">="&$J$3),0)']);
    // 5. Antes sumaba TODAS las tandas; ahora solo desde la fecha de control.
    usado.push(['=IFERROR(SUMIFS(INDEX(' + T + '!$D$3:$M$' + FILAS_TOPE + ',0,MATCH($A' + r + ',' + T + '!$D$2:$M$2,0)),' +
      T + '!$A$3:$A$' + FILAS_TOPE + ',">="&$J$3),0)']);
    r++;
  }
  hoja.getRange(enc + 1, c.comprado, comprado.length, 1).setFormulas(comprado);
  hoja.getRange(enc + 1, c.usado, usado.length, 1).setFormulas(usado);

  // 9. Cajas usadas: lo contado a mano hasta hoy + las cajas de las ventas nuevas.
  //    (Recalcularlas desde cero no cierra: VENTAS dice 80 cajas de 6 y se compraron 71.)
  var V = "'" + h.ventas.getName().replace(/'/g, "''") + "'";
  var col = ventas.col;
  var rv = function (k) { return V + '!$' + letra(col[k]) + '$5:$' + letra(col[k]) + '$' + FILAS_TOPE; };
  var suelto = '((' + rv('box') + '="Personalizado")+(' + rv('box') + '="Unidad"))';
  var cajas = function (tam) {
    return 'SUMPRODUCT((ROW(' + rv('fecha') + ')>' + ventas.ultima + ')*(' + rv('fecha') + '<>"")*(' +
      '(' + rv('cajaUsada') + '="Box de ' + tam + '")*(' + rv('cantBox') + '-' + suelto + '*(' + rv('cantBox') + '-1))+' +
      '(' + rv('cajaUsada') + '="")*ISNUMBER(SEARCH("de ' + tam + '",' + rv('box') + '))*' + rv('cantBox') + '))';
  };

  var filas = hoja.getRange(1, 1, hoja.getLastRow(), 1).getDisplayValues();
  var encCajas = filaConEncabezado(hoja, 'producto', 'compradas');
  var cc = columnasPorNombre(hoja, encCajas, { usadas: 'usadas', notas: 'notas' });
  for (var i = encCajas; i < filas.length; i++) {
    var nombre = norm(filas[i][0]);
    var tam = nombre === 'cajasboxde6' ? 6 : nombre === 'cajasboxde12' ? 12 : 0;
    if (!tam) continue;
    var celda = hoja.getRange(i + 1, cc.usadas);
    if (celda.getFormula()) continue;
    var base = Number(celda.getValue()) || 0;
    celda.setFormula('=' + base + '+' + cajas(tam));
    hoja.getRange(i + 1, cc.notas).setValue(base + ' contadas a mano + las de ventas nuevas (desde la fila ' + (ventas.ultima + 1) + ' de VENTAS)');
  }
}


/* ------------------------------------------------------------------ */
/* CLIENTES: 9                                                          */
/* ------------------------------------------------------------------ */

function arreglarClientes(hoja) {
  var datos = hoja.getRange(1, 1, hoja.getLastRow(), 5).getValues();
  for (var i = datos.length - 1; i >= 0; i--) {
    var nombre = texto(datos[i][0]);
    // Fila de prueba sin compras.
    if (nombre === 'Hola' && !Number(datos[i][4])) { hoja.deleteRow(i + 1); continue; }
    // Era Romina Salinas (ITSP, venta del 20/05): quedó cargada como "Romina Müller / Salinas".
    if (nombre === 'Romina Müller' && texto(datos[i][1]) === 'Salinas') {
      hoja.getRange(i + 1, 1, 1, 2).setValues([['Romina Salinas', 'ITSP']]);
    }
  }
}


/* ------------------------------------------------------------------ */
/* Utilidades de este archivo                                          */
/* ------------------------------------------------------------------ */

function hojaObligatoria(ss, nombres) {
  var hoja = hojaPorNombre(ss, nombres);
  if (!hoja) throw new Error('No encontré la hoja ' + nombres[0] + '. Pestañas: ' + nombresDeHojas(ss));
  return hoja;
}

/** Primera fila (de las 20 de arriba) que tenga los dos títulos. */
function filaConEncabezado(hoja, a, b) {
  var filas = Math.min(40, hoja.getMaxRows());
  var celdas = hoja.getRange(1, 1, filas, Math.min(30, hoja.getMaxColumns())).getDisplayValues();
  for (var f = 0; f < filas; f++) {
    var fila = celdas[f].map(norm);
    if (fila.indexOf(a) !== -1 && fila.some(function (x) { return x.indexOf(b) === 0; })) return f + 1;
  }
  throw new Error('No encontré los títulos "' + a + '" y "' + b + '" en ' + hoja.getName());
}

/** Mapea claves a columnas por el comienzo del título (sin acentos ni espacios). */
function columnasPorNombre(hoja, fila, buscados) {
  var titulos = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getDisplayValues()[0].map(norm);
  var salida = {};
  for (var k in buscados) {
    for (var c = 0; c < titulos.length; c++) {
      if (titulos[c] === buscados[k] || (titulos[c].indexOf(buscados[k]) === 0 && !salida[k])) {
        salida[k] = c + 1;
        if (titulos[c] === buscados[k]) break;
      }
    }
    if (!salida[k]) throw new Error('No encontré la columna "' + buscados[k] + '" en ' + hoja.getName());
  }
  return salida;
}

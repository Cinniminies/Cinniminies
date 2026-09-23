/**
 * CINNAMON ROLLS — Carga de ventas desde el celular
 * =================================================
 * Web App que escribe en la primera fila libre de la hoja VENTAS.
 *
 * No hardcodea columnas: busca la fila de encabezados y mapea por nombre,
 * asi que si moves o agregas columnas el formulario se adapta solo.
 *
 * Las columnas calculadas (Cobro envío, Precio Cobrado, Costo Prod., Costo Caja,
 * Descuento) se escriben con la fórmula plantilla y, una vez calculadas,
 * se CONGELAN como valor: así una venta vieja no cambia de precio ni de costo
 * cuando después cambia la lista de precios o sube un ingrediente.
 * Ganancia y Control siguen siendo fórmula (dependen solo de la misma fila).
 */

/**
 * Ojo: varias pestañas de esta planilla tienen un espacio adelante
 * (" VENTAS", " CLIENTES", " INICIO"…). No hace falta renombrarlas:
 * los nombres se comparan con norm(), que ignora espacios y acentos.
 * Por eso cada hoja se busca por una lista de nombres posibles.
 */
var HOJA_VENTAS   = ['VENTAS', 'REGISTRO DE VENTAS'];
var HOJA_CLIENTES = ['CLIENTES', 'LIBRETA DE CLIENTES', 'LIBRETA'];
var TITULO_APP    = 'Cargar venta';

/** Rango con nombre que define la tabla de formatos (Formato / Precio / Costos). */
var RANGO_FORMATOS = 'FORMATOS';

/**
 * ENVIO: lista fija de tres opciones, no se lee del historial.
 * El guion medio es el "sin envio" que ya venias usando en la planilla.
 * "Retiro" queda fuera de aca en adelante; las ventas viejas lo conservan.
 */
var OPCIONES_ENVIO = ['Envio', '-', 'Pick up'];

/** Columnas que carga la persona. El resto se hereda con sus formulas. */
var COLUMNAS_MANUALES = [
  'fecha', 'cliente', 'origen', 'box', 'cantBox', 'tipo', 'estadoPago',
  'envio', 'notas', 'canela', 'ddl', 'oreo', 'cajaUsada', 'precioFinal'
];

/** Columnas calculadas que se congelan como valor despues de guardar. */
var COLUMNAS_CONGELADAS = ['cobroEnvio', 'precioCobrado', 'costoProd', 'costoCaja', 'descuento'];

/** Como se reconoce cada encabezado. El orden importa (cantBox antes que box). */
var CLAVES_ENCABEZADO = [
  ['fecha',         function (h) { return h === 'fecha'; }],
  ['cliente',       function (h) { return h === 'cliente'; }],
  ['origen',        function (h) { return h === 'origen'; }],
  ['cantBox',       function (h) { return h.indexOf('cantbox') === 0; }],
  ['box',           function (h) { return h === 'box'; }],
  ['tipo',          function (h) { return h === 'tipo'; }],
  ['estadoPago',    function (h) { return h.indexOf('estadopago') === 0; }],
  ['envio',         function (h) { return h === 'envio'; }],
  ['cobroEnvio',    function (h) { return h.indexOf('cobroenvio') === 0; }],
  ['precioCobrado', function (h) { return h.indexOf('preciocobrado') === 0; }],
  ['costoProd',     function (h) { return h.indexOf('costoprod') === 0; }],
  ['costoCaja',     function (h) { return h.indexOf('costocaja') === 0; }],
  ['ganancia',      function (h) { return h.indexOf('ganancia') === 0; }],
  ['notas',         function (h) { return h === 'notas'; }],
  ['canela',        function (h) { return h.indexOf('canela') === 0; }],
  ['ddl',           function (h) { return h.indexOf('ddl') === 0; }],
  ['oreo',          function (h) { return h.indexOf('oreo') === 0; }],
  ['cajaUsada',     function (h) { return h.indexOf('cajausada') === 0; }],
  ['precioFinal',   function (h) { return h.indexOf('preciofinal') === 0; }],
  ['descuento',     function (h) { return h.indexOf('descuento') === 0; }],
  ['control',       function (h) { return h === 'control'; }]
];


/* ------------------------------------------------------------------ */
/* Entrada de la Web App                                               */
/* ------------------------------------------------------------------ */

/**
 * Ojo con addMetaTag: Apps Script solo acepta cuatro etiquetas
 * (viewport, mobile-web-app-capable, apple-mobile-web-app-capable y
 * google-site-verification). Cualquier otra —theme-color, por ejemplo—
 * tira "La metaetiqueta que especificaste no se admite en este contexto".
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Formulario')
    .setTitle(TITULO_APP)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/** Menu en la planilla para abrir el formulario y copiar el link del celu. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧁 Ventas')
    .addItem('Cargar venta', 'abrirFormulario')
    .addItem('Link para el celular', 'mostrarLink')
    .addSeparator()
    .addItem('Congelar precios de ventas cargadas a mano', 'congelarVentasManuales')
    .addToUi();
}

function abrirFormulario() {
  var html = HtmlService.createHtmlOutputFromFile('Formulario')
    .setWidth(460)
    .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, TITULO_APP);
}

function mostrarLink() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('Todavia no implementaste la app. Andá a Implementar → Nueva implementación → Aplicación web.');
    return;
  }
  ui.alert('Link para el celular',
    url + '\n\nAbrilo en el celu y agregalo a la pantalla de inicio.',
    ui.ButtonSet.OK);
}


/* ------------------------------------------------------------------ */
/* Configuracion que consume el formulario                             */
/* ------------------------------------------------------------------ */

function getConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = hojaVentas(ss);

  var est = estructura(hoja);
  var col = est.columnas;
  var proxima = proximaFilaLibre(hoja, est);

  var datos = leerHistorial(hoja, est, proxima);

  return {
    hoja: hoja.getName(),
    proximaFila: proxima,
    hoy: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    opciones: {
      // Origen es campo libre: se sugiere la union de la validacion y lo ya usado.
      origen:     limpiar(opciones(hoja, col.origen, est, proxima, []).concat(datos.valores.origen)),
      box:        opciones(hoja, col.box,        est, proxima, datos.valores.box),
      tipo:       opciones(hoja, col.tipo,       est, proxima, datos.valores.tipo),
      estadoPago: opciones(hoja, col.estadoPago, est, proxima, datos.valores.estadoPago),
      envio:      OPCIONES_ENVIO,
      cajaUsada:  opciones(hoja, col.cajaUsada,  est, proxima, datos.valores.cajaUsada)
    },
    clientes: clientes(ss, datos.origenPorCliente),
    formatos: tablaFormatos(ss),
    ultimas: datos.ultimas
  };
}


/* ------------------------------------------------------------------ */
/* Guardar una venta                                                   */
/* ------------------------------------------------------------------ */

function guardarVenta(datos) {
  validarSabores(datos);

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(25000)) throw new Error('La planilla está ocupada, probá de nuevo en unos segundos.');

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = hojaVentas(ss);
    var est = estructura(hoja);
    var col = est.columnas;
    var fila = proximaFilaLibre(hoja, est);
    var nCols = est.ultimaColumna;

    if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 20);

    // Heredar formato, validaciones y la formula de Ganancia de la fila modelo.
    var modelo = filaModelo(hoja, est, fila);
    if (modelo) {
      hoja.getRange(modelo, 1, 1, nCols).copyTo(hoja.getRange(fila, 1, 1, nCols));
    }

    // Escribir solo las columnas manuales (las vacias quedan vacias de verdad).
    var valores = {
      fecha:       aFecha(datos.fecha, ss.getSpreadsheetTimeZone()),
      cliente:     texto(datos.cliente),
      origen:      texto(datos.origen),
      box:         texto(datos.box),
      cantBox:     numero(datos.cantBox),
      tipo:        texto(datos.tipo),
      estadoPago:  texto(datos.estadoPago),
      envio:       texto(datos.envio),
      notas:       texto(datos.notas),
      canela:      numero(datos.canela),
      ddl:         numero(datos.ddl),
      oreo:        numero(datos.oreo),
      cajaUsada:   texto(datos.cajaUsada),
      precioFinal: numero(datos.precioFinal)
    };

    for (var i = 0; i < COLUMNAS_MANUALES.length; i++) {
      var clave = COLUMNAS_MANUALES[i];
      if (!col[clave]) continue;
      hoja.getRange(fila, col[clave]).setValue(valores[clave]);
    }

    // La fila modelo tiene los calculados congelados (son valores, no formulas):
    // se reponen las formulas plantilla para que esta venta calcule lo suyo.
    ponerFormulasVenta(hoja, col, fila);

    // La fecha se escribe como numero de serie: si la celda quedara sin
    // formato de fecha se veria un numero suelto, asi que lo aseguramos.
    if (col.fecha) {
      var celdaFecha = hoja.getRange(fila, col.fecha);
      if (String(celdaFecha.getNumberFormat()).toLowerCase().indexOf('y') === -1) {
        celdaFecha.setNumberFormat('dd/MM/yyyy');
      }
    }

    // Origen es campo libre: si la columna tiene un desplegable, sumamos el
    // valor nuevo para que la celda no quede marcada como invalida.
    var origenNuevo = agregarAlDesplegable(hoja, est, col.origen, valores.origen, fila);

    SpreadsheetApp.flush();

    // Precio y costos de HOY quedan fijos para esta venta.
    congelarFilas(hoja, col, fila, 1);

    var agregadoALibreta = false;
    if (datos.guardarEnLibreta) {
      agregadoALibreta = agregarCliente(ss, datos.cliente, datos.origen, datos.contacto);
    }

    return {
      fila: fila,
      cliente: valores.cliente,
      precio:   leerNumero(hoja, fila, col.precioCobrado),
      costoProd: leerNumero(hoja, fila, col.costoProd),
      costoCaja: leerNumero(hoja, fila, col.costoCaja),
      ganancia: leerNumero(hoja, fila, col.ganancia),
      descuento: leerNumero(hoja, fila, col.descuento),
      agregadoALibreta: agregadoALibreta,
      origenNuevo: origenNuevo ? valores.origen : ''
    };
  } finally {
    lock.releaseLock();
  }
}

/** Deshacer: vacia las columnas manuales y deja la fila con sus formulas plantilla. */
function deshacerVenta(fila) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) throw new Error('La planilla está ocupada.');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = hojaVentas(ss);
    var est = estructura(hoja);
    var col = est.columnas;

    if (proximaFilaLibre(hoja, est) !== fila + 1) {
      throw new Error('Esa ya no es la última venta cargada. Borrala a mano desde la planilla.');
    }
    for (var i = 0; i < COLUMNAS_MANUALES.length; i++) {
      var clave = COLUMNAS_MANUALES[i];
      if (col[clave]) hoja.getRange(fila, col[clave]).clearContent();
    }
    // Los calculados estaban congelados: sin esto la fila vacia seguiria sumando.
    ponerFormulasVenta(hoja, col, fila);
    SpreadsheetApp.flush();
    return { fila: fila };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Si los sabores estan detallados, tienen que sumar lo que entra en la caja.
 * (Ej. real: una "Box de 12 Canela" cargada con 2/2/2 calculaba el costo de 6 rolls.)
 */
function validarSabores(datos) {
  var unidades = (Number(numero(datos.canela)) || 0) + (Number(numero(datos.ddl)) || 0) + (Number(numero(datos.oreo)) || 0);
  var tam = tamanoCaja(datos.box);
  var cant = Number(numero(datos.cantBox)) || 1;
  if (unidades > 0 && tam && unidades !== tam * cant) {
    throw new Error('Los sabores suman ' + unidades + ' rolls, pero ' + cant + ' × ' + texto(datos.box) +
      ' son ' + (tam * cant) + '. Corregí el detalle de sabores o elegí "Personalizado".');
  }
}

/** Rolls que entran en una caja segun su nombre ("Box de 12 Oreo" → 12). 0 si no es una caja fija. */
function tamanoCaja(box) {
  var m = String(box || '').match(/\bde\s*(\d+)\b/i);
  return m ? Number(m[1]) : 0;
}


/* ------------------------------------------------------------------ */
/* Formulas plantilla y congelado                                      */
/* ------------------------------------------------------------------ */

/**
 * Formulas de las columnas calculadas para la fila r, armadas con las
 * letras reales de cada columna (si mañana se mueve una, siguen andando).
 */
function formulasVenta(col, r) {
  var c = function (clave) { return col[clave] ? letra(col[clave]) + r : '0'; };
  var D = c('box'), E = c('cantBox'), H = c('envio'), O = c('canela'), P = c('ddl'),
      Q = c('oreo'), R = c('cajaUsada'), S = c('precioFinal'), A = c('fecha');
  var suelto = 'OR(' + D + '="Personalizado",' + D + '="Unidad")';
  var unidades = '(' + O + '+' + P + '+' + Q + ')';
  var lista = 'IF(' + suelto + ',' + O + '*PU_CANELA+' + P + '*PU_DDL+' + Q + '*PU_OREO,' +
              'IF(' + D + '="",0,VLOOKUP(' + D + ',FORMATOS,2,0)*' + E + '))';

  return {
    cobroEnvio:    '=IF(' + H + '="Envio",PRECIO_ENVIO,0)',
    precioCobrado: '=IF(' + S + '<>"",' + S + ',' + lista + ')',
    costoProd:     '=IF(' + unidades + '>0,' + O + '*CU_CANELA+' + P + '*CU_DDL+' + Q + '*CU_OREO,' +
                   'IF(' + D + '="",0,VLOOKUP(' + D + ',FORMATOS,3,0)*' + E + '))',
    // Si se eligio "Caja usada" manda esa (incluido "Sin caja"); si no, la del formato.
    costoCaja:     '=IF(' + R + '<>"",VLOOKUP(' + R + ',FORMATOS,4,0)*IF(' + suelto + ',1,' + E + '),' +
                   'IF(OR(' + suelto + ',' + D + '=""),0,VLOOKUP(' + D + ',FORMATOS,4,0)*' + E + '))',
    descuento:     '=IF(' + S + '="",0,' + lista + '-' + S + ')',
    control:       '=IF(' + A + '="","",IF(' + D + '="","⚠️ Sin formato",IF(' + unidades + '=0,"",' +
                   'IF(' + suelto + ',"",IF(' + unidades + '<>IF(ISNUMBER(SEARCH("de 12",' + D + ')),12,' +
                   'IF(ISNUMBER(SEARCH("de 6",' + D + ')),6,' + unidades + '))*' + E + ',"⚠️ Sabores ≠ caja","")))))'
  };
}

function ponerFormulasVenta(hoja, col, fila) {
  var f = formulasVenta(col, fila);
  for (var clave in f) {
    if (col[clave]) hoja.getRange(fila, col[clave]).setFormula(f[clave]);
  }
}

/** Reemplaza por su valor las formulas calculadas de n filas desde "desde" (si no dan error). */
function congelarFilas(hoja, col, desde, n) {
  for (var i = 0; i < COLUMNAS_CONGELADAS.length; i++) {
    var c = col[COLUMNAS_CONGELADAS[i]];
    if (!c) continue;
    var rango = hoja.getRange(desde, c, n, 1);
    var formulas = rango.getFormulas();
    var valores = rango.getValues();
    var salida = valores.map(function (v, k) {
      var esError = typeof v[0] === 'string' && v[0].charAt(0) === '#';
      return [esError && formulas[k][0] ? formulas[k][0] : v[0]];
    });
    rango.setValues(salida);
  }
}

/** Para ventas escritas a mano en la planilla: congela todas las filas cargadas. */
function congelarVentasManuales() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = hojaVentas(ss);
  var est = estructura(hoja);
  var desde = est.filaEncabezado + 1;
  var n = proximaFilaLibre(hoja, est) - desde;
  if (n > 0) congelarFilas(hoja, est.columnas, desde, n);
  ss.toast('Listo: ' + n + ' ventas con precio y costo fijos.', 'Ventas', 5);
}

/** 1 → A, 27 → AA */
function letra(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}


/* ------------------------------------------------------------------ */
/* Estructura de la hoja                                               */
/* ------------------------------------------------------------------ */

/** Busca la fila de encabezados y mapea cada clave a su numero de columna. */
function estructura(hoja) {
  var filas = Math.min(20, hoja.getMaxRows());
  var cols  = Math.min(40, hoja.getMaxColumns());
  var celdas = hoja.getRange(1, 1, filas, cols).getDisplayValues();

  for (var f = 0; f < filas; f++) {
    var normalizada = celdas[f].map(norm);
    if (normalizada.indexOf('fecha') === -1 || normalizada.indexOf('cliente') === -1) continue;

    var columnas = {};
    var ultima = 0;
    for (var c = 0; c < cols; c++) {
      if (normalizada[c]) ultima = c + 1;
      for (var k = 0; k < CLAVES_ENCABEZADO.length; k++) {
        var clave = CLAVES_ENCABEZADO[k][0];
        if (columnas[clave]) continue;
        if (CLAVES_ENCABEZADO[k][1](normalizada[c])) { columnas[clave] = c + 1; break; }
      }
    }
    if (!columnas.fecha || !columnas.cliente) continue;

    var ultimaColumna = Math.max(ultima, columnas.descuento || 0, columnas.precioFinal || 0, columnas.control || 0);
    return { filaEncabezado: f + 1, columnas: columnas, ultimaColumna: ultimaColumna };
  }
  throw new Error('No encontré la fila de encabezados (Fecha / Cliente) en la hoja ' + hoja.getName() + '.');
}

/**
 * Primera fila sin venta. Mira Fecha y Cliente, no getLastRow(),
 * porque abajo hay filas en blanco que ya tienen las formulas puestas.
 */
function proximaFilaLibre(hoja, est) {
  var inicio = est.filaEncabezado + 1;
  var hasta  = Math.max(hoja.getLastRow(), inicio);
  if (hasta < inicio) return inicio;

  var col = est.columnas;
  var izq = Math.min(col.fecha, col.cliente);
  var der = Math.max(col.fecha, col.cliente);
  var bloque = hoja.getRange(inicio, izq, hasta - inicio + 1, der - izq + 1).getValues();

  var iFecha = col.fecha - izq;
  var iCliente = col.cliente - izq;
  var ultima = inicio - 1;
  for (var i = 0; i < bloque.length; i++) {
    var f = bloque[i][iFecha];
    var c = bloque[i][iCliente];
    if (String(f).trim() !== '' || String(c).trim() !== '') ultima = inicio + i;
  }
  return ultima + 1;
}

/**
 * Fila de la que copiar formato y la formula de Ganancia: la venta de arriba.
 * (Los calculados de esa fila estan congelados; guardarVenta repone las formulas.)
 */
function filaModelo(hoja, est, destino) {
  var piso = est.filaEncabezado + 1;
  if (destino <= piso) return null;
  return destino - 1;
}


/* ------------------------------------------------------------------ */
/* Opciones de los desplegables                                        */
/* ------------------------------------------------------------------ */

/**
 * Usa la validación de datos de la hoja; si no hay, arma la lista del historial.
 * En esta planilla la validación de Box está cortada en tramos (D11:D14,
 * D16:D29, D31:D76, D77:D211) y arriba de todo no hay, asi que se busca la
 * validación más cercana desde la fila destino hacia arriba.
 */
function opciones(hoja, columna, est, proxima, historial) {
  if (!columna) return [];

  var dv = validacionCercana(hoja, columna, est, proxima);
  if (dv) {
    var tipo = dv.getCriteriaType();
    var vals = dv.getCriteriaValues();
    if (tipo === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      return limpiar(vals[0]);
    }
    if (tipo === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      return limpiar(vals[0].getValues().map(function (r) { return r[0]; }));
    }
  }
  return historial || [];
}

/** La validación vigente en la fila destino, o la más cercana hacia arriba. */
function validacionCercana(hoja, columna, est, fila) {
  var inicio = est.filaEncabezado + 1;
  var tope = Math.min(Math.max(fila, inicio), hoja.getMaxRows());
  var reglas = hoja.getRange(inicio, columna, tope - inicio + 1).getDataValidations();
  for (var i = reglas.length - 1; i >= 0; i--) {
    if (reglas[i][0]) return reglas[i][0];
  }
  return null;
}

/**
 * Suma un valor nuevo al desplegable de una columna, si es que tiene uno.
 * Asi el origen escrito a mano queda como opcion valida y disponible
 * la proxima vez, tanto en el formulario como en la planilla.
 * Devuelve true solo si tuvo que agregarlo.
 */
function agregarAlDesplegable(hoja, est, columna, valor, fila) {
  valor = texto(valor);
  if (!columna || !valor) return false;

  var dv = validacionCercana(hoja, columna, est, fila);
  if (!dv) return false;   // columna sin desplegable (es el caso de Origen)

  var tipo = dv.getCriteriaType();

  // Lista escrita a mano en la validacion: se reconstruye con el valor nuevo.
  if (tipo === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    var lista = limpiar(dv.getCriteriaValues()[0]);
    if (lista.indexOf(valor) !== -1) return false;
    lista.push(valor);

    var nueva = SpreadsheetApp.newDataValidation()
      .requireValueInList(lista, true)
      .setAllowInvalid(dv.getAllowInvalid())
      .setHelpText(dv.getHelpText() || '')
      .build();

    var inicio = est.filaEncabezado + 1;
    var alto = Math.min(hoja.getMaxRows() - inicio + 1, 2000);
    var rango = hoja.getRange(inicio, columna, alto);
    var actuales = rango.getDataValidations();
    for (var i = 0; i < actuales.length; i++) {
      if (actuales[i][0] &&
          actuales[i][0].getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
        actuales[i][0] = nueva;
      }
    }
    rango.setDataValidations(actuales);
    return true;
  }

  // Lista tomada de un rango: se escribe en la primera celda libre de ese rango.
  if (tipo === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    var origen = dv.getCriteriaValues()[0];
    var celdas = origen.getValues();
    for (var f = 0; f < celdas.length; f++) {
      if (texto(celdas[f][0]) === valor) return false;
    }
    for (var g = 0; g < celdas.length; g++) {
      if (texto(celdas[g][0]) === '') {
        origen.getCell(g + 1, 1).setValue(valor);
        return true;
      }
    }
  }

  return false;
}

function limpiar(lista) {
  var vistos = {}, salida = [];
  for (var i = 0; i < lista.length; i++) {
    var v = String(lista[i]).trim();
    if (!v || vistos[v]) continue;
    vistos[v] = true;
    salida.push(v);
  }
  return salida;
}


/* ------------------------------------------------------------------ */
/* Historial: valores usados, origen habitual por cliente, ultimas     */
/* ------------------------------------------------------------------ */

function leerHistorial(hoja, est, proxima) {
  var inicio = est.filaEncabezado + 1;
  var cantidad = proxima - inicio;
  var vacio = {
    valores: { origen: [], box: [], tipo: [], estadoPago: [], envio: [], cajaUsada: [] },
    origenPorCliente: {}, ultimas: []
  };
  if (cantidad <= 0) return vacio;

  var col = est.columnas;
  var filas = hoja.getRange(inicio, 1, cantidad, est.ultimaColumna).getDisplayValues();

  var frecuencia = { origen: {}, box: {}, tipo: {}, estadoPago: {}, envio: {}, cajaUsada: {} };
  var origenPorCliente = {};
  var ultimas = [];

  for (var i = 0; i < filas.length; i++) {
    var fila = filas[i];
    for (var clave in frecuencia) {
      if (!col[clave]) continue;
      var v = String(fila[col[clave] - 1]).trim();
      if (v) frecuencia[clave][v] = (frecuencia[clave][v] || 0) + 1;
    }
    var cliente = String(fila[col.cliente - 1]).trim();
    var origen  = col.origen ? String(fila[col.origen - 1]).trim() : '';
    if (cliente && origen) origenPorCliente[cliente] = origen;

    if (i >= filas.length - 6) {
      ultimas.push({
        fila: inicio + i,
        fecha: String(fila[col.fecha - 1]),
        cliente: cliente,
        box: col.box ? String(fila[col.box - 1]) : '',
        cant: col.cantBox ? String(fila[col.cantBox - 1]) : '',
        precio: col.precioCobrado ? String(fila[col.precioCobrado - 1]) : '',
        estado: col.estadoPago ? String(fila[col.estadoPago - 1]) : ''
      });
    }
  }

  var valores = {};
  for (var k in frecuencia) valores[k] = porFrecuencia(frecuencia[k]);

  return { valores: valores, origenPorCliente: origenPorCliente, ultimas: ultimas.reverse() };
}

function porFrecuencia(mapa) {
  return Object.keys(mapa).sort(function (a, b) { return mapa[b] - mapa[a]; });
}


/* ------------------------------------------------------------------ */
/* Libreta de clientes                                                 */
/* ------------------------------------------------------------------ */

function clientes(ss, origenPorCliente) {
  var lista = {};
  for (var nombre in origenPorCliente) {
    lista[nombre] = { n: nombre, o: origenPorCliente[nombre], enLibreta: false };
  }

  var hoja = hojaPorNombre(ss, HOJA_CLIENTES);
  if (hoja && hoja.getLastRow() > 1) {
    var celdas = hoja.getRange(1, 1, hoja.getLastRow(), Math.min(4, hoja.getLastColumn())).getDisplayValues();
    var encabezado = -1;
    for (var f = 0; f < celdas.length; f++) {
      if (norm(celdas[f][0]).indexOf('nombre') === 0) { encabezado = f; break; }
    }
    if (encabezado !== -1) {
      for (var i = encabezado + 1; i < celdas.length; i++) {
        var n = String(celdas[i][0]).trim();
        if (!n) continue;
        if (!lista[n]) lista[n] = { n: n, o: '', enLibreta: true };
        else lista[n].enLibreta = true;
      }
    }
  }

  return Object.keys(lista).sort().map(function (n) { return lista[n]; });
}

/** Agrega el cliente a la libreta si todavia no esta. Devuelve true si lo agrego. */
function agregarCliente(ss, nombre, origen, contacto) {
  nombre = String(nombre || '').trim();
  if (!nombre) return false;

  var hoja = hojaPorNombre(ss, HOJA_CLIENTES);
  if (!hoja) return false;

  var ultima = hoja.getLastRow();
  var ancho = Math.max(3, hoja.getLastColumn());
  var celdas = ultima > 0 ? hoja.getRange(1, 1, ultima, 1).getDisplayValues() : [];

  var encabezado = -1;
  for (var f = 0; f < celdas.length; f++) {
    if (norm(celdas[f][0]).indexOf('nombre') === 0) { encabezado = f + 1; break; }
  }
  if (encabezado === -1) return false;

  var destino = encabezado + 1;
  for (var i = encabezado; i < celdas.length; i++) {
    var n = String(celdas[i][0]).trim();
    if (!n) continue;
    if (norm(n) === norm(nombre)) return false; // ya existe
    destino = i + 2;
  }

  if (destino > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 10);

  // Heredar formato y formulas (Total comprado, Última compra) de la fila de arriba.
  if (destino > encabezado + 1) {
    hoja.getRange(destino - 1, 1, 1, ancho).copyTo(hoja.getRange(destino, 1, 1, ancho));
  }
  hoja.getRange(destino, 1).setValue(nombre);
  hoja.getRange(destino, 2).setValue(origen || '');
  hoja.getRange(destino, 3).setValue(contacto || '');
  if (ancho >= 4) hoja.getRange(destino, 4).clearContent();   // Formato favorito
  if (ancho >= 7) hoja.getRange(destino, 7).clearContent();   // Notas / Preferencias
  return true;
}


/* ------------------------------------------------------------------ */
/* Tabla de formatos (para la vista previa de precio)                  */
/* ------------------------------------------------------------------ */

function tablaFormatos(ss) {
  // La planilla ya define el rango con nombre FORMATOS (' INICIO'!O21:R31).
  // Es la fuente mas confiable; el rastreo de abajo queda como respaldo.
  try {
    var nombrado = ss.getRangeByName(RANGO_FORMATOS);
    if (nombrado) {
      var desdeNombre = armarFormatos(nombrado.getValues());
      if (desdeNombre.length) return desdeNombre;
    }
  } catch (e) { /* si el rango no existe, seguimos rastreando */ }

  var hojas = ss.getSheets();
  var mejor = null;

  for (var s = 0; s < hojas.length; s++) {
    var hoja = hojas[s];
    if (hoja.getLastRow() > 600 || hoja.getLastColumn() > 60) continue;
    if (hoja.getLastRow() < 2) continue;
    var celdas = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();

    for (var f = 0; f < celdas.length; f++) {
      for (var c = 0; c + 1 < celdas[f].length; c++) {
        if (norm(celdas[f][c]) !== 'formato') continue;
        if (norm(celdas[f][c + 1]).indexOf('precioventa') !== 0) continue;

        var items = [];
        for (var i = f + 1; i < celdas.length; i++) {
          var nombre = String(celdas[i][c]).trim();
          if (!nombre) break;
          items.push({
            nombre: nombre,
            precio: Number(celdas[i][c + 1]) || 0,
            costoIng: c + 2 < celdas[i].length ? (Number(celdas[i][c + 2]) || 0) : 0,
            costoCaja: c + 3 < celdas[i].length ? (Number(celdas[i][c + 3]) || 0) : 0
          });
        }
        if (!items.length) continue;
        var esTablaVentas = (c + 2 < celdas[f].length) && norm(celdas[f][c + 2]).indexOf('costoing') === 0
          && norm(celdas[f][c + 2]).indexOf('costoingredientes') !== 0;
        if (esTablaVentas) return items;
        if (!mejor || items.length > mejor.length) mejor = items;
      }
    }
  }
  return mejor || [];
}

/** Convierte filas [Formato, Precio, Costo Ing., Costo Caja] en objetos. */
function armarFormatos(filas) {
  var items = [];
  for (var i = 0; i < filas.length; i++) {
    var nombre = texto(filas[i][0]);
    if (!nombre || norm(nombre) === 'formato') continue;
    items.push({
      nombre: nombre,
      precio: Number(filas[i][1]) || 0,
      costoIng: Number(filas[i][2]) || 0,
      costoCaja: Number(filas[i][3]) || 0
    });
  }
  return items;
}


/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/**
 * Busca una hoja ignorando espacios, acentos y mayúsculas.
 * Acepta un nombre o una lista de nombres posibles.
 */
function hojaPorNombre(ss, nombres) {
  var buscados = [].concat(nombres).map(norm);
  var hojas = ss.getSheets();
  var i, j;

  // 1) Coincidencia exacta (ya sin espacios ni acentos).
  for (j = 0; j < buscados.length; j++) {
    for (i = 0; i < hojas.length; i++) {
      if (norm(hojas[i].getName()) === buscados[j]) return hojas[i];
    }
  }
  // 2) La pestaña contiene el nombre buscado.
  for (j = 0; j < buscados.length; j++) {
    for (i = 0; i < hojas.length; i++) {
      if (norm(hojas[i].getName()).indexOf(buscados[j]) !== -1) return hojas[i];
    }
  }
  return null;
}

/** La hoja de ventas, o un error que dice cómo se llaman las pestañas de verdad. */
function hojaVentas(ss) {
  var hoja = hojaPorNombre(ss, HOJA_VENTAS);
  if (!hoja) {
    throw new Error('No encontré la hoja de ventas. Las pestañas de esta planilla son: ' +
      nombresDeHojas(ss) + '.');
  }
  return hoja;
}

/** Lista las pestañas tal cual se llaman, para que los errores sean claros. */
function nombresDeHojas(ss) {
  return ss.getSheets().map(function (h) { return '"' + h.getName() + '"'; }).join(', ');
}

function norm(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function texto(v) {
  return String(v == null ? '' : v).trim();
}

function numero(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  var n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

/**
 * Convierte "2026-09-21" en el numero de serie de Sheets (dias desde el
 * 30/12/1899), calculado en UTC.
 *
 * Antes esto devolvia un objeto Date, y ahi estaba el bug: new Date(a,m,d)
 * arma la medianoche en la zona horaria del PROYECTO de Apps Script, pero la
 * planilla lo vuelve a leer en la zona horaria de la PLANILLA. Si no son la
 * misma, la fecha se corre: una venta del 21 quedaba como 20 a las 20:00.
 *
 * Un numero de serie no tiene zona horaria, asi que no se puede correr.
 * La celda ya tiene formato de fecha y lo muestra como dd/MM/yyyy, 00:00.
 */
function aFecha(iso, tz) {
  var y, m, d;
  var p = String(iso || '').split('-');

  if (p.length === 3 && p[0].length === 4) {
    y = Number(p[0]); m = Number(p[1]); d = Number(p[2]);
  } else {
    var hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-');
    y = Number(hoy[0]); m = Number(hoy[1]); d = Number(hoy[2]);
  }

  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function leerNumero(hoja, fila, columna) {
  if (!columna) return null;
  var v = hoja.getRange(fila, columna).getValue();
  return typeof v === 'number' ? v : null;
}

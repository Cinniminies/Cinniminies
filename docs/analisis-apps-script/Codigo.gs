/**
 * CINNIMINIES · ANÁLISIS — datos de la app en este Google Sheet (solo lectura)
 * ============================================================================
 * Trae las vistas de reporte desde https://cinniminies.vercel.app/api/export y
 * reescribe una pestaña `datos_<vista>` por cada una. Las pestañas de datos están
 * protegidas: el análisis se arma en otras pestañas con fórmulas que las leen.
 *
 * Cada columna de datos tiene un rango con nombre `<vista>_<columna>`
 * (por ejemplo `ventas_total` o `resumen_mensual_vendido`), así las fórmulas
 * no dependen de la letra de la columna: =SUM(ventas_total).
 *
 * La clave de export se guarda en las propiedades del script (menú
 * "📊 Análisis → Configurar clave…"). Nunca va escrita en este código.
 *
 * Diseño: "🎨 Aplicar diseño" pinta todo con los colores de la marca, arma la pestaña
 * "Tablero" (tarjetas y gráficos) y le da estilo a "Resumen". Las pestañas datos_* se
 * vuelven a pintar solas en cada actualización.
 *
 * Instalación y cómo rotar la clave: docs/analisis-apps-script/README.md.
 */

const URL_EXPORT = 'https://cinniminies.vercel.app/api/export';
const PROP_CLAVE = 'EXPORT_KEY';
const HOJA_ESTADO = 'datos_estado';
const HOJA_RESUMEN = 'Resumen';
const ZONA = 'America/Montevideo';

const HOJA_TABLERO = 'Tablero';
const HOJA_GRAFICOS = 'graficos_datos';

// Colores de la web (cinniminies.css)
const COLOR = {
  crema: '#FBF3E1', cremaSuave: '#F7E7C8', card: '#FFFBF2', cafe: '#3A2417', cafeSuave: '#6B4631',
  canela: '#D98F3E', canelaClara: '#F0B873', tostada: '#8B4226', rojo: '#B3401A', naranjaSuave: '#FCE3C2',
};
const FUENTE = 'Plus Jakarta Sans';
const FUENTE_TITULOS = 'Fraunces';
// Columnas con escala de color (más oscuro = más alto)
const CON_ESCALA = ['vendido', 'ganancia_bruta', 'ganancia'];

const FORMATOS = {
  fecha: 'dd/mm/yyyy',
  mes: 'mmm yyyy',
  fechahora: 'dd/mm/yyyy hh:mm',
  dinero: '$#,##0.00',
  numero: '#,##0.##',
};

// ---------------------------------------------------------------- menú

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Análisis')
    .addItem('📊 Actualizar ahora', 'actualizarAhora')
    .addSeparator()
    .addItem('Configurar clave…', 'configurarClave')
    .addItem('Activar actualización cada hora', 'activarCadaHora')
    .addItem('Crear pestaña Resumen', 'crearResumen')
    .addItem('🎨 Aplicar diseño', 'aplicarDiseno')
    .addToUi();
}

function actualizarAhora() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Trayendo los datos de la app…', 'Cinniminies', 30);
  const r = actualizarTodo();
  ss.toast(r.errores.length
    ? 'Listo, con errores en: ' + r.errores.join(', ') + '. Mirá la pestaña ' + HOJA_ESTADO + '.'
    : 'Listo: ' + r.vistas + ' pestañas actualizadas.', 'Cinniminies', 10);
}

function configurarClave() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Clave de export',
    'Pegá la EXPORT_KEY que está en Vercel (Settings → Environment Variables).\n' +
    'Queda guardada en las propiedades del script, no en la planilla.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const clave = r.getResponseText().trim();
  if (!clave) {
    ui.alert('No se guardó nada: la clave está vacía.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_CLAVE, clave);
  // Prueba la clave enseguida para no enterarse recién en el próximo activador.
  const prueba = pedir_(URL_EXPORT, clave);
  ui.alert(prueba.getResponseCode() === 200
    ? 'Clave guardada y probada. Ahora usá "📊 Actualizar ahora".'
    : 'La clave se guardó, pero la app respondió ' + prueba.getResponseCode() + ': ' +
      prueba.getContentText().slice(0, 200));
}

function activarCadaHora() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'actualizarTodo'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('actualizarTodo').timeBased().everyHours(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Se va a actualizar sola cada hora.', 'Cinniminies', 8);
}

// ---------------------------------------------------------------- actualización

/**
 * Trae todas las vistas y reescribe sus pestañas. Si una falla, deja los datos
 * anteriores de esa pestaña y anota el error en `datos_estado`.
 */
function actualizarTodo() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) throw new Error('Ya hay una actualización en curso.');
  try {
    const clave = PropertiesService.getScriptProperties().getProperty(PROP_CLAVE);
    if (!clave) throw new Error('Falta la clave: menú "📊 Análisis → Configurar clave…".');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== ZONA) ss.setSpreadsheetTimeZone(ZONA);

    const lista = leerJson_(pedir_(URL_EXPORT, clave));
    const pedidos = lista.vistas.map(function (v) {
      return {
        url: URL_EXPORT + '/' + encodeURIComponent(v.nombre),
        headers: { 'x-export-key': clave },
        muteHttpExceptions: true,
      };
    });
    const respuestas = UrlFetchApp.fetchAll(pedidos);

    const estado = [];
    const errores = [];
    lista.vistas.forEach(function (v, i) {
      try {
        const tabla = leerJson_(respuestas[i]);
        escribirVista_(ss, tabla);
        estado.push([v.nombre, v.titulo, tabla.filas.length, new Date(tabla.generado), '']);
      } catch (e) {
        errores.push(v.nombre);
        estado.push([v.nombre, v.titulo, '', new Date(), String(e.message || e)]);
      }
    });
    escribirEstado_(ss, estado);
    return { vistas: lista.vistas.length - errores.length, errores: errores };
  } finally {
    lock.releaseLock();
  }
}

function pedir_(url, clave) {
  return UrlFetchApp.fetch(url, { headers: { 'x-export-key': clave }, muteHttpExceptions: true });
}

function leerJson_(respuesta) {
  const codigo = respuesta.getResponseCode();
  const texto = respuesta.getContentText();
  if (codigo !== 200) throw new Error('La app respondió ' + codigo + ': ' + texto.slice(0, 300));
  return JSON.parse(texto);
}

function escribirVista_(ss, tabla) {
  const nombreHoja = 'datos_' + tabla.vista;
  const hoja = ss.getSheetByName(nombreHoja) || ss.insertSheet(nombreHoja);
  const cols = tabla.columnas.length;
  const filas = tabla.filas.length;

  ajustarTamano_(hoja, filas + 1, cols);
  hoja.clear();

  const valores = [tabla.columnas.map(function (c) { return c.nombre; })];
  tabla.filas.forEach(function (f) {
    valores.push(f.map(function (x, j) { return aCelda_(x, tabla.columnas[j].tipo); }));
  });
  hoja.getRange(1, 1, valores.length, cols).setValues(valores);

  hoja.setFrozenRows(1);
  tabla.columnas.forEach(function (c, j) {
    const rango = hoja.getRange(2, j + 1, hoja.getMaxRows() - 1, 1);
    if (FORMATOS[c.tipo]) rango.setNumberFormat(FORMATOS[c.tipo]);
    else if (c.tipo === 'texto') rango.setNumberFormat('@');
    // Rango con nombre por columna: se actualiza en lugar de borrarse, así las
    // fórmulas que lo usan no se rompen.
    nombrarRango_(ss, tabla.vista + '_' + c.nombre, hoja.getRange(2, j + 1, hoja.getMaxRows() - 1, 1));
  });

  estiloDatos_(hoja, tabla.vista, tabla.columnas, filas);
  proteger_(hoja);
}

// La hoja tiene que tener al menos esas filas y columnas (más una fila vacía al final).
function ajustarTamano_(hoja, filas, cols) {
  if (hoja.getMaxRows() < filas + 1) hoja.insertRowsAfter(hoja.getMaxRows(), filas + 1 - hoja.getMaxRows());
  if (hoja.getMaxColumns() < cols) hoja.insertColumnsAfter(hoja.getMaxColumns(), cols - hoja.getMaxColumns());
}

function aCelda_(x, tipo) {
  if (x === null || x === undefined) return '';
  if (tipo === 'fecha' || tipo === 'mes') {
    const p = String(x).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  if (tipo === 'fechahora') return new Date(x);
  return x;
}

function nombrarRango_(ss, nombre, rango) {
  const existente = ss.getNamedRanges().filter(function (n) { return n.getName() === nombre; })[0];
  if (existente) existente.setRange(rango);
  else ss.setNamedRange(nombre, rango);
}

// Solo el dueño (que es quien corre el script) puede editar la pestaña.
function proteger_(hoja) {
  if (hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
  const p = hoja.protect().setDescription('Datos de la app: se reescriben solos cada hora');
  p.addEditor(Session.getEffectiveUser());
  p.removeEditors(p.getEditors().filter(function (e) {
    return e.getEmail() !== Session.getEffectiveUser().getEmail();
  }));
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function escribirEstado_(ss, estado) {
  const hoja = ss.getSheetByName(HOJA_ESTADO) || ss.insertSheet(HOJA_ESTADO);
  hoja.clear();
  const valores = [['vista', 'descripción', 'filas', 'actualizado', 'error']].concat(estado);
  hoja.getRange(1, 1, valores.length, 5).setValues(valores);
  hoja.getRange(2, 4, Math.max(estado.length, 1), 1).setNumberFormat(FORMATOS.fechahora);
  hoja.setFrozenRows(1);
  estiloDatos_(hoja, 'estado', ['vista', 'descripción', 'filas', 'actualizado', 'error']
    .map(function (n) { return { nombre: n, tipo: 'texto' }; }), estado.length);
  hoja.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$E2<>""').setBackground(COLOR.naranjaSuave).setFontColor(COLOR.rojo)
    .setRanges([hoja.getRange(2, 1, Math.max(estado.length, 1), 5)]).build()]);
  proteger_(hoja);
}

// ---------------------------------------------------------------- Resumen de ejemplo

/**
 * Crea la pestaña "Resumen" con fórmulas sobre los rangos con nombre. Es un ejemplo
 * para extender: se puede editar libremente (no se pisa al actualizar).
 */
function crearResumen() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  if (!ss.getSheetByName('datos_resumen_mensual')) {
    ui.alert('Primero tocá "📊 Actualizar ahora" para traer los datos.');
    return;
  }
  if (ss.getSheetByName(HOJA_RESUMEN)) {
    ui.alert('Ya hay una pestaña "' + HOJA_RESUMEN + '". Renombrala o borrala si querés crearla de nuevo.');
    return;
  }
  conRegionIngles_(ss, function () {
    const h = ss.insertSheet(HOJA_RESUMEN, 0);
    const titulo = function (celda, texto) {
      h.getRange(celda).setValue(texto).setFontWeight('bold').setFontSize(12);
    };

    // Totales: tienen que coincidir con "Inicio" de la app (período "Todo").
    titulo('A1', 'Totales');
    h.getRange('A2:B12').setValues([
      ['Actualizado', '=MAX(datos_estado!D2:D)'],
      ['Vendido', '=SUM(resumen_mensual_vendido)'],
      ['Cobrado', '=SUM(resumen_mensual_cobrado)'],
      ['Pendiente de cobro', '=SUM(resumen_mensual_pendiente)'],
      ['Costo de producción', '=SUM(resumen_mensual_costo_produccion)'],
      ['Costo de cajas', '=SUM(resumen_mensual_costo_caja)'],
      ['Ganancia bruta', '=SUM(resumen_mensual_ganancia_bruta)'],
      ['Compras', '=SUM(resumen_mensual_compras)'],
      ['Gastos', '=SUM(resumen_mensual_gastos)'],
      ['Retiros de socios', '=SUM(resumen_mensual_retiros)'],
      ['Stock valorizado', '=SUM(stock_valor)'],
    ]);
    h.getRange('B2').setNumberFormat(FORMATOS.fechahora);
    h.getRange('B3:B12').setNumberFormat(FORMATOS.dinero);

    titulo('D1', 'Por mes');
    h.getRange('D2').setFormula(
      '=QUERY({resumen_mensual_mes, resumen_mensual_ventas, resumen_mensual_vendido, ' +
      'resumen_mensual_ganancia_bruta, resumen_mensual_compras, resumen_mensual_gastos, ' +
      'resumen_mensual_resultado}, "select * where Col1 is not null order by Col1 desc ' +
      'label Col1 \'Mes\', Col2 \'Ventas\', Col3 \'Vendido\', Col4 \'Ganancia bruta\', ' +
      'Col5 \'Compras\', Col6 \'Gastos\', Col7 \'Resultado\'", 0)');
    h.getRange('D3:D').setNumberFormat(FORMATOS.mes);
    h.getRange('F3:J').setNumberFormat(FORMATOS.dinero);

    titulo('L1', 'Por sabor');
    h.getRange('L2').setFormula(
      '=QUERY({ventas_sabores_sabor, ventas_sabores_unidades, ventas_sabores_ingreso, ' +
      'ventas_sabores_costo}, "select Col1, sum(Col2), sum(Col3), sum(Col4), sum(Col3) - sum(Col4) ' +
      'where Col1 is not null group by Col1 order by sum(Col3) desc ' +
      'label Col1 \'Sabor\', sum(Col2) \'Rolls\', sum(Col3) \'Ingreso\', sum(Col4) \'Costo\', ' +
      'sum(Col3) - sum(Col4) \'Ganancia\'", 0)');
    h.getRange('N3:P').setNumberFormat(FORMATOS.dinero);

    titulo('R1', 'Top 10 clientes');
    h.getRange('R2').setFormula(
      '=QUERY({ventas_cliente, ventas_total, ventas_tipo}, "select Col1, count(Col2), sum(Col2) ' +
      'where Col1 is not null and Col3 = \'venta\' group by Col1 order by sum(Col2) desc limit 10 ' +
      'label Col1 \'Cliente\', count(Col2) \'Compras\', sum(Col2) \'Total\'", 0)');
    h.getRange('T3:T').setNumberFormat(FORMATOS.dinero);

    h.getRange('A2:T2').setFontWeight('bold');
    h.getRange('A3:A12').setFontWeight('normal');
    h.setFrozenRows(2);
    h.autoResizeColumns(1, 20);
    ss.setActiveSheet(h);
    estiloResumen_(ss);
  });
}

// ---------------------------------------------------------------- diseño

/**
 * Colores, franjas, formato condicional y gráficos. Se puede correr las veces que haga falta:
 * rehace el Tablero (no editarlo a mano) y vuelve a pintar Resumen sin tocar sus fórmulas.
 */
function aplicarDiseno() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Aplicando el diseño…', 'Cinniminies', 30);
  actualizarTodo(); // trae datos frescos y pinta las pestañas datos_*
  try {
    const tema = ss.getSpreadsheetTheme();
    if (tema) tema.setFontFamily(FUENTE);
  } catch (e) { /* sin temas: queda la fuente por defecto */ }
  conRegionIngles_(ss, function () {
    if (ss.getSheetByName(HOJA_RESUMEN)) estiloResumen_(ss);
    crearTablero_(ss);
  });
  ordenarPestanas_(ss);
  ss.setActiveSheet(ss.getSheetByName(HOJA_TABLERO));
  ss.toast('Listo. El Tablero se rehace con "🎨 Aplicar diseño"; no lo edites a mano.', 'Cinniminies', 10);
}

// Las fórmulas del script van con sintaxis en inglés (coma como separador). En una planilla en
// español eso da #ERROR!, así que se usa en_US mientras se escriben y después se vuelve a la
// configuración de la planilla (las fórmulas se muestran con ";" como siempre).
function conRegionIngles_(ss, fn) {
  const regional = ss.getSpreadsheetLocale();
  if (regional !== 'en_US') ss.setSpreadsheetLocale('en_US');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    if (regional !== 'en_US') ss.setSpreadsheetLocale(regional);
  }
}

function letra_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Pestañas datos_*: encabezado canela, franjas, filtro, negativos en rojo, escala de color y
// resaltado de lo que requiere atención (ventas pendientes, insumos para reponer).
function estiloDatos_(hoja, vista, columnas, filas) {
  const cols = columnas.length;
  const alto = Math.max(filas, 1) + 1;
  const tabla = hoja.getRange(1, 1, alto, cols);
  const cuerpo = hoja.getRange(2, 1, alto - 1, cols);
  const col = function (nombre) {
    const i = columnas.map(function (c) { return c.nombre; }).indexOf(nombre);
    return i < 0 ? null : i + 1;
  };

  hoja.getBandings().forEach(function (b) { b.remove(); });
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.setTabColor(COLOR.cafeSuave);

  tabla.setFontFamily(FUENTE).setFontSize(10).setFontColor(COLOR.cafe).setVerticalAlignment('middle');
  tabla.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(COLOR.cafe).setFirstRowColor(COLOR.card).setSecondRowColor(COLOR.crema);
  hoja.getRange(1, 1, 1, cols).setFontColor(COLOR.card).setFontWeight('bold');
  hoja.setRowHeight(1, 30);
  tabla.createFilter();

  const reglas = [];
  const regla = function () { return SpreadsheetApp.newConditionalFormatRule(); };
  columnas.forEach(function (c, j) {
    const r = hoja.getRange(2, j + 1, alto - 1, 1);
    if (c.tipo === 'dinero') {
      reglas.push(regla().whenNumberLessThan(0).setFontColor(COLOR.rojo).setBold(true).setRanges([r]).build());
    }
    if (CON_ESCALA.indexOf(c.nombre) >= 0) {
      reglas.push(regla().setGradientMinpoint(COLOR.card).setGradientMaxpoint(COLOR.canelaClara).setRanges([r]).build());
    }
  });
  if (vista === 'ventas' && col('estado_pago')) {
    reglas.push(regla().whenFormulaSatisfied('=$' + letra_(col('estado_pago')) + '2="pendiente"')
      .setBackground(COLOR.naranjaSuave).setRanges([cuerpo]).build());
  }
  if (vista === 'stock' && col('reponer')) {
    reglas.push(regla().whenFormulaSatisfied('=$' + letra_(col('reponer')) + '2')
      .setBackground(COLOR.naranjaSuave).setFontColor(COLOR.tostada).setRanges([cuerpo]).build());
  }
  if (vista === 'gastos' && col('es_gasto')) {
    reglas.push(regla().whenFormulaSatisfied('=NOT($' + letra_(col('es_gasto')) + '2)')
      .setFontColor(COLOR.cafeSuave).setItalic(true).setRanges([cuerpo]).build());
  }
  hoja.setConditionalFormatRules(reglas);
  hoja.autoResizeColumns(1, cols);
}

// Resumen: títulos, encabezados de cada tabla, franjas y negativos en rojo. No toca las fórmulas.
function estiloResumen_(ss) {
  const h = ss.getSheetByName(HOJA_RESUMEN);
  h.setTabColor(COLOR.tostada);
  h.getBandings().forEach(function (b) { b.remove(); });
  h.getRange('A1:T60').setFontFamily(FUENTE).setFontColor(COLOR.cafe).setBackground(COLOR.card);
  ['A1', 'D1', 'L1', 'R1'].forEach(function (c) {
    h.getRange(c).setFontFamily(FUENTE_TITULOS).setFontSize(15).setFontWeight('bold').setFontColor(COLOR.tostada);
  });
  h.setRowHeight(1, 34);
  // Totales
  h.getRange('A2:A12').setFontColor(COLOR.cafeSuave);
  h.getRange('B2:B12').setFontWeight('bold').setHorizontalAlignment('right');
  h.getRange('A2:B12').setBorder(null, null, true, null, false, true, COLOR.cremaSuave, SpreadsheetApp.BorderStyle.SOLID);
  // Tablas de QUERY: encabezado + franjas (hasta 40 filas)
  [['D2:J40'], ['L2:P40'], ['R2:T12']].forEach(function (t) {
    h.getRange(t[0]).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
      .setHeaderRowColor(COLOR.canela).setFirstRowColor(COLOR.card).setSecondRowColor(COLOR.crema);
    h.getRange(t[0].replace(/\d+$/, '2')).setFontColor(COLOR.card).setFontWeight('bold'); // fila de encabezados
  });
  h.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
    .setFontColor(COLOR.rojo).setBold(true)
    .setRanges([h.getRange('B3:B12'), h.getRange('F3:J40'), h.getRange('N3:P40'), h.getRange('T3:T12')]).build()]);
  h.setColumnWidth(3, 24);
  h.setColumnWidth(11, 24);
  h.setColumnWidth(17, 24);
}

// Tablero: tarjetas con los totales y cuatro gráficos. Los gráficos leen de una pestaña oculta
// (graficos_datos) con consultas sobre los rangos con nombre, así se actualizan solos.
function crearTablero_(ss) {
  const aux = ss.getSheetByName(HOJA_GRAFICOS) || ss.insertSheet(HOJA_GRAFICOS);
  aux.clear();
  aux.getRange('A1').setFormula('=QUERY({ventas_sabores_sabor, ventas_sabores_unidades}, ' +
    '"select Col1, sum(Col2) where Col1 is not null group by Col1 order by sum(Col2) desc ' +
    'label Col1 \'Sabor\', sum(Col2) \'Rolls\'", 0)');
  aux.getRange('D1').setFormula('=QUERY({ventas_cliente, ventas_total, ventas_tipo}, ' +
    '"select Col1, sum(Col2) where Col1 is not null and Col3 = \'venta\' group by Col1 ' +
    'order by sum(Col2) desc limit 10 label Col1 \'Cliente\', sum(Col2) \'Total\'", 0)');
  aux.getRange('G1').setFormula('=QUERY({resumen_mensual_mes, resumen_mensual_vendido, ' +
    'resumen_mensual_ganancia_bruta, resumen_mensual_compras}, "select * where Col1 is not null order by Col1 ' +
    'label Col1 \'Mes\', Col2 \'Vendido\', Col3 \'Ganancia bruta\', Col4 \'Compras\'", 0)');
  aux.getRange('G2:G100').setNumberFormat(FORMATOS.mes);
  aux.hideSheet();
  proteger_(aux);

  let h = ss.getSheetByName(HOJA_TABLERO);
  if (h) {
    h.getCharts().forEach(function (c) { h.removeChart(c); });
    h.getRange('A1:Z80').breakApart();
    h.clear();
  } else {
    h = ss.insertSheet(HOJA_TABLERO, 0);
  }
  h.setTabColor(COLOR.canela);
  h.setHiddenGridlines(true);
  h.getRange('A1:Z80').setBackground(COLOR.crema).setFontFamily(FUENTE).setFontColor(COLOR.cafe);
  h.setColumnWidth(1, 24);
  for (let c = 2; c <= 11; c++) h.setColumnWidth(c, 112);

  h.getRange('B1').setValue('Cinniminies · Tablero').setFontFamily(FUENTE_TITULOS).setFontSize(22)
    .setFontWeight('bold').setFontColor(COLOR.tostada);
  h.setRowHeight(1, 46);
  h.getRange('B2').setFormula('="Actualizado " & TEXT(MAX(datos_estado!D2:D), "dd/mm/yyyy hh:mm") & ' +
    '" · se actualiza sola cada hora"').setFontColor(COLOR.cafeSuave).setFontSize(9);

  // Tarjetas: [título, fórmula, aclaración]
  const tarjetas = [
    ['Vendido', '=SUM(resumen_mensual_vendido)', 'todo el período'],
    ['Ganancia bruta', '=SUM(resumen_mensual_ganancia_bruta)', 'ventas − costos'],
    ['Pendiente de cobro', '=SUM(resumen_mensual_pendiente)', 'ventas sin cobrar'],
    ['Resultado', '=SUM(resumen_mensual_resultado)', 'vendido − compras − gastos'],
    ['Stock', '=SUM(stock_valor)', 'ingredientes y packaging'],
  ];
  tarjetas.forEach(function (t, i) {
    const c = 2 + i * 2;
    const caja = h.getRange(4, c, 3, 2);
    caja.setBackground(COLOR.card)
      .setBorder(true, true, true, true, false, false, COLOR.cremaSuave, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    h.getRange(4, c, 1, 2).merge().setValue(t[0]).setFontSize(9).setFontWeight('bold').setFontColor(COLOR.canela);
    h.getRange(5, c, 1, 2).merge().setFormula(t[1]).setNumberFormat('$#,##0').setFontFamily(FUENTE_TITULOS)
      .setFontSize(20).setFontWeight('bold').setFontColor(COLOR.cafe);
    h.getRange(6, c, 1, 2).merge().setValue(t[2]).setFontSize(8).setFontColor(COLOR.cafeSuave);
  });
  h.getRange('B4:K6').setHorizontalAlignment('center').setVerticalAlignment('middle');
  h.setRowHeight(4, 26);
  h.setRowHeight(5, 42);
  h.setRowHeight(6, 22);
  h.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
    .setFontColor(COLOR.rojo).setRanges([h.getRange('B5:K5')]).build()]);

  const estilo = function (titulo) {
    return {
      title: titulo,
      titleTextStyle: { color: COLOR.cafe, fontName: FUENTE, fontSize: 13, bold: true },
      backgroundColor: COLOR.card,
      legend: { position: 'bottom', textStyle: { color: COLOR.cafeSuave, fontName: FUENTE } },
      width: 548,
      height: 320,
    };
  };
  const grafico = function (tipo, rangos, fila, columna, opciones) {
    let b = h.newChart().setChartType(tipo).setNumHeaders(1)
      .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS).setPosition(fila, columna, 0, 0);
    rangos.forEach(function (r) { b = b.addRange(aux.getRange(r)); });
    Object.keys(opciones).forEach(function (k) { b = b.setOption(k, opciones[k]); });
    h.insertChart(b.build());
  };
  const ejes = { hAxis: { format: 'MMM yy', textStyle: { color: COLOR.cafeSuave } },
    vAxis: { format: '$#,##0', textStyle: { color: COLOR.cafeSuave }, gridlines: { color: COLOR.cremaSuave } } };

  grafico(Charts.ChartType.COLUMN, ['G1:I100'], 8, 2,
    Object.assign(estilo('Vendido y ganancia por mes'), ejes, { colors: [COLOR.canela, COLOR.tostada] }));
  grafico(Charts.ChartType.PIE, ['A1:B30'], 8, 7,
    Object.assign(estilo('Rolls vendidos por sabor'), { pieHole: 0.45,
      colors: [COLOR.canela, COLOR.tostada, COLOR.canelaClara, COLOR.cafeSuave, COLOR.cremaSuave, COLOR.cafe],
      pieSliceTextStyle: { color: COLOR.card, fontName: FUENTE } }));
  grafico(Charts.ChartType.BAR, ['D1:E11'], 25, 2,
    Object.assign(estilo('Top 10 clientes'), { colors: [COLOR.canela], legend: { position: 'none' },
      hAxis: { format: '$#,##0', textStyle: { color: COLOR.cafeSuave }, gridlines: { color: COLOR.cremaSuave } },
      vAxis: { textStyle: { color: COLOR.cafe } } }));
  grafico(Charts.ChartType.LINE, ['G1:H100', 'J1:J100'], 25, 7,
    Object.assign(estilo('Ventas y compras por mes'), ejes,
      { colors: [COLOR.canela, COLOR.cafeSuave], lineWidth: 3, pointSize: 6, curveType: 'function' }));
}

// Tablero y Resumen adelante; datos al final.
function ordenarPestanas_(ss) {
  [HOJA_TABLERO, HOJA_RESUMEN].forEach(function (nombre, i) {
    const hoja = ss.getSheetByName(nombre);
    if (hoja) {
      ss.setActiveSheet(hoja);
      ss.moveActiveSheet(i + 1);
    }
  });
}

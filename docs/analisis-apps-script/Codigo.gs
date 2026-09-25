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
 * Instalación y cómo rotar la clave: docs/analisis-apps-script/README.md.
 */

const URL_EXPORT = 'https://cinniminies.vercel.app/api/export';
const PROP_CLAVE = 'EXPORT_KEY';
const HOJA_ESTADO = 'datos_estado';
const HOJA_RESUMEN = 'Resumen';
const ZONA = 'America/Montevideo';

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

  hoja.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#f3e9dc');
  hoja.setFrozenRows(1);
  tabla.columnas.forEach(function (c, j) {
    const rango = hoja.getRange(2, j + 1, hoja.getMaxRows() - 1, 1);
    if (FORMATOS[c.tipo]) rango.setNumberFormat(FORMATOS[c.tipo]);
    else if (c.tipo === 'texto') rango.setNumberFormat('@');
    // Rango con nombre por columna: se actualiza en lugar de borrarse, así las
    // fórmulas que lo usan no se rompen.
    nombrarRango_(ss, tabla.vista + '_' + c.nombre, hoja.getRange(2, j + 1, hoja.getMaxRows() - 1, 1));
  });

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
  hoja.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f3e9dc');
  hoja.getRange(2, 4, Math.max(estado.length, 1), 1).setNumberFormat(FORMATOS.fechahora);
  hoja.setFrozenRows(1);
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
}

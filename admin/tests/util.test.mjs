// Pruebas de los formatos de /admin. Correr con: node --test admin/tests/*.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  pesos, numero, cantidad, plural, fechaCorta, fechaLarga, nombreMes, mesISO, linkWhatsapp, proximoSabado, sumarDias, sumarMeses,
  sumar, hoyISO, diaMes, soloMes, normalizar, precioVigenteDe, compartirWhatsapp, opciones, DIAS_SEMANA,
} from '../js/util.js';

// Corre `fn` con el reloj parado en `instante` (ISO en UTC): hoyISO() y todo lo que depende de "hoy".
function conReloj(instante, fn) {
  mock.timers.enable({ apis: ['Date'], now: new Date(instante) });
  try {
    return fn();
  } finally {
    mock.timers.reset();
  }
}

// Corre `fn` con la zona horaria de la máquina en `zona`: las fechas no pueden depender de dónde corre el panel.
function enZona(zona, fn) {
  const antes = process.env.TZ;
  process.env.TZ = zona;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

test('pesos: miles con punto, decimales con coma, sin ,00', () => {
  assert.equal(pesos(250), '$250');
  assert.equal(pesos(1234.5), '$1.234,50');
  assert.equal(pesos(31130), '$31.130');
  assert.equal(pesos(8145.156), '$8.145,16');
  assert.equal(pesos(-50), '−$50');
  assert.equal(pesos(0.005), '$0,01');
  assert.equal(pesos(null), '—');
});

test('pesos: textos de la base, vacíos y millones', () => {
  assert.equal(pesos('1234.5'), '$1.234,50', 'numeric de Postgres llega como texto');
  assert.equal(pesos(0), '$0');
  assert.equal(pesos(''), '—');
  assert.equal(pesos(undefined), '—');
  assert.equal(pesos('abc'), '—');
  assert.equal(pesos(1234567.899), '$1.234.567,90');
  assert.equal(pesos(-1234.5), '−$1.234,50');
  assert.equal(pesos(0.995), '$1', 'redondea a centavos y, si queda entero, no muestra decimales');
});

test('cero con signo: un saldo de -0,001 (resto de una resta) se muestra como cero', { todo: 'pesos, numero y cantidad '
  + 'deciden el signo antes de redondear: pesos(-0.001) da "−$0" y numero(-0.001) da "-0"' }, () => {
  assert.equal(pesos(-0.001), '$0');
  assert.equal(numero(-0.001), '0');
  assert.equal(cantidad(-0.001, 'g'), '0 g');
});

test('números con coma decimal', () => {
  assert.equal(numero(1.5), '1,5');
  assert.equal(numero(5000), '5.000');
});

test('numero: hasta dos decimales por defecto, o los que se pidan', () => {
  assert.equal(numero(1234.5678), '1.234,57');
  assert.equal(numero('3.10'), '3,1');
  assert.equal(numero(2.4, 0), '2');
  assert.equal(numero(0), '0');
  assert.equal(numero(null), '—');
  assert.equal(numero(''), '—');
});

test('fechas sin corrimiento de zona horaria', () => {
  assert.equal(fechaCorta('2026-09-12'), 'sáb 12/09');
  assert.equal(fechaLarga('2026-05-06'), '06/05/2026');
  assert.equal(nombreMes('2026-09-01'), 'septiembre 2026');
  assert.equal(mesISO('2026-09-24'), '2026-09-01');
});

test('fechas: con hora, vacías, bisiesto y bordes del año', () => {
  assert.equal(fechaCorta('2026-10-31T23:30:00Z'), 'sáb 31/10', 'toma el día escrito, no lo pasa a la zona de la máquina');
  assert.equal(fechaCorta(''), '');
  assert.equal(fechaCorta(null), '');
  assert.equal(fechaLarga(undefined), '');
  assert.equal(diaMes(''), '');
  assert.equal(fechaLarga('2028-02-29'), '29/02/2028');
  assert.equal(fechaCorta('2028-02-29'), 'mar 29/02');
  assert.equal(fechaCorta('2026-11-01'), 'dom 01/11');
  assert.equal(diaMes('2026-01-05'), '05/01');
  assert.equal(nombreMes('2026-12-31'), 'diciembre 2026');
  assert.equal(nombreMes('2027-01-01'), 'enero 2027');
  assert.equal(soloMes('2026-02-15'), 'febrero');
  assert.equal(mesISO('2026-12-31T23:59:00Z'), '2026-12-01');
});

test('fechaCorta: los siete días de una semana de pedidos, de domingo a sábado', () => {
  const semana = Array.from({ length: 7 }, (_, i) => fechaCorta(sumarDias('2026-10-25', i)).split(' ')[0]);
  assert.deepEqual(semana, DIAS_SEMANA.map((d) => d.slice(0, 3)));
  assert.equal(semana.at(-1), 'sáb');
});

test('link de WhatsApp solo para celulares uruguayos', () => {
  assert.equal(linkWhatsapp('098 928 728'), 'https://wa.me/59898928728');
  assert.equal(linkWhatsapp('+598 91 962 175'), 'https://wa.me/59891962175');
  assert.equal(linkWhatsapp('@facupiova_77'), null);
  assert.equal(linkWhatsapp(null), null);
});

test('link de WhatsApp: con texto, sin el 0 y fijos', () => {
  assert.equal(linkWhatsapp('99123456'), 'https://wa.me/59899123456');
  assert.equal(linkWhatsapp('099123456', { texto: '¡Hola! ¿Retirás el sábado?' }),
    `https://wa.me/59899123456?text=${encodeURIComponent('¡Hola! ¿Retirás el sábado?')}`);
  assert.equal(linkWhatsapp('2901 2345'), null, 'un teléfono fijo no tiene WhatsApp');
  assert.equal(linkWhatsapp('0991234567'), null, 'un dígito de más');
  assert.equal(compartirWhatsapp('Plan & compras'), 'https://wa.me/?text=Plan%20%26%20compras');
});

test('cantidades con unidad legible', () => {
  assert.equal(cantidad(5000, 'g'), '5 kg');
  assert.equal(cantidad(350, 'g'), '350 g');
  assert.equal(cantidad(1500, 'ml'), '1,5 L');
  assert.equal(cantidad(12, 'un'), '12 un');
  assert.equal(cantidad(-42, 'g'), '-42 g');
});

test('cantidad: papel manteca en metros, faltantes en kg y vacíos', () => {
  assert.equal(cantidad(250, 'cm'), '2,5 m');
  assert.equal(cantidad(30, 'cm'), '30 cm');
  assert.equal(cantidad(1250, 'g'), '1,25 kg');
  assert.equal(cantidad(1000, 'g'), '1 kg', 'justo en el borde ya pasa a kg');
  assert.equal(cantidad(999, 'ml'), '999 ml');
  assert.equal(cantidad(-1500, 'g'), '-1,5 kg', 'un desvío negativo también se lee en kg');
  assert.equal(cantidad('5000', 'g'), '5 kg');
  assert.equal(cantidad(null, 'g'), '—');
  assert.equal(cantidad('', 'g'), '—');
});

test('plural', () => {
  assert.equal(plural(1, 'venta'), '1 venta');
  assert.equal(plural(3, 'venta'), '3 ventas');
  assert.equal(plural(0, 'tanda'), '0 tandas');
});

test('plural: irregular, con miles y desde texto', () => {
  assert.equal(plural(2, 'mes', 'meses'), '2 meses');
  assert.equal(plural(1, 'mes', 'meses'), '1 mes');
  assert.equal(plural('1', 'caja'), '1 caja');
  assert.equal(plural(1500, 'roll'), '1.500 rolls');
});

test('normalizar: sin mayúsculas ni acentos', () => {
  assert.equal(normalizar('Báez'), 'baez');
  assert.equal(normalizar('ÑANDÚ'), 'nandu');
  assert.equal(normalizar(null), '');
});

test('opciones: de un mapa de etiquetas a chips', () => {
  assert.deepEqual(opciones({ retiro: 'Retiro', envio: 'Envío' }),
    [{ valor: 'retiro', texto: 'Retiro' }, { valor: 'envio', texto: 'Envío' }]);
});

test('proximoSabado: el sábado que viene, o hoy si es sábado', () => {
  assert.equal(proximoSabado('2026-09-30'), '2026-10-03'); // miércoles
  assert.equal(proximoSabado('2026-10-03'), '2026-10-03'); // sábado
  assert.equal(proximoSabado('2026-10-04'), '2026-10-10'); // domingo
  assert.equal(proximoSabado('2026-12-28'), '2027-01-02'); // cambia el año
});

test('proximoSabado: toda la semana de pedidos (domingo a sábado) va al mismo sábado', () => {
  for (let i = 0; i < 7; i++) assert.equal(proximoSabado(sumarDias('2026-10-25', i)), '2026-10-31');
  assert.equal(proximoSabado('2026-11-01'), '2026-11-07', 'el domingo ya es la semana siguiente');
});

test('proximoSabado: cruza fin de mes y el 29 de febrero', () => {
  assert.equal(proximoSabado('2026-01-29'), '2026-01-31');
  assert.equal(proximoSabado('2026-02-01'), '2026-02-07');
  assert.equal(proximoSabado('2028-02-27'), '2028-03-04');
  assert.equal(proximoSabado('2028-02-29'), '2028-03-04');
});

test('sumarDias y sumarMeses: cruzan meses y años', () => {
  assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(sumarDias('2026-10-28T15:00:00Z', 0), '2026-10-28');
  assert.equal(sumarMeses('2026-01-01', -1), '2025-12-01');
  assert.equal(sumarMeses('2026-11-01', 2), '2027-01-01');
});

test('sumarDias: años bisiestos y saltos largos', () => {
  assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(sumarDias('2028-02-29', 1), '2028-03-01');
  assert.equal(sumarDias('2028-03-01', -1), '2028-02-29');
  assert.equal(sumarDias('2026-02-28', 1), '2026-03-01');
  assert.equal(sumarDias('2028-01-01', 366), '2029-01-01');
  assert.equal(sumarDias('2026-10-31', -7 * 8), '2026-09-05', 'ocho sábados para atrás sigue siendo sábado');
});

test('sumarMeses: el día no importa y cruza varios años', () => {
  assert.equal(sumarMeses('2026-01-31', 1), '2026-02-01');
  assert.equal(sumarMeses('2026-03-01', 0), '2026-03-01');
  assert.equal(sumarMeses('2026-01-01', -13), '2024-12-01');
  assert.equal(sumarMeses('2026-06-01', 24), '2028-06-01');
});

test('cambio de horario: sumarDias, proximoSabado y mesISO no dependen de la zona de la máquina', () => {
  // Días con cambio de horario en otros países (Uruguay no tiene desde 2015) y zonas en los dos extremos.
  const casos = [
    ['2026-03-07', 1, '2026-03-08'], ['2026-03-28', 1, '2026-03-29'], ['2026-10-24', 1, '2026-10-25'],
    ['2026-11-01', -1, '2026-10-31'], ['2014-10-04', 1, '2014-10-05'], ['2015-03-07', 1, '2015-03-08'],
  ];
  for (const zona of ['America/Montevideo', 'America/New_York', 'Europe/Madrid', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    enZona(zona, () => {
      for (const [desde, n, esperado] of casos) assert.equal(sumarDias(desde, n), esperado, `${zona}: ${desde} ${n}`);
      assert.equal(proximoSabado('2026-10-25'), '2026-10-31', zona);
      assert.equal(sumarMeses('2026-03-01', 1), '2026-04-01', zona);
      assert.equal(fechaCorta('2026-03-08'), 'dom 08/03', zona);
    });
  }
});

test('hoyISO: el día de Montevideo, no el de UTC ni el de la máquina', () => {
  // 31/10 a las 23:30 en Montevideo ya es 1/11 en UTC.
  assert.equal(conReloj('2026-11-01T02:30:00Z', hoyISO), '2026-10-31');
  assert.equal(conReloj('2026-11-01T03:00:00Z', hoyISO), '2026-11-01');
  assert.equal(enZona('Asia/Tokyo', () => conReloj('2026-11-01T02:30:00Z', hoyISO)), '2026-10-31');
  // Con el horario de verano que tuvo Uruguay hasta 2015 (UTC−2), la medianoche llegaba una hora antes.
  assert.equal(conReloj('2015-01-01T02:30:00Z', hoyISO), '2015-01-01');
});

test('hoy por defecto: mesISO, proximoSabado y el sábado mismo', () => {
  conReloj('2026-10-31T15:00:00Z', () => {
    assert.equal(mesISO(), '2026-10-01');
    assert.equal(proximoSabado(), '2026-10-31', 'el sábado de horneado es hoy');
  });
  // Viernes 23:30 en Montevideo (sábado en UTC): el sábado que viene es mañana, no hoy.
  assert.equal(conReloj('2026-10-31T02:30:00Z', () => proximoSabado()), '2026-10-31');
  assert.equal(conReloj('2026-10-30T15:00:00Z', () => proximoSabado()), '2026-10-31');
});

test('precioVigenteDe: el último que ya rige hoy', () => {
  const filas = [
    { precio: 250, vigente_desde: '2026-01-01' },
    { precio: 290, vigente_desde: '2026-10-01' },
    { precio: 320, vigente_desde: '2026-12-01' },
  ];
  conReloj('2026-11-03T15:00:00Z', () => {
    assert.equal(precioVigenteDe(filas), 290);
    assert.equal(precioVigenteDe(filas.slice(2)), null, 'un precio que todavía no rige no cuenta');
    assert.equal(precioVigenteDe([]), null);
  });
  assert.equal(conReloj('2026-12-01T03:00:00Z', () => precioVigenteDe(filas)), 320, 'rige desde su primer día');
});

test('sumar: suma el valor de cada elemento y lo que no es número cuenta 0', () => {
  assert.equal(sumar([{ total: '250' }, { total: 450 }, { total: null }], (v) => v.total), 700);
  assert.equal(sumar([1, 2, 3]), 6);
  assert.equal(sumar([]), 0);
});

test('sumar: negativos, decimales en texto y basura', () => {
  assert.equal(sumar([{ m: '-50' }, { m: '120.5' }, { m: undefined }, { m: 'abc' }, { m: NaN }], (x) => x.m), 70.5);
  assert.equal(sumar(['1', '2.25']), 3.25);
});

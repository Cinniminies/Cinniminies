// Pruebas de los formatos de /admin. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pesos, numero, fechaCorta, fechaLarga, nombreMes, mesISO, linkWhatsapp } from '../js/util.js';

test('pesos: miles con punto, decimales con coma, sin ,00', () => {
  assert.equal(pesos(250), '$250');
  assert.equal(pesos(1234.5), '$1.234,50');
  assert.equal(pesos(31130), '$31.130');
  assert.equal(pesos(8145.156), '$8.145,16');
  assert.equal(pesos(-50), '−$50');
  assert.equal(pesos(0.005), '$0,01');
  assert.equal(pesos(null), '—');
});

test('números con coma decimal', () => {
  assert.equal(numero(1.5), '1,5');
  assert.equal(numero(5000), '5.000');
});

test('fechas sin corrimiento de zona horaria', () => {
  assert.equal(fechaCorta('2026-09-12'), 'sáb 12/09');
  assert.equal(fechaLarga('2026-05-06'), '06/05/2026');
  assert.equal(nombreMes('2026-09-01'), 'septiembre 2026');
  assert.equal(mesISO('2026-09-24'), '2026-09-01');
});

test('link de WhatsApp solo para celulares uruguayos', () => {
  assert.equal(linkWhatsapp('098 928 728'), 'https://wa.me/59898928728');
  assert.equal(linkWhatsapp('+598 91 962 175'), 'https://wa.me/59891962175');
  assert.equal(linkWhatsapp('@facupiova_77'), null);
  assert.equal(linkWhatsapp(null), null);
});

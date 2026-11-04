// Pruebas de lo de graficos.js que no dibuja (el resto necesita el DOM). Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoVariacion } from '../js/graficos.js';

test('textoVariacion: sube o baja contra el mes anterior, con decimal por debajo del 10 %', () => {
  assert.equal(textoVariacion(112, 100, 'agosto'), 'sube 12 % vs agosto');
  assert.equal(textoVariacion(96.5, 100, 'agosto'), 'baja 3,5 % vs agosto');
  assert.equal(textoVariacion(250, 100, 'agosto'), 'sube 150 % vs agosto');
  assert.equal(textoVariacion(0, 100, 'agosto'), 'baja 100 % vs agosto');
});

test('textoVariacion: cambios mínimos cuentan como iguales', () => {
  assert.equal(textoVariacion(100, 100, 'agosto'), 'igual que agosto');
  assert.equal(textoVariacion(100.04, 100, 'agosto'), 'igual que agosto');
});

test('textoVariacion: sin mes anterior (o en cero) no hay comparación', () => {
  assert.equal(textoVariacion(500, 0, 'agosto'), null);
  assert.equal(textoVariacion(500, null, 'agosto'), null);
  assert.equal(textoVariacion(null, 500, 'agosto'), null);
});

test('textoVariacion: con el mes anterior negativo, subir es acercarse a cero', () => {
  assert.equal(textoVariacion(-50, -100, 'agosto'), 'sube 50 % vs agosto');
});

test('textoVariacion: justo por debajo del 10 % redondea a "10" y no a "10,0"', {
  todo: 'con 9,96 % elige el formato con decimal antes de redondear y muestra "10,0 %" (lo mismo en api/_lib/push.js)',
}, () => {
  assert.equal(textoVariacion(109.96, 100, 'agosto'), 'sube 10 % vs agosto');
});

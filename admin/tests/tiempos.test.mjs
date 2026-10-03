// Pruebas de la calculadora de tiempo. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronograma, duracion, horaMas, tiemposDe, TIEMPOS_DEFECTO as T } from '../js/tiempos.js';

test('una tanda: todo seguido', () => {
  const r = cronograma(1);
  assert.equal(r.total, 25 + 60 + 18 + 40 + 20);
  assert.deepEqual(r.tandas[0].horno, [143, 163]);
});

test('dos tandas: se preparan juntas, se estiran de a una, horno de a una', () => {
  const r = cronograma(2);
  assert.deepEqual(r.tandas.map((x) => x.preparacion), [[0, 25], [0, 25]]);
  assert.deepEqual(r.tandas.map((x) => x.estirado), [[85, 103], [103, 121]]);
  assert.deepEqual(r.tandas.map((x) => x.horno), [[143, 163], [163, 183]]);
  assert.equal(r.total, 183);
});

test('mientras leudan las primeras se preparan las otras; estirar tiene prioridad', () => {
  const r = cronograma(6);
  // 3 preparaciones seguidas (0–75); la primera tanda lista para estirar a los 85
  assert.deepEqual(r.tandas.map((x) => x.preparacion[0]), [0, 0, 25, 25, 50, 50]);
  assert.equal(r.tandas[0].estirado[0], 85);
  // Nadie se estira antes de terminar su leudado, ni dos a la vez
  const est = r.tandas.map((x) => x.estirado).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < est.length; i++) assert.ok(est[i][0] >= est[i - 1][1]);
  for (const x of r.tandas) assert.ok(x.estirado[0] >= x.leudado[1]);
  // El horno nunca tiene dos tandas a la vez y cada una entra después del segundo leudado
  const hor = r.tandas.map((x) => x.horno).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < hor.length; i++) assert.ok(hor[i][0] >= hor[i - 1][1]);
  for (const x of r.tandas) assert.ok(x.horno[0] >= x.leudado2[1]);
  assert.equal(r.total, Math.max(...r.tandas.map((x) => x.horno[1])));
});

test('estirar se intercala con preparar cuando una tanda ya leudó', () => {
  const r = cronograma(10, { ...T, tiempo_leudado: 30 });
  // A los 50 terminan 2 preparaciones y la primera tanda (leudó 25–55) todavía no; a los 75 ya sí.
  assert.ok(r.tandas[0].estirado[0] < r.tandas[9].preparacion[0]);
});

test('horno de dos lugares', () => {
  const r = cronograma(2, { ...T, horno_tandas: 2 });
  assert.deepEqual(r.tandas.map((x) => x.horno), [[143, 163], [161, 181]]);
});

test('cero tandas', () => assert.equal(cronograma(0).total, 0));

test('tiemposDe: completa con los de siempre y descarta lo inválido', () => {
  const t = tiemposDe({ tiempo_horno: '22', tiempo_leudado: 'x', masas_por_preparacion: '0' });
  assert.equal(t.tiempo_horno, 22);
  assert.equal(t.tiempo_leudado, 60);
  assert.equal(t.masas_por_preparacion, 2);
});

test('duracion y horaMas', () => {
  assert.equal(duracion(200), '3 h 20 min');
  assert.equal(duracion(120), '2 h');
  assert.equal(duracion(45), '45 min');
  assert.equal(horaMas('09:30', 200), '12:50');
  assert.equal(horaMas('22:00', 190), '25:10');
});

// Pruebas de los desvíos de stock. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filas, resumen, ordenar, escala, porConteo } from '../js/desvios.js';

const base = [
  { insumo_id: 'a', nombre: 'Azúcar', tipo: 'ingrediente', unidad_base: 'g', conteos: 3, usado: '371.67', desvio: '60.33', desvio_relativo: '0.1623', valor: '2.78' },
  { insumo_id: 'd', nombre: 'Dulce de leche', tipo: 'ingrediente', unidad_base: 'g', conteos: 1, usado: '300', desvio: '196', desvio_relativo: '0.6533', valor: '39.98' },
  { insumo_id: 'n', nombre: 'Nutella', tipo: 'ingrediente', unidad_base: 'g', conteos: 2, usado: '166.66', desvio: '-51.66', desvio_relativo: '-0.31', valor: '-37.43' },
  { insumo_id: 'c', nombre: 'Caja Box de 3', tipo: 'packaging', unidad_base: 'un', conteos: 1, usado: '0', desvio: '1', desvio_relativo: null, valor: '24' },
];

test('filas: según recetas, real y confiable', () => {
  const [a, d] = filas(base);
  assert.equal(a.segunRecetas, 371.67);
  assert.equal(Math.round(a.real * 100) / 100, 432);
  assert.equal(a.confiable, true);
  assert.equal(d.confiable, false);
  assert.equal(filas(base)[3].rel, null);
});

test('resumen: de más, sobró y para revisar (solo los confiables)', () => {
  const r = resumen(filas(base));
  assert.equal(Math.round(r.deMas * 100) / 100, 66.76);
  assert.equal(r.sobro, 37.43);
  assert.equal(r.revisar, 2); // Azúcar +16 % y Nutella −31 %; Dulce de leche tiene 1 solo conteo
});

test('ordenar por plata y por %', () => {
  assert.deepEqual(ordenar(filas(base), 'plata').map((f) => f.insumo_id), ['d', 'n', 'c', 'a']);
  assert.deepEqual(ordenar(filas(base), 'pct').map((f) => f.insumo_id), ['d', 'n', 'a', 'c']);
});

test('escala: entre 10 % y 100 %', () => {
  assert.equal(escala(filas(base)), 0.6533);
  assert.equal(escala([{ rel: 0.02 }]), 0.1);
  assert.equal(escala([{ rel: -2.5 }]), 1);
  assert.equal(escala([]), 0.1);
});

test('porConteo: agrupa por carga, más nuevo primero, mayor impacto arriba; hora si hubo dos el mismo día', () => {
  const g = porConteo([
    { fecha: '2026-10-02', creado_en: '2026-10-02T03:37:42Z', nombre: 'Harina', valor: '1' },
    { fecha: '2026-10-03', creado_en: '2026-10-03T16:48:50Z', nombre: 'Azúcar', valor: '2' },
    { fecha: '2026-10-03', creado_en: '2026-10-03T16:48:50Z', nombre: 'Canela', valor: '-5' },
    { fecha: '2026-10-02', creado_en: '2026-10-02T22:43:02Z', nombre: 'Harina', valor: '-1' },
  ]);
  assert.deepEqual(g.map((x) => [x.fecha, x.hora]), [['2026-10-03', null], ['2026-10-02', '19:43'], ['2026-10-02', '00:37']]);
  assert.deepEqual(g[0].filas.map((x) => x.nombre), ['Canela', 'Azúcar']);
});

// Pruebas de los desvíos de stock. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filas, resumen, ordenar, escala, porConteo, estadoAjuste, redondear, propuesta, cambios } from '../js/desvios.js';

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

test('estadoAjuste', () => {
  const [a, d, n] = filas(base);
  assert.equal(estadoAjuste(a), 'ajustar'); // +16 %, 3 conteos
  assert.equal(estadoAjuste(d), 'pocos'); // 1 conteo
  assert.equal(estadoAjuste({ ...n, rel: -0.02 }), 'chico');
  assert.equal(estadoAjuste(undefined), 'sin');
});

test('redondear: cantidades cómodas', () => {
  assert.equal(redondear(174.35, 'g'), 175);
  assert.equal(redondear(58.12, 'g'), 58);
  assert.equal(redondear(17.05, 'g'), 17);
  assert.equal(redondear(11.37, 'g'), 11.5);
  assert.equal(redondear(0.1, 'g'), 0.5);
  assert.equal(redondear(1.3, 'un'), 1.5);
});

test('propuesta: ajusta solo lo elegido con datos, costo antes y después; cambios', () => {
  const recetas = [
    { sabor_id: 'ca', sabor: 'Canela', rolls: 12, insumo_id: 'a', nombre: 'Azúcar', unidad: 'g', cantidad: '150' },
    { sabor_id: 'ca', sabor: 'Canela', rolls: 12, insumo_id: 'h', nombre: 'Huevos', unidad: 'un', cantidad: '1' },
    { sabor_id: 'dl', sabor: 'Dulce de Leche', rolls: 12, insumo_id: 'd', nombre: 'Dulce de leche', unidad: 'g', cantidad: '240' },
    { sabor_id: 'dl', sabor: 'Dulce de Leche', rolls: 12, insumo_id: 'a', nombre: 'Azúcar', unidad: 'g', cantidad: '50' },
  ];
  const p = propuesta(recetas, filas(base), new Set(['a']), { a: 0.05, h: 10, d: 0.2 });
  const canela = p.find((s) => s.sabor === 'Canela');
  const azucar = canela.items[0];
  assert.equal(azucar.nombre, 'Azúcar'); // lo que cambia va primero
  assert.equal(Math.round(azucar.real * 10) / 10, 174.3);
  assert.equal(azucar.propuesta, 175);
  assert.equal(canela.items[1].propuesta, 1); // huevos sin datos: igual
  assert.equal(canela.items[1].estado, 'sin');
  assert.equal(canela.costoAntes, 150 * 0.05 + 10);
  assert.equal(canela.costoDespues, 175 * 0.05 + 10);
  const ddl = p.find((s) => s.sabor === 'Dulce de Leche');
  assert.equal(ddl.items.find((i) => i.nombre === 'Dulce de leche').propuesta, 240); // no elegido (1 conteo)
  assert.deepEqual(cambios(p), [
    { sabor_id: 'ca', insumo_id: 'a', cantidad: 175 },
    { sabor_id: 'dl', insumo_id: 'a', cantidad: 58 },
  ]);
});

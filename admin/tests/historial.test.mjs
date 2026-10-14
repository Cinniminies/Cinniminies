// Pruebas del historial de precios de insumos. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puntos, cambio, impactoPorRoll, impactoPorCaja } from '../js/historial.js';

const compras = [
  { fecha: '2026-09-11', creado_en: '2026-09-11T10:00:00Z', total: '420', cantidad_base: '10000' },
  { fecha: '2026-05-08', creado_en: '2026-05-08T10:00:00Z', total: '159', cantidad_base: '5000' },
  { fecha: '2026-09-11', creado_en: '2026-09-11T09:00:00Z', total: '200', cantidad_base: '5000' },
  { fecha: '2026-06-01', creado_en: '2026-06-01T09:00:00Z', total: '50', cantidad_base: null },
];

test('puntos: solo compras con cantidad, en orden de fecha y de carga', () => {
  const p = puntos(compras);
  assert.deepEqual(p.map((x) => x.fecha), ['2026-05-08', '2026-09-11', '2026-09-11']);
  assert.equal(p[0].precio, 0.0318);
  assert.equal(p[1].precio, 0.04);
  assert.equal(p[2].precio, 0.042);
});

test('cambio: de la primera a la última compra', () => {
  const c = cambio(puntos(compras));
  assert.equal(Math.round(c.diferencia * 1e4) / 1e4, 0.0102);
  assert.equal(Math.round(c.relativo * 1000) / 1000, 0.321);
  assert.equal(cambio(puntos(compras.slice(0, 1))), null);
});

test('impactoPorRoll: cantidad de la receta por la diferencia, dividida por los rolls de la tanda', () => {
  const sabores = [{ id: 'c', nombre: 'Canela', rolls_por_tanda: 12, activo: true }, { id: 'n', nombre: 'Nutella', rolls_por_tanda: 10, activo: true }];
  const r = impactoPorRoll(0.01, [{ sabor_id: 'c', cantidad: 600 }, { sabor_id: 'n', cantidad: 1000 }, { sabor_id: 'x', cantidad: 5 }], sabores, { c: 25, n: null });
  assert.deepEqual(r.map((x) => x.sabor), ['Nutella', 'Canela']);
  assert.equal(r[0].porRoll, 1);
  assert.equal(r[0].relativo, null);
  assert.equal(r[1].porRoll, 0.5);
  assert.equal(r[1].relativo, 0.02);
});

test('impactoPorCaja: lo que lleva cada caja por la diferencia', () => {
  assert.deepEqual(impactoPorCaja(2, [{ caja: 'Box de 6', cantidad: 1 }, { caja: 'Box de 12', cantidad: 2 }, { caja: 'X', cantidad: 0 }]),
    [{ caja: 'Box de 12', porCaja: 4 }, { caja: 'Box de 6', porCaja: 2 }]);
});

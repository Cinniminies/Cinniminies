// Pruebas del carrito guardado de la web pública (carrito-guardado.js). Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../carrito-guardado.js';

const { armarGuardado, cajasVigentes } = globalThis.carritoGuardado;
const menu = {
  tamanos: [6, 12, 'custom'],
  sabores: ['canela', 'dulce', 'oreo'],
  topeDe: (caja) => (caja.size === 'custom' ? 12 : caja.size),
};
const ahora = new Date(2026, 10, 4, 15, 0).getTime(); // miércoles 4/11/2026

test('vence al terminar el sábado de esta semana, o el del pedido si se sabe', () => {
  const finSabado = new Date(2026, 10, 7, 23, 59, 59, 999).getTime();
  assert.equal(armarGuardado([], { ahora: new Date(ahora) }).vence, finSabado);
  assert.equal(armarGuardado([], { ahora: new Date(2026, 10, 7, 10, 0) }).vence, finSabado);
  // El domingo ya es la semana siguiente.
  const finSabadoSiguiente = new Date(2026, 10, 14, 23, 59, 59, 999).getTime();
  assert.equal(armarGuardado([], { ahora: new Date(2026, 10, 8, 10, 0) }).vence, finSabadoSiguiente);
  assert.equal(armarGuardado([], { ahora: new Date(ahora), sabado: '2026-11-14' }).vence, finSabadoSiguiente);
});

test('guarda solo tamaño y sabores, sin los nombres', () => {
  const caja = { size: 6, flavors: { canela: 6 }, _flavorNames: { canela: 'Roll de Canela' } };
  assert.deepEqual(armarGuardado([caja], { ahora: new Date(ahora) }).cajas, [{ size: 6, flavors: { canela: 6 } }]);
});

test('vuelve lo que sigue valiendo, incompleto incluido', () => {
  const cajas = [{ size: 6, flavors: { canela: 4, dulce: 2 } }, { size: 'custom', flavors: { oreo: 2 } }];
  assert.deepEqual(cajasVigentes({ vence: ahora + 1, cajas }, { ...menu, ahora }), cajas);
});

test('vencido o roto: nada', () => {
  const cajas = [{ size: 6, flavors: { canela: 6 } }];
  assert.deepEqual(cajasVigentes({ vence: ahora, cajas }, { ...menu, ahora }), []);
  assert.deepEqual(cajasVigentes({ cajas }, { ...menu, ahora }), []);
  assert.deepEqual(cajasVigentes(null, { ...menu, ahora }), []);
  assert.deepEqual(cajasVigentes({ vence: ahora + 1, cajas: 'x' }, { ...menu, ahora }), []);
});

test('descarta cajas de tamaños o sabores que ya no están, cantidades raras o que se pasan del tope', () => {
  const vigente = { size: 12, flavors: { dulce: 12 } };
  const cajas = [
    { size: 9, flavors: { canela: 9 } },
    { size: 6, flavors: { canela: 3, nutella: 3 } },
    { size: 6, flavors: { canela: 7 } },
    { size: 'custom', flavors: { canela: 13 } },
    { size: 6, flavors: { canela: 1.5 } },
    { size: 6, flavors: { canela: 0 } },
    { size: 6, flavors: {} },
    { size: 6 },
    null,
    vigente,
  ];
  assert.deepEqual(cajasVigentes({ vence: ahora + 1, cajas }, { ...menu, ahora }), [vigente]);
  assert.deepEqual(cajasVigentes({ vence: ahora + 1, cajas: [{ size: 'custom', flavors: { canela: 3 } }] },
    { ...menu, tamanos: [6, 12], ahora }), []);
});

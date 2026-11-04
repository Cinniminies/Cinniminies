// Pruebas del catálogo en memoria de /admin con Supabase falso. Correr con: node --test admin/tests/*.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { tablas, consultas, reiniciar, pasosDe } from './_supabase-falso.mjs';

register('./_cargador.mjs', import.meta.url);
const { catalogo, guardarParametros, invalidarCatalogo, clientes, origenes } = await import('../js/catalogo.js');

function cargarBase() {
  Object.assign(tablas, {
    sabores: [
      { id: 'canela', nombre: 'Canela', activo: true },
      { id: 'oreo', nombre: 'Oreo', activo: false },
    ],
    formatos: [{ id: 'box6', nombre: 'Box de 6', activo: true }, { id: 'box3', nombre: 'Box de 3', activo: false }],
    insumos: [
      { id: 'c6', nombre: 'Caja Box de 6', tipo: 'packaging', activo: true },
      { id: 'c3', nombre: 'caja Box de 3', tipo: 'packaging', activo: false },
      { id: 'pm', nombre: 'Papel manteca', tipo: 'packaging', activo: true },
      { id: 'cc', nombre: 'Cacao', tipo: 'ingrediente', activo: true },
    ],
    parametros: [{ clave: 'precio_envio', valor: '120' }, { clave: 'minutos_horno', valor: '18' }],
  });
}

beforeEach(() => {
  reiniciar();
  invalidarCatalogo();
  cargarBase();
});

test('catalogo: activos, cajas, precio del envío y búsqueda por id', async () => {
  const cat = await catalogo();
  assert.deepEqual(cat.saboresActivos.map((s) => s.id), ['canela']);
  assert.deepEqual(cat.formatosActivos.map((f) => f.id), ['box6']);
  assert.deepEqual(cat.cajas.map((c) => c.id), ['c6'], 'solo packaging activo que empieza con "caja"');
  assert.equal(cat.precioEnvio, 120);
  assert.equal(cat.parametros.minutos_horno, '18');
  assert.equal(cat.sabor('oreo').nombre, 'Oreo');
  assert.equal(cat.formato('box3').nombre, 'Box de 3');
  assert.equal(cat.insumo('cc').nombre, 'Cacao');
  assert.equal(cat.sabor('no-existe'), undefined);
  assert.deepEqual(pasosDe('sabores'), [['select', '*'], ['order', 'orden'], ['order', 'nombre']]);
});

test('catalogo: sin precio de envío cargado, el envío vale 0', async () => {
  tablas.parametros = [];
  assert.equal((await catalogo()).precioEnvio, 0);
});

test('catalogo: se lee una vez por sesión, salvo que se fuerce o se invalide', async () => {
  const primero = await catalogo();
  assert.equal(await catalogo(), primero);
  assert.equal(consultas.length, 4);
  assert.notEqual(await catalogo(true), primero);
  invalidarCatalogo();
  await catalogo();
  assert.equal(consultas.length, 12);
});

test('guardarParametros: guarda como texto y deja al día el catálogo en memoria', async () => {
  const cat = await catalogo();
  await guardarParametros({ precio_envio: 150, rolls_por_tanda: 12 });
  assert.deepEqual(pasosDe('parametros'),
    [['upsert', [{ clave: 'precio_envio', valor: '150' }, { clave: 'rolls_por_tanda', valor: '12' }]]]);
  assert.equal(cat.parametros.precio_envio, '150');
  assert.equal(cat.parametros.rolls_por_tanda, '12');
});

test('guardarParametros: sin catálogo cargado solo guarda', async () => {
  await guardarParametros({ precio_envio: 150 });
  assert.equal(consultas.length, 1);
});

test('clientes: los que más compraron primero', async () => {
  tablas.v_clientes = [{ nombre: 'Ana' }];
  assert.deepEqual(await clientes(), [{ nombre: 'Ana' }]);
  assert.deepEqual(pasosDe('v_clientes'), [['select', '*'], ['order', 'compras', { ascending: false }], ['order', 'nombre']]);
});

test('origenes: sin repetir y en orden alfabético con acentos', async () => {
  tablas.clientes = [{ origen: 'Instagram' }, { origen: 'Ámbito laboral' }, { origen: 'Feria' }, { origen: 'Instagram' }];
  assert.deepEqual(await origenes(), ['Ámbito laboral', 'Feria', 'Instagram']);
  assert.deepEqual(pasosDe('clientes'), [['select', 'origen'], ['not', 'origen', 'is', null]]);
});

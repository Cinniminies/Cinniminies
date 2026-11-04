// Pruebas de db.js (q, rpc, contar) y textos.js con Supabase falso. Correr con: node --test admin/tests/*.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { tablas, errores, reiniciar, pasosDe } from './_supabase-falso.mjs';

register('./_cargador.mjs', import.meta.url);
const { sb, q, rpc, contar } = await import('../js/db.js');
const { cargarTextosPanel, textoPanel } = await import('../js/textos.js');

beforeEach(reiniciar);

test('q: devuelve los datos o tira el mensaje de la base', async () => {
  tablas.sabores = [{ id: 'canela' }];
  assert.deepEqual(await q(sb.from('sabores').select('*')), [{ id: 'canela' }]);
  errores.sabores = { message: 'No hay stock de Nutella para esa tanda' };
  await assert.rejects(q(sb.from('sabores').select('*')), { message: 'No hay stock de Nutella para esa tanda' });
  errores.sabores = {};
  await assert.rejects(q(sb.from('sabores').select('*')), { message: 'Error de conexión' });
});

test('rpc: llama a la función con sus argumentos', async () => {
  tablas['rpc:cierre_mes'] = { vendido: 6790 };
  assert.deepEqual(await rpc('cierre_mes', { p_mes: '2026-10-01' }), { vendido: 6790 });
  assert.deepEqual(pasosDe('rpc:cierre_mes'), [['rpc', { p_mes: '2026-10-01' }]]);
});

test('contar: cuenta sin traer las filas y con el filtro que se pase', async () => {
  tablas.tandas = [{}, {}, {}];
  assert.equal(await contar('tandas', (c) => c.eq('sabor_id', 'canela')), 3);
  assert.deepEqual(pasosDe('tandas'), [['select', '*', { count: 'exact', head: true }], ['eq', 'sabor_id', 'canela']]);
  assert.equal(await contar('ventas'), 0);
  errores.ventas = { message: 'permiso denegado' };
  await assert.rejects(contar('ventas'), /permiso denegado/);
});

test('textoPanel: el texto por defecto con sus variables, hasta que se cargan los de la base', async () => {
  assert.equal(textoPanel('panel.semana', 'Semana del sábado {fecha}', { fecha: '31/10' }), 'Semana del sábado 31/10');
  assert.equal(textoPanel('panel.libro_salio', 'Salió {monto}'), 'Salió ', 'una variable que no viene queda vacía');
  tablas.contenido_web = [{ clave: 'panel.semana', valor: 'Sábado {fecha}' }, { clave: 'panel.vacio', valor: '' }];
  await cargarTextosPanel();
  assert.deepEqual(pasosDe('contenido_web'), [['select', 'clave,valor'], ['like', 'clave', 'panel.%']]);
  assert.equal(textoPanel('panel.semana', 'Semana del sábado {fecha}', { fecha: '31/10' }), 'Sábado 31/10');
  assert.equal(textoPanel('panel.vacio', 'Por defecto'), 'Por defecto', 'un texto vacío en la base usa el de siempre');
});

test('cargarTextosPanel: si la base falla, quedan los textos que había', async () => {
  errores.contenido_web = { message: 'relation "contenido_web" does not exist' };
  await cargarTextosPanel();
  assert.equal(textoPanel('panel.otro', 'Hola {nombre}', { nombre: 'Ana' }), 'Hola Ana');
});

// Pruebas del descuento por recomendación en /admin, con Supabase falso. Correr con: node --test admin/tests/*.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { tablas, consultas, reiniciar, pasosDe } from './_supabase-falso.mjs';

register('./_cargador.mjs', import.meta.url);
const { campanaVigente, bonoDe, codigoDe, diaMes, mensajeCodigo, linkCodigo } = await import('../js/recomendacion.js');

const campana = { porcentaje: '7.50', tope: '30.00' };
const bono = { porcentaje: '5.00', hasta: '2027-01-19' };

beforeEach(reiniciar);

test('diaMes: día y mes sin ceros', () => {
  assert.equal(diaMes('2027-01-19'), '19/1');
  assert.equal(diaMes('2026-10-05'), '5/10');
});

test('mensajeCodigo: el texto de siempre con el primer nombre, el código y la campaña', () => {
  const texto = mensajeCodigo('  Ana María Pérez ', 'ANAK7P', campana);
  assert.match(texto, /^¡Hola Ana! Gracias por tu compra en Cinniminies\. Este es tu código: ANAK7P/);
  assert.match(texto, /te suma 7,5 % de descuento .* \(hasta 30 % por mes\)/);
  assert.doesNotMatch(texto, /\{\w+\}/, 'no quedan variables sin reemplazar');
  assert.doesNotMatch(texto, /Box de 12 ya tenés/, 'sin bono no se agrega el párrafo');
});

test('mensajeCodigo: sin campaña cargada usa 5 % y tope 30 %; sin nombre, "¡Hola!"', () => {
  const texto = mensajeCodigo('', 'ANAK7P', null);
  assert.match(texto, /^¡Hola! Gracias/);
  assert.match(texto, /te suma 5 % .* \(hasta 30 % por mes\)/);
  assert.match(mensajeCodigo(null, 'X', null), /^¡Hola! /);
});

test('mensajeCodigo: con el bono de la Box de 12 agrega cuánto es y hasta cuándo', () => {
  const texto = mensajeCodigo('Ana', 'ANAK7P', campana, bono);
  assert.match(texto, /\n\nY por tu primera Box de 12 ya tenés 5 % de descuento para tus próximos pedidos, hasta el 19\/1\.$/);
});

test('mensajeCodigo: los textos editables de la campaña ganan, y una variable desconocida queda como está', () => {
  const editable = {
    ...campana, mensaje: ' {nombre}: tu código es {codigo} ({porcentaje} %, {otra}) ', mensaje_bono: 'Bono {bono} % al {vence}',
  };
  assert.equal(mensajeCodigo('Ana', 'ANAK7P', editable), 'Ana: tu código es ANAK7P (7,5 %, {otra})');
  assert.equal(mensajeCodigo('Ana', 'ANAK7P', editable, bono), 'Ana: tu código es ANAK7P (7,5 %, {otra})\n\nBono 5 % al 19/1');
  assert.match(mensajeCodigo('Ana', 'X', { ...campana, mensaje: '   ' }), /^¡Hola Ana!/, 'un texto en blanco usa el de siempre');
});

test('linkCodigo: WhatsApp con el mensaje, solo para celulares uruguayos', () => {
  const link = linkCodigo('099 123 456', 'Ana', 'ANAK7P', campana);
  assert.ok(link.startsWith('https://wa.me/59899123456?text='));
  assert.equal(decodeURIComponent(link.split('?text=')[1]), mensajeCodigo('Ana', 'ANAK7P', campana));
  assert.equal(linkCodigo('@ana.cinnamon', 'Ana', 'ANAK7P', campana), null);
});

test('campanaVigente: la de hoy, con los dos textos editables', async () => {
  tablas.campanas_recomendacion = [{ id: 1, porcentaje: 5, tope: 30 }];
  tablas.contenido_web = [{ clave: 'recomendacion.mensaje', valor: 'Hola {nombre}' }];
  const c = await campanaVigente();
  assert.deepEqual(c, { id: 1, porcentaje: 5, tope: 30, mensaje: 'Hola {nombre}', mensaje_bono: null });
  const pasos = pasosDe('campanas_recomendacion');
  assert.deepEqual(pasos.map(([metodo]) => metodo), ['select', 'lte', 'gte', 'order', 'limit']);
  assert.equal(pasos[1][2], pasos[2][2], 'desde y hasta se comparan contra el mismo día');
  assert.match(pasos[1][2], /^\d{4}-\d{2}-\d{2}$/);
});

test('campanaVigente: sin campaña hoy, null', async () => {
  assert.equal(await campanaVigente(), null);
});

test('bonoDe y codigoDe: sin cliente no consultan; con cliente filtran por él', async () => {
  assert.equal(await bonoDe(null), null);
  assert.equal(await codigoDe(undefined), null);
  assert.equal(consultas.length, 0);

  assert.equal(await bonoDe('c1'), null);
  tablas.bonos_recomendacion = [bono];
  assert.equal(await bonoDe('c1'), bono);
  assert.deepEqual(pasosDe('bonos_recomendacion')[1], ['eq', 'cliente_id', 'c1']);

  assert.equal(await codigoDe('c1'), null);
  tablas.codigos_recomendacion = [{ codigo: 'ANAK7P' }];
  assert.equal(await codigoDe('c1'), 'ANAK7P');
});

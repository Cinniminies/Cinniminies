// Pruebas de /api/visita (idea 6.2): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { esBot, armarVisita } = require('../_lib/visitas.js');

const valida = { sesion: 'abc123def456', tipo: 'visita', origen: 'instagram', dispositivo: 'celular' };

test('armarVisita: deja solo los cuatro campos y descarta lo que no es texto corto', () => {
  assert.deepEqual(armarVisita({ ...valida, extra: 'x' }), valida);
  assert.equal(armarVisita({ ...valida, tipo: 3 }), null);
  assert.equal(armarVisita({ ...valida, origen: 'x'.repeat(40) }), null);
  assert.equal(armarVisita({ sesion: valida.sesion }), null);
  assert.equal(armarVisita(null), null);
});

test('esBot: buscadores, vistas previas y navegadores sin nombre', () => {
  assert.ok(esBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(esBot('facebookexternalhit/1.1'));
  assert.ok(esBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(esBot(''));
  assert.ok(!esBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300'));
});

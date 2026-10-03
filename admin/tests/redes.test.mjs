// Pruebas del análisis de Instagram. Correr con: node --test admin/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoDe, puntaje, interaccion, tendencia, sugerencias, resumenTexto, MINIMO } from '../js/redes.js';

// Hora de Montevideo (UTC−3) → ISO en UTC.
const uy = (fecha, hora) => new Date(`${fecha}T${String(hora).padStart(2, '0')}:00:00-03:00`).toISOString();
const pub = (o) => ({ tipo: 'IMAGE', producto: 'FEED', texto: '', alcance: 100, me_gusta: 10, comentarios: 1, guardados: 0, compartidos: 0, ...o });

test('tipoDe', () => {
  assert.equal(tipoDe({ tipo: 'VIDEO', producto: 'REELS' }), 'Reel');
  assert.equal(tipoDe({ tipo: 'CAROUSEL_ALBUM', producto: 'FEED' }), 'Carrusel');
  assert.equal(tipoDe({ tipo: 'IMAGE', producto: 'FEED' }), 'Foto');
});

test('puntaje: vistas, si no alcance', () => {
  assert.equal(puntaje({ vistas: 5, alcance: 3 }), 5);
  assert.equal(puntaje({ vistas: null, alcance: 3 }), 3);
  assert.equal(puntaje({}), null);
});

test('interaccion', () => {
  assert.equal(interaccion({ alcance: 200, me_gusta: 10, comentarios: 2, guardados: 6, compartidos: 2 }), 0.1);
  assert.equal(interaccion({ alcance: 0 }), null);
});

test('tendencia: cambio contra hace 7 y 30 días', () => {
  const t = tendencia([
    { fecha: '2026-09-01', seguidores: 700 }, { fecha: '2026-09-26', seguidores: 790 }, { fecha: '2026-10-03', seguidores: 812 },
  ]);
  assert.deepEqual(t, { seguidores: 812, fecha: '2026-10-03', semana: 22, mes: 112 });
  assert.equal(tendencia([{ fecha: '2026-10-03', seguidores: 5 }]).semana, null);
  assert.equal(tendencia([]), null);
});

test('pocas publicaciones: pide más datos', () => {
  const s = sugerencias([pub({ publicada_en: uy('2026-10-02', 20), vistas: 10 })], { ahora: new Date('2026-10-03T12:00:00Z') });
  assert.equal(s.length, 1);
  assert.equal(s[0].tipo, 'datos');
  assert.match(s[0].texto, new RegExp(`a partir de ${MINIMO}`));
});

test('sin publicar hace días', () => {
  const s = sugerencias([pub({ publicada_en: uy('2026-09-20', 20), vistas: 10 })], { ahora: new Date('2026-10-03T12:00:00Z') });
  assert.ok(s.some((x) => x.tipo === 'frecuencia' && /12 días/.test(x.texto)));
});

test('reels de noche con Oreo rinden más', () => {
  const pubs = [
    // Reels, jueves 20 h, con Oreo: muchas vistas
    pub({ publicada_en: uy('2026-10-01', 20), producto: 'REELS', tipo: 'VIDEO', texto: 'Llegaron los rolls de OREO', vistas: 1000, alcance: 800, guardados: 40, compartidos: 10, enlace: 'https://ig/a' }),
    pub({ publicada_en: uy('2026-09-24', 21), producto: 'REELS', tipo: 'VIDEO', texto: 'Oreo otra vez', vistas: 900, alcance: 700 }),
    pub({ publicada_en: uy('2026-09-17', 19), producto: 'REELS', tipo: 'VIDEO', texto: 'Oreo y Canela', vistas: 800, alcance: 600 }),
    // Fotos, lunes 10 h: pocas vistas
    pub({ publicada_en: uy('2026-09-28', 10), texto: 'Canela', vistas: 200 }),
    pub({ publicada_en: uy('2026-09-21', 10), texto: 'Dulce de leche', vistas: 150 }),
    pub({ publicada_en: uy('2026-09-14', 11), texto: 'Canela', vistas: 180 }),
  ];
  const s = sugerencias(pubs, { sabores: [{ nombre: 'Oreo', nombre_corto: 'Oreo' }, { nombre: 'Canela' }], ahora: new Date('2026-10-03T12:00:00Z') });
  const tipos = s.map((x) => x.tipo);
  assert.ok(tipos.includes('formato'));
  assert.match(s.find((x) => x.tipo === 'formato').texto, /^Los reels tienen 5 veces las vistas de las fotos: conviene hacer más reels/);
  assert.match(s.find((x) => x.tipo === 'dia').texto, /jueves/);
  assert.match(s.find((x) => x.tipo === 'horario').texto, /a la noche/);
  assert.match(s.find((x) => x.tipo === 'sabor').texto, /^Cuando aparece Oreo/);
  assert.ok(!s.some((x) => x.tipo === 'sabor' && /Canela/.test(x.texto)), 'Canela no rinde más');
  assert.equal(s.find((x) => x.tipo === 'guardados').enlace, 'https://ig/a');
  assert.ok(!tipos.includes('frecuencia'));
});

test('una publicación excepcional no cambia la conclusión (mediana, mínimo 3 por grupo)', () => {
  const pubs = [
    pub({ publicada_en: uy('2026-09-14', 12), tipo: 'CAROUSEL_ALBUM', vistas: 1200 }),
    pub({ publicada_en: uy('2026-08-30', 12), tipo: 'CAROUSEL_ALBUM', vistas: 1100 }),
    pub({ publicada_en: uy('2026-08-08', 12), tipo: 'CAROUSEL_ALBUM', vistas: 1700 }),
    pub({ publicada_en: uy('2026-09-12', 12), producto: 'REELS', tipo: 'VIDEO', vistas: 800 }),
    pub({ publicada_en: uy('2026-07-26', 12), producto: 'REELS', tipo: 'VIDEO', vistas: 750 }),
    pub({ publicada_en: uy('2026-07-03', 12), producto: 'REELS', tipo: 'VIDEO', vistas: 700 }),
    // Solo dos fotos, una de ellas un sorteo con muchas vistas: no alcanza para opinar de las fotos
    pub({ publicada_en: uy('2026-06-03', 12), vistas: 3149 }),
    pub({ publicada_en: uy('2026-05-30', 12), vistas: 1181 }),
  ];
  const f = sugerencias(pubs, { ahora: new Date('2026-09-15T12:00:00Z') }).find((x) => x.tipo === 'formato');
  assert.match(f.texto, /^Los carruseles tienen 1,6 veces las vistas de los reels/);
});

test('resumenTexto', () => {
  assert.equal(resumenTexto(null), 'sin texto');
  assert.equal(resumenTexto('hola   mundo'), 'hola mundo');
  assert.equal(resumenTexto('a'.repeat(80), 10), 'aaaaaaaaa…');
});

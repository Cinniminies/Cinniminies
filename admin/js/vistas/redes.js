import { sb, q } from '../db.js';
import { h, vaciar, numero, fechaCorta, plural } from '../util.js';
import { columnas, barras } from '../graficos.js';
import { catalogo } from '../catalogo.js';
import { tipoDe, puntaje, interaccion, tendencia, sugerencias, resumenTexto } from '../redes.js';

// Redes: Instagram leído por la API una vez por día (api/instagram.js). Seguidores, vistas,
// mejores publicaciones y sugerencias. Los números de cada publicación son los de la última lectura.
export async function mostrar(cont) {
  const [cat, [estado], dias, pubs] = await Promise.all([
    catalogo(),
    q(sb.from('ig_config').select('usuario,ultima_lectura,ultimo_error')),
    q(sb.from('ig_cuenta_dia').select('*').order('fecha', { ascending: false }).limit(90)),
    q(sb.from('ig_publicaciones').select('*').order('publicada_en', { ascending: false }).limit(60)),
  ]);

  if (!estado) {
    vaciar(cont, h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Instagram todavía no está conectado'),
      h('p', {}, 'Hace falta un token de la API de Instagram en Vercel (variable INSTAGRAM_TOKEN). '
        + 'Con eso, todos los días a las 7 se leen seguidores, vistas y los números de cada publicación.'),
      h('p', { class: 'ayuda' }, 'Los pasos están en docs/instagram.md.')));
    return;
  }

  const t = tendencia(dias);
  const desde30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const ultimas30 = pubs.filter((p) => p.publicada_en >= desde30);
  const vistas30 = ultimas30.reduce((a, p) => a + (puntaje(p) || 0), 0);
  const tasas = ultimas30.map(interaccion).filter((x) => x != null);
  const signo = (n) => (n > 0 ? `+${numero(n, 0)}` : numero(n, 0));
  const kpi = (etiqueta, valor, sub) => h('div', { class: 'stat' },
    h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor), sub ? h('div', { class: 'sub' }, sub) : null);

  const cronologia = [...dias].reverse().slice(-30);
  const grafSeguidores = cronologia.length >= 2 ? columnas(cronologia.map((d, i) => ({
    etiqueta: i % 5 === 0 || i === cronologia.length - 1 ? fechaCorta(d.fecha).split(' ')[1] : '',
    etiquetaLarga: fechaCorta(d.fecha),
    valor: d.seguidores,
    destacado: i === cronologia.length - 1,
    filas: [['Publicaciones', numero(d.publicaciones, 0)], ...(d.alcance != null ? [['Alcance del día', numero(d.alcance, 0)]] : [])],
  })), {
    titulo: 'Seguidores por día',
    formato: (v) => numero(v, 0),
    columnasTabla: [['Día', (d) => d.etiquetaLarga], ['Seguidores', (d) => numero(d.valor, 0)]],
  }) : h('p', { class: 'ayuda' }, 'El gráfico de seguidores aparece cuando haya lecturas de al menos dos días.');

  const porTipo = {};
  for (const p of ultimas30) if (puntaje(p) != null) porTipo[tipoDe(p)] = [...(porTipo[tipoDe(p)] || []), puntaje(p)];

  const mejores = [...pubs].filter((p) => puntaje(p) != null).sort((a, b) => puntaje(b) - puntaje(a)).slice(0, 5);
  const tarjeta = (p) => h('li', {}, h('a', { class: 'fila', href: p.enlace || '#', target: '_blank', rel: 'noopener' },
    p.imagen ? h('img', { src: p.imagen, alt: '', loading: 'lazy', width: 48, height: 48,
      style: 'width:48px;height:48px;object-fit:cover;border-radius:8px;flex:none', onerror: (e) => e.target.remove() }) : null,
    h('div', { class: 'princ' },
      h('div', { class: 't1' }, resumenTexto(p.texto, 48)),
      h('div', { class: 't2' }, [tipoDe(p), fechaCorta(p.publicada_en.slice(0, 10)),
        `${numero(p.me_gusta || 0, 0)} me gusta`, p.guardados ? `${numero(p.guardados, 0)} guardados` : null].filter(Boolean).join(' · '))),
    h('div', { class: 'num-der' }, h('strong', {}, numero(puntaje(p), 0)), h('div', { class: 'sub ayuda' }, p.vistas != null ? 'vistas' : 'alcance'))));

  vaciar(cont,
    estado.ultimo_error ? h('p', { class: 'mensaje-error' }, `La última lectura falló: ${estado.ultimo_error}`) : null,
    h('p', { class: 'ayuda' }, `@${estado.usuario || '…'} · `, estado.ultima_lectura
      ? `actualizado ${new Date(estado.ultima_lectura).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'sin lecturas todavía', ' · se actualiza solo todos los días'),
    t ? h('div', { class: 'stats' },
      kpi('Seguidores', numero(t.seguidores, 0),
        [t.semana != null ? `${signo(t.semana)} en 7 días` : null, t.mes != null ? `${signo(t.mes)} en 30 días` : null]
          .filter(Boolean).join(' · ') || 'el cambio aparece desde mañana'),
      kpi('Vistas', numero(vistas30, 0), `${plural(ultimas30.length, 'publicación', 'publicaciones')} de los últimos 30 días`),
      kpi('Interacción', tasas.length ? `${numero((100 * tasas.reduce((a, x) => a + x, 0)) / tasas.length, 1)} %` : '—',
        'reacciones sobre el alcance'),
      kpi('Por publicación', ultimas30.length ? numero(vistas30 / ultimas30.length, 0) : '—', 'vistas en promedio')) : null,

    h('h2', {}, 'Sugerencias'),
    h('ul', { class: 'lista card' }, sugerencias(pubs, { sabores: cat.saboresActivos }).map((s) => h('li', {},
      h('div', { class: 'fila' }, h('div', { class: 'princ' }, h('div', { class: 't1', style: 'white-space:normal;font-weight:500' }, s.texto),
        s.enlace ? h('a', { class: 't2', href: s.enlace, target: '_blank', rel: 'noopener' }, 'Ver en Instagram') : null))))),

    h('div', { class: 'card' }, grafSeguidores),
    Object.keys(porTipo).length ? h('div', { class: 'card' }, barras(
      Object.entries(porTipo).map(([etiqueta, xs]) => ({ etiqueta, valor: Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) })),
      { titulo: 'Vistas promedio por formato (últimos 30 días)', formato: (v) => numero(v, 0), vacio: '' })) : null,

    h('h2', {}, 'Mejores publicaciones'),
    mejores.length ? h('ul', { class: 'lista card' }, mejores.map(tarjeta)) : h('p', { class: 'vacio' }, 'Todavía no hay publicaciones con números.'),
    h('h2', {}, 'Últimas publicaciones'),
    pubs.length ? h('ul', { class: 'lista card' }, pubs.slice(0, 12).map(tarjeta)) : h('p', { class: 'vacio' }, 'Todavía no hay publicaciones.'));
}

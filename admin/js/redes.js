// Análisis de Instagram para /admin → Redes (funciones puras, con pruebas en tests/redes.test.mjs).
// Las publicaciones vienen de ig_publicaciones; la cuenta por día, de ig_cuenta_dia.
import { normalizar } from './util.js';

const ZONA = 'America/Montevideo';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FRANJAS = [[0, 6, 'de madrugada'], [6, 12, 'a la mañana'], [12, 18, 'a la tarde'], [18, 24, 'a la noche']];
const PLURAL = { Reel: 'Los reels', Carrusel: 'Los carruseles', Video: 'Los videos', Foto: 'Las fotos' };
export const MINIMO = 6; // publicaciones con números para animarse a sugerir

export function tipoDe(p) {
  if (p.producto === 'REELS') return 'Reel';
  if (p.tipo === 'CAROUSEL_ALBUM') return 'Carrusel';
  if (p.tipo === 'VIDEO') return 'Video';
  return 'Foto';
}

// Lo que se compara: las vistas (o el alcance si la API no dio vistas).
export const puntaje = (p) => (p.vistas ?? p.alcance ?? null);

// Interacción sobre el alcance: (me gusta + comentarios + guardados + compartidos) / alcance.
export function interaccion(p) {
  if (!p.alcance) return null;
  return ((p.me_gusta || 0) + (p.comentarios || 0) + (p.guardados || 0) + (p.compartidos || 0)) / p.alcance;
}

function horaLocal(iso) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.find((x) => x.type === 'weekday').value);
  return { dia, hora: Number(partes.find((x) => x.type === 'hour').value) };
}

const promedio = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;

// Agrupa por clave y devuelve [{ clave, n, prom }] de los grupos con al menos `min` publicaciones.
function grupos(pubs, clave, min = 2) {
  const m = new Map();
  for (const p of pubs) {
    const k = clave(p);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(puntaje(p));
  }
  return [...m].filter(([, xs]) => xs.length >= min).map(([k, xs]) => ({ clave: k, n: xs.length, prom: promedio(xs) }))
    .sort((a, b) => b.prom - a.prom);
}

const veces = (x) => x.toLocaleString('es-UY', { maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)} %`;

// Seguidores hoy y cambio contra hace 7 y 30 días (el día más cercano que haya).
export function tendencia(dias) {
  const orden = [...dias].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = orden[orden.length - 1];
  if (!ultimo) return null;
  const hace = (n) => {
    const limite = new Date(`${ultimo.fecha}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() - n);
    const l = limite.toISOString().slice(0, 10);
    const previo = orden.filter((d) => d.fecha <= l).pop();
    return previo ? ultimo.seguidores - previo.seguidores : null;
  };
  return { seguidores: ultimo.seguidores, fecha: ultimo.fecha, semana: hace(7), mes: hace(30) };
}

// Sugerencias en castellano a partir de las publicaciones. sabores: [{ nombre, nombre_corto }].
export function sugerencias(publicaciones, { sabores = [], ahora = new Date() } = {}) {
  const pubs = publicaciones.filter((p) => puntaje(p) != null);
  const out = [];
  const ordenadas = [...publicaciones].sort((a, b) => b.publicada_en.localeCompare(a.publicada_en));
  const ultima = ordenadas[0];
  if (ultima) {
    const dias = Math.floor((ahora - new Date(ultima.publicada_en)) / 86400e3);
    if (dias >= 5) out.push({ tipo: 'frecuencia', texto: `Hace ${dias} días que no publican: la cuenta crece con constancia.` });
  }
  if (pubs.length < MINIMO) {
    out.push({ tipo: 'datos', texto: `Con ${pubs.length} publicaciones con números todavía no alcanza para comparar; las sugerencias aparecen a partir de ${MINIMO}.` });
    return out;
  }
  const general = promedio(pubs.map(puntaje));

  const porTipo = grupos(pubs, tipoDe);
  if (porTipo.length >= 2 && porTipo[0].prom >= 1.3 * porTipo[porTipo.length - 1].prom) {
    const a = porTipo[0];
    const z = porTipo[porTipo.length - 1];
    out.push({ tipo: 'formato', texto: `${PLURAL[a.clave]} tienen ${veces(a.prom / z.prom)} veces las vistas de ${PLURAL[z.clave].toLowerCase()}: conviene hacer más ${PLURAL[a.clave].slice(4).toLowerCase()}.` });
  }

  const porDia = grupos(pubs, (p) => horaLocal(p.publicada_en).dia);
  if (porDia.length >= 2 && porDia[0].prom >= 1.2 * general) {
    out.push({ tipo: 'dia', texto: `Lo que publican los ${DIAS[porDia[0].clave]} rinde ${pct(porDia[0].prom / general - 1)} más que el promedio.` });
  }

  const porFranja = grupos(pubs, (p) => {
    const { hora } = horaLocal(p.publicada_en);
    return FRANJAS.find(([d, hs]) => hora >= d && hora < hs)[2];
  });
  if (porFranja.length >= 2 && porFranja[0].prom >= 1.2 * general) {
    out.push({ tipo: 'horario', texto: `Publicar ${porFranja[0].clave} da ${pct(porFranja[0].prom / general - 1)} más vistas que el promedio.` });
  }

  for (const s of sabores) {
    const nombres = [...new Set([s.nombre, s.nombre_corto].filter(Boolean).map(normalizar))];
    const con = pubs.filter((p) => nombres.some((n) => normalizar(p.texto).includes(n)));
    if (con.length < 2 || con.length === pubs.length) continue;
    const resto = promedio(pubs.filter((p) => !con.includes(p)).map(puntaje));
    const prom = promedio(con.map(puntaje));
    if (prom >= 1.2 * resto) {
      out.push({ tipo: 'sabor', texto: `Cuando aparece ${s.nombre}, las publicaciones tienen ${pct(prom / resto - 1)} más vistas: muéstrenlo más.` });
    }
  }

  const guardadas = pubs.filter((p) => p.alcance >= 50 && (p.guardados || 0) + (p.compartidos || 0) > 0)
    .map((p) => ({ p, tasa: ((p.guardados || 0) + (p.compartidos || 0)) / p.alcance }))
    .sort((a, b) => b.tasa - a.tasa);
  if (guardadas.length) {
    const { p } = guardadas[0];
    out.push({ tipo: 'guardados', texto: `La que más se guardó y compartió: "${resumenTexto(p.texto)}". Repetir ese tipo de contenido trae seguidores nuevos.`, enlace: p.enlace });
  }

  if (!out.length) out.push({ tipo: 'parejo', texto: 'Todas las publicaciones rinden parecido: no hay un formato, día u horario que se destaque todavía.' });
  return out;
}

export function resumenTexto(texto, largo = 60) {
  const t = (texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'sin texto';
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
}

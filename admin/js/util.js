import { ZONA_HORARIA } from './config.js';
import './cifras.js';

// ---------------------------------------------------------------- DOM

// h('button', { class: 'btn', onclick }, 'Guardar'). Los hijos de texto se insertan como texto
// (nunca como HTML), así que los datos de clientes no pueden inyectar nada.
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  let valor;
  if (tag === 'input' && attrs?.type === 'number' && attrs.inputmode === 'decimal') {
    // En el celular con teclado en español, un type="number" no acepta "80,76" (queda vacío).
    // Va como texto y la coma se pasa a punto antes de que lo lean los oninput.
    attrs = { ...attrs, type: 'text', autocomplete: 'off' };
    el.addEventListener('input', () => {
      if (!el.value.includes(',')) return;
      const pos = el.selectionStart;
      el.value = el.value.replaceAll(',', '.');
      el.setSelectionRange(pos, pos);
    });
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'value') valor = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (typeof v === 'boolean') el.toggleAttribute(k, v);
    else el.setAttribute(k, v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  if (valor !== undefined) el.value = valor; // después de las opciones de un <select>
  return el;
}

export function vaciar(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

// ---------------------------------------------------------------- formatos

// Para buscar sin importar mayúsculas ni acentos: 'Báez' → 'baez'.
export const normalizar = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// $1.234,50 (sin decimales si es un número entero: $250)
export const { pesos } = globalThis.cifras;

// "1 venta", "3 ventas" (plural regular por defecto).
export const plural = (n, uno, varios = `${uno}s`) => `${numero(n, 0)} ${Number(n) === 1 ? uno : varios}`;

export function numero(n, decimales = 2) {
  if (n == null || n === '') return '—';
  // Se redondea antes de formatear: -0,001 da "0" y no "-0".
  return (Number(Number(n).toFixed(decimales)) || 0).toLocaleString('es-UY', { maximumFractionDigits: decimales });
}

// Cantidad en unidad base con una unidad legible: 5000 g → "5 kg", 250 ml → "250 ml", 12 un → "12 un".
export function cantidad(n, unidad) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (unidad === 'g' && Math.abs(v) >= 1000) return `${numero(v / 1000)} kg`;
  if (unidad === 'ml' && Math.abs(v) >= 1000) return `${numero(v / 1000)} L`;
  if (unidad === 'cm' && Math.abs(v) >= 100) return `${numero(v / 100)} m`;
  return `${numero(v)} ${unidad}`;
}

export function hoyISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());
}

// De una lista de precios [{ precio, vigente_desde }], el que rige hoy (o null).
export function precioVigenteDe(filas) {
  const hoy = hoyISO();
  const vigentes = filas.filter((f) => f.vigente_desde <= hoy).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
  return vigentes.length ? vigentes[0].precio : null;
}

// Fecha ISO `n` días después (antes, con n negativo): sumarDias('2026-10-31', 1) → '2026-11-01'.
export function sumarDias(iso, n) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Día de la semana de una fecha ISO: 0 el domingo … 6 el sábado.
export const diaDeLaSemana = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();

// El sábado que viene (hoy, si es sábado): los días de horneado.
export function proximoSabado(desde = hoyISO()) {
  return sumarDias(desde, (6 - diaDeLaSemana(desde) + 7) % 7);
}

export function mesISO(fecha = hoyISO()) {
  return fecha.slice(0, 7) + '-01';
}

// Primer día del mes `n` meses después de `mes` (antes, con n negativo): sumarMeses('2026-01-01', -1) → '2025-12-01'.
export function sumarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

// Suma de un valor de cada elemento: sumar(ventas, (v) => v.total). Lo que no es número cuenta 0.
export const sumar = (lista, valorDe = (x) => x) => lista.reduce((total, x) => total + (Number(valorDe(x)) || 0), 0);

export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS = DIAS_SEMANA.map((d) => d.slice(0, 3));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

function partes(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { a, m, d, dia: DIAS[diaDeLaSemana(iso)] };
}

// "12/09"
export function diaMes(iso) {
  if (!iso) return '';
  const { m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// "sáb 12/09"
export function fechaCorta(iso) {
  if (!iso) return '';
  return `${partes(iso).dia} ${diaMes(iso)}`;
}

// "12/09/2026"
export function fechaLarga(iso) {
  if (!iso) return '';
  return `${diaMes(iso)}/${partes(iso).a}`;
}

// "septiembre 2026"
export function nombreMes(iso) {
  const { a, m } = partes(iso);
  return `${MESES[m - 1]} ${a}`;
}

// "septiembre" (sin el año: para comparar contra el mes anterior)
export const soloMes = (iso) => MESES[partes(iso).m - 1];

export const ETIQUETAS = {
  entrega: { retiro: 'Retiro', envio: 'Envío', sin_envio: 'Sin envío' },
  medio_pago: { efectivo: 'Efectivo', transferencia: 'Transferencia' },
  estado_pago: { pagado: 'Pagado', pendiente: 'Pendiente' },
  tipo: { venta: 'Venta', consumo_propio: 'Consumo propio', regalo: 'Regalo' },
  gasto: {
    merma: 'Merma', tanda_descartada: 'Tanda descartada', gasto_operativo: 'Gasto', mejora: 'Mejoras del negocio',
    comision: 'Comisión', retiro_socios: 'Retiro socios', ajuste_caja: 'Ajuste de caja', otro: 'Otro',
  },
  ingreso: { aporte_socios: 'Aporte socios', otro: 'Otro ingreso' },
};

export const opciones = (mapa) => Object.entries(mapa).map(([valor, texto]) => ({ valor, texto }));

// Link de WhatsApp si el contacto parece un celular uruguayo (09x xxx xxx), con el `texto` ya escrito si viene.
export function linkWhatsapp(contacto, { texto } = {}) {
  const digitos = (contacto || '').replace(/\D/g, '');
  const m = digitos.match(/^(?:598)?0?(9\d{7})$/);
  return m ? `https://wa.me/598${m[1]}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null;
}

// Link de WhatsApp sin destinatario: el que lo abre elige el chat (el suyo propio, el del socio…).
export const compartirWhatsapp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

// ---------------------------------------------------------------- componentes

// Chips de una sola opción. `desmarcable`: tocar la elegida la deselecciona.
export function chips(lista, valor, alCambiar, { desmarcable = false } = {}) {
  // Pocas opciones fijas (Retiro / Envío, Este mes / Mes pasado…): selector segmentado, en una sola pieza.
  const segmentado = !desmarcable && lista.length <= 3;
  const cont = h('div', { class: segmentado ? 'chips segmentado' : 'chips', role: 'group' });
  const dibujar = () => {
    for (const b of cont.children) b.setAttribute('aria-pressed', String(b.dataset.valor === String(valor)));
  };
  for (const o of lista) {
    cont.append(h('button', {
      type: 'button', class: 'chip', 'data-valor': String(o.valor),
      onclick: () => {
        valor = desmarcable && String(valor) === String(o.valor) ? null : o.valor;
        dibujar();
        alCambiar(valor);
      },
    }, o.texto));
  }
  dibujar();
  return cont;
}

// `paso`: cuánto suma o resta cada toque. `formato`: cómo se muestra el valor (por ejemplo, con coma decimal).
export function stepper(valor, alCambiar, { min = 0, max = Infinity, paso = 1, formato = String } = {}) {
  const salida = h('output', {}, formato(valor));
  const menos = h('button', { type: 'button', 'aria-label': 'Restar' }, '−');
  const mas = h('button', { type: 'button', 'aria-label': 'Sumar' }, '+');
  const cambiar = (nuevo) => {
    valor = Math.min(max, Math.max(min, nuevo));
    const anterior = salida.textContent;
    salida.textContent = formato(valor);
    rodarNumero(salida, anterior);
    menos.disabled = valor <= min;
    mas.disabled = valor >= max;
    alCambiar(valor);
  };
  menos.onclick = () => cambiar(valor - paso);
  mas.onclick = () => cambiar(valor + paso);
  menos.disabled = valor <= min;
  mas.disabled = valor >= max;
  return h('div', { class: 'stepper' }, menos, salida, mas);
}

// Campo para un monto en pesos (acepta coma decimal en el celular).
export const campoPesos = (attrs) => h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', ...attrs });

export function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' }, h('span', { class: 'etq' }, etiqueta), control,
    ayuda ? h('div', { class: 'ayuda' }, ayuda) : null);
}

// Casilla de sí/no con su texto.
export function interruptor(etiqueta, valor, alCambiar, ayuda) {
  return h('label', { class: 'interruptor' },
    h('input', { type: 'checkbox', checked: !!valor, onchange: (e) => alCambiar(e.target.checked) }),
    h('span', {}, etiqueta, ayuda ? h('small', {}, ayuda) : null));
}

// Campo de fecha que avisa cuando no es la de hoy (la app puede quedar abierta de un día al otro).
export function campoFecha(valor, alCambiar) {
  const aviso = h('div', { class: 'ayuda aviso-fecha' });
  const revisar = (v) => { aviso.textContent = v && v !== hoyISO() ? `Ojo: no es la fecha de hoy (${fechaLarga(v)})` : ''; };
  const input = h('input', {
    type: 'date', value: valor, max: hoyISO(), required: true,
    onchange: (e) => { const v = e.target.value || hoyISO(); revisar(v); alCambiar(v); },
  });
  revisar(valor);
  return h('label', { class: 'campo' }, h('span', { class: 'etq' }, 'Fecha'), input, aviso);
}

// La fecha de una venta es siempre el sábado de entrega: se elige entre 8 sábados para atrás y 8 para adelante
// (y el que ya tenía la venta, si es más viejo).
export function campoSabado(valor, alCambiar) {
  const este = proximoSabado();
  const sabados = Array.from({ length: 17 }, (_, i) => sumarDias(este, (i - 8) * 7));
  if (valor && !sabados.includes(valor)) sabados.unshift(valor);
  const select = h('select', { required: true, onchange: (e) => alCambiar(e.target.value) },
    sabados.map((s) => h('option', { value: s }, `${fechaCorta(s)}${s === este ? ' · este sábado' : ''}`)));
  select.value = valor;
  return h('label', { class: 'campo' }, h('span', { class: 'etq' }, 'Sábado de entrega'), select);
}

export function grupo(etiqueta, control) {
  return h('div', { class: 'campo' }, h('span', { class: 'etq-grupo' }, etiqueta), control);
}

let timerToast;
let salidaToast;
export function toast(mensaje, { error = false, accion = null, ms = 4000 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(timerToast);
  salidaToast?.cancel();
  vaciar(el, h('span', {}, mensaje),
    accion ? h('button', {
      type: 'button',
      onclick: async () => {
        clearTimeout(timerToast);
        ocultarToast(el);
        try { await accion.fn(); } catch (e) { mostrarError(e); }
      },
    }, accion.texto) : null);
  el.className = 'toast' + (error ? ' error' : '');
  // Si ya había un aviso a la vista, cambia el texto en su lugar; si no, baja desde un poco más arriba.
  const llega = el.hidden;
  el.hidden = false;
  if (llega) entrar(el, { desde: '-8px' });
  timerToast = setTimeout(() => ocultarToast(el), accion ? Math.max(ms, 7000) : ms);
}

// Se va desvaneciéndose; si en el medio llega otro aviso, `toast` corta la salida.
function ocultarToast(el) {
  salidaToast = animar(el, [{ opacity: 0 }], { duracion: 'rapida', fill: 'forwards' });
  if (!salidaToast) { el.hidden = true; return; }
  salidaToast.onfinish = () => { el.hidden = true; salidaToast.cancel(); };
}

export const mostrarError = (e) => toast(e.message || String(e), { error: true, ms: 6000 });

// Ejecuta una acción deshabilitando el botón mientras tanto.
export async function conBoton(boton, fn) {
  boton.disabled = true;
  try {
    return await fn();
  } catch (e) {
    mostrarError(e);
  } finally {
    boton.disabled = false;
  }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- movimiento

// Cada movimiento tiene una causa (tocar, llegar a una pantalla, guardar) y dura poco: la curva y las duraciones
// son los tokens --mov-* de app.css, la misma fuente que usa el CSS. Con "reducir movimiento" no se anima nada.
// Se leen una vez, en la primera animación: leerlos con el DOM recién cambiado forzaría un recálculo de estilos.
let movimiento = null;
function leerMovimiento() {
  if (movimiento) return movimiento;
  const estilos = getComputedStyle(document.documentElement);
  const token = (nombre) => estilos.getPropertyValue(`--mov-${nombre}`).trim();
  movimiento = {
    reducido: matchMedia('(prefers-reduced-motion: reduce)'),
    curva: token('curva'),
    duraciones: { rapida: parseFloat(token('rapida')), normal: parseFloat(token('normal')), lenta: parseFloat(token('lenta')) },
  };
  return movimiento;
}
// Sin DOM (las pruebas en Node) no hay movimiento.
const sinMovimiento = () => !globalThis.matchMedia || leerMovimiento().reducido.matches;

// Anima `el` con la Web Animations API. `duracion`: 'rapida', 'normal' o 'lenta'; `pseudo`: '::after'.
// Devuelve la animación, o null si no se anima.
// `fill: 'forwards'` solo para una salida: quien la pide la cancela cuando oculta el elemento.
export function animar(el, cuadros, { duracion = 'normal', retraso = 0, pseudo, fill = 'backwards' } = {}) {
  if (!el?.animate || sinMovimiento()) return null;
  const { duraciones, curva } = leerMovimiento();
  return el.animate(cuadros, { duration: duraciones[duracion], delay: retraso, easing: curva, fill, pseudoElement: pseudo });
}

// Llega entera y en su lugar: aparece mientras se corre `desde` en vertical (negativo: baja desde arriba).
// Usa `translate` y no `transform`, así no pisa el centrado de quien ya tiene un transform (el aviso).
export const entrar = (el, { desde = '8px', retraso = 0 } = {}) =>
  animar(el, [{ opacity: 0, translate: `0 ${desde}` }, { opacity: 1, translate: '0 0' }], { retraso });

// "$12.450" → 12450: alcanza para saber si un número subió o bajó.
const cifra = (texto) => Number(texto.replace(/[^\d,]/g, '').replace(',', '.')) || 0;

// Un número que cambia en su lugar: ruedan solo las cifras que cambiaron (comparadas desde la derecha), la última
// primero, desde abajo si subió y desde arriba si bajó. `el` ya tiene el texto nuevo; `anterior`, el que tenía.
export function rodarNumero(el, anterior) {
  const nuevo = el.textContent;
  if (anterior == null || anterior === nuevo || sinMovimiento()) return;
  const desde = cifra(nuevo) >= cifra(anterior) ? '.45em' : '-.45em';
  const viejas = [...anterior];
  const letras = [...nuevo];
  const corrimiento = viejas.length - letras.length;
  const cambiadas = [];
  el.replaceChildren(...letras.map((letra, i) => {
    if (viejas[i + corrimiento] === letra) return letra;
    const cifraNueva = h('span', { class: 'mov-cifra' }, letra);
    cambiadas.push(cifraNueva);
    return cifraNueva;
  }));
  const animaciones = cambiadas.reverse().map((c, i) => entrar(c, { desde, retraso: i * 30 }));
  // Cuando terminan, vuelve a ser un texto entero (para copiar y leer), salvo que ya haya cambiado otra vez.
  Promise.allSettled(animaciones.map((a) => a?.finished)).then(() => { if (el.textContent === nuevo) el.textContent = nuevo; });
}

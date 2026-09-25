import { ZONA_HORARIA } from './config.js';

// ---------------------------------------------------------------- DOM

// h('button', { class: 'btn', onclick }, 'Guardar'). Los hijos de texto se insertan como texto
// (nunca como HTML), así que los datos de clientes no pueden inyectar nada.
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  let valor;
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
export function pesos(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  const centavos = Math.round(Math.abs(Number(n)) * 100);
  const entero = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = centavos % 100;
  return (Number(n) < 0 ? '−' : '') + '$' + entero + (resto ? ',' + String(resto).padStart(2, '0') : '');
}

// "1 venta", "3 ventas" (plural regular por defecto).
export const plural = (n, uno, varios = `${uno}s`) => `${numero(n, 0)} ${Number(n) === 1 ? uno : varios}`;

export function numero(n, decimales = 2) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('es-UY', { maximumFractionDigits: decimales });
}

// Cantidad en unidad base con una unidad legible: 5000 g → "5 kg", 250 ml → "250 ml", 12 un → "12 un".
export function cantidad(n, unidad) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (unidad === 'g' && Math.abs(v) >= 1000) return `${numero(v / 1000)} kg`;
  if (unidad === 'ml' && Math.abs(v) >= 1000) return `${numero(v / 1000)} L`;
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

export function mesISO(fecha = hoyISO()) {
  return fecha.slice(0, 7) + '-01';
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

function partes(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { a, m, d, dia: DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] };
}

// "sáb 12/09"
export function fechaCorta(iso) {
  if (!iso) return '';
  const { m, d, dia } = partes(iso);
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// "12/09/2026"
export function fechaLarga(iso) {
  if (!iso) return '';
  const { a, m, d } = partes(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

// "septiembre 2026"
export function nombreMes(iso) {
  const { a, m } = partes(iso);
  return `${MESES[m - 1]} ${a}`;
}

export const ETIQUETAS = {
  entrega: { retiro: 'Retiro', envio: 'Envío', sin_envio: 'Sin envío' },
  medio_pago: { efectivo: 'Efectivo', transferencia: 'Transferencia' },
  estado_pago: { pagado: 'Pagado', pendiente: 'Pendiente' },
  tipo: { venta: 'Venta', consumo_propio: 'Consumo propio', regalo: 'Regalo' },
  gasto: {
    merma: 'Merma', tanda_descartada: 'Tanda descartada', gasto_operativo: 'Gasto',
    comision: 'Comisión', retiro_socios: 'Retiro socios', ajuste_caja: 'Ajuste de caja', otro: 'Otro',
  },
};

export const opciones = (mapa) => Object.entries(mapa).map(([valor, texto]) => ({ valor, texto }));

// Link de WhatsApp si el contacto parece un celular uruguayo (09x xxx xxx).
export function linkWhatsapp(contacto) {
  const digitos = (contacto || '').replace(/\D/g, '');
  const m = digitos.match(/^(?:598)?0?(9\d{7})$/);
  return m ? `https://wa.me/598${m[1]}` : null;
}

// ---------------------------------------------------------------- componentes

// Chips de una sola opción. `desmarcable`: tocar la elegida la deselecciona.
export function chips(lista, valor, alCambiar, { desmarcable = false } = {}) {
  const cont = h('div', { class: 'chips', role: 'group' });
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

export function stepper(valor, alCambiar, { min = 0, max = Infinity } = {}) {
  const salida = h('output', {}, valor);
  const menos = h('button', { type: 'button', 'aria-label': 'Restar' }, '−');
  const mas = h('button', { type: 'button', 'aria-label': 'Sumar' }, '+');
  const cambiar = (nuevo) => {
    valor = Math.min(max, Math.max(min, nuevo));
    salida.textContent = valor;
    menos.disabled = valor <= min;
    mas.disabled = valor >= max;
    alCambiar(valor);
  };
  menos.onclick = () => cambiar(valor - 1);
  mas.onclick = () => cambiar(valor + 1);
  menos.disabled = valor <= min;
  mas.disabled = valor >= max;
  return h('div', { class: 'stepper' }, menos, salida, mas);
}

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
export function campoFecha(valor, alCambiar, etiqueta = 'Fecha') {
  const aviso = h('div', { class: 'ayuda aviso-fecha' });
  const revisar = (v) => { aviso.textContent = v && v !== hoyISO() ? `Ojo: no es la fecha de hoy (${fechaLarga(v)})` : ''; };
  const input = h('input', {
    type: 'date', value: valor, max: hoyISO(), required: true,
    onchange: (e) => { const v = e.target.value || hoyISO(); revisar(v); alCambiar(v); },
  });
  revisar(valor);
  return h('label', { class: 'campo' }, h('span', { class: 'etq' }, etiqueta), input, aviso);
}

export function grupo(etiqueta, control) {
  return h('div', { class: 'campo' }, h('span', { class: 'etq-grupo' }, etiqueta), control);
}

let timerToast;
export function toast(mensaje, { error = false, accion = null, ms = 4000 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(timerToast);
  vaciar(el, h('span', {}, mensaje),
    accion ? h('button', {
      type: 'button',
      onclick: async () => {
        el.hidden = true;
        try { await accion.fn(); } catch (e) { mostrarError(e); }
      },
    }, accion.texto) : null);
  el.className = 'toast' + (error ? ' error' : '');
  el.hidden = false;
  timerToast = setTimeout(() => { el.hidden = true; }, accion ? Math.max(ms, 7000) : ms);
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

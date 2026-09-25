import { sb, q } from './db.js';
import { h, vaciar, campo, toast, conBoton } from './util.js';
import { icono } from './iconos.js';

// Rutas: '#/ventas/:id' → { id }. Cada vista exporta `mostrar(contenedor, params)`.
// [título, módulo, pestaña que se marca, a dónde vuelve "←" (null = es una pantalla principal)]
const RUTAS = {
  panel: ['Inicio', () => import('./vistas/panel.js'), 'panel', null],
  venta: ['Nueva venta', () => import('./vistas/venta.js'), 'venta', null],
  ventas: ['Ventas', () => import('./vistas/ventas.js'), 'ventas', null],
  tandas: ['Producción', () => import('./vistas/tandas.js'), 'produccion', null],
  stock: ['Producción', () => import('./vistas/stock.js'), 'produccion', null],
  compras: ['Producción', () => import('./vistas/compras.js'), 'produccion', null],
  comprar: ['Producción', () => import('./vistas/comprar.js'), 'produccion', null],
  mas: ['Más', () => import('./vistas/mas.js'), 'mas', null],
  gastos: ['Gastos y retiros', () => import('./vistas/gastos.js'), 'mas', '#/mas'],
  clientes: ['Clientes', () => import('./vistas/clientes.js'), 'mas', '#/mas'],
  catalogo: ['Costos y márgenes', () => import('./vistas/catalogo.js'), 'mas', '#/mas'],
  sabores: ['Sabores', () => import('./vistas/sabores.js'), 'mas', '#/mas'],
  insumos: ['Insumos', () => import('./vistas/insumos.js'), 'mas', '#/mas'],
  formatos: ['Formatos', () => import('./vistas/formatos.js'), 'mas', '#/mas'],
  precios: ['Precios', () => import('./vistas/precios.js'), 'mas', '#/mas'],
};
// Subpantallas: a dónde vuelve "←" desde una ficha o un formulario.
function volverDe(ruta, id, accion) {
  if (ruta === 'ventas' && id && accion === 'editar') return [`#/ventas/${id}`, 'Editar venta'];
  if (ruta === 'ventas' && id) return ['#/ventas', 'Venta'];
  if (ruta === 'stock' && id === 'conteo') return ['#/stock', 'Cargar conteo'];
  const nuevo = { sabores: 'Nuevo sabor', insumos: 'Nuevo insumo', formatos: 'Nuevo formato' };
  if (id && ['clientes', 'sabores', 'insumos', 'formatos'].includes(ruta)) {
    return [`#/${ruta}`, id === 'nuevo' ? nuevo[ruta] : RUTAS[ruta][0]];
  }
  return [RUTAS[ruta][3], RUTAS[ruta][0]];
}

// Producción agrupa cuatro pantallas; la pestaña vuelve a la última que se usó.
export const PRODUCCION = [['tandas', 'Tandas'], ['stock', 'Stock'], ['compras', 'Compras'], ['comprar', '¿Qué compro?']];
const ultimaProduccion = () => {
  try { return sessionStorage.getItem('produccion') || 'tandas'; } catch { return 'tandas'; }
};

const PESTANAS = [
  ['panel', 'Inicio', 'inicio', () => '#/panel'],
  ['ventas', 'Ventas', 'ventas', () => '#/ventas'],
  ['venta', 'Nueva venta', 'nuevo', () => '#/venta'],
  ['produccion', 'Producción', 'roll', () => `#/${ultimaProduccion()}`],
  ['mas', 'Más', 'menu', () => '#/mas'],
];

const vista = document.getElementById('vista');
const tabs = document.getElementById('tabs');
const titulo = document.getElementById('titulo');
const atras = document.getElementById('atras');
const marca = document.getElementById('marca');
atras.append(icono('atras'));

// Pestañas (abajo en el celular, a la izquierda en pantallas grandes)
for (const [clave, texto, ico] of PESTANAS) {
  tabs.append(h('a', { 'data-tab': clave, class: clave === 'venta' ? 'tab-principal' : null },
    h('span', { class: 'ico' }, icono(ico)), h('span', { class: 'tab-texto' }, clave === 'venta' ? 'Venta' : texto)));
}
function marcarPestana(activa) {
  for (const a of tabs.querySelectorAll('a')) {
    const [, , , destino] = PESTANAS.find(([c]) => c === a.dataset.tab);
    a.href = destino();
    const es = a.dataset.tab === activa;
    a.classList.toggle('activo', es);
    if (es) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
export const sesion = { usuario: null, nombre: null };

// El link del mail vuelve con '#access_token=…' o '#error=…&error_description=…'. supabase-js lee
// los tokens; acá se guarda el error para mostrarlo y se limpia la URL para el router ('#/…').
let mensajeLogin = null;
if (location.hash && !location.hash.startsWith('#/')) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('error')) {
    mensajeLogin = params.get('error_code') === 'otp_expired'
      ? 'El link venció o ya se usó. Pedí uno nuevo.'
      : `No se pudo entrar: ${params.get('error_description') || params.get('error')}`;
    history.replaceState(null, '', location.pathname);
  }
}

const TRADUCCIONES = [
  [/signups not allowed|user not found/i, 'Ese email no tiene acceso a la app.'],
  [/rate limit|only request this after/i, 'Se mandaron demasiados mails. Esperá un rato y probá de nuevo, o entrá con contraseña.'],
  [/invalid login credentials/i, 'Email o contraseña incorrectos.'],
  [/email not confirmed/i, 'Ese email todavía no está confirmado.'],
];
const traducir = (msg) => TRADUCCIONES.find(([re]) => re.test(msg))?.[1] || msg;

let navegacion = 0;
async function enrutar() {
  if (!sesion.nombre) return;
  let [nombre = 'panel', ...resto] = location.hash.replace(/^#\/?/, '').split('/');
  if (nombre === 'produccion') { history.replaceState(null, '', `#/${ultimaProduccion()}`); nombre = ultimaProduccion(); }
  const ruta = RUTAS[nombre] ? nombre : 'panel';
  const [, cargar, pestana] = RUTAS[ruta];
  const [volver, texto] = volverDe(ruta, resto[0], resto[1]);
  const esta = ++navegacion;
  if (pestana === 'produccion' && !resto[0]) {
    try { sessionStorage.setItem('produccion', ruta); } catch { /* sin almacenamiento: vuelve a Tandas */ }
  }
  titulo.textContent = texto;
  document.title = `${texto} · Cinniminies`;
  atras.hidden = !volver;
  marca.hidden = !!volver;
  atras.onclick = () => { location.hash = volver; };
  marcarPestana(pestana);
  vaciar(vista, h('p', { class: 'cargando' }, 'Cargando…'));
  window.scrollTo(0, 0);
  try {
    const modulo = await cargar();
    if (esta !== navegacion) return; // el usuario ya se fue a otra pantalla
    const cont = h('div');
    await modulo.mostrar(cont, { id: resto[0], accion: resto[1] });
    if (esta === navegacion) {
      vaciar(vista, cont);
      vista.focus({ preventScroll: true }); // los lectores de pantalla arrancan en el contenido nuevo
    }
  } catch (e) {
    if (esta !== navegacion) return;
    vaciar(vista, h('div', { class: 'card' }, h('p', { class: 'mensaje-error' }, e.message),
      h('button', { class: 'btn', onclick: enrutar }, 'Reintentar')));
  }
}

// ---------------------------------------------------------------- login

function pantallaLogin(mensaje) {
  tabs.hidden = true;
  atras.hidden = true;
  marca.hidden = false;
  titulo.textContent = '';
  let modo = 'clave';
  const cont = h('div', { class: 'login' });

  function dibujar() {
    const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'tu@email.com' });
    const clave = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const codigo = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456', required: true });
    const boton = h('button', { class: 'btn primario bloque', type: 'submit' }, modo === 'clave' ? 'Entrar' : 'Mandarme el link');
    let codigoEnviado = false;

    const form = h('form', {
      class: 'card',
      onsubmit: (e) => {
        e.preventDefault();
        mensajeLogin = null;
        conBoton(boton, async () => {
          if (modo === 'clave') {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: clave.value });
            if (error) throw new Error(traducir(error.message));
          } else if (!codigoEnviado) {
            const { error } = await sb.auth.signInWithOtp({
              email: email.value.trim(),
              options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
            });
            if (error) throw new Error(traducir(error.message));
            codigoEnviado = true;
            email.readOnly = true;
            form.insertBefore(h('p', { class: 'ayuda' },
              'Listo: revisá tu mail y tocá el link para entrar. Si el mail trae un código, ponelo acá abajo.'), boton);
            form.insertBefore(campo('Código (opcional)', codigo), boton);
            boton.textContent = 'Entrar con el código';
          } else {
            const { error } = await sb.auth.verifyOtp({ email: email.value.trim(), token: codigo.value.trim(), type: 'email' });
            if (error) throw new Error('El código no es válido o ya venció');
          }
        });
      },
    },
    campo('Email', email),
    modo === 'clave' ? campo('Contraseña', clave) : null,
    boton);

    vaciar(cont,
      h('h1', {}, 'Cinniminies'),
      mensaje ? h('p', { class: 'mensaje-error' }, mensaje) : null,
      form,
      h('p', { class: 'pie' }, modo === 'clave'
        ? h('button', { class: 'link', type: 'button', onclick: () => { modo = 'codigo'; dibujar(); } }, 'Entrar con un link por mail')
        : h('button', { class: 'link', type: 'button', onclick: () => { modo = 'clave'; dibujar(); } }, 'Entrar con contraseña')));
  }

  dibujar();
  vaciar(vista, cont);
}

// ---------------------------------------------------------------- sesión

async function alCambiarSesion(session) {
  if (!session) {
    sesion.usuario = sesion.nombre = null;
    // Supabase puede avisar dos veces que no hay sesión: el mensaje se mantiene hasta que se intenta entrar
    pantallaLogin(mensajeLogin);
    return;
  }
  if (sesion.usuario === session.user.id && sesion.nombre) return;
  sesion.usuario = session.user.id;
  try {
    const admin = await q(sb.from('usuarios_admin').select('nombre').eq('user_id', session.user.id).maybeSingle());
    if (!admin) {
      sesion.usuario = sesion.nombre = null;
      mensajeLogin = 'Tu usuario no tiene acceso a la app.';
      await sb.auth.signOut(); // dispara SIGNED_OUT → pantallaLogin(mensajeLogin)
      return;
    }
    sesion.nombre = admin.nombre;
    mensajeLogin = null;
  } catch (e) {
    sesion.usuario = null;
    vaciar(vista, h('div', { class: 'card' }, h('p', { class: 'mensaje-error' }, `No se pudo conectar: ${e.message}`),
      h('button', { class: 'btn', onclick: async () => alCambiarSesion((await sb.auth.getSession()).data.session) }, 'Reintentar')));
    return;
  }
  tabs.hidden = false;
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', location.pathname + '#/panel');
  enrutar();
}

window.addEventListener('hashchange', enrutar);
sb.auth.onAuthStateChange((evento, session) => {
  // Diferido: no se puede llamar a Supabase dentro del callback (bloquea el cliente).
  setTimeout(() => alCambiarSesion(session), 0);
  if (evento === 'PASSWORD_RECOVERY') toast('Elegí una contraseña nueva en Más → Contraseña');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

export function irA(hash) {
  if (location.hash === hash) enrutar();
  else location.hash = hash;
}

// Vuelve a dibujar la pantalla solo si el usuario sigue en ella (para los "Deshacer" de los avisos,
// que se pueden tocar después de haber cambiado de pantalla).
export function refrescarSi(hash) {
  if (location.hash === hash) enrutar();
}

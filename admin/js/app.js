import { sb, q } from './db.js';
import { h, vaciar, campo, toast, conBoton } from './util.js';

// Rutas: '#/ventas/:id' → { vista: 'ventas', id }. Cada vista exporta `mostrar(contenedor, params)`.
const RUTAS = {
  panel: ['Inicio', () => import('./vistas/panel.js')],
  venta: ['Nueva venta', () => import('./vistas/venta.js')],
  ventas: ['Ventas', () => import('./vistas/ventas.js')],
  tandas: ['Tandas', () => import('./vistas/tandas.js')],
  compras: ['Compras', () => import('./vistas/compras.js')],
  gastos: ['Gastos y retiros', () => import('./vistas/gastos.js')],
  clientes: ['Clientes', () => import('./vistas/clientes.js')],
  stock: ['Stock', () => import('./vistas/stock.js')],
  comprar: ['¿Qué compro?', () => import('./vistas/comprar.js')],
  catalogo: ['Catálogo', () => import('./vistas/catalogo.js')],
  sabores: ['Sabores', () => import('./vistas/sabores.js')],
  insumos: ['Insumos', () => import('./vistas/insumos.js')],
  formatos: ['Formatos', () => import('./vistas/formatos.js')],
  precios: ['Precios', () => import('./vistas/precios.js')],
  mas: ['Más', () => import('./vistas/mas.js')],
};
// Pantallas que no tienen pestaña propia: se marca "Más".
const TAB_DE = Object.fromEntries(['compras', 'gastos', 'clientes', 'stock', 'comprar', 'catalogo', 'sabores', 'insumos',
  'formatos', 'precios'].map((r) => [r, 'mas']));

const vista = document.getElementById('vista');
const tabs = document.getElementById('tabs');
const titulo = document.getElementById('titulo');
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
  const [nombre = 'panel', ...resto] = location.hash.replace(/^#\/?/, '').split('/');
  const ruta = RUTAS[nombre] ? nombre : 'panel';
  const [texto, cargar] = RUTAS[ruta];
  const esta = ++navegacion;
  titulo.textContent = texto;
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('activo', a.dataset.tab === (TAB_DE[ruta] || ruta));
  vaciar(vista, h('p', { class: 'cargando' }, 'Cargando…'));
  window.scrollTo(0, 0);
  try {
    const modulo = await cargar();
    if (esta !== navegacion) return; // el usuario ya se fue a otra pantalla
    const cont = h('div');
    await modulo.mostrar(cont, { id: resto[0], accion: resto[1] });
    if (esta === navegacion) vaciar(vista, cont);
  } catch (e) {
    if (esta !== navegacion) return;
    vaciar(vista, h('div', { class: 'card' }, h('p', { class: 'mensaje-error' }, e.message),
      h('button', { class: 'btn', onclick: enrutar }, 'Reintentar')));
  }
}

// ---------------------------------------------------------------- login

function pantallaLogin(mensaje) {
  tabs.hidden = true;
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

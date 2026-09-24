import { sb } from '../db.js';
import { h, vaciar, campo, toast, conBoton } from '../util.js';
import { sesion } from '../app.js';

export async function mostrar(cont) {
  const item = (href, texto, sub) => h('li', {}, h('a', { class: 'fila', href },
    h('div', { class: 'princ' }, h('div', { class: 't1' }, texto), sub ? h('div', { class: 't2' }, sub) : null), '›'));

  const clave = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const repetir = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const guardarClave = h('button', { class: 'btn', type: 'button' }, 'Guardar contraseña');
  guardarClave.onclick = () => conBoton(guardarClave, async () => {
    if (clave.value.length < 8) throw new Error('La contraseña tiene que tener al menos 8 caracteres');
    if (clave.value !== repetir.value) throw new Error('Las contraseñas no coinciden');
    const { error } = await sb.auth.updateUser({ password: clave.value });
    if (error) throw new Error(error.message);
    clave.value = repetir.value = '';
    toast('Contraseña guardada: la próxima vez podés entrar con ella');
  });

  const salir = h('button', { class: 'btn peligro bloque', type: 'button' }, 'Salir');
  salir.onclick = () => conBoton(salir, () => sb.auth.signOut());

  vaciar(cont,
    h('ul', { class: 'lista menu-mas' },
      item('#/compras', 'Compras', 'Ingredientes, packaging y equipamiento'),
      item('#/gastos', 'Gastos y retiros', 'Mermas, comisiones, retiros de socios'),
      item('#/clientes', 'Clientes', 'Libreta, historial y duplicados')),
    h('details', { class: 'plegable', style: 'margin-top:1rem' },
      h('summary', {}, 'Contraseña'),
      h('p', { class: 'ayuda' }, 'Elegí una contraseña para entrar sin esperar el código por mail.'),
      campo('Contraseña nueva', clave),
      campo('Repetila', repetir),
      h('div', { class: 'acciones', style: 'margin-bottom:1rem' }, guardarClave)),
    salir,
    h('p', { class: 'pie' }, `Sesión de ${sesion.nombre}`));
}

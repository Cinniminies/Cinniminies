import { sb } from '../db.js';
import { h, vaciar, campo, toast, conBoton } from '../util.js';
import { icono } from '../iconos.js';
import { sesion } from '../app.js';

// Todo lo que no es de uso diario, agrupado. Cada destino está a un toque.
export async function mostrar(cont) {
  const item = (href, ico, texto, sub) => h('li', {}, h('a', { class: 'fila', href },
    h('span', { class: 'fila-ico' }, icono(ico)),
    h('div', { class: 'princ' }, h('div', { class: 't1' }, texto), sub ? h('div', { class: 't2' }, sub) : null),
    icono('derecha', 'icono chev')));
  const seccion = (titulo, ...items) => [h('h2', { class: 'seccion-titulo' }, titulo), h('ul', { class: 'lista' }, items)];

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

  const salir = h('button', { class: 'fila', type: 'button' },
    h('span', { class: 'fila-ico' }, icono('salir')), h('div', { class: 'princ' }, h('div', { class: 't1' }, 'Salir')));
  salir.onclick = () => conBoton(salir, () => sb.auth.signOut());

  vaciar(cont,
    seccion('Negocio',
      item('#/clientes', 'clientes', 'Clientes', 'Libreta, historial y duplicados'),
      item('#/gastos', 'gasto', 'Gastos y retiros', 'Mermas, comisiones, retiros de socios')),
    seccion('Catálogo',
      item('#/sabores', 'roll', 'Sabores y recetas', 'Activar, ocultar en la web, precio por unidad'),
      item('#/formatos', 'caja', 'Formatos', 'Cajas, personalizado y unidad'),
      item('#/precios', 'etiqueta', 'Precios', 'Vigentes, programados e historial'),
      item('#/insumos', 'bolsa', 'Insumos', 'Ingredientes, packaging y mínimos'),
      item('#/catalogo', 'grafico', 'Costos y márgenes', 'Costo por roll y margen por caja')),
    h('h2', { class: 'seccion-titulo' }, 'Cuenta'),
    h('ul', { class: 'lista' },
      h('li', {}, h('details', { class: 'fila-detalle' },
        h('summary', { class: 'fila' }, h('span', { class: 'fila-ico' }, icono('llave')),
          h('div', { class: 'princ' }, h('div', { class: 't1' }, 'Contraseña'),
            h('div', { class: 't2' }, 'Para entrar sin esperar el mail'))),
        h('div', { class: 'fila-cuerpo' },
          campo('Contraseña nueva', clave),
          campo('Repetila', repetir),
          guardarClave))),
      h('li', {}, salir)),
    h('p', { class: 'pie' }, `Sesión de ${sesion.nombre}`));
}

import { sb, q, rpc } from '../db.js';
import { h, vaciar, fechaCorta, toast, conBoton } from '../util.js';
import { irA } from '../app.js';

// Dispositivos que pueden usar la app (ver la migración dispositivos_autorizados). Los pendientes los
// pidió alguien desde la pantalla de bloqueo: se autorizan comparando el código que le aparece ahí.
export async function mostrar(cont) {
  const lista = await q(sb.from('v_dispositivos').select('*')
    .order('autorizado').order('creado_en', { ascending: false }));

  const fila = (d) => {
    const acciones = [];
    if (!d.autorizado) {
      const autorizar = h('button', { class: 'btn chico primario', type: 'button' }, 'Autorizar');
      autorizar.onclick = () => conBoton(autorizar, async () => {
        await rpc('autorizar_dispositivo', { p_id: d.id });
        toast(`${d.nombre} autorizado`);
        irA('#/dispositivos');
      });
      acciones.push(autorizar);
    }
    const quitar = h('button', { class: 'btn chico peligro', type: 'button' }, d.autorizado ? 'Quitar' : 'Rechazar');
    quitar.onclick = () => conBoton(quitar, async () => {
      if (!confirm(d.este
        ? 'Es este mismo dispositivo: si lo quitás, la app deja de funcionar acá hasta que lo autoricen de nuevo. ¿Seguir?'
        : `¿Quitar ${d.nombre} (${d.usuario || 'sin usuario'})? Para volver a usar la app ahí van a tener que autorizarlo de nuevo.`)) return;
      await q(sb.from('dispositivos').delete().eq('id', d.id));
      toast('Dispositivo quitado');
      if (d.este) location.reload(); else irA('#/dispositivos');
    });
    acciones.push(quitar);
    return h('li', {}, h('div', { class: 'fila' },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, d.nombre, ' ',
          d.este ? h('span', { class: 'badge ok' }, 'Este') : null, ' ',
          d.autorizado ? null : h('span', { class: 'badge pendiente' }, `Pendiente · código ${d.codigo}`)),
        h('div', { class: 't2' }, [d.usuario || 'Sin usuario',
          d.autorizado && d.autorizado_en ? `autorizado el ${fechaCorta(d.autorizado_en.slice(0, 10))}` : `pedido el ${fechaCorta(d.creado_en.slice(0, 10))}`,
          d.ultimo_uso ? `último uso ${fechaCorta(d.ultimo_uso.slice(0, 10))}` : null].filter(Boolean).join(' · '))),
      acciones));
  };

  vaciar(cont,
    h('p', { class: 'ayuda' }, 'La app solo funciona en estos dispositivos, aunque alguien sepa la contraseña. '
      + 'Si cambiás de celular, borrás los datos del navegador o usás otro navegador, hay que autorizarlo de nuevo.'),
    lista.length ? h('ul', { class: 'lista' }, lista.map(fila)) : h('p', { class: 'vacio' }, 'No hay dispositivos.'));
}

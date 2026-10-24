import { sb, q, rpc } from '../db.js';
import { h, vaciar, fechaCorta, plural, toast, conBoton } from '../util.js';
import { icono } from '../iconos.js';
import { irA } from '../app.js';

// Dispositivos que pueden usar la app (ver la migración dispositivos_autorizados). Arriba, destacados, los que
// esperan autorización: se aprueban comparando el código grande con el que le aparece al otro dispositivo.
// Abajo, los autorizados en tarjetas (en la compu, en grilla).
export async function mostrar(cont) {
  const lista = await q(sb.from('v_dispositivos').select('*').order('creado_en', { ascending: false }));
  const pendientes = lista.filter((d) => !d.autorizado);
  const autorizados = lista.filter((d) => d.autorizado).sort((a, b) => (b.este ? 1 : 0) - (a.este ? 1 : 0));
  const dia = (iso) => fechaCorta(iso.slice(0, 10));
  const esCompu = (nombre) => /mac|windows|linux|compu|notebook|pc/i.test(nombre);

  function botonQuitar(d, texto) {
    const quitar = h('button', { class: 'btn chico peligro', type: 'button' }, texto);
    quitar.onclick = () => conBoton(quitar, async () => {
      if (!confirm(d.este
        ? 'Es este mismo dispositivo: si lo quitás, la app deja de funcionar acá hasta que lo autoricen de nuevo. ¿Seguir?'
        : `¿Quitar ${d.nombre} (${d.usuario || 'sin usuario'})? Para volver a usar la app ahí van a tener que autorizarlo de nuevo.`)) return;
      await q(sb.from('dispositivos').delete().eq('id', d.id));
      toast('Dispositivo quitado');
      if (d.este) location.reload(); else irA('#/dispositivos');
    });
    return quitar;
  }

  const tarjetaPendiente = (d) => {
    const autorizar = h('button', { class: 'btn primario', type: 'button' }, 'Autorizar');
    autorizar.onclick = () => conBoton(autorizar, async () => {
      await rpc('autorizar_dispositivo', { p_id: d.id });
      toast(`${d.nombre} autorizado`);
      irA('#/dispositivos');
    });
    return h('div', { class: 'disp-pendiente' },
      h('div', { class: 'etq' }, 'Pide autorización'),
      h('h3', {}, d.nombre),
      h('div', { class: 'ayuda' }, `${d.usuario || 'Sin usuario'} · pedido el ${dia(d.creado_en)}`),
      h('div', { class: 'disp-codigo', 'aria-label': `Código ${d.codigo}` }, [...d.codigo].map((c) => h('span', {}, c))),
      h('p', { class: 'ayuda', style: 'margin:0 0 .75rem' }, 'Autorizalo solo si es el mismo código que ves en ese dispositivo.'),
      h('div', { class: 'acciones', style: 'margin:0' }, autorizar, botonQuitar(d, 'Rechazar')));
  };

  const tarjeta = (d) => h('div', { class: 'disp' + (d.este ? ' este' : '') },
    h('span', { class: 'disp-ico' }, icono(esCompu(d.nombre) ? 'compu' : 'celular')),
    h('div', { class: 'princ' },
      h('div', { class: 't1' }, d.nombre, ' ', d.este ? h('span', { class: 'badge ok' }, 'Este') : null),
      h('div', { class: 't2' }, d.usuario || 'Sin usuario'),
      h('div', { class: 't2' }, [d.autorizado_en ? `Autorizado el ${dia(d.autorizado_en)}` : null,
        d.ultimo_uso ? `último uso ${dia(d.ultimo_uso)}` : null].filter(Boolean).join(' · ')),
      botonQuitar(d, 'Quitar')));

  vaciar(cont,
    pendientes.length ? [
      h('h2', { style: 'margin-top:0' }, plural(pendientes.length, 'dispositivo espera', 'dispositivos esperan'), ' autorización'),
      h('div', { class: 'disp-pendientes' }, pendientes.map(tarjetaPendiente)),
    ] : null,
    h('h2', { style: pendientes.length ? null : 'margin-top:0' }, 'Autorizados'),
    h('p', { class: 'ayuda' }, 'La app solo funciona en estos dispositivos, aunque alguien sepa la contraseña. '
      + 'Si cambiás de celular, borrás los datos del navegador o usás otro navegador, hay que autorizarlo de nuevo.'),
    autorizados.length ? h('div', { class: 'disps' }, autorizados.map(tarjeta)) : h('p', { class: 'vacio' }, 'No hay dispositivos.'));
}

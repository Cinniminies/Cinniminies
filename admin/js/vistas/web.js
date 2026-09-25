import { sb, q } from '../db.js';
import { h, vaciar, campo, toast, conBoton } from '../util.js';
import { srcFoto, subirFoto, borrarFotoDelBucket } from '../fotos.js';
import { irA } from '../app.js';

// Textos e imágenes de la web pública (Etapa 7). Cada fila de contenido_web es un lugar de
// index.html; la web los toma de /api/catalogo (tarda hasta 5 minutos en verse).
const SECCIONES = ['Inicio', 'Dónde encontrarnos', 'Contacto', 'Pedido recibido'];

// Mismas reglas que los checks de la base, para avisar antes de guardar.
const VALIDAR = {
  texto: (v) => (v.trim() ? null : 'no puede quedar vacío'),
  imagen: (v) => (/^(\/?img\/[\w./-]+|https:\/\/[^\s"'<>]+)$/.test(v) ? null : 'tiene que ser una ruta img/… o un link https'),
  whatsapp: (v) => (/^598\d{8}$/.test(v) ? null : 'tiene que ser 598 y 8 números, sin el 0 (ej: 59895226739)'),
  instagram: (v) => (/^[\w.]{1,30}$/.test(v) ? null : 'solo letras, números, punto y guion bajo, sin @'),
};

export async function mostrar(cont) {
  const filas = await q(sb.from('contenido_web').select('*').order('orden'));
  const cambios = {};
  const guardar = h('button', { class: 'btn primario', type: 'button', disabled: true }, 'Guardar cambios');
  const marcar = (f, valor) => {
    if (valor === f.valor) delete cambios[f.clave]; else cambios[f.clave] = valor;
    const n = Object.keys(cambios).length;
    guardar.disabled = !n;
    guardar.textContent = n ? `Guardar ${n} ${n === 1 ? 'cambio' : 'cambios'}` : 'Guardar cambios';
  };

  function control(f) {
    let el;
    if (f.tipo === 'imagen') return controlImagen(f);
    if (f.tipo === 'texto_largo') el = h('textarea', { rows: Math.max(2, f.valor.split('\n').length + 1), value: f.valor });
    else el = h('input', { value: f.valor, inputmode: f.tipo === 'whatsapp' ? 'numeric' : null });
    el.addEventListener('input', () => marcar(f, f.tipo === 'whatsapp' ? el.value.replace(/\D/g, '') : el.value));
    const volver = f.valor !== f.original
      ? h('p', { class: 'ayuda', style: 'margin:-.6rem 0 .9rem' }, h('button', { class: 'link', type: 'button',
        onclick: () => { el.value = f.original; marcar(f, f.original); } }, 'Volver al texto original'))
      : null;
    return [campo(f.etiqueta, el, f.ayuda), volver];
  }

  function controlImagen(f) {
    let actual = f.valor;
    // Imagen subida y todavía sin guardar: si se reemplaza o se vuelve a la original, se borra del bucket.
    let subidaSinGuardar = null;
    const descartarSubida = () => {
      if (subidaSinGuardar) borrarFotoDelBucket('web', subidaSinGuardar);
      subidaSinGuardar = null;
    };
    const vista = h('div', { class: 'foto-sabor foto-ancha' });
    const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const subir = h('button', { class: 'btn chico', type: 'button', onclick: () => archivo.click() }, 'Cambiar imagen');
    const volver = h('button', { class: 'btn chico', type: 'button' }, 'Volver a la original');
    const dibujar = () => {
      vaciar(vista, h('img', { src: srcFoto(actual), alt: f.etiqueta }));
      volver.hidden = actual === f.original;
    };
    volver.onclick = () => { descartarSubida(); actual = f.original; marcar(f, actual); dibujar(); };
    archivo.onchange = () => conBoton(subir, async () => {
      const a = archivo.files[0];
      archivo.value = '';
      if (!a) return;
      subir.textContent = 'Subiendo…';
      try {
        const nueva = await subirFoto('web', a, f.clave.replace('.', '-'));
        descartarSubida();
        actual = subidaSinGuardar = nueva;
        marcar(f, actual);
        toast('Imagen subida: tocá Guardar para que quede');
      } finally {
        subir.textContent = 'Cambiar imagen';
        dibujar();
      }
    });
    dibujar();
    return h('div', { class: 'campo' }, h('span', { class: 'etq' }, f.etiqueta),
      h('div', { class: 'foto-fila' }, vista,
        h('div', {}, h('div', { class: 'acciones', style: 'margin-top:0' }, subir, volver, archivo),
          f.ayuda ? h('p', { class: 'ayuda' }, f.ayuda) : null)));
  }

  guardar.onclick = () => conBoton(guardar, async () => {
    const porClave = Object.fromEntries(filas.map((f) => [f.clave, f]));
    for (const [clave, valor] of Object.entries(cambios)) {
      const error = VALIDAR[porClave[clave].tipo]?.(valor);
      if (error) throw new Error(`${porClave[clave].etiqueta}: ${error}`);
    }
    for (const [clave, valor] of Object.entries(cambios)) {
      await q(sb.from('contenido_web').update({ valor }).eq('clave', clave));
      const f = porClave[clave];
      if (f.tipo === 'imagen') await borrarFotoDelBucket('web', f.valor);
    }
    toast('Guardado. La web lo muestra en unos 5 minutos');
    irA('#/web');
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    h('p', { class: 'ayuda', style: 'margin-top:0' },
      'Lo que cambies acá aparece en ', h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'la web'),
      ' en unos 5 minutos, sin tocar código. Los sabores, fotos de sabores y precios se editan en Catálogo.'),
    SECCIONES.map((sec) => {
      const deSeccion = filas.filter((f) => f.seccion === sec);
      return deSeccion.length ? h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, sec), deSeccion.map(control)) : null;
    })),
  h('div', { class: 'guardar' }, guardar));
}

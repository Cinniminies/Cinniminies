import { sb, q } from '../db.js';
import { h, vaciar, pesos, fechaLarga, hoyISO } from '../util.js';

// Resumen de todos los precios: el vigente de cada combinación y los programados. Se editan en la
// ficha de cada formato (precio de caja y especiales) o sabor (precio por unidad).
export async function mostrar(cont) {
  const precios = await q(sb.from('precios')
    .select('id,formato_id,sabor_id,precio,vigente_desde,formatos(nombre,activo,orden),sabores(nombre,activo,orden)'));
  const hoy = hoyISO();

  const grupos = new Map();
  for (const p of precios) {
    const clave = `${p.formato_id || ''}|${p.sabor_id || ''}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }
  const combinaciones = [...grupos.values()].map((filas) => {
    const [p] = filas;
    const vigentes = filas.filter((f) => f.vigente_desde <= hoy).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
    const futuros = filas.filter((f) => f.vigente_desde > hoy).sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde));
    return {
      nombre: [p.formatos?.nombre, p.sabores?.nombre].filter(Boolean).join(' '),
      tipo: p.formato_id && p.sabor_id ? 'especial' : p.formato_id ? 'caja' : 'unidad',
      activo: (p.formatos?.activo ?? true) && (p.sabores?.activo ?? true),
      orden: (p.formatos?.orden ?? 0) * 1000 + (p.sabores?.orden ?? 0),
      href: p.formato_id ? `#/formatos/${p.formato_id}` : `#/sabores/${p.sabor_id}`,
      actual: vigentes[0],
      futuro: futuros[0],
    };
  });

  const seccion = (tipo, titulo, ayuda) => {
    const filas = combinaciones.filter((c) => c.tipo === tipo).sort((a, b) => b.activo - a.activo || a.orden - b.orden);
    if (!filas.length) return null;
    return [
      h('h2', {}, titulo),
      ayuda ? h('p', { class: 'ayuda' }, ayuda) : null,
      h('ul', { class: 'lista' }, filas.map((c) => h('li', {}, h('a', { class: 'fila', href: c.href },
        h('div', { class: 'princ' },
          h('div', { class: 't1' }, c.nombre, ' ', c.activo ? null : h('span', { class: 'badge neutro' }, 'Inactivo')),
          h('div', { class: 't2' }, c.actual ? `desde el ${fechaLarga(c.actual.vigente_desde)}` : 'todavía no rige',
            c.futuro ? [' · ', h('span', { class: 'badge neutro' }, `${pesos(c.futuro.precio)} desde el ${fechaLarga(c.futuro.vigente_desde)}`)] : null)),
        h('span', { class: 'monto' }, c.actual ? pesos(c.actual.precio) : '—'))))),
    ];
  };

  vaciar(cont,
    h('p', { class: 'ayuda' }, 'Tocá un precio para cambiarlo o ver su historial. Las ventas ya cargadas conservan el precio con el que se guardaron.'),
    seccion('caja', 'Cajas'),
    seccion('unidad', 'Por unidad', 'Lo que vale cada roll en el personalizado y suelto.'),
    seccion('especial', 'Especiales', 'Cajas de un solo sabor con precio distinto.'));
}

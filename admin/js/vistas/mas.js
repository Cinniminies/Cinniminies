import { sb } from '../db.js';
import { h, vaciar, campo, chips, toast, conBoton } from '../util.js';
import { textoPanel } from '../textos.js';
import { icono } from '../iconos.js';
import { sesion } from '../app.js';
import * as push from '../push.js';

// Elección de tema de este dispositivo; el script del <head> de index.html lee la misma clave.
const CLAVE_TEMA = 'cinniminies.tema';

// Fila de la cuenta: ícono, título y detalle; `control` va a la derecha y `debajo`, abajo del texto.
function filaCuenta(ico, titulo, detalle, { control = null, debajo = null } = {}) {
  return h('li', {}, h('div', { class: 'fila' }, h('span', { class: 'fila-ico' }, icono(ico)),
    h('div', { class: 'princ' }, h('div', { class: 't1' }, titulo), detalle, debajo), control));
}

// "Avisarme de pedidos nuevos" en este dispositivo. En iPhone solo funciona con la app agregada a la
// pantalla de inicio (iOS 16.4+): en Safari común se muestra cómo instalarla.
function filaAvisos() {
  const titulo = textoPanel('panel.mas.avisos', 'Avisarme de pedidos nuevos');
  const sub = h('div', { class: 't2', style: 'white-space: normal' },
    textoPanel('panel.mas.avisos_ayuda', 'En este celular o compu, cuando entra un pedido de la web'));
  const fila = (control) => filaCuenta('carrito', titulo, sub, { control });
  const soporte = push.soporte();
  if (soporte !== 'ok') {
    sub.textContent = soporte === 'instalar'
      ? textoPanel('panel.mas.avisos_iphone',
        'En iPhone: tocá Compartir → "Agregar a inicio", abrí la app desde ahí y activalos.')
      : textoPanel('panel.mas.avisos_sin_soporte', 'Este navegador no permite avisos.');
    return fila(null);
  }
  const casilla = h('input', { type: 'checkbox', 'aria-label': titulo, disabled: true });
  push.activos().then((si) => { casilla.checked = si; casilla.disabled = false; }).catch(() => { casilla.disabled = false; });
  casilla.onchange = async () => {
    const quiere = casilla.checked;
    casilla.disabled = true;
    try {
      if (quiere) await push.activar(); else await push.desactivar();
      toast(quiere ? textoPanel('panel.mas.avisos_activados', 'Listo: te vamos a avisar de cada pedido nuevo')
        : textoPanel('panel.mas.avisos_desactivados', 'Avisos desactivados en este dispositivo'));
    } catch (e) {
      casilla.checked = !quiere;
      toast(e.message, { error: true });
    } finally {
      casilla.disabled = false;
    }
  };
  return fila(h('label', { class: 'interruptor solo' }, casilla));
}

// Tema de este dispositivo: Automático (sigue al celular), Claro u Oscuro. Lo aplica el script del <head> de
// index.html; acá solo se guarda y se le avisa.
function filaTema() {
  let elegido = 'auto';
  try { elegido = localStorage.getItem(CLAVE_TEMA) || 'auto'; } catch { /* sin almacenamiento: Automático */ }
  const opciones = chips([
    { valor: 'auto', texto: textoPanel('panel.tema.auto', 'Automático') },
    { valor: 'claro', texto: textoPanel('panel.tema.claro', 'Claro') },
    { valor: 'oscuro', texto: textoPanel('panel.tema.oscuro', 'Oscuro') },
  ], elegido, (valor) => {
    try {
      if (valor === 'auto') localStorage.removeItem(CLAVE_TEMA); else localStorage.setItem(CLAVE_TEMA, valor);
    } catch {
      toast(textoPanel('panel.tema.sin_guardar', 'Este navegador no deja guardar el tema: queda en Automático'));
    }
    document.dispatchEvent(new Event('cambio-tema'));
  });
  opciones.classList.add('tema-opciones');
  return filaCuenta('tema', textoPanel('panel.tema', 'Tema'),
    h('div', { class: 't2' }, textoPanel('panel.tema.ayuda', 'Automático sigue al celular')), { debajo: opciones });
}

// Todo lo que no es de uso diario, agrupado. Cada destino está a un toque. En pantallas grandes
// Negocio y Catálogo están en el menú lateral y acá queda solo la cuenta.
export async function mostrar(cont) {
  const item = (href, ico, texto, sub) => h('li', {}, h('a', { class: 'fila', href },
    h('span', { class: 'fila-ico' }, icono(ico)),
    h('div', { class: 'princ' }, h('div', { class: 't1' }, texto), sub ? h('div', { class: 't2' }, sub) : null),
    icono('derecha', 'icono chev')));
  const seccion = (titulo, ...items) => h('div', { class: 'solo-celular' },
    h('h2', { class: 'seccion-titulo' }, titulo), h('ul', { class: 'lista' }, items));

  const clave = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const repetir = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const guardarClave = h('button', { class: 'btn', type: 'button' }, 'Guardar contraseña');
  guardarClave.onclick = () => conBoton(guardarClave, async () => {
    if (clave.value.length < 8) {
      throw new Error(textoPanel('panel.mas.clave_corta', 'La contraseña tiene que tener al menos 8 caracteres'));
    }
    if (clave.value !== repetir.value) throw new Error(textoPanel('panel.mas.clave_distinta', 'Las contraseñas no coinciden'));
    const { error } = await sb.auth.updateUser({ password: clave.value });
    if (error) throw new Error(error.message);
    clave.value = repetir.value = '';
    toast(textoPanel('panel.mas.clave_guardada', 'Contraseña guardada: la próxima vez podés entrar con ella'));
  });

  const salir = h('button', { class: 'fila', type: 'button' },
    h('span', { class: 'fila-ico' }, icono('salir')), h('div', { class: 'princ' }, h('div', { class: 't1' }, 'Salir')));
  salir.onclick = () => conBoton(salir, () => sb.auth.signOut());

  vaciar(cont,
    seccion('Negocio',
      item('#/pedidos', 'carrito', 'Pedidos web',
        textoPanel('panel.mas.pedidos', 'Los que llegan desde la web: confirmar o rechazar')),
      item('#/clientes', 'clientes', 'Clientes', textoPanel('panel.mas.clientes', 'Libreta, historial y duplicados')),
      item('#/recomendaciones', 'regalo', 'Recomendaciones',
        textoPanel('panel.mas.recomendaciones', 'Campaña de descuento por recomendar, códigos y resultados')),
      item('#/promos', 'etiqueta', 'Promociones',
        textoPanel('panel.mas.promos', 'Descuentos por fechas en las Box y sabores que elijas')),
      item('#/gastos', 'gasto', 'Gastos e ingresos',
        textoPanel('panel.mas.gastos', 'Mermas, comisiones, retiros y aportes de socios')),
      item('#/cierre', 'grafico', 'Cierre de mes',
        textoPanel('panel.mas.cierre', 'Resumen del mes para guardar en PDF o mandar por WhatsApp'))),
    seccion('Catálogo',
      item('#/sabores', 'roll', 'Sabores y recetas',
        textoPanel('panel.mas.sabores', 'Activar, ocultar en la web, precio por unidad')),
      item('#/formatos', 'caja', 'Formatos', textoPanel('panel.mas.formatos', 'Cajas, personalizado y unidad')),
      item('#/precios', 'etiqueta', 'Precios', textoPanel('panel.mas.precios', 'Vigentes, programados e historial')),
      item('#/insumos', 'bolsa', 'Insumos', textoPanel('panel.mas.insumos', 'Ingredientes, packaging y mínimos')),
      item('#/catalogo', 'grafico', 'Costos y márgenes', textoPanel('panel.mas.catalogo', 'Costo por roll y margen por caja'))),
    seccion('Web',
      item('#/web', 'etiqueta', 'Textos e imágenes',
        textoPanel('panel.mas.web', 'Inicio, dónde encontrarnos, contacto y WhatsApp de la web')),
      item('#/redes', 'redes', 'Instagram', textoPanel('panel.mas.redes', 'Seguidores, vistas y sugerencias de contenido')),
      item('#/visitas', 'grafico', 'Visitas',
        textoPanel('panel.mas.visitas', 'Cuántos entran a la web, de dónde vienen y cuántos piden'))),
    h('h2', { class: 'seccion-titulo' }, 'Cuenta'),
    h('ul', { class: 'lista' },
      filaAvisos(),
      filaTema(),
      h('li', {}, h('a', { class: 'fila', href: '#/dispositivos' }, h('span', { class: 'fila-ico' }, icono('llave')),
        h('div', { class: 'princ' }, h('div', { class: 't1' }, 'Dispositivos'),
          h('div', { class: 't2' }, textoPanel('panel.mas.dispositivos', 'Celulares y compus que pueden usar la app'))),
        icono('derecha', 'icono chev'))),
      h('li', {}, h('details', { class: 'fila-detalle' },
        h('summary', { class: 'fila' }, h('span', { class: 'fila-ico' }, icono('llave')),
          h('div', { class: 'princ' }, h('div', { class: 't1' }, 'Contraseña'),
            h('div', { class: 't2' }, textoPanel('panel.mas.clave', 'Para entrar sin esperar el mail')))),
        h('div', { class: 'fila-cuerpo' },
          campo('Contraseña nueva', clave),
          campo('Repetila', repetir),
          guardarClave))),
      h('li', {}, salir)),
    h('p', { class: 'pie' }, textoPanel('panel.mas.sesion', 'Sesión de {nombre}', { nombre: sesion.nombre })));
}

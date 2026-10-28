import { sb } from './db.js';

// Textos del panel que se editan en /admin → Web (filas 'panel.*' de contenido_web). Se cargan una vez al
// entrar; si la base no los tiene todavía (migración sin aplicar) o falla, se usa el texto por defecto.
const textos = {};

export async function cargarTextosPanel() {
  try {
    const { data } = await sb.from('contenido_web').select('clave,valor').like('clave', 'panel.%');
    for (const f of data || []) textos[f.clave] = f.valor;
  } catch { /* quedan los textos por defecto */ }
}

// textoPanel('panel.semana', 'Semana del sábado {fecha}', { fecha: '31/10' }) → "Semana del sábado 31/10".
export function textoPanel(clave, defecto, vars = {}) {
  return (textos[clave] || defecto).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

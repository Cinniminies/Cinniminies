// Descuento por recomendación (docs/descuento-plan/logica.md). La web pregunta si hay campaña y qué significa
// un código para quien pide; la base decide todo (campana_web y consultar_codigo).
const { encabezados } = require('./supabase.js');

class ErrorRecomendacion extends Error {}

async function rpc(nombre, args, { url, clave, fetch: pedir = fetch }) {
  const r = await pedir(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { ...encabezados(clave), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(`Supabase respondió ${r.status} a ${nombre}: ${detalle.slice(0, 300)}`);
  }
  return r.json();
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

// { activa, porcentaje?, tope?, hasta? } o, terminada la campaña con bonos por usar, { activa: false, solo_canje: true }
async function leerCampana(prueba, conf) {
  const c = await rpc('campana_web', { p_prueba: prueba }, conf);
  if (c?.activa) return { activa: true, porcentaje: num(c.porcentaje), tope: num(c.tope), hasta: c.hasta };
  return c?.solo_canje === true ? { activa: false, solo_canje: true } : { activa: false };
}

// Solo letras y números, como los guarda la base (ANA-K7P → ANAK7P).
const limpiarCodigo = (x) => (typeof x === 'string' ? x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : '');
const limpiarTelefono = (x) => (typeof x === 'string' ? x.replace(/\D/g, '').slice(0, 15) : '');

const ESTADOS = new Set(['sin_campana', 'no_existe', 'propio', 'ya_cliente', 'recomendado', 'existe']);

const fecha = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);

// { estado, nombre?, porcentaje?, tope?, campana?, bono?, bono_hasta? }: deja pasar solo esos campos
// (lo del saldo y el bono, solo con el código propio).
async function consultarCodigo(cuerpo, prueba, conf) {
  const codigo = limpiarCodigo(cuerpo?.codigo);
  if (codigo.length < 4) throw new ErrorRecomendacion('Escribí el código completo');
  const r = await rpc('consultar_codigo', { p_codigo: codigo, p_telefono: limpiarTelefono(cuerpo?.telefono), p_prueba: prueba }, conf);
  if (!ESTADOS.has(r?.estado)) throw new Error(`consultar_codigo devolvió ${JSON.stringify(r).slice(0, 200)}`);
  const salida = { estado: r.estado };
  if (typeof r.nombre === 'string') salida.nombre = r.nombre.slice(0, 40);
  if (r.estado === 'propio') {
    Object.assign(salida, { porcentaje: num(r.porcentaje), tope: num(r.tope), campana: r.campana !== false });
    if (num(r.bono) && fecha(r.bono_hasta)) Object.assign(salida, { bono: num(r.bono), bono_hasta: r.bono_hasta });
  }
  return salida;
}

module.exports = { ErrorRecomendacion, leerCampana, consultarCodigo, limpiarCodigo };

// Comprobantes de transferencia de los pedidos web: el archivo llega en base64 dentro de un JSON,
// se sube al bucket privado "comprobantes" y se anota en el pedido con adjuntar_comprobante(), que
// pide el código y el celular del pedido (así nadie adjunta archivos a pedidos ajenos).
const crypto = require('node:crypto');
const { encabezados, rpc } = require('./supabase.js');

const MAX_ARCHIVO = 3 * 1024 * 1024;          // la web achica las fotos; un PDF del banco pesa mucho menos
const MAX_CUERPO = Math.ceil(MAX_ARCHIVO * 4 / 3) + 2000; // base64 + los otros campos

class ErrorComprobante extends Error {}

// Tipo según los primeros bytes (no se confía en lo que dice el navegador).
function tipoReal(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', 'webp'];
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return ['application/pdf', 'pdf'];
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(buf.subarray(8, 12).toString('latin1'))) {
    return ['image/heic', 'heic'];
  }
  return null;
}

// { codigo, telefono, archivo } → { codigo, telefono, buf, tipo, ext } o ErrorComprobante.
function armarComprobante(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorComprobante('Pedido inválido');
  const codigo = typeof b.codigo === 'string' ? b.codigo.trim().toUpperCase() : '';
  const telefono = typeof b.telefono === 'string' ? b.telefono.replace(/\D/g, '') : '';
  if (!/^CM-\d{4}-[A-Z0-9]{4,8}$/.test(codigo)) throw new ErrorComprobante('Falta el número de pedido');
  if (!/^09[1-9]\d{6}$/.test(telefono)) throw new ErrorComprobante('Falta el celular del pedido');
  if (typeof b.archivo !== 'string' || !b.archivo) throw new ErrorComprobante('Falta el archivo');
  const buf = Buffer.from(b.archivo.replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > MAX_ARCHIVO) throw new ErrorComprobante('El archivo es muy grande (máximo 3 MB)');
  const tipo = tipoReal(buf);
  if (!tipo) throw new ErrorComprobante('Subí una foto, una captura o un PDF');
  return { codigo, telefono, buf, tipo: tipo[0], ext: tipo[1] };
}

async function guardarComprobante({ codigo, telefono, buf, tipo, ext }, { url, clave, fetch: pedir = fetch }) {
  const ruta = `${codigo}/${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const objeto = `${url}/storage/v1/object/comprobantes/${ruta}`;
  const subida = await pedir(objeto, { method: 'POST', headers: { ...encabezados(clave), 'Content-Type': tipo }, body: buf });
  if (!subida.ok) throw new Error(`Storage respondió ${subida.status}: ${(await subida.text().catch(() => '')).slice(0, 300)}`);

  try {
    await rpc('adjuntar_comprobante', { p_codigo: codigo, p_telefono: telefono, p_ruta: ruta }, { url, clave, fetch: pedir },
      { ErrorCliente: ErrorComprobante });
    return { codigo };
  } catch (e) {
    // No quedó anotado: el archivo no sirve. Se borra (si falla, queda huérfano en un bucket privado).
    await pedir(objeto, { method: 'DELETE', headers: encabezados(clave) }).catch(() => {});
    throw e;
  }
}

module.exports = { MAX_ARCHIVO, MAX_CUERPO, tipoReal, armarComprobante, guardarComprobante, ErrorComprobante };

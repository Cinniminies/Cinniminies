import { sb } from './db.js';

// Fotos para la web: se achican en el navegador (lado mayor 1200 px, WebP o JPEG) y se suben a un
// bucket público de Supabase Storage ("sabores" o "web"). En la base queda la URL pública; también
// vale una ruta del sitio (img/…).
const LADO_MAX = 1200;

// src para mostrarla dentro de /admin (las rutas del sitio son relativas a la raíz).
export const srcFoto = (f) => (!f ? null : /^https?:\/\//.test(f) ? f : `/${f.replace(/^\/+/, '')}`);

const rutaEnBucket = (bucket, url) => url?.match(new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`))?.[1] ?? null;

async function achicar(archivo) {
  const bmp = await createImageBitmap(archivo).catch(() => { throw new Error('No se pudo leer la imagen'); });
  const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  const aBlob = (tipo) => new Promise((ok) => lienzo.toBlob(ok, tipo, 0.82));
  const webp = await aBlob('image/webp');
  // Safari viejo no genera WebP y devuelve PNG: ahí va JPEG
  return webp?.type === 'image/webp' ? webp : aBlob('image/jpeg');
}

export async function subirFoto(bucket, archivo, base) {
  const blob = await achicar(archivo);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const nombre = `${(base || 'foto').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(nombre, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return sb.storage.from(bucket).getPublicUrl(nombre).data.publicUrl;
}

// Borra una foto del bucket si es de ese bucket (las rutas img/… y los links externos no se tocan).
export async function borrarFotoDelBucket(bucket, url) {
  const ruta = rutaEnBucket(bucket, url);
  if (ruta) await sb.storage.from(bucket).remove([decodeURIComponent(ruta)]).catch(() => {});
}

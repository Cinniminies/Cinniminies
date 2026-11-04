/* Achica una foto en el navegador antes de subirla. La usan la web (el comprobante de transferencia, en cinniminies.js)
   y /admin (las fotos de sabores y de la web, en admin/js/fotos.js): por eso es un script común que queda en
   globalThis y no un módulo, como carrito-guardado.js. */
globalThis.achicarImagen = async (archivo, { ladoMax, tipos = ['image/jpeg'], calidad = 0.85 }) => {
  // Si el navegador no la sabe abrir (p. ej. HEIC fuera de Safari), tira el error y decide quien la llamó.
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  // El primer tipo que el navegador sepa generar (Safari viejo no genera WebP y devuelve PNG).
  for (const tipo of tipos) {
    const blob = await new Promise((ok) => lienzo.toBlob(ok, tipo, calidad));
    if (blob?.type === tipo) return blob;
  }
  return null;
};

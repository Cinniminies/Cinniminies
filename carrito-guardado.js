/* Carrito guardado en el navegador (idea 6.4): si el cliente recarga o cierra la pestaña sin querer, al volver
   encuentra sus cajas. Acá está solo la parte que no toca la página (armar lo que se guarda y revisar lo leído), para
   poder probarla con node --test; leer y escribir localStorage lo hace cinniminies.js. */
globalThis.carritoGuardado = (() => {
  // Lo guardado vence al terminar el sábado de entrega: la semana de pedidos va de domingo a sábado, y un carrito de
  // una semana que ya cerró puede tener sabores, precios o promos que ya no corren. `sabado` es el del pedido
  // ('AAAA-MM-DD', de /api/catalogo); sin él, el sábado de esta semana (hoy, si es sábado).
  function venceAl(ahora, sabado) {
    let fin;
    if (sabado) {
      fin = new Date(`${sabado}T00:00:00`);
    } else {
      fin = new Date(ahora);
      fin.setDate(fin.getDate() + 6 - fin.getDay());
    }
    fin.setHours(23, 59, 59, 999);
    return fin.getTime();
  }

  // Lo que va a localStorage: { vence, cajas: [{ size, flavors }] } (los nombres de los sabores salen del menú al volver).
  function armarGuardado(cajas, { ahora = new Date(), sabado } = {}) {
    return { vence: venceAl(ahora, sabado), cajas: cajas.map(({ size, flavors }) => ({ size, flavors })) };
  }

  const esCantidad = (n) => Number.isInteger(n) && n > 0;

  // La caja tal como se guardó, o null si su tamaño o alguno de sus sabores ya no está en el menú o si se pasa del tope.
  function cajaVigente(caja, { tamanos, sabores, topeDe }) {
    if (!caja || !tamanos.includes(caja.size) || !caja.flavors || typeof caja.flavors !== 'object') return null;
    const cantidades = Object.entries(caja.flavors);
    if (!cantidades.length || cantidades.some(([id, n]) => !sabores.includes(id) || !esCantidad(n))) return null;
    const rolls = cantidades.reduce((suma, [, n]) => suma + n, 0);
    return rolls <= topeDe(caja) ? { size: caja.size, flavors: Object.fromEntries(cantidades) } : null;
  }

  // Las cajas de lo leído de localStorage que siguen valiendo con el menú de hoy. `tamanos`: [6, 12, 'custom'] o los
  // que haya; `sabores`: ids; `topeDe(caja)`: cuántos rolls entran (boxCap). Si venció o vino roto, ninguna.
  function cajasVigentes(guardado, { ahora = Date.now(), ...menu }) {
    if (!guardado || !Array.isArray(guardado.cajas) || !(guardado.vence > ahora)) return [];
    return guardado.cajas.map(caja => cajaVigente(caja, menu)).filter(Boolean);
  }

  return { armarGuardado, cajasVigentes };
})();

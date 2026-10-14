// Historial de precios de un insumo (ideas 3.4): cómo cambió el precio en cada compra y cuánto
// movió eso el costo de lo que se vende. Cuentas puras, sin pantalla, para poder probarlas.

// Compras con cantidad, de la más vieja a la más nueva: [{ fecha, precio }] (precio por unidad base).
// `compras`: filas de la tabla compras ({ fecha, creado_en, total, cantidad_base }).
export function puntos(compras) {
  return compras
    .filter((c) => Number(c.cantidad_base) > 0 && c.total != null)
    .sort((a, b) => (a.fecha === b.fecha ? String(a.creado_en).localeCompare(String(b.creado_en)) : a.fecha.localeCompare(b.fecha)))
    .map((c) => ({ fecha: c.fecha, precio: Number(c.total) / Number(c.cantidad_base) }));
}

// Primera y última compra y el cambio relativo entre las dos (null si hay menos de dos).
export function cambio(pts) {
  if (pts.length < 2) return null;
  const desde = pts[0];
  const hasta = pts[pts.length - 1];
  return { desde, hasta, diferencia: hasta.precio - desde.precio, relativo: desde.precio ? (hasta.precio - desde.precio) / desde.precio : null };
}

// Cuánto cambió el costo de cada roll por la diferencia de precio de este insumo, con las recetas de hoy.
// recetas: [{ sabor_id, cantidad }] del insumo; sabores: [{ id, nombre, rolls_por_tanda, activo }];
// costos: { sabor_id: costo_roll actual }. Devuelve de mayor a menor impacto.
export function impactoPorRoll(diferencia, recetas, sabores, costos = {}) {
  return recetas
    .map((r) => {
      const s = sabores.find((x) => x.id === r.sabor_id);
      if (!s || !Number(r.cantidad)) return null;
      const porRoll = (Number(r.cantidad) * diferencia) / s.rolls_por_tanda;
      const costo = costos[s.id] != null ? Number(costos[s.id]) : null;
      return { sabor: s.nombre, activo: s.activo, porRoll, relativo: costo ? porRoll / costo : null };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.porRoll) - Math.abs(a.porRoll));
}

// Lo mismo para el packaging: cada caja que lleva este insumo (o la caja misma).
// usos: [{ caja, cantidad }]. Devuelve [{ caja, porCaja }].
export function impactoPorCaja(diferencia, usos) {
  return usos
    .filter((u) => Number(u.cantidad) > 0)
    .map((u) => ({ caja: u.caja, porCaja: Number(u.cantidad) * diferencia }))
    .sort((a, b) => Math.abs(b.porCaja) - Math.abs(a.porCaja));
}

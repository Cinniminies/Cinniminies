-- Pruebas de las reglas de negocio (sección 5). Se corren pegándolas en el SQL editor
-- de Supabase (o con execute_sql). No dejan nada guardado: terminan siempre con un error
-- que deshace todo. Si el mensaje final es "TODO OK", pasaron.
-- Hay dos bloques `do $$ … $$`: corré uno por vez (el primero corta la ejecución al terminar).

do $$
declare
  b6 uuid := (select id from formatos where nombre = 'Box de 6');
  b12 uuid := (select id from formatos where nombre = 'Box de 12');
  pers uuid := (select id from formatos where nombre = 'Personalizado');
  b4 uuid := (select id from formatos where nombre = 'Box de 4');
  ca uuid := (select id from sabores where nombre = 'Canela');
  ddl uuid := (select id from sabores where nombre = 'Dulce de Leche');
  oreo uuid := (select id from sabores where nombre = 'Oreo');
  sd uuid := (select id from sabores where nombre = 'Sin detalle');
  har uuid := (select id from insumos where nombre = 'Harina');
  r jsonb;
  antes jsonb;
  despues jsonb;
  fallo text;
  linea jsonb;
begin
  -- 5.2 Costos por roll con los precios de referencia del 22/09 (sin compras cargadas).
  if not exists (select 1 from compras) then
    assert round(costo_roll(ca, '2026-09-22'), 2) = 9.51, 'costo Canela';
    assert round(costo_roll(ddl, '2026-09-22'), 2) = 9.55, 'costo DDL';
    assert round(costo_roll(oreo, '2026-09-22'), 2) = 15.01, 'costo Oreo';
  end if;

  -- 5.3 Caja fija mixta con envío
  r := calcular_venta(jsonb_build_object('fecha', '2026-09-22', 'entrega', 'envio', 'lineas', jsonb_build_array(
         jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', ca, 'unidades', 2), jsonb_build_object('sabor_id', oreo, 'unidades', 4))))));
  assert (r->>'precio_lista')::numeric = 250, 'precio box 6';
  assert (r->>'cobro_envio')::numeric = 25, 'envío';
  -- Costo de caja = caja + papel manteca + sticker (caja_insumos)
  assert (r->>'costo_caja')::numeric = round(costo_caja((select caja_insumo_id from formatos where id = b6)), 2),
         'costo caja 6 con packaging';

  -- 5.3 Personalizado: suma por unidad y caja sugerida de 6 (5 rolls). Precio especial.
  r := calcular_venta(jsonb_build_object('entrega', 'retiro', 'precio_especial', 1100, 'lineas', jsonb_build_array(
         jsonb_build_object('formato_id', b12, 'cantidad', 2, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', ca, 'unidades', 24))),
         jsonb_build_object('formato_id', pers, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', ddl, 'unidades', 3), jsonb_build_object('sabor_id', oreo, 'unidades', 2))))));
  assert (r->>'precio_lista')::numeric = 900 + 3 * 55 + 2 * 60, 'precio 2 box 12 + personalizado';
  assert (r->>'descuento')::numeric = 1185 - 1100, 'descuento';
  assert (r->>'cobro_envio')::numeric = 0, 'retiro sin envío';
  assert (r->>'costo_caja')::numeric
         = round(2 * costo_caja((select caja_insumo_id from formatos where id = b12)), 2)
           + round(costo_caja((select caja_insumo_id from formatos where id = b6)), 2), 'cajas 2×12 + 1×6';

  -- Sin caja
  r := calcular_venta(jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
         'formato_id', pers, 'caja_insumo_id', null, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', oreo, 'unidades', 8))))));
  assert (r->>'costo_caja')::numeric = 0, 'personalizado sin caja';

  -- 5.4 Validaciones que tienen que fallar
  foreach linea in array array[
    jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 5))),
    jsonb_build_object('formato_id', b6),
    jsonb_build_object('formato_id', pers, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 2))),
    jsonb_build_object('formato_id', pers, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 13))),
    jsonb_build_object('formato_id', b4, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 4))),
    jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', sd, 'unidades', 6)))
  ] loop
    fallo := null;
    begin
      perform calcular_venta(jsonb_build_object('lineas', jsonb_build_array(linea)));
    exception when others then
      fallo := sqlerrm;
    end;
    assert fallo is not null, 'tenía que fallar: ' || linea::text;
  end loop;

  -- 5.5 El snapshot no cambia al subir precios o costos
  r := registrar_venta(jsonb_build_object('fecha', '2026-09-20', 'entrega', 'envio', 'medio_pago', 'Efectivo',
         'cliente', jsonb_build_object('nombre', 'Prueba', 'origen', 'IG'),
         'lineas', jsonb_build_array(jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', ca, 'unidades', 6))))));
  select to_jsonb(v) into antes from v_ventas v where id = (r->>'venta_id')::uuid;
  insert into precios (formato_id, precio, vigente_desde) values (b6, 999, '2026-09-01');
  insert into compras (fecha, insumo_id, categoria, cantidad_base, total)
  values ('2026-09-01', har, 'ingrediente', 1000, 1000);
  select to_jsonb(v) into despues from v_ventas v where id = (r->>'venta_id')::uuid;
  assert antes = despues, 'la venta cambió al subir precio y costo';
  assert (calcular_venta(jsonb_build_object('fecha', '2026-09-20', 'lineas', jsonb_build_array(
            jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(
              jsonb_build_object('sabor_id', ca, 'unidades', 6))))))->>'precio_lista')::numeric = 999,
         'el precio nuevo no se aplica a ventas nuevas';

  -- Tanda: consume receta × cantidad
  r := registrar_tanda(jsonb_build_object('sabor_id', ca, 'cantidad', 2));
  assert (select cantidad from tanda_consumos where tanda_id = (r->>'tanda_id')::uuid and insumo_id = har) = 900,
         'consumo de harina de 2 tandas';
  assert (r->>'rolls')::int = 24, 'rolls de 2 tandas';

  -- 5.7 Una venta posterior al último conteo descuenta la caja y lo que lleva
  select jsonb_object_agg(nombre, teorico) into antes from v_stock
   where nombre in ('Caja Box de 6', 'Papel manteca', 'Stickers');
  perform registrar_venta(jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object(
            'formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 6))))));
  select jsonb_object_agg(nombre, teorico) into despues from v_stock
   where nombre in ('Caja Box de 6', 'Papel manteca', 'Stickers');
  assert (despues->>'Caja Box de 6')::numeric = (antes->>'Caja Box de 6')::numeric - 1, 'stock caja 6';
  assert (despues->>'Papel manteca')::numeric = (antes->>'Papel manteca')::numeric - 1, 'stock papel';
  assert (despues->>'Stickers')::numeric = (antes->>'Stickers')::numeric - 1, 'stock stickers';

  raise exception 'TODO OK';
end $$;

-- Funciones de carga de /admin (Etapa 2): editar ventas, compras y fusionar clientes.
do $$
declare
  b6 uuid := (select id from formatos where nombre = 'Box de 6');
  b12 uuid := (select id from formatos where nombre = 'Box de 12');
  ca uuid := (select id from sabores where nombre = 'Canela');
  oreo uuid := (select id from sabores where nombre = 'Oreo');
  har uuid := (select id from insumos where nombre = 'Harina');
  leche uuid := (select id from insumos where nombre = 'Leche');
  r jsonb;
  e jsonb;
  antes jsonb;
  c1 uuid;
  c2 uuid;
  v2 uuid;
  fallo text;
begin
  r := registrar_venta(jsonb_build_object('fecha', '2026-09-20', 'entrega', 'retiro', 'medio_pago', 'efectivo',
         'cliente', jsonb_build_object('nombre', 'Prueba A', 'contacto', '099'),
         'lineas', jsonb_build_array(jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(
           jsonb_build_object('sabor_id', ca, 'unidades', 6))))));
  select to_jsonb(v) into antes from v_ventas v where id = (r->>'venta_id')::uuid;

  -- Cambiar solo datos (estado, entrega, notas) no toca el snapshot; pasar a envío cobra el envío
  e := actualizar_venta((r->>'venta_id')::uuid, '{"estado_pago": "pendiente", "entrega": "envio", "notas": "x"}');
  assert e->>'estado_pago' = 'pendiente' and (e->>'cobro_envio')::numeric = 25, 'datos + envío';
  assert e->>'costo_produccion' = antes->>'costo_produccion' and e->>'precio_cobrado' = antes->>'precio_cobrado',
         'el snapshot no cambia al editar datos';

  -- Precio especial y vuelta al precio de lista
  e := actualizar_venta((r->>'venta_id')::uuid, '{"precio_especial": 200}');
  assert (e->>'descuento')::numeric = 50, 'precio especial';
  e := actualizar_venta((r->>'venta_id')::uuid, '{"precio_especial": null}');
  assert (e->>'precio_cobrado')::numeric = 250, 'vuelve al precio de lista';

  -- Cambiar los productos recalcula
  e := actualizar_venta((r->>'venta_id')::uuid, jsonb_build_object('lineas', jsonb_build_array(
         jsonb_build_object('formato_id', b12, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', oreo, 'unidades', 12))))));
  assert (e->>'precio_lista')::numeric = 450 and e->>'formatos' = 'Box de 12' and (e->>'rolls')::int = 12, 'productos nuevos';

  -- Compras: conversión a la unidad base del insumo
  r := registrar_compra(jsonb_build_object('insumo_id', har, 'cantidad', 5, 'unidad', 'kg', 'total', 200));
  assert (r->>'cantidad_base')::numeric = 5000, 'kg a g';
  r := registrar_compra(jsonb_build_object('insumo_id', leche, 'cantidad', 2, 'unidad', 'L', 'total', 90));
  assert (r->>'cantidad_base')::numeric = 2000, 'L a ml';
  begin
    perform registrar_compra(jsonb_build_object('insumo_id', leche, 'cantidad', 2, 'unidad', 'kg', 'total', 90));
  exception when others then
    fallo := sqlerrm;
  end;
  assert fallo = 'Leche se mide en ml', 'unidad incompatible: ' || coalesce(fallo, 'no falló');
  r := registrar_compra('{"categoria": "equipamiento", "descripcion": "Rodillo", "total": 300}');
  assert (select categoria from compras where id = (r->>'compra_id')::uuid) = 'equipamiento', 'equipamiento';

  -- Fusionar clientes: las ventas pasan al que queda, que hereda el contacto
  insert into clientes (nombre) values ('Dup 1') returning id into c1;
  insert into clientes (nombre, contacto) values ('Dup 2', '098') returning id into c2;
  r := registrar_venta(jsonb_build_object('cliente_id', c2, 'lineas', jsonb_build_array(jsonb_build_object(
         'formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 6))))));
  v2 := (r->>'venta_id')::uuid;
  perform fusionar_clientes(c1, c2);
  assert (select cliente_id from ventas where id = v2) = c1, 'la venta pasó al que queda';
  assert (select contacto from clientes where id = c1) = '098', 'hereda el contacto';
  assert not exists (select 1 from clientes where id = c2), 'el duplicado se borra';

  raise exception 'TODO OK';
end $$;

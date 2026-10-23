-- Pruebas de las reglas de negocio (sección 5). Se corren pegándolas en el SQL editor
-- de Supabase (o con execute_sql). No dejan nada guardado: terminan siempre con un error
-- que deshace todo. Si el mensaje final es "TODO OK", pasaron.
-- Hay varios bloques `do $$ … $$`: corré uno por vez (cada uno corta la ejecución al terminar).

do $$
declare
  b6 uuid := (select id from formatos where nombre = 'Box de 6');
  b12 uuid := (select id from formatos where nombre = 'Box de 12');
  pers uuid := (select id from formatos where nombre = 'Personalizado');
  b4 uuid := (select id from formatos where nombre = 'Box de 4');
  ca uuid := (select id from sabores where nombre = 'Canela');
  ddl uuid := (select id from sabores where nombre = 'Dulce de Leche');
  oreo uuid := (select id from sabores where nombre = 'Oreo');
  inactivo uuid;
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
  insert into sabores (nombre, activo, visible_web) values ('PRUEBA inactivo', false, false)
    returning id into inactivo;
  foreach linea in array array[
    jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 5))),
    jsonb_build_object('formato_id', b6),
    jsonb_build_object('formato_id', pers, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 2))),
    jsonb_build_object('formato_id', pers, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 13))),
    jsonb_build_object('formato_id', b4, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 4))),
    jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', inactivo, 'unidades', 6)))
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
  -- Editar la tanda: salieron 3 → consumo y rolls en proporción; los rolls cargados a mano se respetan
  perform actualizar_tanda((r->>'tanda_id')::uuid, '{"cantidad": 3}');
  assert (select cantidad from tanda_consumos where tanda_id = (r->>'tanda_id')::uuid and insumo_id = har) = 1350,
         'consumo de harina al pasar a 3 tandas';
  assert (select rolls from tandas where id = (r->>'tanda_id')::uuid) = 36, 'rolls al pasar a 3 tandas';
  perform actualizar_tanda((r->>'tanda_id')::uuid, '{"rolls": 40, "notas": "PRUEBA"}');
  assert (select cantidad = 3 and rolls = 40 and notas = 'PRUEBA' from tandas where id = (r->>'tanda_id')::uuid),
         'rolls y notas a mano';
  perform actualizar_tanda((r->>'tanda_id')::uuid, '{"cantidad": 2, "rolls": 24}');
  assert (select cantidad from tanda_consumos where tanda_id = (r->>'tanda_id')::uuid and insumo_id = har) = 900,
         'vuelve a 2 tandas';

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
  assert not (select por_hacer from ventas where id = (r->>'venta_id')::uuid), 'por defecto no queda por hacer';
  select to_jsonb(v) into antes from v_ventas v where id = (r->>'venta_id')::uuid;

  -- Cambiar solo datos (estado, entrega, notas) no toca el snapshot; pasar a envío cobra el envío
  e := actualizar_venta((r->>'venta_id')::uuid, '{"estado_pago": "pendiente", "entrega": "envio", "notas": "x"}');
  assert e->>'estado_pago' = 'pendiente' and (e->>'cobro_envio')::numeric = 25, 'datos + envío';
  assert e->>'costo_produccion' = antes->>'costo_produccion' and e->>'precio_cobrado' = antes->>'precio_cobrado',
         'el snapshot no cambia al editar datos';
  assert not (e->>'por_hacer')::boolean, 'editar otra cosa no toca por_hacer';

  -- Precio especial y vuelta al precio de lista
  e := actualizar_venta((r->>'venta_id')::uuid, '{"precio_especial": 200}');
  assert (e->>'descuento')::numeric = 50, 'precio especial';
  e := actualizar_venta((r->>'venta_id')::uuid, '{"precio_especial": null}');
  assert (e->>'precio_cobrado')::numeric = 250, 'vuelve al precio de lista';

  -- Cambiar los productos recalcula
  e := actualizar_venta((r->>'venta_id')::uuid, jsonb_build_object('lineas', jsonb_build_array(
         jsonb_build_object('formato_id', b12, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', oreo, 'unidades', 12))))));
  assert (e->>'precio_lista')::numeric = 450 and e->>'formatos' = 'Box de 12' and (e->>'rolls')::int = 12, 'productos nuevos';

  -- Con precio especial, cambiar los productos lo conserva (no vuelve al de lista sin avisar)
  e := actualizar_venta((r->>'venta_id')::uuid, '{"precio_especial": 400}');
  e := actualizar_venta((r->>'venta_id')::uuid, jsonb_build_object('lineas', jsonb_build_array(
         jsonb_build_object('formato_id', b6, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 6))))));
  assert (e->>'precio_lista')::numeric = 250 and (e->>'precio_cobrado')::numeric = 400, 'conserva el precio especial';

  -- Pasar la venta a un cliente nuevo: se crea en la misma operación y la venta toma su origen
  e := actualizar_venta((r->>'venta_id')::uuid, '{"cliente": {"nombre": "Prueba B", "origen": "Web"}}');
  assert e->>'cliente' = 'Prueba B' and e->>'origen' = 'Web', 'cliente nuevo al editar';

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
  r := registrar_compra('{"categoria": "otro", "descripcion": "Rodillo", "total": 300}');
  assert (select categoria from compras where id = (r->>'compra_id')::uuid) = 'otro', 'compra sin insumo';
  -- Las mejoras del negocio (palote, balanza) ya no son compras: van en Gastos con tipo 'mejora'
  fallo := null;
  begin
    perform registrar_compra('{"categoria": "equipamiento", "descripcion": "Palote", "total": 300}');
  exception when others then
    fallo := sqlerrm;
  end;
  assert fallo like 'Las mejoras del negocio%', 'equipamiento rechazado: ' || coalesce(fallo, 'no falló');
  insert into gastos (fecha, descripcion, tipo, monto) values ('2026-09-15', 'PRUEBA palote', 'mejora', 300);
  assert (select es_gasto from v_gastos where descripcion = 'PRUEBA palote'), 'la mejora es un gasto';

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

-- Catálogo y stock (Etapa 3): el flujo de aceptación con un sabor "Pistacho", precios con
-- historial, packaging de caja, conteo con desvío, "¿Qué compro?" y unidad protegida.
do $$
declare
  ca uuid := (select id from sabores where nombre = 'Canela');
  har uuid := (select id from insumos where nombre = 'Harina');
  man uuid := (select id from insumos where nombre = 'Manteca');
  caja6 uuid := (select id from insumos where nombre = 'Caja Box de 6');
  papel uuid := (select id from insumos where nombre = 'Papel manteca');
  b6 uuid := (select id from formatos where nombre = 'Box de 6');
  pis uuid;
  pist uuid;
  r jsonb;
  c record;
  fallo text;
  n int;
  id1 uuid;
  id2 uuid;
begin
  -- Sabor nuevo con la receta de Canela + pasta de pistacho
  insert into insumos (nombre, tipo, unidad_base, costo_referencia) values ('Pasta de pistacho', 'ingrediente', 'g', 1.2) returning id into pist;
  insert into sabores (nombre, activo) values ('Pistacho', true) returning id into pis;
  perform guardar_receta(pis, (select jsonb_agg(jsonb_build_object('insumo_id', insumo_id, 'cantidad', cantidad)) from recetas where sabor_id = ca)
                              || jsonb_build_array(jsonb_build_object('insumo_id', pist, 'cantidad', 100)));
  assert (select count(*) from recetas where sabor_id = pis) = 9, 'receta copiada + 1';
  assert round(costo_tanda(pis), 2) = round(costo_tanda(ca) + 120, 2), 'costo con pistacho';
  begin
    perform guardar_receta(pis, jsonb_build_array(jsonb_build_object('insumo_id', caja6, 'cantidad', 1)));
  exception when others then
    fallo := sqlerrm;
  end;
  assert fallo = 'La receta solo puede llevar ingredientes', 'receta con packaging: ' || coalesce(fallo, 'no falló');

  -- Precio: corregir el mismo día no duplica; uno con fecha futura queda programado
  id1 := fijar_precio(jsonb_build_object('sabor_id', pis, 'precio', 70, 'vigente_desde', '2026-09-01'));
  id2 := fijar_precio(jsonb_build_object('sabor_id', pis, 'precio', 72, 'vigente_desde', '2026-09-01'));
  assert id1 = id2 and (select precio from precios where id = id1) = 72, 'corrige el mismo día';
  perform fijar_precio(jsonb_build_object('sabor_id', pis, 'precio', 80, 'vigente_desde', '2099-01-01'));
  assert precio_vigente(null, pis) = 72, 'el precio futuro todavía no rige';

  -- Se vende
  r := registrar_venta(jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('formato_id', b6,
         'sabores', jsonb_build_array(jsonb_build_object('sabor_id', pis, 'unidades', 6))))));
  assert (r->>'precio_lista')::numeric = 250, 'box de 6 pistacho';

  -- Packaging de caja
  perform guardar_packaging_caja(caja6, jsonb_build_array(jsonb_build_object('insumo_id', papel, 'cantidad', 2)));
  assert (select count(*) from caja_insumos where caja_insumo_id = caja6) = 1, 'packaging reemplazado';

  -- Conteo con desvío (teórico − contado); el teórico arranca del conteo
  r := registrar_conteo(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('insumo_id', har, 'cantidad', 700))));
  assert (r->0->>'contado')::numeric = 700 and (r->0->>'desvio')::numeric = (r->0->>'teorico')::numeric - 700, 'desvío';
  assert (select teorico from v_stock where insumo_id = har) = 700, 'el teórico arranca del conteo';

  -- ¿Qué compro? 2 tandas de Canela con 700 g de harina: faltan 200 g → 1 bolsa de la última compra
  select * into c from que_comprar(jsonb_build_object(ca::text, 2)) where insumo_id = har;
  assert c.necesario = 900 and c.stock = 700 and c.faltante = 200 and c.paquetes = 1
     and c.costo_estimado = c.precio_presentacion, 'qué compro, harina: ' || row_to_json(c)::text;
  select count(*) into n from que_comprar(jsonb_build_object(ca::text, 2));
  assert n = 8, 'un renglón por ingrediente de la receta';

  -- No se puede cambiar la unidad de un insumo usado
  begin
    update insumos set unidad_base = 'ml' where id = man;
  exception when others then
    fallo := sqlerrm;
  end;
  assert fallo like 'No se puede cambiar la unidad de "Manteca"%', 'unidad protegida: ' || coalesce(fallo, 'no falló');

  raise exception 'TODO OK';
end $$;

-- eliminar_sabor: borra si nunca se usó (con precios y receta); si tiene ventas o tandas lo marca
-- como eliminado (inactivo, fuera de la web) y no deja reactivarlo sin restaurarlo.
do $$
declare s uuid; r text; canela uuid;
begin
  insert into sabores (nombre, slug) values ('PRUEBA borrar', 'prueba-borrar') returning id into s;
  insert into precios (sabor_id, precio, vigente_desde) values (s, 70, current_date);
  insert into recetas (sabor_id, insumo_id, cantidad) select s, id, 10 from insumos limit 1;
  r := eliminar_sabor(s);
  if r <> 'borrado' or exists (select 1 from sabores where id = s) or exists (select 1 from precios where sabor_id = s) then
    raise exception 'FALLA borrado: %', r; end if;
  select id into canela from sabores where slug = 'canela';
  r := eliminar_sabor(canela);
  if r <> 'eliminado' or not (select eliminado and not activo and not visible_web from sabores where id = canela) then
    raise exception 'FALLA eliminado: %', r; end if;
  if (select catalogo_web()->'sabores') @> '[{"id":"canela"}]' then raise exception 'FALLA web'; end if;
  begin
    update sabores set activo = true where id = canela;
    raise exception 'FALLA check';
  exception when check_violation then null;
  end;
  raise exception 'TODO OK';
end $$;

-- Etapa 6: pedidos web. Precio recalculado, validaciones, límite por IP, confirmar a venta y rechazar.
do $$
declare r jsonb; v jsonb; ped uuid; fallo text; n int; ventas_antes int := (select count(*) from ventas);
begin
  -- caja de 6 mezclada + personalizada 1 DDL + 2 Oreo = 250 + 55 + 120 = 425 (con los precios del 25/09)
  r := crear_pedido_web('{"nombre":"PRUEBA Web","telefono":"099 123 456","modalidad":"entrega","direccion":"Calle 1","pago":"Transferencia","notas":"sin nueces",
    "cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":3,"oreo":3}},{"tipo":"personalizado","sabores":{"dulce":1,"oreo":2}}]}', 'hash-prueba');
  assert (r->>'total')::numeric = 425, 'total ' || r::text;
  assert r->>'codigo' ~ '^CM-[0-9]{4}-[A-Z2-9]{4}$', 'codigo ' || (r->>'codigo');
  assert (select count(*) from pedido_cajas c join pedidos p on p.id = c.pedido_id where p.codigo = r->>'codigo') = 2, 'cajas';

  begin perform crear_pedido_web('{"nombre":"X","telefono":"099123456","modalidad":"retiro","pago":"efectivo","cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":5}}]}'); fallo := 'no';
  exception when others then fallo := sqlerrm; end;
  assert fallo like '%lleva 6 rolls y cargaste 5%', 'rolls: ' || fallo;
  begin perform crear_pedido_web('{"nombre":"X","telefono":"12345","modalidad":"retiro","pago":"efectivo","cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]}'); fallo := 'no';
  exception when others then fallo := sqlerrm; end;
  assert fallo like '%celular uruguayo%', 'tel: ' || fallo;
  begin perform crear_pedido_web('{"nombre":"X","telefono":"099123456","modalidad":"retiro","pago":"efectivo","cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":"6"}}]}'); fallo := 'no';
  exception when others then fallo := sqlerrm; end;
  assert fallo like '%Cantidad inválida%', 'cantidad texto: ' || fallo;

  for n in 1..4 loop
    perform crear_pedido_web('{"nombre":"PRUEBA","telefono":"099123456","modalidad":"retiro","pago":"efectivo","cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]}', 'hash-prueba');
  end loop;
  begin perform crear_pedido_web('{"nombre":"PRUEBA","telefono":"099123456","modalidad":"retiro","pago":"efectivo","cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]}', 'hash-prueba'); fallo := 'no';
  exception when others then fallo := sqlerrm; end;
  assert fallo like 'Demasiados pedidos%', 'rate: ' || fallo;

  select id into ped from pedidos where codigo = r->>'codigo';
  v := confirmar_pedido(ped);
  assert (v->>'precio_cobrado')::numeric = 425, 'cobrado ' || v::text;
  assert (select entrega || '/' || estado_pago || '/' || origen from ventas where id = (v->>'venta_id')::uuid) = 'envio/pendiente/Web', 'venta';
  assert (select estado from pedidos where id = ped) = 'confirmado', 'estado';
  begin perform confirmar_pedido(ped); fallo := 'no'; exception when others then fallo := sqlerrm; end;
  assert fallo like '%ya está confirmado%', 'doble: ' || fallo;
  assert (select count(*) from ventas) = ventas_antes + 1, 'una venta';

  select id into ped from pedidos where estado = 'nuevo' limit 1;
  perform rechazar_pedido(ped, 'sin stock');
  assert (select estado || '/' || motivo_rechazo from pedidos where id = ped) = 'rechazado/sin stock', 'rechazo';

  raise exception 'TODO OK';
end $$;

-- Etapa 7: contenido de la web. Checks por tipo y que llegue al catálogo sin tocar el original.
do $$
declare fallos int := 0;
begin
  begin update contenido_web set valor = '095226739' where clave = 'contacto.whatsapp'; exception when check_violation then fallos := fallos + 1; end;
  begin update contenido_web set valor = '@cinni' where clave = 'contacto.instagram'; exception when check_violation then fallos := fallos + 1; end;
  begin update contenido_web set valor = 'javascript:alert(1)' where clave = 'hero.foto'; exception when check_violation then fallos := fallos + 1; end;
  begin update contenido_web set valor = '' where clave = 'hero.frase'; exception when check_violation then fallos := fallos + 1; end;
  assert fallos = 4, 'checks: ' || fallos;
  update contenido_web set valor = 'https://skysdjfxuykrufawhzvn.supabase.co/storage/v1/object/public/web/x.webp' where clave = 'hero.foto';
  update contenido_web set valor = 'Otra frase' where clave = 'hero.frase';
  assert (select catalogo_web()->'contenido'->>'hero.frase') = 'Otra frase', 'catalogo';
  assert (select original from contenido_web where clave = 'hero.frase') = 'Horneado en Paysandú con exceso de amor.', 'original';
  raise exception 'TODO OK';
end $$;

-- Pedido web con entrega (23/10): el envío va en el total; al confirmarlo, la venta no lo cobra dos veces.
do $$
declare
  r jsonb; v jsonb; pid uuid; r2 jsonb;
begin
  r := crear_pedido_web('{"nombre":"PRUEBA envio","telefono":"099000000","modalidad":"entrega","direccion":"Calle 1","pago":"transferencia","prueba":true,"cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]}');
  assert (r->>'envio')::numeric = 25 and (r->>'total')::numeric = precio_vigente((select id from formatos where nombre = 'Box de 6'), null) + 25,
         'entrega: ' || r::text;
  select id into pid from pedidos where codigo = r->>'codigo';
  v := confirmar_pedido(pid);
  assert (select precio_cobrado + cobro_envio from ventas where id = (v->>'venta_id')::uuid) = (r->>'total')::numeric,
         'la venta cobra lo mismo que el pedido';
  r2 := crear_pedido_web('{"nombre":"PRUEBA retiro","telefono":"099000000","modalidad":"retiro","pago":"efectivo","prueba":true,"cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]}');
  assert (r2->>'envio')::numeric = 0, 'retiro sin envío';
  assert (catalogo_web()->>'envio')::numeric = 25, 'el catálogo trae el precio del envío';
  raise exception 'TODO OK';
end $$;


-- Revisión del backend: borrar la venta de un pedido lo devuelve a "nuevo", tope general de 40
-- pedidos por hora, y en contenido_web un admin solo puede cambiar el valor.
do $$
declare r jsonb; v jsonb; ped uuid; fallo text; n int := 0; admin uuid;
  caja text := '"cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]';
begin
  r := crear_pedido_web(('{"nombre":"PRUEBA","telefono":"099123456","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h0');
  select id into ped from pedidos where codigo = r->>'codigo';
  v := confirmar_pedido(ped);
  delete from ventas where id = (v->>'venta_id')::uuid;
  assert (select estado = 'nuevo' and venta_id is null and gestionado_en is null from pedidos where id = ped), 'vuelve a nuevo';
  perform confirmar_pedido(ped);
  assert (select estado from pedidos where id = ped) = 'confirmado', 'reconfirmar';

  while (select count(*) from pedidos where creado_en > now() - interval '1 hour') < 40 loop
    n := n + 1;
    perform crear_pedido_web(('{"nombre":"PRUEBA","telefono":"099123456","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h' || n);
  end loop;
  begin
    perform crear_pedido_web(('{"nombre":"PRUEBA","telefono":"099123456","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h-otra');
    fallo := 'no';
  exception when others then fallo := sqlerrm; end;
  assert fallo like 'Demasiados pedidos en este momento%', 'tope: ' || fallo;

  select user_id into admin from usuarios_admin limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update contenido_web set valor = 'Otra frase' where clave = 'hero.frase';
  begin
    update contenido_web set tipo = 'texto' where clave = 'contacto.whatsapp';
    fallo := 'no';
  exception when insufficient_privilege then fallo := 'bloqueado'; end;
  reset role;
  assert fallo = 'bloqueado', 'tipo: ' || fallo;
  assert (select valor from contenido_web where clave = 'hero.frase') = 'Otra frase', 'valor';

  raise exception 'TODO OK';
end $$;

-- Fase 2 · 2.2: cliente del pedido web. La búsqueda por celular, el cliente elegido a mano (manda sobre la
-- búsqueda, no crea otro y puede guardarse el celular), uno nuevo aunque el celular coincida, y v_pedidos.
do $$
declare r jsonb; v jsonb; ped uuid; ana uuid; tel text := '098765432'; clientes_antes int;
  caja text := '"cajas":[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]';
begin
  assert cliente_por_telefono(tel) is null, 'el celular de prueba ya es de un cliente';
  assert cliente_por_telefono('099') is null, 'un contacto corto no coincide';
  insert into clientes (nombre, contacto) values ('PRUEBA Ana', '@ana') returning id into ana;

  -- Elegido a mano + guardar el celular: la venta es de Ana y no se crea otro cliente
  r := crear_pedido_web(('{"nombre":"PRUEBA Anita","telefono":"' || tel || '","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h22a');
  select id into ped from pedidos where codigo = r->>'codigo';
  assert (select cliente_sugerido_id is null from v_pedidos where id = ped), 'sin sugerido';
  clientes_antes := (select count(*) from clientes);
  v := confirmar_pedido(ped, jsonb_build_object('cliente_id', ana, 'guardar_telefono', true));
  assert (select cliente_id from ventas where id = (v->>'venta_id')::uuid) = ana, 'venta a nombre de Ana';
  assert (select count(*) from clientes) = clientes_antes, 'no crea cliente';
  assert (select contacto from clientes where id = ana) = '@ana · ' || tel, 'guarda el celular';

  -- El próximo pedido de ese celular ya sugiere a Ana, con su compra
  r := crear_pedido_web(('{"nombre":"Otra","telefono":"' || tel || '","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h22b');
  select id into ped from pedidos where codigo = r->>'codigo';
  assert (select cliente_sugerido_id = ana and cliente_sugerido = 'PRUEBA Ana' and compras_cliente = 1
            from v_pedidos where id = ped), 'sugerido';
  v := confirmar_pedido(ped);
  assert (select cliente_id from ventas where id = (v->>'venta_id')::uuid) = ana, 'se asocia solo';

  -- Mismo celular pero es otra persona: cliente nuevo con el nombre elegido, contacto y origen por defecto
  r := crear_pedido_web(('{"nombre":"Hermana","telefono":"' || tel || '","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h22d');
  select id into ped from pedidos where codigo = r->>'codigo';
  v := confirmar_pedido(ped, '{"cliente": {"nombre": "PRUEBA Sofi"}}');
  assert (select c.nombre || '/' || c.contacto || '/' || c.origen from ventas x join clientes c on c.id = x.cliente_id
           where x.id = (v->>'venta_id')::uuid) = 'PRUEBA Sofi/' || tel || '/Web', 'otro cliente con el mismo celular';
  assert cliente_por_telefono(tel) = ana, 'la sugerencia sigue siendo la más antigua';

  -- Sin coincidencia ni elección: crea el cliente con el nombre del pedido
  r := crear_pedido_web(('{"nombre":"PRUEBA Nuevo","telefono":"097111222","modalidad":"retiro","pago":"efectivo",' || caja || '}')::jsonb, 'h22c');
  select id into ped from pedidos where codigo = r->>'codigo';
  if cliente_por_telefono('097111222') is null then
    v := confirmar_pedido(ped);
    assert (select c.nombre || '/' || c.origen from ventas x join clientes c on c.id = x.cliente_id
             where x.id = (v->>'venta_id')::uuid) = 'PRUEBA Nuevo/Web', 'cliente nuevo';
  end if;
  -- Fase 2 · 3.1: la venta de un pedido web queda por hacer.
  assert (select por_hacer from ventas where id = (v->>'venta_id')::uuid), 'pedido web confirmado queda por hacer';

  raise exception 'TODO OK';
end $$;

-- Fase 2 · 2.1: push_suscripciones. Cada admin guarda (upsert por user_id + endpoint) y ve solo las suyas;
-- no puede guardar una a nombre de otro, y el mismo navegador con dos cuentas queda en dos filas.
do $$
declare yo uuid; otro uuid; fallo text; n int;
begin
  select user_id into yo from usuarios_admin where es_prueba;
  select user_id into otro from usuarios_admin where not es_prueba limit 1;
  insert into push_suscripciones (user_id, endpoint, p256dh, auth) values (otro, 'https://push.prueba/x', 'k', 'a');

  perform set_config('request.jwt.claims', json_build_object('sub', yo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into push_suscripciones (endpoint, p256dh, auth) values ('https://push.prueba/x', 'k', 'a');
  insert into push_suscripciones (endpoint, p256dh, auth) values ('https://push.prueba/x', 'k2', 'a2')
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh;
  select count(*) into n from push_suscripciones;
  begin
    insert into push_suscripciones (user_id, endpoint, p256dh, auth) values (otro, 'https://push.prueba/y', 'k', 'a');
    fallo := 'no';
  exception when insufficient_privilege then fallo := 'bloqueado'; end;
  reset role;

  assert n = 1, 've solo la suya: ' || n;
  assert fallo = 'bloqueado', 'a nombre de otro: ' || fallo;
  assert (select count(*) from push_suscripciones where endpoint = 'https://push.prueba/x') = 2, 'una por cuenta';
  assert (select p256dh from push_suscripciones where user_id = yo and endpoint = 'https://push.prueba/x') = 'k2', 'upsert';
  begin
    insert into push_suscripciones (user_id, endpoint, p256dh, auth) values (yo, 'http://inseguro', 'k', 'a');
    fallo := 'no';
  exception when check_violation then fallo := 'check'; end;
  assert fallo = 'check', 'solo https: ' || fallo;
  raise exception 'TODO OK';
end $$;

-- Fase 2 · 6.5: los textos nuevos de la web existen, arrancan en su original, llegan al catálogo y no pueden quedar vacíos.
do $$
declare claves text[] := array['nav.menu', 'nav.local', 'nav.contacto', 'nav.pedido', 'hero.boton_menu', 'hero.boton_contacto',
  'menu.animacion', 'menu.frase', 'menu.titulo', 'menu.paso_caja', 'carrito.titulo', 'carrito.boton', 'form.titulo',
  'form.ayuda_whatsapp', 'pedido.titulo']; fallo text;
begin
  assert (select count(*) from contenido_web where clave = any(claves) and valor = original and tipo = 'texto') = 15, 'filas nuevas';
  assert (select catalogo_web()->'contenido' ?& claves), 'en el catálogo';
  begin update contenido_web set valor = '' where clave = 'nav.pedido'; fallo := 'no';
  exception when check_violation then fallo := 'check'; end;
  assert fallo = 'check', 'vacío: ' || fallo;
  raise exception 'TODO OK';
end $$;

-- Fase 2 · 3.1 + 3.2: plan de horneado. Solo cuentan las ventas por hacer (cobradas o no), las
-- elegidas; masa propia redondea aparte; masa compartida junta los sobrantes en tandas mezcladas y
-- completa la última con el sabor elegido; registrar_horneado carga las tandas y marca los pedidos hechos.
do $$
declare
  pers uuid := (select id from formatos where nombre = 'Personalizado');
  ca uuid := (select id from sabores where nombre = 'Canela');
  ddl uuid := (select id from sabores where nombre = 'Dulce de Leche');
  nut uuid := (select id from sabores where nombre = 'Nutella');
  oreo uuid := (select id from sabores where nombre = 'Oreo');
  v1 uuid; v2 uuid; v3 uuid;
  r jsonb;
  de jsonb;
  fallo text;
  venta_de text := $f$
    select (registrar_venta(jsonb_build_object('entrega', 'retiro', 'medio_pago', 'efectivo',
      'estado_pago', %L, 'por_hacer', %s, 'notas', 'PRUEBA plan', 'lineas', (
      select jsonb_agg(jsonb_build_object('formato_id', %L::uuid, 'sabores', c)) from jsonb_array_elements(%L::jsonb) c)
      ))->>'venta_id')::uuid$f$;   -- cada elemento del último parámetro es una caja Personalizado (3 a 12 rolls)
begin
  update ventas set por_hacer = false where por_hacer;   -- se deshace al final
  assert (select masa_propia from sabores where id = oreo) and not (select masa_propia from sabores where id = ca),
         'masa propia: solo Oreo';

  -- Aceptación del handoff: 18 Canela + 6 Oreo pedidos y 6 Canela extra → 2 tandas de Canela y 1 de Oreo.
  execute format(venta_de, 'pagado', 'true', pers, jsonb_build_array(jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 12)))) into v1;
  execute format(venta_de, 'pendiente', 'true', pers, jsonb_build_array(jsonb_build_array(
    jsonb_build_object('sabor_id', ca, 'unidades', 6), jsonb_build_object('sabor_id', oreo, 'unidades', 6)))) into v2;
  -- Entregada sin cobrar: no entra.
  execute format(venta_de, 'pendiente', 'false', pers, jsonb_build_array(jsonb_build_array(jsonb_build_object('sabor_id', ddl, 'unidades', 12)))) into v3;

  r := plan_horneado(jsonb_build_object('extra', jsonb_build_object(ca, 6)));
  assert (r->>'total_tandas')::int = 3, 'aceptación: 3 tandas, dio ' || (r->>'total_tandas');
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = ca::text;
  assert (de->>'pedidos')::int = 18 and (de->>'rolls')::int = 24 and (de->>'tandas')::numeric = 2, 'Canela: ' || de;
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = oreo::text;
  assert (de->>'rolls')::int = 12 and (de->>'para_vender')::int = 6 and (de->>'tandas')::numeric = 1, 'Oreo: ' || de;
  assert not exists (select 1 from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = ddl::text),
         'la venta ya entregada no cuenta';
  assert not exists (select 1 from jsonb_array_elements(r->'tandas') t where t->>'tipo' = 'mezcla'), 'sin mezcla';

  -- Solo las elegidas: sin v1 quedan 6 Canela → 1 tanda de Canela (6 para vender) + Oreo.
  r := plan_horneado(jsonb_build_object('ventas', jsonb_build_array(v2, v3)));
  assert (r->>'total_tandas')::int = 2, 'elegidas: 2 tandas';
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = ca::text;
  assert (de->>'pedidos')::int = 6 and (de->>'rolls')::int = 12, 'elegidas Canela: ' || de;

  -- El ejemplo de los dueños: 14 Canela, 3 Nutella, 3 DDL → 1 tanda de Canela + 1 mezclada
  -- (Canela 2 + 4 para completar, Nutella 3, DDL 3). Total 2, no 3.
  update ventas set por_hacer = false where id in (v1, v2);
  execute format(venta_de, 'pendiente', 'true', pers, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 12)),
    jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 2), jsonb_build_object('sabor_id', nut, 'unidades', 3),
                      jsonb_build_object('sabor_id', ddl, 'unidades', 3)))) into v1;
  r := plan_horneado();
  assert (r->>'total_tandas')::int = 2, 'ejemplo: 2 tandas, dio ' || (r->>'total_tandas');
  assert (r->>'completar')::uuid = ca, 'completa con Canela por defecto';
  select t into de from jsonb_array_elements(r->'tandas') t where t->>'tipo' = 'mezcla';
  assert (de->>'rolls')::int = 12 and jsonb_array_length(de->'sabores') = 3, 'mezcla: ' || de;
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = ca::text;
  assert (de->>'rolls')::int = 18 and (de->>'para_vender')::int = 4 and (de->>'tandas')::numeric = 1.5, 'ejemplo Canela: ' || de;
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = nut::text;
  assert (de->>'tandas')::numeric = 0.25, 'Nutella usa 1/4 de receta';

  -- Completar con otro sabor.
  r := plan_horneado(jsonb_build_object('completar', ddl));
  select s into de from jsonb_array_elements(r->'sabores') s where s->>'sabor_id' = ddl::text;
  assert (de->>'rolls')::int = 7, 'completar con DDL: ' || de;
  begin
    perform plan_horneado(jsonb_build_object('completar', oreo));
    fallo := 'completar con masa propia debió fallar';
  exception when others then null;
  end;
  assert fallo is null, fallo;

  -- Ningún sabor queda partido entre dos tandas: 7 Nutella + 7 DDL → una mezclada con cada uno,
  -- completadas con Canela (antes quedaba DDL 5 en una y 2 en la otra).
  update ventas set por_hacer = false where id = v1;
  execute format(venta_de, 'pendiente', 'true', pers, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('sabor_id', nut, 'unidades', 7)),
    jsonb_build_array(jsonb_build_object('sabor_id', ddl, 'unidades', 7)))) into v1;
  r := plan_horneado();
  assert (r->>'total_tandas')::int = 2, 'sin partir: 2 tandas';
  assert (select count(*) from jsonb_array_elements(r->'tandas') t, jsonb_array_elements(t->'sabores') x
           where x->>'sabor_id' = ddl::text) = 1, 'DDL en una sola tanda: ' || (r->'tandas');
  assert (select count(*) from jsonb_array_elements(r->'tandas') t, jsonb_array_elements(t->'sabores') x
           where x->>'sabor_id' = nut::text) = 1, 'Nutella en una sola tanda';

  -- Si la Canela que sobra no entra en los lugares libres, va en una tanda entera de Canela:
  -- 14 Canela + 9 Nutella + 3 DDL → 2 × Canela + mezclada (Nutella 9, DDL 3). Canela no queda "mezclada" sola.
  update ventas set por_hacer = false where id = v1;
  execute format(venta_de, 'pendiente', 'true', pers, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 12)),
    jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 2), jsonb_build_object('sabor_id', nut, 'unidades', 9)),
    jsonb_build_array(jsonb_build_object('sabor_id', ddl, 'unidades', 3)))) into v1;
  r := plan_horneado();
  assert (r->>'total_tandas')::int = 3, 'canela aparte: 3 tandas';
  select t into de from jsonb_array_elements(r->'tandas') t where t->>'tipo' = 'sola';
  assert (de->>'cantidad')::int = 2 and de->'sabores'->0->>'sabor_id' = ca::text, '2 × Canela: ' || de;
  select t into de from jsonb_array_elements(r->'tandas') t where t->>'tipo' = 'mezcla';
  assert jsonb_array_length(de->'sabores') = 2 and (de->>'rolls')::int = 12, 'mezclada Nutella + DDL: ' || de;

  -- Sobrantes que no entran en una sola mezcla: 11 Nutella + 11 DDL → 2 mezcladas (22 + 2 Canela).
  update ventas set por_hacer = false where id = v1;
  execute format(venta_de, 'pendiente', 'true', pers, jsonb_build_array(
    jsonb_build_array(jsonb_build_object('sabor_id', nut, 'unidades', 11)),
    jsonb_build_array(jsonb_build_object('sabor_id', ddl, 'unidades', 11)))) into v2;
  r := plan_horneado();
  assert (r->>'total_tandas')::int = 2, 'dos mezcladas';
  assert (select sum((s->>'rolls')::int) from jsonb_array_elements(r->'sabores') s) = 24, '24 rolls';

  -- Registrar: tandas con la fracción de receta y el pedido pasa a hecho.
  r := registrar_horneado(jsonb_build_object('fecha', '2026-10-03'));
  assert (r->>'ventas_hechas')::int = 1 and not (select por_hacer from ventas where id = v2), 'pedido hecho';
  assert (select hecho_en from ventas where id = v2) = now(), 'las cajas salen al registrar el horneado';
  assert (select count(*) from tandas where fecha = '2026-10-03' and notas = 'Plan de horneado') = 3, 'una tanda por sabor';
  assert (select cantidad from tandas where fecha = '2026-10-03' and sabor_id = nut and notas = 'Plan de horneado')
         = round(11 / 12.0, 4), 'fracción de Nutella';
  begin
    perform registrar_horneado();
    fallo := 'sin pedidos debió fallar';
  exception when others then null;
  end;
  assert fallo is null, fallo;

  -- actualizar_venta cambia la marca; v_ventas la muestra.
  perform actualizar_venta(v2, '{"por_hacer": true}');
  assert (select por_hacer from v_ventas where id = v2), 'por_hacer en v_ventas';

  raise exception 'TODO OK';
end $$;

-- Plan de horneado · cajas: cajas_plan cuenta las cajas (y papel y sticker) de los pedidos elegidos; las cajas
-- de un pedido por hacer salen del stock cuando se hace, no cuando se carga; que_comprar suma las cajas que le pasan.
do $$
declare
  b6 uuid := (select id from formatos where nombre = 'Box de 6');
  b12 uuid := (select id from formatos where nombre = 'Box de 12');
  ca uuid := (select id from sabores where nombre = 'Canela');
  c6 uuid := (select caja_insumo_id from formatos where nombre = 'Box de 6');
  c12 uuid := (select caja_insumo_id from formatos where nombre = 'Box de 12');
  papel uuid := (select id from insumos where nombre = 'Papel manteca');
  v uuid;
  r record;
  antes numeric;
begin
  update ventas set por_hacer = false where por_hacer;   -- se deshace al final
  assert (select stock from stock_disponible() where insumo_id = c6) = (select teorico from v_stock where insumo_id = c6),
         'disponible = teórico';
  antes := (select teorico from v_stock where insumo_id = c6);

  v := (registrar_venta(jsonb_build_object('entrega', 'retiro', 'medio_pago', 'efectivo', 'estado_pago', 'pagado',
         'por_hacer', true, 'notas', 'PRUEBA cajas', 'lineas', jsonb_build_array(
           jsonb_build_object('formato_id', b6, 'cantidad', 2, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 12))),
           jsonb_build_object('formato_id', b12, 'sabores', jsonb_build_array(jsonb_build_object('sabor_id', ca, 'unidades', 12))))))->>'venta_id')::uuid;

  select * into r from cajas_plan() where insumo_id = c6;
  assert r.necesario = 2, 'Box de 6: 2 cajas, dio ' || r.necesario;
  assert (select teorico from v_stock where insumo_id = c6) = antes, 'las cajas del pedido por hacer siguen en el stock';
  assert (select hecho_en from ventas where id = v) is null, 'por hacer: sin hecho_en';
  assert (select necesario from cajas_plan() where insumo_id = c12) = 1, 'Box de 12: 1 caja';
  assert (select necesario from cajas_plan() where insumo_id = papel)
         = 2 * (select cantidad from caja_insumos where caja_insumo_id = c6 and insumo_id = papel)
           + (select cantidad from caja_insumos where caja_insumo_id = c12 and insumo_id = papel), 'papel manteca según cada caja';
  assert not exists (select 1 from cajas_plan(jsonb_build_object('ventas', '[]'::jsonb))), 'sin pedidos elegidos, sin cajas';

  select * into r from que_comprar('{}', jsonb_build_object(c6, 2)) where insumo_id = c6;
  assert r.necesario = 2 and r.faltante = greatest(2 - greatest((select stock from stock_disponible() where insumo_id = c6), 0), 0),
         'que_comprar con cajas';
  assert (select count(*) from que_comprar(jsonb_build_object(ca, 1))) > 0, 'que_comprar sigue andando solo con tandas';

  -- Un conteo entre la carga y el horneado cuenta las cajas del pedido; al hacerlo, salen del stock.
  perform registrar_conteo(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('insumo_id', c6, 'cantidad', 5))));
  update conteos set creado_en = creado_en - interval '1 second'   -- en la prueba todo pasa en el mismo now()
   where insumo_id = c6 and creado_en = now();
  assert (select teorico from v_stock where insumo_id = c6) = 5, 'conteo con el pedido por hacer';
  perform actualizar_venta(v, '{"por_hacer": false}');
  assert (select hecho_en from ventas where id = v) is not null, 'hecho: con hecho_en';
  assert (select teorico from v_stock where insumo_id = c6) = 3, 'hecho: las 2 cajas salen después del conteo';
  assert (select stock from stock_disponible() where insumo_id = c6) = 3, 'hecho: disponible = teórico';
  perform actualizar_venta(v, '{"por_hacer": true}');
  assert (select teorico from v_stock where insumo_id = c6) = 5, 'vuelve a por hacer: las cajas vuelven';

  raise exception 'TODO OK';
end $$;

-- Ingresos: el aporte de socios suma a la caja y al capital pero no a la ganancia; el otro ingreso
-- suma también a la ganancia neta y al resultado del mes. Monto siempre mayor a 0.
do $$
declare
  a record;
  b record;
  ra numeric;
  rb numeric;
begin
  select * into a from v_panel;
  select coalesce((select resultado from v_resumen_mensual where mes = '2026-09-01'), 0) into ra;
  insert into ingresos (fecha, descripcion, tipo, monto) values
    ('2026-09-15', 'PRUEBA aporte', 'aporte_socios', 1000), ('2026-09-15', 'PRUEBA otro', 'otro', 200);
  select * into b from v_panel;
  select resultado into rb from v_resumen_mensual where mes = '2026-09-01';
  assert b.caja_teorica - a.caja_teorica = 1200, 'caja: suman los dos';
  assert b.capital - a.capital = 1200, 'capital: suman los dos';
  assert b.ganancia_neta - a.ganancia_neta = 200, 'ganancia neta: solo el otro ingreso';
  assert rb - ra = 200, 'resultado del mes: solo el otro ingreso';
  assert b.aportes - a.aportes = 1000 and b.otros_ingresos - a.otros_ingresos = 200, 'columnas nuevas';
  assert b.total_gastado = a.total_gastado, 'no cuentan como gasto';
  begin
    insert into ingresos (fecha, descripcion, tipo, monto) values ('2026-09-15', 'PRUEBA', 'otro', 0);
    raise exception 'dejó un ingreso de $0';
  exception when check_violation then null;
  end;
  raise exception 'TODO OK';
end $$;

-- Desvíos de stock: el conteo guarda el teórico y lo usado desde el conteo anterior; el promedio
-- por insumo arranca de nuevo después de ajustar las recetas. Lo que entra en un conteo se decide por
-- cuándo se cargó: una tanda con fecha futura cargada antes de contar ya está en lo contado.
do $$
declare
  ca uuid := (select id from sabores where nombre = 'Canela');
  har uuid := (select id from insumos where nombre = 'Harina');
  receta numeric := (select cantidad from recetas where sabor_id = (select id from sabores where nombre = 'Canela')
                                                  and insumo_id = (select id from insumos where nombre = 'Harina'));
  d record;
begin
  -- Dentro del bloque now() es siempre el mismo: corro hacia atrás el creado_en de lo que se carga antes.
  perform registrar_conteo(jsonb_build_object(
            'items', jsonb_build_array(jsonb_build_object('insumo_id', har, 'cantidad', 5000))));
  update conteos set creado_en = now() - interval '2 minutes' where insumo_id = har and creado_en = now();
  perform registrar_tanda(jsonb_build_object('fecha', hoy() + 5, 'sabor_id', ca, 'cantidad', 2));
  update tandas set creado_en = now() - interval '1 minute' where creado_en = now();
  perform registrar_conteo(jsonb_build_object('items', jsonb_build_array(
            jsonb_build_object('insumo_id', har, 'cantidad', 5000 - 2 * receta - 90))));
  assert (select teorico from v_stock where insumo_id = har) = 5000 - 2 * receta - 90,
         'la tanda con fecha futura no se vuelve a restar después de contar';
  select * into d from v_desvios where insumo_id = har order by creado_en desc limit 1;
  assert d.teorico = 5000 - 2 * receta, 'teórico guardado';
  assert d.usado = 2 * receta, 'usado desde el conteo anterior';
  assert d.desvio = 90, 'desvío = teórico − contado';
  assert d.desvio_relativo = round(90 / (2 * receta), 4), 'desvío relativo';

  perform ajustar_recetas_insumo(har, 1.1);
  assert (select cantidad from recetas where sabor_id = ca and insumo_id = har) = round(receta * 1.1, 2), 'receta ajustada';
  assert not exists (select 1 from v_desvio_insumo where insumo_id = har), 'el promedio arranca de nuevo';
  begin
    perform ajustar_recetas_insumo((select id from insumos where tipo = 'packaging' limit 1), 1.1);
    raise exception 'ajustó packaging';
  exception when others then
    if sqlerrm = 'ajustó packaging' then raise; end if;
  end;
  raise exception 'TODO OK';
end $$;

-- Recetas propuestas: guarda las cantidades tal cual y reinicia el promedio de esos ingredientes.
do $$
declare
  ca uuid := (select id from sabores where nombre = 'Canela');
  har uuid := (select id from insumos where nombre = 'Harina');
  caja uuid := (select id from insumos where tipo = 'packaging' limit 1);
  n int;
begin
  n := aplicar_recetas_propuestas(jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('sabor_id', ca, 'insumo_id', har, 'cantidad', 475))));
  assert n = 1, 'una fila';
  assert (select cantidad from recetas where sabor_id = ca and insumo_id = har) = 475, 'cantidad guardada';
  assert (select receta_ajustada_en from insumos where id = har) = now(), 'promedio reiniciado';
  begin
    perform aplicar_recetas_propuestas(jsonb_build_object('items', jsonb_build_array(
              jsonb_build_object('sabor_id', ca, 'insumo_id', caja, 'cantidad', 1))));
    raise exception 'cambió packaging';
  exception when others then
    if sqlerrm = 'cambió packaging' then raise; end if;
  end;
  begin
    perform aplicar_recetas_propuestas(jsonb_build_object('items', jsonb_build_array(
              jsonb_build_object('sabor_id', ca, 'insumo_id', har, 'cantidad', 0))));
    raise exception 'dejó 0';
  exception when others then
    if sqlerrm = 'dejó 0' then raise; end if;
  end;
  raise exception 'TODO OK';
end $$;

-- Deshacer el último conteo: borra todo lo de esa vez y el teórico vuelve a arrancar del conteo anterior.
do $$
declare
  har uuid := (select id from insumos where nombre = 'Harina');
  antes numeric := (select teorico from v_stock where insumo_id = (select id from insumos where nombre = 'Harina'));
  r jsonb;
begin
  perform registrar_conteo(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('insumo_id', har, 'cantidad', 1))));
  assert (select teorico from v_stock where insumo_id = har) = 1, 'conteo cargado';
  r := deshacer_ultimo_conteo();
  assert (r->>'insumos')::int = 1, 'borró solo lo de esa vez';
  assert (select teorico from v_stock where insumo_id = har) = antes, 'volvió al conteo anterior';
  raise exception 'TODO OK';
end $$;

-- Descuento por recomendación (20/10): flujo completo con datos de prueba, y los dueños no ven nada de prueba.
-- Usa el usuario de prueba (usuarios_admin.es_prueba) y uno de los dueños; simula la web con la service key.
do $$
declare
  u_prueba uuid := (select user_id from usuarios_admin where es_prueba limit 1);
  u_dueno uuid := (select user_id from usuarios_admin where not es_prueba order by creado_en limit 1);
  box12 jsonb := '[{"tipo":"caja_fija","rolls":12,"sabores":{"canela":6,"oreo":6}}]';
  box6 jsonb := '[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]';
  perso jsonb := '[{"tipo":"personalizado","sabores":{"dulce":4}}]';
  r jsonb; pa jsonb; pb jsonb; pc jsonb;
  v_ana uuid; v_bruno uuid; v_cod text; v_pa uuid; v_pb uuid; v_pc uuid;
begin
  -- Usuario de prueba: campaña de prueba
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform guardar_campana(jsonb_build_object('nombre', 'PRUEBA campaña', 'desde', hoy() - 1, 'hasta', hoy() + 60));
  reset role;

  -- Web en modo prueba: Ana pide sin código
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  if (campana_web(true)->>'activa')::boolean is not true then raise exception 'campaña de prueba no activa'; end if;
  if (campana_web(false)->>'activa')::boolean then raise exception 'la web real no debería ver campaña'; end if;
  pa := crear_pedido_web(jsonb_build_object('nombre','Ana Prueba','telefono','091000001','modalidad','retiro','pago','efectivo','cajas',box12,'prueba',true));
  reset role;

  -- Admin de prueba: confirma y cobra → Ana recibe su código
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_pa from pedidos where codigo = pa->>'codigo';
  if v_pa is null then raise exception 'el usuario de prueba no ve su pedido'; end if;
  r := confirmar_pedido(v_pa, '{}');
  update ventas set estado_pago = 'pagado' where id = (r->>'venta_id')::uuid;
  select v.cliente_id into v_ana from ventas v where v.id = (r->>'venta_id')::uuid;
  select codigo into v_cod from codigos_recomendacion where cliente_id = v_ana;
  if v_cod is null or v_cod !~ '^ANA-[A-Z2-9]{3}$' then raise exception 'código de Ana: %', v_cod; end if;
  -- su primera compra fue una Box de 12: además del código, 5 % por 30 días
  if saldo_recomendacion(v_ana) <> 5 or (select hasta from bonos_recomendacion where cliente_id = v_ana) <> hoy() + 30 then
    raise exception 'bono de Ana: %', (select row_to_json(x) from bonos_recomendacion x where cliente_id = v_ana);
  end if;
  reset role;

  -- Bruno (nuevo) pide con el código de Ana, en minúsculas y sin guion
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := consultar_codigo(lower(replace(v_cod, '-', ' ')), '091000002', true);
  if r->>'estado' <> 'recomendado' or r->>'nombre' <> 'Ana' then raise exception 'consultar Bruno: %', r; end if;
  if consultar_codigo(v_cod, '091000002', false)->>'estado' <> 'sin_campana' then raise exception 'real con campaña'; end if;
  r := consultar_codigo(v_cod, '091000001', true);
  if r->>'estado' <> 'propio' or (r->>'porcentaje')::numeric <> 5 or (r->>'bono')::numeric <> 5
     or (r->>'bono_hasta')::date <> hoy() + 30 or not (r->>'campana')::boolean then
    raise exception 'Ana con el bono: %', r;
  end if;
  pb := crear_pedido_web(jsonb_build_object('nombre','Bruno Prueba','telefono','091000002','modalidad','retiro','pago','efectivo','cajas',box6,'prueba',true,'codigo_recomendacion',lower(v_cod)));
  if (pb->>'total')::numeric <> 250 then raise exception 'Bruno no paga de lista: %', pb; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_pb from pedidos where codigo = pb->>'codigo';
  if (select estado from recomendaciones where pedido_id = v_pb) <> 'pendiente' then raise exception 'reco no pendiente'; end if;
  -- se confirma ya pagado (la venta se crea antes de enlazarse al pedido)
  r := confirmar_pedido(v_pb, '{"estado_pago":"pagado"}');
  if (select estado from recomendaciones where pedido_id = v_pb) <> 'valida' then
    raise exception 'reco de Bruno: %', (select row_to_json(x) from recomendaciones x where pedido_id = v_pb);
  end if;
  if saldo_recomendacion(v_ana) <> 10 then raise exception 'saldo Ana: %', saldo_recomendacion(v_ana); end if;
  -- la Box de 6 de Bruno no da bono
  select v.cliente_id into v_bruno from ventas v where v.id = (r->>'venta_id')::uuid;
  if saldo_recomendacion(v_bruno) <> 0 then raise exception 'Bruno con bono por una Box de 6'; end if;
  -- deja de estar pagada → pendiente; vuelve a pagada → válida
  update ventas set estado_pago = 'pendiente' where id = (r->>'venta_id')::uuid;
  if saldo_recomendacion(v_ana) <> 5 then raise exception 'saldo Ana con venta impaga'; end if;
  update ventas set estado_pago = 'pagado' where id = (r->>'venta_id')::uuid;
  if saldo_recomendacion(v_ana) <> 10 then raise exception 'saldo Ana repagada'; end if;
  reset role;

  -- Dueño: no ve nada de prueba
  perform set_config('request.jwt.claims', json_build_object('sub', u_dueno, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from pedidos where telefono like '09100000_') or exists (select 1 from v_ventas where cliente like '% Prueba')
     or exists (select 1 from clientes where contacto like '09100000_') or exists (select 1 from recomendaciones)
     or exists (select 1 from codigos_recomendacion) or exists (select 1 from campanas_recomendacion)
     or exists (select 1 from bonos_recomendacion) then
    raise exception 'el dueño ve datos de prueba';
  end if;
  reset role;

  -- Ana usa su 10 % (5 del bono + 5 de Bruno): el personalizado no lleva; con Box de 6 + Box de 12 va a la de 12
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := crear_pedido_web(jsonb_build_object('nombre','Ana Prueba','telefono','091000001','modalidad','retiro','pago','efectivo','cajas',perso,'prueba',true,'codigo_recomendacion',v_cod));
  if (r->>'descuento')::numeric <> 0 or (r->'recomendacion'->>'aplicado')::boolean then raise exception 'personalizado con descuento: %', r; end if;
  pc := crear_pedido_web(jsonb_build_object('nombre','Ana Prueba','telefono','091000001','modalidad','retiro','pago','efectivo','cajas',box6 || box12,'prueba',true,'codigo_recomendacion',v_cod));
  if (pc->>'descuento')::numeric <> 45 or (pc->>'total')::numeric <> 655 or pc->'recomendacion'->>'formato' <> 'Box de 12' then
    raise exception 'canje Ana: %', pc;
  end if;
  -- No se gasta: sigue teniendo el 10 % para el resto del mes
  if (consultar_codigo(v_cod, '091000001', true)->>'porcentaje')::numeric <> 10 then raise exception 'el saldo se gastó'; end if;
  -- lo de Bruno no pasa al mes siguiente; el bono dura 30 días (el día 30 todavía vale, el 31 ya no)
  if saldo_recomendacion(v_ana, hoy() + 30)
     <> 5 + (case when date_trunc('month', hoy() + 30) = date_trunc('month', hoy()) then 5 else 0 end) then
    raise exception 'saldo a los 30 días: %', saldo_recomendacion(v_ana, hoy() + 30);
  end if;
  if saldo_recomendacion(v_ana, hoy() + 31) <> 0 then raise exception 'el bono duró más de 30 días'; end if;
  -- Bruno ya compró: el código de Ana ya no cuenta para él
  if consultar_codigo(v_cod, '091000002', true)->>'estado' <> 'ya_cliente' then raise exception 'Bruno ya_cliente'; end if;
  -- código inexistente: el pedido sale igual, sin descuento
  r := crear_pedido_web(jsonb_build_object('nombre','Caro Prueba','telefono','091000003','modalidad','retiro','pago','efectivo','cajas',box6,'prueba',true,'codigo_recomendacion','XXX-999'));
  if r->'recomendacion'->>'estado' <> 'no_existe' or (r->>'total')::numeric <> 250 then raise exception 'código inexistente: %', r; end if;
  reset role;

  -- El canje queda en la nota y en el cobro; si se borra la venta y se rechaza el pedido, el saldo no cambia
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_pc from pedidos where codigo = pc->>'codigo';
  r := confirmar_pedido(v_pc, '{}');
  if (select notas from ventas where id = (r->>'venta_id')::uuid) not like '%Descuento por recomendaciones 10% en Box de 12 (−$45)%' then
    raise exception 'nota: %', (select notas from ventas where id = (r->>'venta_id')::uuid);
  end if;
  if (select precio_cobrado from ventas where id = (r->>'venta_id')::uuid) <> 655 then raise exception 'cobro canje'; end if;
  delete from ventas where id = (r->>'venta_id')::uuid;
  perform rechazar_pedido(v_pc, 'PRUEBA');
  if saldo_recomendacion(v_ana) <> 10 then raise exception 'saldo tras rechazo: %', saldo_recomendacion(v_ana); end if;
  r := (select resumen_campana(id) from campanas_recomendacion);
  if (r->>'validas')::int <> 1 or r->'ranking'->0->>'nombre' <> 'Ana Prueba' or (r->>'bonos')::int <> 1 then
    raise exception 'resumen: %', r;
  end if;
  r := borrar_datos_prueba();
  if (r->>'pedidos')::int <> 5 or (r->>'clientes')::int < 2 or (r->>'campanas')::int <> 1 then raise exception 'borrar: %', r; end if;
  if exists (select 1 from pedidos) or exists (select 1 from ventas) then raise exception 'quedaron datos de prueba'; end if;
  reset role;

  -- Un dueño no puede borrar datos de prueba
  perform set_config('request.jwt.claims', json_build_object('sub', u_dueno, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform borrar_datos_prueba();
    raise exception 'el dueño pudo borrar';
  exception when raise_exception then
    if sqlerrm = 'el dueño pudo borrar' then raise; end if;
  end;
  reset role;

  raise exception 'TODO OK';
end $$;

-- Bono por la primera Box de 12 (21/10): uno por campaña aunque ya fuera cliente, recién cuando se paga, se
-- puede usar sus 30 días aunque la campaña termine, y sigue a la venta al fusionar clientes.
do $$
declare
  u_prueba uuid := (select user_id from usuarios_admin where es_prueba limit 1);
  box12 jsonb := '[{"tipo":"caja_fija","rolls":12,"sabores":{"canela":6,"oreo":6}}]';
  box6 jsonb := '[{"tipo":"caja_fija","rolls":6,"sabores":{"canela":6}}]';
  r jsonb; pa jsonb; pb jsonb; pc jsonb; pd jsonb;
  v_ana uuid; v_bruno uuid; v_cod text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform guardar_campana(jsonb_build_object('nombre', 'PRUEBA campaña', 'desde', hoy() - 1, 'hasta', hoy() + 60));
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  pa := crear_pedido_web(jsonb_build_object('nombre','Ana Prueba','telefono','091000001','modalidad','retiro','pago','efectivo','cajas',box12,'prueba',true));
  pb := crear_pedido_web(jsonb_build_object('nombre','Bruno Prueba','telefono','091000002','modalidad','retiro','pago','efectivo','cajas',box6,'prueba',true));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := confirmar_pedido((select id from pedidos where codigo = pa->>'codigo'), '{"estado_pago":"pagado"}');
  select v.cliente_id into v_ana from ventas v where v.id = (r->>'venta_id')::uuid;
  select codigo into v_cod from codigos_recomendacion where cliente_id = v_ana;
  r := confirmar_pedido((select id from pedidos where codigo = pb->>'codigo'), '{"estado_pago":"pagado"}');
  select v.cliente_id into v_bruno from ventas v where v.id = (r->>'venta_id')::uuid;
  -- confirmada ya pagada: bono igual
  if saldo_recomendacion(v_ana) <> 5 then raise exception 'bono Ana confirmada pagada'; end if;
  reset role;

  -- Bruno, que ya es cliente, pide su primera Box de 12: bono recién cuando se paga, y uno solo por campaña
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  pd := crear_pedido_web(jsonb_build_object('nombre','Bruno Prueba','telefono','091000002','modalidad','retiro','pago','efectivo','cajas',box12,'prueba',true));
  pc := crear_pedido_web(jsonb_build_object('nombre','Bruno Prueba','telefono','091000002','modalidad','retiro','pago','efectivo','cajas',box12,'prueba',true));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := confirmar_pedido((select id from pedidos where codigo = pd->>'codigo'), '{}');
  if saldo_recomendacion(v_bruno) <> 0 then raise exception 'bono de Bruno sin pagar'; end if;
  update ventas set estado_pago = 'pagado' where id = (r->>'venta_id')::uuid;
  if saldo_recomendacion(v_bruno) <> 5 then raise exception 'bono de Bruno: %', saldo_recomendacion(v_bruno); end if;
  r := confirmar_pedido((select id from pedidos where codigo = pc->>'codigo'), '{"estado_pago":"pagado"}');
  if (select count(*) from bonos_recomendacion where cliente_id = v_bruno) <> 1 or saldo_recomendacion(v_bruno) <> 5 then
    raise exception 'Bruno con dos bonos';
  end if;
  r := (select resumen_campana(id) from campanas_recomendacion);
  if (r->>'bonos')::int <> 2 or (r->>'bonos_vigentes')::int <> 2 then raise exception 'resumen: %', r; end if;
  -- Termina la campaña: el bono se sigue pudiendo usar sus 30 días; lo de recomendar, no
  perform guardar_campana(jsonb_build_object('id', (select id from campanas_recomendacion), 'nombre', 'PRUEBA campaña',
                                             'desde', hoy() - 2, 'hasta', hoy() - 1));
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := campana_web(true);
  if (r->>'activa')::boolean or not (r->>'solo_canje')::boolean then raise exception 'web sin campaña con bonos: %', r; end if;
  if campana_web(false) <> '{"activa": false}' then raise exception 'la web real ve bonos de prueba: %', campana_web(false); end if;
  r := consultar_codigo(v_cod, '091000001', true);
  if r->>'estado' <> 'propio' or (r->>'porcentaje')::numeric <> 5 or (r->>'campana')::boolean or (r->>'tope')::numeric <> 30 then
    raise exception 'Ana sin campaña: %', r;
  end if;
  if consultar_codigo(v_cod, '091000009', true)->>'estado' <> 'sin_campana' then raise exception 'recomendar sin campaña'; end if;
  pc := crear_pedido_web(jsonb_build_object('nombre','Ana Prueba','telefono','091000001','modalidad','retiro','pago','efectivo','cajas',box12,'prueba',true,'codigo_recomendacion',v_cod));
  if (pc->>'descuento')::numeric <> 23 then raise exception 'canje del bono sin campaña: %', pc; end if;
  if (select campana_id from canjes_recomendacion x join pedidos p on p.id = x.pedido_id where p.codigo = pc->>'codigo')
     is distinct from (select campana_id from bonos_recomendacion where cliente_id = v_ana) then
    raise exception 'el canje sin campaña no quedó en la campaña del bono';
  end if;
  reset role;

  -- Fusionar: el bono sigue a la venta; si los dos tenían, queda uno
  perform set_config('request.jwt.claims', json_build_object('sub', u_prueba, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform fusionar_clientes(v_ana, v_bruno);
  if (select count(*) from bonos_recomendacion) <> 1 or saldo_recomendacion(v_ana) <> 5 then
    raise exception 'bonos tras fusionar: %', (select json_agg(x) from bonos_recomendacion x);
  end if;
  r := borrar_datos_prueba();
  if (r->>'pedidos')::int <> 5 or (r->>'campanas')::int <> 1 then raise exception 'borrar: %', r; end if;
  if exists (select 1 from pedidos) or exists (select 1 from ventas) or exists (select 1 from bonos_recomendacion) then
    raise exception 'quedaron datos de prueba';
  end if;
  reset role;
  raise exception 'TODO OK';
end $$;

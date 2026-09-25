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

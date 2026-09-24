-- Carga el histórico de la planilla en una sola transacción. La llama el script
-- migracion/importar.py con la service_role key; nadie más puede ejecutarla.
--
-- Es idempotente: borra lo importado antes (filas con fila_planilla) y vuelve a cargar.
-- Si ya hay datos cargados desde la app, se niega a correr para no mezclar.
-- Los insumos, sabores y formatos se buscan por nombre en el catálogo.

create function importar_planilla(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  x jsonb;
  l jsonb;
  v_id uuid;
  v_linea uuid;
  v_faltan text;
begin
  if exists (select 1 from ventas where fila_planilla is null)
     or exists (select 1 from compras where fila_planilla is null)
     or exists (select 1 from tandas where fila_planilla is null)
     or exists (select 1 from gastos where fila_planilla is null)
     or exists (select 1 from conteos where fila_planilla is null)
     or exists (select 1 from clientes where fila_planilla is null) then
    raise exception 'Ya hay datos cargados desde la app: no reimporto la planilla encima';
  end if;

  -- Nombres del catálogo que no existen (mejor fallar con un mensaje claro)
  select string_agg(distinct n, ', ') into v_faltan from (
    select l2->>'caja' as n from jsonb_array_elements(p->'ventas') v2,
           jsonb_array_elements(v2->'lineas') l2
     where l2->>'caja' is not null and not exists (select 1 from insumos where nombre = l2->>'caja')
    union all
    select l2->>'formato' from jsonb_array_elements(p->'ventas') v2, jsonb_array_elements(v2->'lineas') l2
     where not exists (select 1 from formatos where nombre = l2->>'formato')
    union all
    select s2->>'sabor' from jsonb_array_elements(p->'ventas') v2, jsonb_array_elements(v2->'lineas') l2,
           jsonb_array_elements(l2->'sabores') s2
     where not exists (select 1 from sabores where nombre = s2->>'sabor')
    union all
    select c2->>'insumo' from jsonb_array_elements(p->'compras') c2
     where c2->>'insumo' is not null and not exists (select 1 from insumos where nombre = c2->>'insumo')
    union all
    select t2->>'sabor' from jsonb_array_elements(p->'tandas') t2
     where not exists (select 1 from sabores where nombre = t2->>'sabor')
    union all
    select k2->>'insumo' from jsonb_array_elements(p->'tandas') t2, jsonb_array_elements(t2->'consumos') k2
     where not exists (select 1 from insumos where nombre = k2->>'insumo')
    union all
    select c2->>'insumo' from jsonb_array_elements(p->'conteos') c2
     where not exists (select 1 from insumos where nombre = c2->>'insumo')
  ) q;
  if v_faltan is not null then
    raise exception 'No existen en el catálogo: %', v_faltan;
  end if;

  delete from ventas where fila_planilla is not null;
  delete from compras where fila_planilla is not null;
  delete from tandas where fila_planilla is not null;
  delete from gastos where fila_planilla is not null;
  delete from conteos where fila_planilla is not null;
  delete from clientes where fila_planilla is not null;

  create temp table _clientes (ref text primary key, id uuid) on commit drop;
  for x in select * from jsonb_array_elements(p->'clientes') loop
    insert into clientes (nombre, contacto, origen, notas, fila_planilla)
    values (x->>'nombre', x->>'contacto', x->>'origen', x->>'notas', (x->>'fila')::int)
    returning id into v_id;
    insert into _clientes values (x->>'ref', v_id);
  end loop;

  for x in select * from jsonb_array_elements(p->'ventas') loop
    insert into ventas (fecha, cliente_id, origen, entrega, cobro_envio, medio_pago, estado_pago, tipo,
                        precio_lista, precio_cobrado, notas, fila_planilla, creado_en)
    values ((x->>'fecha')::date, (select id from _clientes where ref = x->>'cliente_ref'), x->>'origen',
            x->>'entrega', (x->>'cobro_envio')::numeric, x->>'medio_pago', x->>'estado_pago', x->>'tipo',
            (x->>'precio_lista')::numeric, (x->>'precio_cobrado')::numeric, x->>'notas',
            (x->>'fila')::int, (x->>'creado_en')::timestamptz)
    returning id into v_id;

    for l in select * from jsonb_array_elements(x->'lineas') loop
      insert into venta_lineas (venta_id, formato_id, cantidad, caja_insumo_id, precio_lista, costo_caja)
      values (v_id, (select id from formatos where nombre = l->>'formato'), (l->>'cantidad')::int,
              (select id from insumos where nombre = l->>'caja'), (l->>'precio_lista')::numeric,
              (l->>'costo_caja')::numeric)
      returning id into v_linea;

      insert into venta_linea_sabores (linea_id, sabor_id, unidades, costo_unitario)
      select v_linea, s.id, y.unidades, y.costo_unitario
        from jsonb_to_recordset(l->'sabores') as y(sabor text, unidades int, costo_unitario numeric)
        join sabores s on s.nombre = y.sabor;
    end loop;
  end loop;

  insert into compras (fecha, proveedor, descripcion, insumo_id, categoria, cantidad, unidad,
                       cantidad_base, total, notas, fila_planilla, creado_en)
  select y.fecha, y.proveedor, y.descripcion, i.id, y.categoria, y.cantidad, y.unidad,
         y.cantidad_base, y.total, y.notas, y.fila, y.creado_en
    from jsonb_to_recordset(p->'compras') as y(fecha date, proveedor text, descripcion text, insumo text,
           categoria text, cantidad numeric, unidad text, cantidad_base numeric, total numeric,
           notas text, fila int, creado_en timestamptz)
    left join insumos i on i.nombre = y.insumo;

  for x in select * from jsonb_array_elements(p->'tandas') loop
    insert into tandas (fecha, sabor_id, cantidad, rolls, notas, fila_planilla, creado_en)
    values ((x->>'fecha')::date, (select id from sabores where nombre = x->>'sabor'),
            (x->>'cantidad')::numeric, (x->>'rolls')::int, x->>'notas', (x->>'fila')::int,
            (x->>'creado_en')::timestamptz)
    returning id into v_id;

    insert into tanda_consumos (tanda_id, insumo_id, cantidad)
    select v_id, i.id, y.cantidad
      from jsonb_to_recordset(x->'consumos') as y(insumo text, cantidad numeric)
      join insumos i on i.nombre = y.insumo;
  end loop;

  insert into gastos (fecha, descripcion, tipo, monto, rolls, notas, fila_planilla, creado_en)
  select y.fecha, y.descripcion, y.tipo, y.monto, y.rolls, y.notas, y.fila, y.creado_en
    from jsonb_to_recordset(p->'gastos') as y(fecha date, descripcion text, tipo text, monto numeric,
           rolls int, notas text, fila int, creado_en timestamptz);

  insert into conteos (fecha, insumo_id, cantidad, fila_planilla, creado_en)
  select y.fecha, i.id, y.cantidad, y.fila, y.creado_en
    from jsonb_to_recordset(p->'conteos') as y(fecha date, insumo text, cantidad numeric, fila int,
           creado_en timestamptz)
    join insumos i on i.nombre = y.insumo;

  return jsonb_build_object(
    'clientes', (select count(*) from clientes),
    'ventas', (select count(*) from ventas),
    'compras', (select count(*) from compras),
    'tandas', (select count(*) from tandas),
    'gastos', (select count(*) from gastos),
    'conteos', (select count(*) from conteos));
end;
$$;

revoke all on function importar_planilla(jsonb) from public, anon, authenticated;
grant execute on function importar_planilla(jsonb) to service_role;

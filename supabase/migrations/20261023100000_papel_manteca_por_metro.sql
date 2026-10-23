-- Papel manteca por metro (23/10). Dejan de comprar hojas sueltas y pasan a un rollo de 7,5 m a $75 ($10/m).
--
-- * Unidad base nueva 'cm'. Las compras se cargan en m o cm (registrar_compra convierte a cm).
-- * El insumo viejo (en hojas) no se puede pasar a cm porque ya tiene compras y ventas: queda inactivo como
--   "Papel manteca (hojas)" y se crea "Papel manteca" en cm, con $0,10/cm de referencia hasta la primera compra.
-- * Lo que lleva cada caja: Box de 3 = 18 cm, Box de 6 = 26 cm, Box de 12 = un corte de 30 cm (antes 2 hojas).
-- * El papel nuevo arranca con un conteo en 0: v_stock calcula el packaging de las ventas con caja_insumos de
--   hoy, así que sin ese conteo las ventas viejas le restarían centímetros que nunca salieron del rollo.

alter table insumos drop constraint insumos_unidad_base_check;
alter table insumos add constraint insumos_unidad_base_check check (unidad_base in ('g', 'ml', 'un', 'paq', 'cm'));

create or replace function registrar_compra(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  i insumos%rowtype;
  v_cant numeric := nullif(p->>'cantidad', '')::numeric;
  v_unidad text := nullif(trim(p->>'unidad'), '');
  v_total numeric := nullif(p->>'total', '')::numeric;
  v_dim text;
  v_factor numeric;
  v_base numeric;
  v_categoria text;
  v_id uuid;
begin
  if v_total is null or v_total <= 0 then
    raise exception 'Falta el total de la compra';
  end if;

  if nullif(p->>'insumo_id', '') is not null then
    select * into i from insumos where id = (p->>'insumo_id')::uuid;
    if not found then
      raise exception 'Insumo inexistente';
    end if;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Falta la cantidad comprada de %', i.nombre;
    end if;
    select dim, factor into v_dim, v_factor
      from (values ('g', 'g', 1), ('kg', 'g', 1000), ('ml', 'ml', 1), ('l', 'ml', 1000),
                   ('un', 'un', 1), ('paq', 'paq', 1), ('cm', 'cm', 1), ('m', 'cm', 100)) as u(unidad, dim, factor)
     where u.unidad = lower(coalesce(v_unidad, i.unidad_base));
    if v_dim is null then
      raise exception 'Unidad desconocida: %', v_unidad;
    end if;
    if v_dim <> i.unidad_base then
      raise exception '% se mide en %', i.nombre, i.unidad_base;
    end if;
    v_base := v_cant * v_factor;
    v_categoria := i.tipo;
  else
    v_categoria := coalesce(nullif(p->>'categoria', ''), 'otro');
    if v_categoria not in ('equipamiento', 'otro') then
      raise exception 'Elegí el insumo de la compra';
    end if;
  end if;

  insert into compras (fecha, proveedor, descripcion, insumo_id, categoria, cantidad, unidad,
                       cantidad_base, total, notas)
  values (coalesce(nullif(p->>'fecha', '')::date, hoy()), nullif(trim(p->>'proveedor'), ''),
          coalesce(nullif(trim(p->>'descripcion'), ''), i.nombre), i.id, v_categoria, v_cant,
          coalesce(v_unidad, i.unidad_base), v_base, v_total, nullif(trim(p->>'notas'), ''))
  returning id into v_id;

  return jsonb_build_object('compra_id', v_id, 'cantidad_base', v_base,
                            'costo_unitario', case when v_base > 0 then v_total / v_base end);
end;
$$;

do $$
declare
  viejo uuid := (select id from insumos where nombre = 'Papel manteca' and unidad_base = 'un');
  nuevo uuid;
begin
  update insumos set nombre = 'Papel manteca (hojas)', activo = false where id = viejo;
  insert into insumos (nombre, tipo, unidad_base, stock_minimo, costo_referencia)
  values ('Papel manteca', 'packaging', 'cm', 150, 75.0 / 750)
  returning id into nuevo;
  insert into conteos (fecha, insumo_id, cantidad) values (hoy(), nuevo, 0);

  delete from caja_insumos where insumo_id = viejo;
  insert into caja_insumos (caja_insumo_id, insumo_id, cantidad)
  select c.id, nuevo, m.cm
    from (values ('Caja Box de 3', 18), ('Caja Box de 6', 26), ('Caja Box de 12', 30)) as m(caja, cm)
    join insumos c on c.nombre = m.caja;
end $$;

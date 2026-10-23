-- Gasto "Mejoras del negocio" (23/10): cosas para trabajar mejor, como un palote de amasar, moldes o la balanza.
--
-- * gastos.tipo suma 'mejora'. Cuenta como gasto del mes (v_resumen_mensual, v_panel y v_gastos ya cuentan
--   todo lo que no es retiro ni ajuste de caja).
-- * Sale "Equipamiento" de Compras (los dueños no lo encontraban): la única compra cargada así, la balanza, pasa
--   a gastos como mejora, con su fecha, monto y notas. registrar_compra ya no acepta esa categoría.

alter table gastos drop constraint gastos_tipo_check;
alter table gastos add constraint gastos_tipo_check check (tipo in
  ('merma', 'tanda_descartada', 'gasto_operativo', 'mejora', 'comision', 'retiro_socios', 'ajuste_caja', 'otro'));

insert into gastos (fecha, descripcion, tipo, monto, notas, creado_en)
select fecha, coalesce(descripcion, 'Equipamiento'), 'mejora', total,
       nullif(concat_ws(' · ', notas, case when proveedor is not null then 'Proveedor: ' || proveedor end), ''),
       creado_en
  from compras
 where categoria = 'equipamiento';
delete from compras where categoria = 'equipamiento';

alter table compras drop constraint compras_categoria_check;
alter table compras add constraint compras_categoria_check check (categoria in ('ingrediente', 'packaging', 'otro'));

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
    if v_categoria = 'equipamiento' then
      raise exception 'Las mejoras del negocio (palote, moldes…) se cargan en Gastos';
    end if;
    if v_categoria <> 'otro' then
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

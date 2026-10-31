-- Qué parte de cada ingrediente de la receta va al relleno. La masa es la misma en todos los sabores de masa
-- compartida, así que para pesar una tanda mezclada solo importa el relleno de cada sabor.
-- Se guarda como fracción de la cantidad (y no en gramos) para que, al ajustar la receta con los desvíos,
-- el relleno siga la misma proporción sin tocar ajustar_recetas_insumo ni aplicar_recetas_propuestas.
alter table recetas add column parte_relleno numeric not null default 0
  check (parte_relleno >= 0 and parte_relleno <= 1);
comment on column recetas.parte_relleno is 'Fracción de la cantidad que va al relleno (0 = todo masa, 1 = todo relleno)';

-- p_items: [{ insumo_id, cantidad, relleno }]; relleno en la unidad del insumo, entre 0 y la cantidad.
create or replace function public.guardar_receta(p_sabor uuid, p_items jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from sabores where id = p_sabor) then
    raise exception 'Sabor inexistente';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric)
               left join insumos i on i.id = y.insumo_id
              where i.id is null or i.tipo <> 'ingrediente') then
    raise exception 'La receta solo puede llevar ingredientes';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric) where y.cantidad < 0) then
    raise exception 'Las cantidades no pueden ser negativas';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric, relleno numeric)
              where y.relleno < 0 or y.relleno > y.cantidad) then
    raise exception 'El relleno no puede ser más que la cantidad de la receta';
  end if;

  delete from recetas where sabor_id = p_sabor;
  insert into recetas (sabor_id, insumo_id, cantidad, parte_relleno)
  select p_sabor, y.insumo_id, sum(y.cantidad), coalesce(sum(y.relleno), 0) / sum(y.cantidad)
    from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric, relleno numeric)
   where y.cantidad > 0
   group by y.insumo_id;
end;
$function$;

-- Los rellenos que pasaron los dueños el 31/10: DDL lleva su dulce de leche, Canela 100 g de azúcar y su canela,
-- Nutella su Nutella. El resto (harina, leche, manteca, huevo, levadura, el azúcar de la masa y el glaseado) no se pesa aparte.
update recetas r set parte_relleno = coalesce(least(v.gramos / r.cantidad, 1), 1)
  from (values
    ('Dulce de Leche', 'Dulce de leche', null::numeric),
    ('Canela', 'Azúcar', 100),
    ('Canela', 'Canela', null),
    ('Nutella', 'Nutella', null)
  ) as v(sabor, insumo, gramos)
  join sabores s on s.nombre = v.sabor
  join insumos i on i.nombre = v.insumo
 where r.sabor_id = s.id and r.insumo_id = i.id;

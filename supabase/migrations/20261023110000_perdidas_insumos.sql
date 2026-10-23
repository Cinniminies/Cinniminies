-- Pérdida de insumos (23/10): se rompe una bolsa de harina, se vence la leche… Lo perdido sale del stock teórico.
--
-- * Tabla perdidas: insumo, cantidad (en la unidad base) y motivo. `costo` guarda lo que valía al perderlo, solo
--   para mostrar: la plata ya se contó al cargar la compra, así que no se suma a gastos ni al resultado del mes.
-- * v_stock resta las pérdidas posteriores al último conteo (columna nueva `perdido`, al final) y
--   v_movimientos_stock las suma como salida. El `usado` de los conteos (base de los desvíos) no las incluye:
--   una bolsa rota no dice nada de si la receta gasta más o menos.

create table perdidas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default hoy(),
  insumo_id uuid not null references insumos,
  cantidad numeric not null check (cantidad > 0),   -- en la unidad base del insumo
  costo numeric(12, 2),                              -- lo que valía (informativo)
  motivo text,
  creado_en timestamptz not null default now()
);
create index on perdidas (insumo_id, creado_en);

alter table perdidas enable row level security;
revoke all on perdidas from anon;
create policy "solo admins" on perdidas for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

-- El costo se calcula al cargarla (con el costo del insumo de ese momento).
create function perdida_costo() returns trigger
language plpgsql set search_path = public
as $$
begin
  new.costo := round(new.cantidad * coalesce(costo_insumo(new.insumo_id), 0), 2);
  return new;
end;
$$;
create trigger perdidas_costo before insert or update of cantidad, insumo_id on perdidas
  for each row execute function perdida_costo();

create or replace view v_movimientos_stock with (security_invoker = true) as
select c.insumo_id, c.fecha, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida
  from compras c
 where c.insumo_id is not null and c.cantidad_base is not null
union all
select tc.insumo_id, t.fecha, t.creado_en, 0, tc.cantidad
  from tanda_consumos tc
  join tandas t on t.id = tc.tanda_id
union all
select l.caja_insumo_id, v.fecha, v.hecho_en, 0, l.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
 where l.caja_insumo_id is not null and v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
union all
select ci.insumo_id, v.fecha, v.hecho_en, 0, l.cantidad * ci.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
  join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
 where v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
union all
select p.insumo_id, p.fecha, p.creado_en, 0, p.cantidad
  from perdidas p;

create or replace view v_stock with (security_invoker = true) as
with ult as (
  select distinct on (conteos.insumo_id) conteos.insumo_id, conteos.fecha, conteos.creado_en, conteos.cantidad
    from conteos
   order by conteos.insumo_id, conteos.creado_en desc
), movimientos as (
  select c.insumo_id, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida_tandas, 0::numeric as salida_ventas,
         0::numeric as salida_perdidas
    from compras c
   where c.insumo_id is not null and c.cantidad_base is not null
  union all
  select tc.insumo_id, t.creado_en, 0, tc.cantidad, 0, 0
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
  union all
  select l.caja_insumo_id, v.hecho_en, 0, 0, l.cantidad, 0
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null and v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
  union all
  select ci.insumo_id, v.hecho_en, 0, 0, l.cantidad::numeric * ci.cantidad, 0
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
   where v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
  union all
  select p.insumo_id, p.creado_en, 0, 0, 0, p.cantidad
    from perdidas p
), desde as (
  select i.id as insumo_id,
         coalesce(sum(m.entrada), 0) as comprado,
         coalesce(sum(m.salida_tandas), 0) as usado_tandas,
         coalesce(sum(m.salida_ventas), 0) as usado_ventas,
         coalesce(sum(m.salida_perdidas), 0) as perdido
    from insumos i
    left join ult u on u.insumo_id = i.id
    left join movimientos m on m.insumo_id = i.id and (u.insumo_id is null or m.creado_en > u.creado_en)
   group by i.id
), calc as (
  select i.id as insumo_id, i.nombre, i.tipo, i.unidad_base,
         u.fecha as fecha_conteo,
         coalesce(u.cantidad, 0) as conteo,
         d.comprado, d.usado_tandas, d.usado_ventas,
         coalesce(u.cantidad, 0) + d.comprado - d.usado_tandas - d.usado_ventas - d.perdido as teorico,
         i.stock_minimo,
         costo_insumo(i.id) as costo_unitario,
         d.perdido
    from insumos i
    join desde d on d.insumo_id = i.id
    left join ult u on u.insumo_id = i.id
   where i.activo
)
select insumo_id, nombre, tipo, unidad_base, fecha_conteo, conteo, comprado, usado_tandas, usado_ventas, teorico,
       stock_minimo, costo_unitario,
       teorico < stock_minimo as reponer,
       round(greatest(teorico, 0) * coalesce(costo_unitario, 0), 2) as valor,
       perdido
  from calc;

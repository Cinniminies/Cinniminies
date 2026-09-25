-- Etapa 4: vistas que faltaban para el export al Google Sheet de análisis
-- (/api/export/<vista>). Igual que las demás: security_invoker, sin permisos para anon.

-- Una fila por gasto o retiro, con el mes y si cuenta como gasto del negocio.
create view v_gastos with (security_invoker = true) as
select g.id,
       g.fecha,
       date_trunc('month', g.fecha)::date as mes,
       g.tipo,
       g.descripcion,
       g.monto,
       g.tipo not in ('retiro_socios', 'ajuste_caja') as es_gasto,
       g.rolls,
       g.notas,
       g.creado_en
  from gastos g;

-- Una fila por compra, con el insumo y el costo por unidad base.
create view v_compras with (security_invoker = true) as
select c.id,
       c.fecha,
       date_trunc('month', c.fecha)::date as mes,
       c.categoria,
       i.nombre as insumo,
       c.descripcion,
       c.proveedor,
       c.cantidad,
       c.unidad,
       c.cantidad_base,
       i.unidad_base,
       c.total,
       round(c.total / nullif(c.cantidad_base, 0), 6) as costo_unitario,
       c.notas,
       c.creado_en
  from compras c
  left join insumos i on i.id = c.insumo_id;

-- Una fila por tanda. El costo se estima con lo que consumió (tanda_consumos) a los
-- precios de compra vigentes en la fecha de la tanda; no es un snapshot guardado.
create view v_tandas with (security_invoker = true) as
with con as (
  select tc.tanda_id,
         case when bool_and(costo_insumo(tc.insumo_id, t.fecha) is not null)
              then sum(tc.cantidad * costo_insumo(tc.insumo_id, t.fecha)) end as costo
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
   group by tc.tanda_id
)
select t.id,
       t.fecha,
       date_trunc('month', t.fecha)::date as mes,
       s.nombre as sabor,
       t.cantidad as tandas,
       t.rolls,
       round(con.costo, 2) as costo,
       round(con.costo / nullif(t.rolls, 0), 2) as costo_roll,
       t.notas,
       t.creado_en
  from tandas t
  join sabores s on s.id = t.sabor_id
  left join con on con.tanda_id = t.id;

revoke all on public.v_gastos, public.v_compras, public.v_tandas from anon;
-- v_gastos sale de una sola tabla y sería actualizable: las tres quedan de solo lectura.
revoke insert, update, delete, truncate on public.v_gastos, public.v_compras, public.v_tandas
  from authenticated;

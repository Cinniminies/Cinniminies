-- Ingresos de plata que no son ventas: aportes de los socios y otros ingresos.
-- Tabla aparte de `gastos` (y no un tipo más) para que ninguna suma de gastos los cuente por error.
--   aporte_socios: plata que ponen los socios. Espejo del retiro: suma a la caja, no es ganancia.
--   otro: plata que entra por otra cosa que no es una venta. Suma a la caja y al resultado.

create table ingresos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  descripcion text not null,
  tipo text not null check (tipo in ('aporte_socios', 'otro')),
  monto numeric(12, 2) not null check (monto > 0),
  notas text,
  creado_en timestamptz not null default now()
);
create index on ingresos (fecha);

alter table ingresos enable row level security;
revoke all on ingresos from anon;
create policy "solo admins" on ingresos for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

-- Resumen por mes: columnas nuevas al final (create or replace no deja reordenar).
-- `resultado` ahora suma los otros ingresos.
create or replace view v_resumen_mensual with (security_invoker = true) as
with vt as (
  select mes,
         count(*) filter (where tipo in ('venta', 'consumo_propio')) as ventas,
         coalesce(sum(total) filter (where tipo in ('venta', 'consumo_propio')), 0) as vendido,
         coalesce(sum(total) filter (where tipo in ('venta', 'consumo_propio')
                                       and estado_pago = 'pagado'), 0) as cobrado,
         sum(rolls) as rolls_vendidos,
         sum(costo_produccion) as costo_produccion,
         sum(costo_caja) as costo_caja,
         sum(ganancia) as ganancia_bruta
    from v_ventas
   group by mes
), co as (
  select date_trunc('month', fecha)::date as mes, sum(total) as compras
    from compras group by 1
), ga as (
  select date_trunc('month', fecha)::date as mes,
         coalesce(sum(monto) filter (where tipo not in ('retiro_socios', 'ajuste_caja')), 0) as gastos,
         coalesce(sum(monto) filter (where tipo = 'retiro_socios'), 0) as retiros,
         coalesce(sum(monto) filter (where tipo = 'ajuste_caja'), 0) as ajustes_caja
    from gastos group by 1
), ig as (
  select date_trunc('month', fecha)::date as mes,
         coalesce(sum(monto) filter (where tipo = 'aporte_socios'), 0) as aportes,
         coalesce(sum(monto) filter (where tipo = 'otro'), 0) as otros_ingresos
    from ingresos group by 1
), meses as (
  select mes from vt union select mes from co union select mes from ga union select mes from ig
)
select m.mes,
       coalesce(vt.ventas, 0) as ventas,
       coalesce(vt.rolls_vendidos, 0) as rolls_vendidos,
       coalesce(vt.vendido, 0) as vendido,
       coalesce(vt.cobrado, 0) as cobrado,
       coalesce(vt.vendido, 0) - coalesce(vt.cobrado, 0) as pendiente,
       coalesce(vt.costo_produccion, 0) as costo_produccion,
       coalesce(vt.costo_caja, 0) as costo_caja,
       coalesce(vt.ganancia_bruta, 0) as ganancia_bruta,
       coalesce(co.compras, 0) as compras,
       coalesce(ga.gastos, 0) as gastos,
       coalesce(co.compras, 0) + coalesce(ga.gastos, 0) as total_gastado,
       coalesce(ga.retiros, 0) as retiros,
       coalesce(ga.ajustes_caja, 0) as ajustes_caja,
       coalesce(vt.vendido, 0) + coalesce(ig.otros_ingresos, 0)
         - coalesce(co.compras, 0) - coalesce(ga.gastos, 0) as resultado,
       coalesce(ig.aportes, 0) as aportes,
       coalesce(ig.otros_ingresos, 0) as otros_ingresos
  from meses m
  left join vt on vt.mes = m.mes
  left join co on co.mes = m.mes
  left join ga on ga.mes = m.mes
  left join ig on ig.mes = m.mes;

-- Panel: los ingresos suman a la caja y al capital; los otros ingresos, también a la ganancia neta.
create or replace view v_panel with (security_invoker = true) as
with v as (
  select coalesce(sum(total) filter (where tipo in ('venta', 'consumo_propio')), 0) as vendido,
         coalesce(sum(total) filter (where tipo in ('venta', 'consumo_propio')
                                       and estado_pago = 'pagado'), 0) as cobrado,
         count(*) filter (where tipo in ('venta', 'consumo_propio')) as ventas,
         count(*) filter (where estado_pago = 'pendiente') as ventas_pendientes,
         coalesce(sum(ganancia), 0) as ganancia_bruta,
         coalesce(sum(rolls), 0) as rolls_vendidos
    from v_ventas
), c as (
  select coalesce(sum(total), 0) as compras from compras
), g as (
  select coalesce(sum(monto) filter (where tipo not in ('retiro_socios', 'ajuste_caja')), 0) as gastos,
         coalesce(sum(monto) filter (where tipo = 'retiro_socios'), 0) as retiros,
         coalesce(sum(monto) filter (where tipo = 'ajuste_caja'), 0) as ajustes_caja
    from gastos
), i as (
  select coalesce(sum(monto) filter (where tipo = 'aporte_socios'), 0) as aportes,
         coalesce(sum(monto) filter (where tipo = 'otro'), 0) as otros_ingresos
    from ingresos
), s as (
  select coalesce(sum(valor) filter (where tipo = 'ingrediente'), 0) as stock_ingredientes,
         coalesce(sum(valor) filter (where tipo = 'packaging'), 0) as stock_packaging,
         count(*) filter (where reponer) as alertas_stock
    from v_stock
), t as (
  select coalesce(sum(cantidad), 0) as tandas, coalesce(sum(rolls), 0) as rolls_producidos from tandas
)
select v.vendido,
       v.cobrado,
       v.vendido - v.cobrado as pendiente,
       v.ventas,
       v.ventas_pendientes,
       c.compras,
       g.gastos,
       c.compras + g.gastos as total_gastado,
       g.retiros,
       g.ajustes_caja,
       v.ganancia_bruta,
       s.stock_ingredientes,
       s.stock_packaging,
       s.alertas_stock,
       v.vendido + i.otros_ingresos - (c.compras + g.gastos) + s.stock_ingredientes + s.stock_packaging
         as ganancia_neta,
       v.vendido - (c.compras + g.gastos) - (v.vendido - v.cobrado) - g.retiros - g.ajustes_caja
         + i.aportes + i.otros_ingresos as caja_teorica,
       v.vendido - (c.compras + g.gastos) - (v.vendido - v.cobrado) - g.retiros - g.ajustes_caja
         + i.aportes + i.otros_ingresos + s.stock_ingredientes + s.stock_packaging as capital,
       t.tandas,
       t.rolls_producidos,
       v.rolls_vendidos,
       i.aportes,
       i.otros_ingresos
  from v, c, g, s, t, i;

-- Export al Sheet: una fila por ingreso. Solo lectura, como v_gastos.
create view v_ingresos with (security_invoker = true) as
select i.id,
       i.fecha,
       date_trunc('month', i.fecha)::date as mes,
       i.tipo,
       i.descripcion,
       i.monto,
       i.tipo = 'otro' as es_ingreso_negocio,
       i.notas,
       i.creado_en
  from ingresos i;
revoke all on public.v_ingresos from anon;
revoke insert, update, delete, truncate on public.v_ingresos from authenticated;

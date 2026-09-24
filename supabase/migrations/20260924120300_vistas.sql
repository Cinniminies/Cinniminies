-- Vistas de reporte. Las usan el panel de /admin y el export a Google Sheets.
-- Todas con security_invoker: respetan la RLS de quien consulta.

-- Una fila por venta.
create view v_ventas with (security_invoker = true) as
with lineas as (
  select l.venta_id,
         string_agg(case when l.cantidad > 1 then l.cantidad || ' × ' else '' end || f.nombre,
                    ' + ' order by f.orden, f.nombre) as formatos,
         sum(l.costo_caja) as costo_caja
    from venta_lineas l
    join formatos f on f.id = l.formato_id
   group by l.venta_id
), sab as (
  select l.venta_id,
         sum(s.unidades) as rolls,
         sum(s.unidades * s.costo_unitario) as costo_produccion,
         string_agg(coalesce(sa.nombre_corto, sa.nombre) || ' ' || s.unidades, ', '
                    order by sa.orden, sa.nombre) as sabores
    from venta_lineas l
    join venta_linea_sabores s on s.linea_id = l.id
    join sabores sa on sa.id = s.sabor_id
   group by l.venta_id
)
select v.id,
       v.fecha,
       date_trunc('month', v.fecha)::date as mes,
       v.cliente_id,
       c.nombre as cliente,
       v.origen,
       v.tipo,
       v.entrega,
       v.medio_pago,
       v.estado_pago,
       l.formatos,
       sab.sabores,
       coalesce(sab.rolls, 0)::int as rolls,
       v.precio_lista,
       v.precio_cobrado,
       v.precio_lista - v.precio_cobrado as descuento,
       v.cobro_envio,
       v.precio_cobrado + v.cobro_envio as total,
       round(coalesce(sab.costo_produccion, 0), 2) as costo_produccion,
       coalesce(l.costo_caja, 0) as costo_caja,
       round(v.precio_cobrado + v.cobro_envio - coalesce(sab.costo_produccion, 0)
             - coalesce(l.costo_caja, 0), 2) as ganancia,
       v.notas,
       v.creado_en
  from ventas v
  left join clientes c on c.id = v.cliente_id
  left join lineas l on l.venta_id = v.id
  left join sab on sab.venta_id = v.id;

-- Una fila por sabor de cada venta. El ingreso se prorratea por unidades.
create view v_ventas_sabores with (security_invoker = true) as
with rolls as (
  select l.venta_id, sum(s.unidades) as rolls
    from venta_lineas l
    join venta_linea_sabores s on s.linea_id = l.id
   group by l.venta_id
)
select v.id as venta_id,
       v.fecha,
       date_trunc('month', v.fecha)::date as mes,
       v.tipo,
       v.estado_pago,
       f.nombre as formato,
       sa.nombre as sabor,
       s.unidades,
       round(v.precio_cobrado * s.unidades / nullif(r.rolls, 0), 2) as ingreso,
       round(s.unidades * s.costo_unitario, 2) as costo,
       s.costo_unitario
  from ventas v
  join venta_lineas l on l.venta_id = v.id
  join formatos f on f.id = l.formato_id
  join venta_linea_sabores s on s.linea_id = l.id
  join sabores sa on sa.id = s.sabor_id
  join rolls r on r.venta_id = v.id;

-- Costo unitario vigente de cada insumo y de dónde sale.
create view v_costo_insumo with (security_invoker = true) as
select i.id as insumo_id,
       i.nombre,
       i.tipo,
       i.unidad_base,
       costo_insumo(i.id) as costo_unitario,
       case when uc.id is null then 'referencia' else 'compra' end as fuente,
       uc.fecha as ultima_compra,
       uc.proveedor,
       uc.cantidad_base as presentacion,
       uc.total as precio_presentacion,
       i.activo
  from insumos i
  left join lateral (
    select c.id, c.fecha, c.proveedor, c.cantidad_base, c.total
      from compras c
     where c.insumo_id = i.id and c.cantidad_base > 0 and c.fecha <= hoy()
     order by c.fecha desc, c.creado_en desc
     limit 1
  ) uc on true;

-- Costo por tanda y por roll de cada sabor, con el margen de venderlo por unidad.
create view v_costo_sabor with (security_invoker = true) as
select s.id as sabor_id,
       s.nombre,
       s.activo,
       s.visible_web,
       s.rolls_por_tanda,
       round(costo_tanda(s.id), 2) as costo_tanda,
       round(costo_roll(s.id), 4) as costo_roll,
       precio_vigente(null, s.id) as precio_unidad,
       round(precio_vigente(null, s.id) - costo_roll(s.id), 2) as margen_unidad
  from sabores s;

-- Margen de cada caja fija activa armada con un solo sabor (incluye el costo de la caja).
create view v_margen_formato with (security_invoker = true) as
select f.id as formato_id,
       f.nombre as formato,
       s.id as sabor_id,
       s.nombre as sabor,
       coalesce(precio_vigente(f.id, s.id), precio_vigente(f.id, null)) as precio,
       round(f.rolls * costo_roll(s.id), 2) as costo_rolls,
       round(coalesce(costo_insumo(f.caja_insumo_id), 0), 2) as costo_caja,
       round(coalesce(precio_vigente(f.id, s.id), precio_vigente(f.id, null))
             - f.rolls * costo_roll(s.id) - coalesce(costo_insumo(f.caja_insumo_id), 0), 2) as margen
  from formatos f
  cross join sabores s
 where f.tipo = 'caja_fija' and f.activo and s.activo;

-- 5.7 Stock teórico = último conteo + compras − consumos de tandas − cajas (y lo que llevan)
-- usadas en ventas, contando solo los movimientos posteriores al conteo.
create view v_stock with (security_invoker = true) as
with ult as (
  select distinct on (insumo_id) insumo_id, fecha, creado_en, cantidad
    from conteos
   order by insumo_id, fecha desc, creado_en desc
), movimientos as (
  select c.insumo_id, c.fecha, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida_tandas,
         0::numeric as salida_ventas
    from compras c
   where c.insumo_id is not null and c.cantidad_base is not null
  union all
  select tc.insumo_id, t.fecha, t.creado_en, 0, tc.cantidad, 0
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
  union all
  select l.caja_insumo_id, v.fecha, v.creado_en, 0, 0, l.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null
  union all
  select ci.insumo_id, v.fecha, v.creado_en, 0, 0, l.cantidad * ci.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
), desde as (
  select i.id as insumo_id,
         coalesce(sum(m.entrada), 0) as comprado,
         coalesce(sum(m.salida_tandas), 0) as usado_tandas,
         coalesce(sum(m.salida_ventas), 0) as usado_ventas
    from insumos i
    left join ult u on u.insumo_id = i.id
    left join movimientos m
      on m.insumo_id = i.id
     and (u.insumo_id is null or (m.fecha, m.creado_en) > (u.fecha, u.creado_en))
   group by i.id
), calc as (
  select i.id as insumo_id,
         i.nombre,
         i.tipo,
         i.unidad_base,
         u.fecha as fecha_conteo,
         coalesce(u.cantidad, 0) as conteo,
         d.comprado,
         d.usado_tandas,
         d.usado_ventas,
         coalesce(u.cantidad, 0) + d.comprado - d.usado_tandas - d.usado_ventas as teorico,
         i.stock_minimo,
         costo_insumo(i.id) as costo_unitario
    from insumos i
    join desde d on d.insumo_id = i.id
    left join ult u on u.insumo_id = i.id
   where i.activo
)
select calc.*,
       teorico < stock_minimo as reponer,
       round(greatest(teorico, 0) * coalesce(costo_unitario, 0), 2) as valor
  from calc;

-- Tandas, rolls producidos y rolls vendidos por sabor.
create view v_produccion_sabor with (security_invoker = true) as
select s.id as sabor_id,
       s.nombre,
       coalesce((select sum(t.cantidad) from tandas t where t.sabor_id = s.id), 0) as tandas,
       coalesce((select sum(t.rolls) from tandas t where t.sabor_id = s.id), 0) as rolls_producidos,
       coalesce((select sum(vs.unidades) from venta_linea_sabores vs where vs.sabor_id = s.id), 0)
         as rolls_vendidos
  from sabores s;

-- Clientes con lo que compraron.
create view v_clientes with (security_invoker = true) as
select c.id,
       c.nombre,
       c.contacto,
       c.origen,
       c.notas,
       count(v.id) as compras,
       coalesce(sum(v.total), 0) as total_comprado,
       max(v.fecha) as ultima_compra
  from clientes c
  left join v_ventas v on v.cliente_id = c.id
 group by c.id;

-- 5.6 Vendido, cobrado, gastos, retiros y ganancia por mes.
create view v_resumen_mensual with (security_invoker = true) as
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
), meses as (
  select mes from vt union select mes from co union select mes from ga
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
       coalesce(vt.vendido, 0) - coalesce(co.compras, 0) - coalesce(ga.gastos, 0) as resultado
  from meses m
  left join vt on vt.mes = m.mes
  left join co on co.mes = m.mes
  left join ga on ga.mes = m.mes;

-- 5.6 Números del panel (una sola fila).
create view v_panel with (security_invoker = true) as
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
       v.vendido - (c.compras + g.gastos) + s.stock_ingredientes + s.stock_packaging as ganancia_neta,
       v.vendido - (c.compras + g.gastos) - (v.vendido - v.cobrado) - g.retiros - g.ajustes_caja
         as caja_teorica,
       v.vendido - (c.compras + g.gastos) - (v.vendido - v.cobrado) - g.retiros - g.ajustes_caja
         + s.stock_ingredientes + s.stock_packaging as capital,
       t.tandas,
       t.rolls_producidos,
       v.rolls_vendidos
  from v, c, g, s, t;

do $$
declare
  vista text;
begin
  foreach vista in array array[
    'v_ventas', 'v_ventas_sabores', 'v_costo_insumo', 'v_costo_sabor', 'v_margen_formato',
    'v_stock', 'v_produccion_sabor', 'v_clientes', 'v_resumen_mensual', 'v_panel'
  ] loop
    execute format('revoke all on public.%I from anon', vista);
  end loop;
end $$;

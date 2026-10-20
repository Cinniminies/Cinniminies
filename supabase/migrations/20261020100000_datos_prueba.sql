-- Datos de prueba aislados (20/10, para probar el descuento por recomendación en local contra la base real).
--
-- Lo que carga el usuario de prueba (usuarios_admin.es_prueba) queda marcado y los dueños no lo ven: ni en
-- /admin ni en el Sheet de análisis. El usuario de prueba, a su vez, ve solo lo suyo. Se borra todo junto con
-- borrar_datos_prueba() (en la migración de recomendaciones).
--
-- * privado.es_prueba(): true si quien llama es el usuario de prueba; false para los dueños y la service key.
-- * clientes, ventas y pedidos: columna es_prueba. Clientes y ventas toman la de quien los carga; los pedidos
--   de la web, la que les pasa crear_pedido_web (solo el servidor local la manda en true).
-- * RLS: cada admin ve las filas con su misma marca. Las líneas de venta y las cajas de pedido se ven si se ve
--   su venta o su pedido.
-- * v_ventas, v_ventas_sabores, v_movimientos_stock y v_stock filtran igual, porque el export las lee con la
--   service key (que se saltea la RLS). Las vistas que salen de v_ventas (v_clientes, v_resumen_mensual,
--   v_panel) heredan el filtro.

create function privado.es_prueba() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select es_prueba from public.usuarios_admin where user_id = (select auth.uid())), false);
$$;
revoke all on function privado.es_prueba() from public, anon;
grant usage on schema privado to service_role;
grant execute on function privado.es_prueba() to authenticated, service_role;

alter table clientes add column es_prueba boolean not null default privado.es_prueba();
alter table ventas add column es_prueba boolean not null default privado.es_prueba();
alter table pedidos add column es_prueba boolean not null default false;
comment on column clientes.es_prueba is 'Cargado por el usuario de prueba: solo lo ve él (ver privado.es_prueba)';
comment on column ventas.es_prueba is 'Cargada por el usuario de prueba: solo la ve él (ver privado.es_prueba)';
comment on column pedidos.es_prueba is 'Pedido hecho desde el servidor local en modo prueba: solo lo ve el usuario de prueba';

drop policy "solo admins" on clientes;
create policy "solo admins" on clientes for all to authenticated
  using ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()))
  with check ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()));

drop policy "solo admins" on ventas;
create policy "solo admins" on ventas for all to authenticated
  using ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()))
  with check ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()));

drop policy "solo admins" on pedidos;
create policy "solo admins" on pedidos for all to authenticated
  using ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()))
  with check ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()));

-- Las tablas hijas se ven si se ve la fila madre (que ya está filtrada por la RLS de arriba).
drop policy "solo admins" on venta_lineas;
create policy "solo admins" on venta_lineas for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from ventas v where v.id = venta_id))
  with check ((select privado.es_admin()) and exists (select 1 from ventas v where v.id = venta_id));

drop policy "solo admins" on venta_linea_sabores;
create policy "solo admins" on venta_linea_sabores for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from venta_lineas l where l.id = linea_id))
  with check ((select privado.es_admin()) and exists (select 1 from venta_lineas l where l.id = linea_id));

drop policy "solo admins" on pedido_cajas;
create policy "solo admins" on pedido_cajas for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id))
  with check ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id));

-- Vistas: mismas definiciones que antes, con el filtro de la marca.
create or replace view v_ventas with (security_invoker = true) as
with lineas as (
  select l.venta_id,
         string_agg(case when l.cantidad > 1 then l.cantidad || ' × ' else '' end || f.nombre, ' + '
                    order by f.orden, f.nombre) as formatos,
         sum(l.costo_caja) as costo_caja
    from venta_lineas l
    join formatos f on f.id = l.formato_id
   group by l.venta_id
), sab as (
  select l.venta_id,
         sum(s.unidades) as rolls,
         sum(s.unidades * s.costo_unitario) as costo_produccion,
         string_agg(coalesce(sa.nombre_corto, sa.nombre) || ' ' || s.unidades, ', ' order by sa.orden, sa.nombre) as sabores
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
       round(v.precio_cobrado + v.cobro_envio - coalesce(sab.costo_produccion, 0) - coalesce(l.costo_caja, 0), 2) as ganancia,
       v.notas,
       v.creado_en,
       v.por_hacer
  from ventas v
  left join clientes c on c.id = v.cliente_id
  left join lineas l on l.venta_id = v.id
  left join sab on sab.venta_id = v.id
 where v.es_prueba = (select privado.es_prueba());

create or replace view v_ventas_sabores with (security_invoker = true) as
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
  join rolls r on r.venta_id = v.id
 where v.es_prueba = (select privado.es_prueba());

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
 where v.hecho_en is not null and v.es_prueba = (select privado.es_prueba());

create or replace view v_stock with (security_invoker = true) as
with ult as (
  select distinct on (conteos.insumo_id) conteos.insumo_id, conteos.fecha, conteos.creado_en, conteos.cantidad
    from conteos
   order by conteos.insumo_id, conteos.creado_en desc
), movimientos as (
  select c.insumo_id, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida_tandas, 0::numeric as salida_ventas
    from compras c
   where c.insumo_id is not null and c.cantidad_base is not null
  union all
  select tc.insumo_id, t.creado_en, 0, tc.cantidad, 0
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
  union all
  select l.caja_insumo_id, v.hecho_en, 0, 0, l.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null and v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
  union all
  select ci.insumo_id, v.hecho_en, 0, 0, l.cantidad::numeric * ci.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
   where v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
), desde as (
  select i.id as insumo_id,
         coalesce(sum(m.entrada), 0) as comprado,
         coalesce(sum(m.salida_tandas), 0) as usado_tandas,
         coalesce(sum(m.salida_ventas), 0) as usado_ventas
    from insumos i
    left join ult u on u.insumo_id = i.id
    left join movimientos m on m.insumo_id = i.id and (u.insumo_id is null or m.creado_en > u.creado_en)
   group by i.id
), calc as (
  select i.id as insumo_id, i.nombre, i.tipo, i.unidad_base,
         u.fecha as fecha_conteo,
         coalesce(u.cantidad, 0) as conteo,
         d.comprado, d.usado_tandas, d.usado_ventas,
         coalesce(u.cantidad, 0) + d.comprado - d.usado_tandas - d.usado_ventas as teorico,
         i.stock_minimo,
         costo_insumo(i.id) as costo_unitario
    from insumos i
    join desde d on d.insumo_id = i.id
    left join ult u on u.insumo_id = i.id
   where i.activo
)
select insumo_id, nombre, tipo, unidad_base, fecha_conteo, conteo, comprado, usado_tandas, usado_ventas, teorico,
       stock_minimo, costo_unitario,
       teorico < stock_minimo as reponer,
       round(greatest(teorico, 0) * coalesce(costo_unitario, 0), 2) as valor
  from calc;

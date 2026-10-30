-- Cierre de mes (idea 4.4): el resumen de un mes para /admin → Cierre de mes (se guarda en PDF o se manda por
-- WhatsApp) y para el aviso push del día 1 (api/cierre-mes.js). Los meses son los de la fecha de venta, o sea el
-- sábado de entrega (20261029160000).
--
-- cierre_mes(mes) → { mes, actual, anterior, margen, ticket, clientes, clientes_total, clientes_nuevos, sabores,
--                     sabor_top, semanas, mejor_sabado }
-- * actual / anterior: la fila de v_resumen_mensual del mes y del mes anterior (null si no hubo nada).
-- * margen: la ganancia bruta en % de lo vendido; ticket: lo vendido por venta (null sin ventas).
-- * clientes: los 5 que más compraron en el mes [{ id, nombre, compras, total }]; clientes_total: cuántos
--   compraron; clientes_nuevos: cuántos compraron por primera vez.
-- * sabores: rolls por sabor { "Canela": 40, … }; sabor_top: el que más salió { nombre, pct }.
-- * semanas: lo vendido cada sábado del mes [{ sabado, vendido, rolls }]; mejor_sabado: el que más vendió.
-- Cuenta lo mismo que v_resumen_mensual: ventas y consumo propio (no los regalos).
create function cierre_mes(p_mes date) returns jsonb
language sql stable set search_path = public
as $$
  with m as (select date_trunc('month', p_mes)::date as mes),
  del_mes as (
    select v.* from v_ventas v, m where v.mes = m.mes and v.tipo in ('venta', 'consumo_propio')
  ),
  r as (select v.* from v_resumen_mensual v, m where v.mes = m.mes),
  sab as (select sabor, sum(unidades) as rolls from v_ventas_sabores s, m where s.mes = m.mes group by sabor),
  semanas as (
    select s.sabado, coalesce(x.vendido, 0) as vendido, coalesce(x.rolls, 0) as rolls
      from m, (select privado.sabado_de_semana(m.mes) + 7 * i as sabado from m, generate_series(0, 4) i) s
      left join (select fecha, sum(total) as vendido, sum(rolls) as rolls from del_mes group by fecha) x
        on x.fecha = s.sabado
     where s.sabado < m.mes + interval '1 month'
  )
  select jsonb_build_object(
    'mes', m.mes,
    'actual', (select to_jsonb(r) from r),
    'margen', (select round(100 * ganancia_bruta / nullif(vendido, 0)) from r),
    'ticket', (select round(vendido / nullif(ventas, 0)) from r),
    'anterior', (select to_jsonb(r) from v_resumen_mensual r where r.mes = (m.mes - interval '1 month')::date),
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.cliente_id, 'nombre', x.cliente, 'compras', x.compras, 'total', x.total)
                       order by x.total desc)
        from (select cliente_id, cliente, count(*) as compras, sum(total) as total
                from del_mes where cliente_id is not null
               group by cliente_id, cliente order by sum(total) desc limit 5) x), '[]'::jsonb),
    'clientes_total', (select count(distinct cliente_id) from del_mes),
    -- Nuevos: los que compraron este mes y nunca antes
    'clientes_nuevos', (select count(distinct d.cliente_id) from del_mes d
                         where not exists (select 1 from v_ventas v where v.cliente_id = d.cliente_id and v.fecha < m.mes)),
    'sabores', coalesce((select jsonb_object_agg(sabor, rolls) from sab), '{}'::jsonb),
    'sabor_top', (select jsonb_build_object('nombre', sabor, 'pct', round(100 * rolls / sum(rolls) over ()))
                    from sab order by rolls desc limit 1),
    -- Todos los sábados del mes, también los que no se vendió nada (o no se horneó)
    'semanas', (select jsonb_agg(to_jsonb(s) order by s.sabado) from semanas s),
    'mejor_sabado', (select to_jsonb(s) from semanas s where s.vendido > 0 order by s.vendido desc limit 1))
  from m;
$$;
revoke all on function cierre_mes(date) from public, anon;
grant execute on function cierre_mes(date) to authenticated, service_role;

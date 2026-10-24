-- Rolls que sobraron de cada horneado y no se vendieron (pedido del 24/10/2026: "solo informe").
--
-- Un horneado = los días de tandas seguidos (por ejemplo sábado y domingo). Por horneado y sabor:
-- producidos (tandas) − usados (ventas, regalos y consumo propio) = sobrantes.
-- Pérdida: solo los sobrantes dentro de lo que rinde la receta (tandas × rolls por tanda). Si una tanda de 12
-- dio 13, ese roll de más salió con los mismos ingredientes: si no se vende no se perdió nada.
-- No se carga nada a mano y no va a gastos (la plata ya salió en las compras): es para ver.
--
-- ¿Qué ventas son de cada horneado?
-- * ventas.horneado: la fecha del horneado que las hizo. La guarda registrar_horneado en los pedidos que
--   pasa a hechos.
-- * Si no la tiene (venta cargada "Ya entregado", como un roll suelto que sobró, o un pedido marcado hecho a
--   mano), va al último horneado que empezó en su fecha o antes.
-- * Las que siguen "Por hacer" no cuentan: todavía no se hornearon.
-- * Lo cargado antes de esto (desde el 01/09) se asigna como venían trabajando: los pedidos de la semana van
--   al primer horneado en su fecha o después.
-- El informe arranca el 01/09/2026: antes las tandas no se cargaban todas y no se puede comparar.

alter table ventas add column horneado date;

update ventas v
   set horneado = (select min(t.fecha) from tandas t where t.fecha >= v.fecha)
 where not v.por_hacer and v.fecha >= date '2026-09-01';

create or replace function registrar_horneado(p jsonb default '{}') returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_plan jsonb := plan_horneado(p);
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  s jsonb;
  v_tandas int := 0;
  v_ventas int;
begin
  if jsonb_array_length(v_plan->'sabores') = 0 then
    raise exception 'No hay nada para hornear';
  end if;
  for s in select * from jsonb_array_elements(v_plan->'sabores') loop
    perform registrar_tanda(jsonb_build_object(
      'fecha', v_fecha, 'sabor_id', s->>'sabor_id', 'cantidad', s->'tandas', 'rolls', s->'rolls',
      'notas', 'Plan de horneado'));
    v_tandas := v_tandas + 1;
  end loop;

  update ventas v set por_hacer = false, horneado = v_fecha
   where v.por_hacer
     and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x));
  get diagnostics v_ventas = row_count;

  return v_plan || jsonb_build_object('fecha', v_fecha, 'tandas_registradas', v_tandas, 'ventas_hechas', v_ventas);
end;
$$;

-- Una fila por horneado y sabor. costo_roll a la fecha del horneado.
create view v_sobrantes with (security_invoker = true) as
with dias as (
  select fecha, case when fecha - lag(fecha) over (order by fecha) <= 1 then 0 else 1 end as nuevo
    from (select distinct fecha from tandas where fecha >= date '2026-09-01') d
), grupos as (
  select fecha, sum(nuevo) over (order by fecha) as g from dias
), horneados as (
  select g, min(fecha) as inicio, max(fecha) as fin from grupos group by g
), prod as (
  select h.g, t.sabor_id, sum(t.rolls)::int as rolls, sum(t.cantidad * s.rolls_por_tanda) as esperados
    from tandas t
    join sabores s on s.id = t.sabor_id
    join horneados h on t.fecha between h.inicio and h.fin
   group by 1, 2
), ventas_h as (
  select v.id,
         coalesce((select h.g from horneados h where v.horneado between h.inicio and h.fin),
                  (select h.g from horneados h where h.inicio <= v.fecha order by h.inicio desc limit 1)) as g
    from ventas v
   where not v.por_hacer
     and v.es_prueba = (select privado.es_prueba())
), usados as (
  select vh.g, vs.sabor_id, sum(vs.unidades)::int as rolls
    from ventas_h vh
    join venta_lineas l on l.venta_id = vh.id
    join venta_linea_sabores vs on vs.linea_id = l.id
   where vh.g is not null
   group by 1, 2
)
select h.inicio,
       h.fin,
       s.id as sabor_id,
       s.nombre,
       coalesce(p.rolls, 0) as producidos,
       coalesce(u.rolls, 0) as usados,
       greatest(coalesce(p.rolls, 0) - coalesce(u.rolls, 0), 0) as sobrantes,
       greatest(floor(least(coalesce(p.rolls, 0), coalesce(p.esperados, 0)))::int - coalesce(u.rolls, 0), 0) as perdidos,
       round(greatest(floor(least(coalesce(p.rolls, 0), coalesce(p.esperados, 0)))::int - coalesce(u.rolls, 0), 0)
             * coalesce(costo_roll(s.id, h.fin), 0), 2) as costo
  from horneados h
  cross join sabores s
  left join prod p on p.g = h.g and p.sabor_id = s.id
  left join usados u on u.g = h.g and u.sabor_id = s.id
 where p.rolls is not null or u.rolls is not null;

revoke all on v_sobrantes from anon;

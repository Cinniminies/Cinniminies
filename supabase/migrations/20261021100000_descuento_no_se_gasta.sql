-- El descuento por recomendación no se gasta al usarlo: lo ganado en el mes (con tope) vale para todos los
-- pedidos de ese mes y vuelve a cero recién cuando cambia el mes. Los canjes se siguen guardando, pero solo
-- para saber cuánto costó la campaña (resumen_campana).
create or replace function saldo_recomendacion(p_cliente uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  with k as (
    select (campana_vigente(coalesce(p_fecha, hoy()), c.es_prueba)).* from clientes c where c.id = p_cliente
  ), m as (select date_trunc('month', coalesce(p_fecha, hoy()))::date as mes)
  select coalesce((
    select least(k.tope, k.porcentaje * (select count(*) from recomendaciones r
                                         where r.recomendador_id = p_cliente and r.campana_id = k.id
                                           and r.estado = 'valida' and r.mes = m.mes))
      from k, m where k.id is not null), 0);
$$;

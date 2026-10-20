-- Campañas: frenar fechas mal tipeadas (20/10). Una campaña de prueba quedó hasta el 31/12/20226: la base la
-- tomaba como vigente pero /admin, que compara fechas como texto, la mostraba terminada. Ahora una campaña
-- no puede durar más de un año.
create or replace function guardar_campana(p jsonb) returns uuid
language plpgsql set search_path = public
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_desde date := (p->>'desde')::date;
  v_hasta date := (p->>'hasta')::date;
begin
  if nullif(trim(p->>'nombre'), '') is null then raise exception 'Falta el nombre de la campaña'; end if;
  if v_desde is null or v_hasta is null then raise exception 'Faltan las fechas'; end if;
  if v_hasta < v_desde then raise exception 'La campaña termina antes de empezar'; end if;
  if v_hasta > v_desde + 366 then raise exception 'La campaña dura más de un año: revisá las fechas'; end if;
  if exists (select 1 from campanas_recomendacion
              where id is distinct from v_id and es_prueba = privado.es_prueba()
                and desde <= v_hasta and hasta >= v_desde) then
    raise exception 'Ya hay una campaña en esas fechas';
  end if;
  if v_id is null then
    insert into campanas_recomendacion (nombre, desde, hasta, porcentaje, tope)
    values (trim(p->>'nombre'), v_desde, v_hasta,
            coalesce(nullif(p->>'porcentaje', '')::numeric, 5), coalesce(nullif(p->>'tope', '')::numeric, 30))
    returning id into v_id;
  else
    update campanas_recomendacion
       set nombre = trim(p->>'nombre'), desde = v_desde, hasta = v_hasta,
           porcentaje = coalesce(nullif(p->>'porcentaje', '')::numeric, porcentaje),
           tope = coalesce(nullif(p->>'tope', '')::numeric, tope)
     where id = v_id;
    if not found then raise exception 'La campaña no existe'; end if;
  end if;
  return v_id;
end;
$$;

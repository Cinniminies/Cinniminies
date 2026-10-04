-- Deshacer el último conteo (pedido de Lucio, 04/10): borra todo lo que se guardó en esa vez (mismo
-- creado_en, una llamada a registrar_conteo). Solo el último, porque cada conteo guarda su teórico
-- y lo usado desde el anterior: borrar uno del medio dejaría mal los desvíos del siguiente.
-- Al borrarlo, el stock teórico vuelve a arrancar del conteo anterior de cada insumo.

create function deshacer_ultimo_conteo() returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_creado timestamptz := (select max(creado_en) from conteos);
  v_fecha date;
  n int;
begin
  if v_creado is null then
    raise exception 'No hay conteos para deshacer';
  end if;
  select fecha into v_fecha from conteos where creado_en = v_creado limit 1;
  delete from conteos where creado_en = v_creado;
  get diagnostics n = row_count;
  return jsonb_build_object('fecha', v_fecha, 'creado_en', v_creado, 'insumos', n);
end;
$$;
revoke all on function public.deshacer_ultimo_conteo() from public, anon;
grant execute on function public.deshacer_ultimo_conteo() to authenticated;

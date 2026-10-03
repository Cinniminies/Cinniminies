-- Editar una tanda ya registrada (pedido de Lucio, 03/10): por ejemplo, si salieron más de las que
-- se cargaron desde el Plan de horneado.
-- * cantidad: lo consumido se escala en proporción, así se conserva la receta del día de la tanda.
-- * rolls: si no viene y cambia la cantidad, se escala igual; si viene, se usa tal cual.
-- * notas: solo si viene la clave.

create function actualizar_tanda(p_id uuid, p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  t tandas%rowtype;
  v_cant numeric;
  v_rolls int;
begin
  select * into t from tandas where id = p_id for update;
  if not found then
    raise exception 'Tanda inexistente';
  end if;
  v_cant := coalesce(nullif(p->>'cantidad', '')::numeric, t.cantidad);
  if v_cant <= 0 then
    raise exception 'La cantidad de tandas tiene que ser mayor a 0';
  end if;
  v_rolls := coalesce(nullif(p->>'rolls', '')::int, round(t.rolls * v_cant / t.cantidad)::int);
  if v_rolls < 0 then
    raise exception 'Los rolls no pueden ser negativos';
  end if;

  if v_cant <> t.cantidad then
    update tanda_consumos set cantidad = cantidad * v_cant / t.cantidad where tanda_id = t.id;
  end if;
  update tandas
     set cantidad = v_cant, rolls = v_rolls,
         notas = case when p ? 'notas' then nullif(trim(p->>'notas'), '') else notas end
   where id = t.id;

  return jsonb_build_object('tanda_id', t.id, 'cantidad', v_cant, 'rolls', v_rolls);
end;
$$;

revoke all on function public.actualizar_tanda(uuid, jsonb) from public, anon;
grant execute on function public.actualizar_tanda(uuid, jsonb) to authenticated;

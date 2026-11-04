-- Aviso del viernes con las compras (idea 3.6): lo que dice ¿Qué compro? para el plan de horneado de un sábado, con
-- todo lo que /admin → Plan elige por defecto: los pedidos por hacer de ese sábado y los atrasados, sin rolls extra y
-- completando la tanda mezclada con el sabor de siempre. Lo usan el push del viernes (api/compras-sabado.js) y
-- /admin → ¿Qué compro? al abrir el aviso (#/comprar/AAAA-MM-DD), así los dos muestran lo mismo.
--
-- compras_sabado(sabado = el de esta semana) → { sabado, pedidos, tandas, cajas, comprar, total }
-- * pedidos: cuántas ventas por hacer entran.
-- * tandas: { "<sabor_id>": recetas } y cajas: { "<insumo_id>": cantidad }, lo que reciben que_comprar y cargarPlan.
-- * comprar: las filas de que_comprar con algo que falta; total: su costo estimado.
create function compras_sabado(p_sabado date default privado.sabado_de_semana(hoy())) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_p jsonb := jsonb_build_object('ventas', coalesce(
    (select jsonb_agg(v.id) from ventas v where v.por_hacer and v.fecha <= p_sabado), '[]'::jsonb));
  v_plan jsonb := plan_horneado(v_p);
  v_tandas jsonb := coalesce((select jsonb_object_agg(s->>'sabor_id', (s->>'tandas')::numeric)
                                from jsonb_array_elements(v_plan->'sabores') s), '{}'::jsonb);
  v_cajas jsonb := coalesce((select jsonb_object_agg(c.insumo_id, c.necesario) from cajas_plan(v_p) c), '{}'::jsonb);
  v_comprar jsonb;
  v_total numeric;
begin
  select coalesce(jsonb_agg(to_jsonb(c) order by c.insumo), '[]'::jsonb), coalesce(sum(c.costo_estimado), 0)
    into v_comprar, v_total
    from que_comprar(v_tandas, v_cajas) c
   where c.faltante > 0;
  return jsonb_build_object(
    'sabado', p_sabado,
    'pedidos', jsonb_array_length(v_p->'ventas'),
    'tandas', v_tandas,
    'cajas', v_cajas,
    'comprar', v_comprar,
    'total', v_total);
end $$;
revoke all on function compras_sabado(date) from public, anon;
grant execute on function compras_sabado(date) to authenticated, service_role;

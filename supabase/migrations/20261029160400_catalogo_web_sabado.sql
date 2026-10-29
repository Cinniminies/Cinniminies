-- Cierre de pedidos (5/5): la web recibe para qué sábado es el pedido, y sus textos.

-- catalogo_web: suma para qué sábado es un pedido hecho ahora, hasta cuándo se puede pedir para ese sábado
-- (hora de Uruguay) y por qué no es el de esta semana: 'cierre' (ya cerró) o 'sin_horneado' (ese sábado no se hornea).
create or replace function catalogo_web(p_prueba boolean default false) returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'sabores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.slug,
               'nombre', s.nombre,
               'descripcion', s.descripcion,
               'etiqueta', s.etiqueta_web,
               'foto', s.foto,
               'precio_unidad', precio_vigente(null, s.id))
             order by s.orden, s.nombre)
        from sabores s
       where s.activo and s.visible_web and not s.eliminado
         and nullif(trim(s.slug), '') is not null), '[]'::jsonb),
    'formatos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', f.nombre,
               'tipo', f.tipo,
               'rolls', f.rolls,
               'min_rolls', f.min_rolls,
               'max_rolls', f.max_rolls,
               'precio', precio_vigente(f.id, null))
             order by f.orden, f.nombre)
        from formatos f
       where f.activo and f.visible_web), '[]'::jsonb),
    'contenido', coalesce((select jsonb_object_agg(c.clave, c.valor) from contenido_web c), '{}'::jsonb),
    'envio', (select valor::numeric from parametros where clave = 'precio_envio'),
    -- Promos de hoy. formatos/sabores vacíos = todos; la web hace la misma cuenta que privado.promo_de_linea.
    'promos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', pr.nombre,
               'tipo', pr.tipo,
               'valor', pr.valor,
               'texto', pr.texto_web,
               'hasta', pr.hasta,
               'formatos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', f.tipo, 'rolls', f.rolls)), '[]')
                              from formatos f where f.id = any(pr.formatos)),
               'sabores', (select coalesce(jsonb_agg(s.slug), '[]') from sabores s where s.id = any(pr.sabores)))
             order by pr.desde, pr.nombre)
        from promos pr
       where pr.activa and pr.es_prueba = p_prueba and hoy() between pr.desde and pr.hasta), '[]'::jsonb),
    'pedidos', (
      select jsonb_build_object(
               'sabado', x.sabado,
               'cierre', to_char(privado.cierre_de(x.sabado), 'YYYY-MM-DD"T"HH24:MI'),
               'motivo', case when x.sabado = x.este then null
                              when exists (select 1 from sabados_sin_horneado where sabado = x.este) then 'sin_horneado'
                              else 'cierre' end)
        from (select sabado_de_pedido() as sabado, privado.sabado_de_semana(hoy()) as este) x));
$$;
revoke all on function catalogo_web(boolean) from public, anon, authenticated;
grant execute on function catalogo_web(boolean) to service_role;

-- Textos de la web: para qué sábado es el pedido (arriba del carrito) y en el pedido recibido.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, seccion, orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('carrito.sabado', 'Carrito y formulario', 19, 'Para qué sábado es el pedido',
    'Arriba del carrito. {sabado}: el sábado de entrega (31/10). {cierre}: hasta cuándo se puede pedir (jueves 29/10 a las 23:59).',
    'Pedidos para el sábado {sabado}. Se puede pedir hasta el {cierre}.'),
  ('carrito.sabado_cerrado', 'Carrito y formulario', 20, 'Para qué sábado es el pedido (después del cierre)',
    'Cuando ya cerraron los pedidos de este sábado. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.',
    'Ya cerramos los pedidos de este sábado. Tu pedido es para el sábado {sabado}.'),
  ('carrito.sabado_sin_horneado', 'Carrito y formulario', 21, 'Para qué sábado es el pedido (sábado sin horneado)',
    'Cuando este sábado no hornean. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.',
    'Este sábado no horneamos. Tu pedido es para el sábado {sabado}.'),
  ('pedido.sabado', 'Pedido recibido', 2, 'Para qué sábado es', 'Debajo del número de pedido. {sabado}: el sábado de entrega.',
    'Tu pedido es para el sábado {sabado}.')
) as t(clave, seccion, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;

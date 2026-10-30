-- Estadísticas de visitas propias (idea 6.2): cuántos entran a la web, de dónde vienen y cuántos llegan a pedir.
-- Sin cookies ni datos personales: la web manda un número de sesión al azar por pestaña (sessionStorage), de dónde
-- vino (Instagram, Google, WhatsApp…) y si es celular o compu. No se guarda la IP: solo su hash, para limitar
-- abusos (como en pedidos). Lo registra /api/visita con service_role; los bots se descartan ahí.
--
-- Pasos de una sesión: visita (entró) → carrito (abrió el carrito con algo) → formulario (tocó "Pedir ahora") →
-- pedido (lo mandó). Cada paso cuenta una vez por sesión y por día.

create table visitas (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  dia date not null default hoy(),
  sesion text not null check (sesion ~ '^[a-z0-9]{8,32}$'),
  tipo text not null check (tipo in ('visita', 'carrito', 'formulario', 'pedido')),
  origen text not null check (origen in ('instagram', 'google', 'whatsapp', 'facebook', 'tiktok', 'directo', 'otro')),
  dispositivo text not null check (dispositivo in ('celular', 'compu')),
  ip_hash text,
  unique (sesion, tipo, dia)
);
create index on visitas (dia);
create index on visitas (ip_hash, creado_en);

alter table visitas enable row level security;
revoke all on visitas from anon;
create policy "solo admins leen" on visitas for select to authenticated using ((select privado.es_admin()));

-- p: { sesion, tipo, origen, dispositivo }. Los pasos después de la visita toman el origen de la visita de esa
-- sesión (así el embudo por origen cierra aunque el navegador ya no tenga el referrer). Lo repetido se ignora y
-- una misma IP no registra más de 120 pasos por hora. No devuelve nada: la web no espera respuesta.
create function registrar_visita(p jsonb, p_ip_hash text default null) returns void
language plpgsql set search_path = public
as $$
declare
  v_sesion text := lower(p->>'sesion');
begin
  if p_ip_hash is not null
     and (select count(*) from visitas where ip_hash = p_ip_hash and creado_en > now() - interval '1 hour') >= 120 then
    return;
  end if;
  insert into visitas (sesion, tipo, origen, dispositivo, ip_hash)
  values (v_sesion, p->>'tipo',
          coalesce((select origen from visitas where sesion = v_sesion and tipo = 'visita' order by creado_en desc limit 1),
                   p->>'origen'),
          p->>'dispositivo', p_ip_hash)
  on conflict (sesion, tipo, dia) do nothing;
end;
$$;
revoke all on function registrar_visita(jsonb, text) from public, anon, authenticated;
grant execute on function registrar_visita(jsonb, text) to service_role;

-- Resumen de las visitas entre dos días (inclusive) para /admin → Visitas:
-- { sesiones, embudo: { carrito, formulario, pedido }, por_dia: [{ dia, sesiones, pedidos }],
--   origenes: [{ origen, sesiones, pedidos }], dispositivos: { celular, compu }, anterior: { sesiones, pedidos } }
-- Todo cuenta sesiones distintas: `sesiones` es el primer paso del embudo (entraron). `anterior` es el mismo largo
-- de días justo antes, para comparar.
create function resumen_visitas(p_desde date, p_hasta date) returns jsonb
language sql stable set search_path = public
as $$
  with v as (select * from visitas where dia between p_desde and p_hasta),
  sesiones as (
    select sesion, min(origen) as origen, min(dispositivo) as dispositivo,
           bool_or(tipo = 'pedido') as pidio
      from v group by sesion
  ),
  dias as (
    select dia, count(distinct sesion) as sesiones, count(distinct sesion) filter (where tipo = 'pedido') as pedidos
      from v group by dia
  ),
  previo as (
    select count(distinct sesion) as sesiones, count(distinct sesion) filter (where tipo = 'pedido') as pedidos
      from visitas where dia between p_desde - (p_hasta - p_desde + 1) and p_desde - 1
  )
  select jsonb_build_object(
    'sesiones', (select count(*) from sesiones),
    'embudo', (select jsonb_build_object(
                 'carrito', count(distinct sesion) filter (where tipo = 'carrito'),
                 'formulario', count(distinct sesion) filter (where tipo = 'formulario'),
                 'pedido', count(distinct sesion) filter (where tipo = 'pedido')) from v),
    -- Todos los días del período, también los que no entró nadie
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', d.dia, 'sesiones', coalesce(x.sesiones, 0),
                                                    'pedidos', coalesce(x.pedidos, 0)) order by d.dia)
                  from (select p_desde + i as dia from generate_series(0, p_hasta - p_desde) i) d
                  left join dias x on x.dia = d.dia),
    'origenes', coalesce((select jsonb_agg(jsonb_build_object('origen', origen, 'sesiones', n, 'pedidos', pedidos)
                                           order by n desc)
                            from (select origen, count(*) as n, count(*) filter (where pidio) as pedidos
                                    from sesiones group by origen) x), '[]'::jsonb),
    'dispositivos', (select jsonb_build_object('celular', count(*) filter (where dispositivo = 'celular'),
                                               'compu', count(*) filter (where dispositivo = 'compu'))
                       from sesiones),
    'anterior', (select to_jsonb(previo) from previo));
$$;
revoke all on function resumen_visitas(date, date) from public, anon;
grant execute on function resumen_visitas(date, date) to authenticated, service_role;

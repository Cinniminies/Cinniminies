-- Cierre de pedidos (1/5) de la semana (idea 2.9) y "Pedidos para el sábado DD/MM" en la web (6.8). Decidido el 29/10:
-- * Se hornea y se entrega solo el sábado: la fecha de una venta es SIEMPRE el sábado de entrega. El día en que
--   entró el pedido queda aparte, en ventas.pedido_el (con él se toman precios, costos y promos).
-- * Los pedidos de un sábado cierran el jueves a las 23:59 (editable en /admin → Pedidos web). Pasado el cierre,
--   el pedido es para el sábado siguiente, tanto en la web como en lo que se carga a mano (WhatsApp, Instagram).
-- * Hay sábados en los que no se hornea (sabados_sin_horneado): los pedidos pasan al sábado siguiente.
-- * Lo ya entregado fuera del sábado (rolls que sobraron y se venden el domingo) va al sábado del horneado.
-- * Las ventas ya cargadas pasan al sábado de su horneado o, si no lo tienen, al de su semana (domingo a sábado).

-- 4 = jueves (el día de la semana de Postgres: 0 = domingo). La hora es la de Uruguay.
insert into parametros (clave, valor) values ('cierre_dia', '4'), ('cierre_hora', '23:59')
on conflict (clave) do nothing;

create table sabados_sin_horneado (
  sabado date primary key check (extract(dow from sabado) = 6),
  motivo text check (length(motivo) <= 80),
  creado_en timestamptz not null default now()
);
alter table sabados_sin_horneado enable row level security;
revoke all on sabados_sin_horneado from anon;
create policy "solo admins" on sabados_sin_horneado for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

-- La hora de Uruguay (o la de parametros.zona_horaria) de un momento, sin zona.
create function privado.hora_local(p_momento timestamptz) returns timestamp
language sql stable set search_path = public
as $$
  select p_momento at time zone coalesce((select valor from parametros where clave = 'zona_horaria'), 'America/Montevideo');
$$;

-- Hasta cuándo se puede pedir para el sábado p_sabado (hora de Uruguay): cierre_dia de esa semana a la cierre_hora.
create function privado.cierre_de(p_sabado date) returns timestamp
language sql stable set search_path = public
as $$
  select (p_sabado - (6 - coalesce((select valor::int from parametros where clave = 'cierre_dia'), 4)))
         + coalesce((select valor::time from parametros where clave = 'cierre_hora'), time '23:59');
$$;

-- El sábado de la semana de pedidos (domingo a sábado) de un día.
create function privado.sabado_de_semana(p_dia date) returns date
language sql immutable set search_path = public
as $$
  select p_dia + (6 - extract(dow from p_dia)::int);
$$;

-- El sábado del horneado de algo entregado en p_dia: ese día si es sábado, si no el sábado anterior.
create function privado.sabado_anterior(p_dia date) returns date
language sql immutable set search_path = public
as $$
  select p_dia - ((extract(dow from p_dia)::int + 1) % 7);
$$;

revoke all on function privado.hora_local(timestamptz), privado.cierre_de(date), privado.sabado_de_semana(date),
  privado.sabado_anterior(date) from public, anon;
grant execute on function privado.hora_local(timestamptz), privado.cierre_de(date), privado.sabado_de_semana(date),
  privado.sabado_anterior(date) to authenticated, service_role;

-- El sábado de entrega de un pedido hecho en p_momento: el primero cuyo cierre no pasó y en el que se hornea.
-- El cierre vale hasta el final de su minuto (23:59:59 todavía entra).
create function sabado_de_pedido(p_momento timestamptz default now()) returns date
language plpgsql stable set search_path = public
as $$
declare
  v_local timestamp := date_trunc('minute', privado.hora_local(p_momento));
  v_sabado date := privado.sabado_de_semana(v_local::date);
begin
  for i in 1..52 loop
    if v_local <= privado.cierre_de(v_sabado)
       and not exists (select 1 from sabados_sin_horneado where sabado = v_sabado) then
      return v_sabado;
    end if;
    v_sabado := v_sabado + 7;
  end loop;
  raise exception 'No hay ningún sábado con horneado en el próximo año';
end;
$$;
revoke all on function sabado_de_pedido(timestamptz) from public, anon;
grant execute on function sabado_de_pedido(timestamptz) to authenticated, service_role;

-- El sábado que se sugiere al cargar una venta hoy: si queda por hacer, el del próximo cierre; si ya se entregó, el
-- del horneado. Lo usan registrar_venta (sin fecha) y + Venta en /admin.
create function sabado_de_entrega(p_por_hacer boolean, p_pedido_el date default null) returns date
language sql stable set search_path = public
as $$
  select case when p_por_hacer then sabado_de_pedido() else privado.sabado_anterior(coalesce(p_pedido_el, hoy())) end;
$$;
revoke all on function sabado_de_entrega(boolean, date) from public, anon;
grant execute on function sabado_de_entrega(boolean, date) to authenticated, service_role;

-- La fecha de una venta tiene que ser un sábado (el de entrega).
create function privado.exigir_sabado(p_fecha date) returns void
language plpgsql immutable set search_path = public
as $$
begin
  if extract(dow from p_fecha) <> 6 then
    raise exception 'La fecha de la venta es el sábado de entrega, y el % no es sábado', to_char(p_fecha, 'DD/MM');
  end if;
end;
$$;
revoke all on function privado.exigir_sabado(date) from public, anon;
grant execute on function privado.exigir_sabado(date) to authenticated, service_role;

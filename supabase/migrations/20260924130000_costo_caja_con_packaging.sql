-- Respuestas de los dueños (24/09) a la conciliación de la Etapa 1:
-- * El costo de caja de las ventas nuevas incluye el packaging que lleva cada caja
--   (papel manteca y stickers, según caja_insumos). Las ventas ya guardadas no cambian.
-- * Existió una caja de 3 ($25), usada en una venta vieja. Queda inactiva.

insert into insumos (nombre, tipo, unidad_base, stock_minimo, costo_referencia, activo)
values ('Caja Box de 3', 'packaging', 'un', 0, 25, false);

-- Costo de usar una caja: la caja más lo que lleva (caja_insumos). Null si falta algún costo.
create function costo_caja(p_caja uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select costo_insumo(p_caja, p_fecha)
         + coalesce((select case when bool_and(costo_insumo(ci.insumo_id, p_fecha) is not null)
                                 then sum(ci.cantidad * costo_insumo(ci.insumo_id, p_fecha)) end
                       from caja_insumos ci
                      where ci.caja_insumo_id = p_caja
                     having count(*) > 0), 0);
$$;
revoke all on function costo_caja(uuid, date) from public, anon;
grant execute on function costo_caja(uuid, date) to authenticated;

-- Calcula y valida una venta sin guardarla (sirve para el resumen en vivo de la app).
-- payload: {
--   fecha?, entrega ('envio'|'retiro'|'sin_envio'), cobro_envio?, precio_especial?,
--   lineas: [{ formato_id, cantidad?, caja_insumo_id? (null = sin caja; si falta, la de
--              siempre), sabores: [{ sabor_id, unidades }] }]
-- }
create or replace function calcular_venta(p jsonb) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  v_entrega text := coalesce(nullif(p->>'entrega', ''), 'sin_envio');
  v_linea jsonb;
  v_item jsonb;
  f formatos%rowtype;
  s sabores%rowtype;
  v_cant int;
  v_unidades int;
  v_rolls int;
  v_n_sabores int;
  v_sabor_unico uuid;
  v_precio numeric;
  v_costo numeric;
  v_precio_linea numeric;
  v_costo_prod_linea numeric;
  v_caja uuid;
  v_costo_caja numeric;
  v_sabores jsonb;
  v_lineas jsonb := '[]';
  v_lista numeric := 0;
  v_costo_prod numeric := 0;
  v_costo_cajas numeric := 0;
  v_rolls_total int := 0;
  v_cobrado numeric;
  v_envio numeric;
begin
  if v_entrega not in ('envio', 'retiro', 'sin_envio') then
    raise exception 'Entrega inválida: %', v_entrega;
  end if;
  if jsonb_typeof(p->'lineas') is distinct from 'array' or jsonb_array_length(p->'lineas') = 0 then
    raise exception 'La venta no tiene nada cargado';
  end if;

  for v_linea in select * from jsonb_array_elements(p->'lineas') loop
    select * into f from formatos where id = nullif(v_linea->>'formato_id', '')::uuid;
    if not found then
      raise exception 'Formato inexistente';
    end if;
    if not f.activo then
      raise exception 'El formato "%" no está activo', f.nombre;
    end if;

    v_cant := coalesce(nullif(v_linea->>'cantidad', '')::int, 1);
    if v_cant < 1 then
      raise exception 'La cantidad de "%" tiene que ser al menos 1', f.nombre;
    end if;
    if f.tipo <> 'caja_fija' and v_cant <> 1 then
      raise exception 'En "%" la cantidad se indica con las unidades de cada sabor', f.nombre;
    end if;

    -- Sabores de la línea
    v_sabores := '[]';
    v_rolls := 0;
    v_n_sabores := 0;
    v_precio_linea := 0;
    v_costo_prod_linea := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_linea->'sabores', '[]')) loop
      v_unidades := coalesce(nullif(v_item->>'unidades', '')::int, 0);
      continue when v_unidades = 0;
      if v_unidades < 0 then
        raise exception 'Las unidades no pueden ser negativas';
      end if;
      select * into s from sabores where id = nullif(v_item->>'sabor_id', '')::uuid;
      if not found then
        raise exception 'Sabor inexistente';
      end if;
      if not s.activo then
        raise exception 'El sabor "%" no está activo', s.nombre;
      end if;
      if v_sabores @> jsonb_build_array(jsonb_build_object('sabor_id', s.id)) then
        raise exception 'El sabor "%" está repetido en "%"', s.nombre, f.nombre;
      end if;

      v_costo := costo_roll(s.id, v_fecha);
      if v_costo is null then
        raise exception 'No puedo calcular el costo de "%": falta la receta o el costo de algún insumo', s.nombre;
      end if;

      if f.tipo <> 'caja_fija' then
        v_precio := coalesce(precio_vigente(f.id, s.id, v_fecha), precio_vigente(null, s.id, v_fecha));
        if v_precio is null then
          raise exception 'No hay precio por unidad para "%" al %', s.nombre, v_fecha;
        end if;
        v_precio_linea := v_precio_linea + v_unidades * v_precio;
      end if;

      v_sabores := v_sabores || jsonb_build_object(
        'sabor_id', s.id, 'sabor', s.nombre, 'unidades', v_unidades, 'costo_unitario', v_costo);
      v_rolls := v_rolls + v_unidades;
      v_n_sabores := v_n_sabores + 1;
      v_sabor_unico := s.id;
      v_costo_prod_linea := v_costo_prod_linea + v_unidades * v_costo;
    end loop;

    if v_n_sabores = 0 then
      raise exception 'Elegí los sabores de "%"', f.nombre;
    end if;

    -- 5.4 Validaciones de cantidad de rolls
    if f.tipo = 'caja_fija' and v_rolls <> f.rolls * v_cant then
      raise exception '% × "%" lleva % rolls y cargaste %', v_cant, f.nombre, f.rolls * v_cant, v_rolls;
    end if;
    if f.tipo = 'personalizado'
       and (v_rolls < coalesce(f.min_rolls, 1) or v_rolls > coalesce(f.max_rolls, v_rolls)) then
      raise exception '"%" va de % a % rolls y cargaste %',
        f.nombre, coalesce(f.min_rolls, 1), coalesce(f.max_rolls, v_rolls), v_rolls;
    end if;

    -- 5.3 Precio de una caja fija: el especial de ese sabor si es de un solo sabor, si no el general
    if f.tipo = 'caja_fija' then
      v_precio := case when v_n_sabores = 1 then precio_vigente(f.id, v_sabor_unico, v_fecha) end;
      v_precio := coalesce(v_precio, precio_vigente(f.id, null, v_fecha));
      if v_precio is null then
        raise exception 'No hay precio para "%" al %', f.nombre, v_fecha;
      end if;
      v_precio_linea := v_precio * v_cant;
    end if;

    -- Caja: la indicada (null = sin caja) o la de siempre
    if v_linea ? 'caja_insumo_id' then
      v_caja := nullif(v_linea->>'caja_insumo_id', '')::uuid;
    elsif f.tipo = 'caja_fija' then
      v_caja := f.caja_insumo_id;
    elsif f.tipo = 'personalizado' then
      v_caja := caja_sugerida(v_rolls);
    else
      v_caja := null;
    end if;
    v_costo_caja := 0;
    if v_caja is not null then
      if not exists (select 1 from insumos where id = v_caja and tipo = 'packaging') then
        raise exception 'La caja elegida no es un insumo de packaging';
      end if;
      v_costo := costo_caja(v_caja, v_fecha);
      if v_costo is null then
        raise exception 'No hay costo para la caja o su packaging: cargá una compra o un costo de referencia';
      end if;
      v_costo_caja := round(v_costo * v_cant, 2);
    end if;

    v_lineas := v_lineas || jsonb_build_object(
      'formato_id', f.id, 'formato', f.nombre, 'tipo', f.tipo, 'cantidad', v_cant,
      'rolls', v_rolls, 'caja_insumo_id', v_caja, 'precio_lista', v_precio_linea,
      'costo_produccion', round(v_costo_prod_linea, 2), 'costo_caja', v_costo_caja,
      'sabores', v_sabores);
    v_lista := v_lista + v_precio_linea;
    v_costo_prod := v_costo_prod + v_costo_prod_linea;
    v_costo_cajas := v_costo_cajas + v_costo_caja;
    v_rolls_total := v_rolls_total + v_rolls;
  end loop;

  v_cobrado := coalesce(nullif(p->>'precio_especial', '')::numeric, v_lista);
  if v_cobrado < 0 then
    raise exception 'El precio especial no puede ser negativo';
  end if;
  v_envio := case
    when v_entrega <> 'envio' then 0
    else coalesce(nullif(p->>'cobro_envio', '')::numeric,
                  (select valor::numeric from parametros where clave = 'precio_envio'), 0)
  end;

  return jsonb_build_object(
    'fecha', v_fecha,
    'entrega', v_entrega,
    'rolls', v_rolls_total,
    'precio_lista', v_lista,
    'precio_cobrado', v_cobrado,
    'descuento', v_lista - v_cobrado,
    'cobro_envio', v_envio,
    'costo_produccion', round(v_costo_prod, 2),
    'costo_caja', v_costo_cajas,
    'ganancia', round(v_cobrado + v_envio - v_costo_prod - v_costo_cajas, 2),
    'lineas', v_lineas);
end;
$$;

-- Margen de cada caja fija activa armada con un solo sabor (incluye caja, papel y stickers).
create or replace view v_margen_formato with (security_invoker = true) as
select f.id as formato_id,
       f.nombre as formato,
       s.id as sabor_id,
       s.nombre as sabor,
       coalesce(precio_vigente(f.id, s.id), precio_vigente(f.id, null)) as precio,
       round(f.rolls * costo_roll(s.id), 2) as costo_rolls,
       round(coalesce(costo_caja(f.caja_insumo_id), 0), 2) as costo_caja,
       round(coalesce(precio_vigente(f.id, s.id), precio_vigente(f.id, null))
             - f.rolls * costo_roll(s.id) - coalesce(costo_caja(f.caja_insumo_id), 0), 2) as margen
  from formatos f
  cross join sabores s
 where f.tipo = 'caja_fija' and f.activo and s.activo;


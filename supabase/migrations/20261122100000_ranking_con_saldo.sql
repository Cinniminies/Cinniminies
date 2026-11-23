-- El ranking de la campaña (/admin → Recomendaciones) trae, además de cuántas recomendaciones válidas tiene
-- cada uno, el descuento que tiene hoy (saldo_recomendacion), hasta cuándo lo puede usar, su código y su
-- contacto: así se ve el % sin entrar a la ficha y se le puede mandar un WhatsApp con lo que juntó.
-- `vence`: lo ganado recomendando se usa hasta fin de mes (o hasta que termine la campaña, si es antes); si
-- todo el saldo es el bono de la Box de 12, hasta que vence el bono. Sin saldo, null.
-- Igual a 20261021120000_bono_box_12.sql salvo el 'ranking'.
create or replace function resumen_campana(p_campana uuid) returns jsonb
language sql stable set search_path = public as $$
  with k as (select * from campanas_recomendacion where id = p_campana),
  r as (select r.* from recomendaciones r where r.campana_id = p_campana),
  nuevos as (select recomendado_id from r where estado = 'valida'),
  canjes as (select x.* from canjes_recomendacion x join pedidos p on p.id = x.pedido_id
              where x.campana_id = p_campana and p.estado = 'confirmado'),
  -- clientes nuevos de cualquier origen en las fechas de la campaña (para comparar)
  primeras as (select v.cliente_id, min(v.fecha) as fecha from ventas v where v.cliente_id is not null group by 1),
  ranking as (
    select c.id, c.nombre, c.contacto, cr.codigo, x.validas, s.saldo,
           case when s.saldo = 0 then null
                when s.saldo > coalesce(b.porcentaje, 0)
                  then least((date_trunc('month', hoy()) + interval '1 month - 1 day')::date, kv.hasta)
                else b.hasta end as vence
      from (select recomendador_id as id, count(*) as validas from r where estado = 'valida' group by 1) x
      join clientes c on c.id = x.id
      left join codigos_recomendacion cr on cr.cliente_id = c.id
      cross join lateral (select saldo_recomendacion(c.id) as saldo) s
      left join lateral bono_recomendacion(c.id, hoy()) b on b.id is not null
      left join lateral campana_vigente(hoy(), c.es_prueba) kv on kv.id is not null)
  select jsonb_build_object(
    'validas', (select count(*) from r where estado = 'valida'),
    'pendientes', (select count(*) from r where estado = 'pendiente'),
    'anuladas', (select count(*) from r where estado = 'anulada'),
    'clientes_nuevos_total', (select count(*) from primeras, k where primeras.fecha between k.desde and k.hasta),
    'vendido_recomendados', coalesce((select sum(v.precio_cobrado + v.cobro_envio) from ventas v, k
                                       where v.cliente_id in (select recomendado_id from nuevos)
                                         and v.fecha between k.desde and k.hasta), 0),
    'volvieron', (select count(*) from nuevos n where (select count(*) from ventas v where v.cliente_id = n.recomendado_id) > 1),
    'bonos', (select count(*) from bonos_recomendacion where campana_id = p_campana),
    'bonos_vigentes', (select count(*) from bonos_recomendacion where campana_id = p_campana and hoy() between desde and hasta),
    'canjes', (select count(*) from canjes),
    'descuento_entregado', coalesce((select sum(monto) from canjes), 0),
    'costo_por_cliente', (select round(coalesce(sum(monto), 0) / nullif((select count(*) from nuevos), 0), 2) from canjes),
    'ranking', coalesce((select jsonb_agg(to_jsonb(x) order by x.validas desc, x.nombre) from ranking x), '[]'));
$$;

-- El WhatsApp con el descuento que lleva juntado, editable en /admin → Textos e imágenes.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Descuento por recomendación', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('recomendacion.mensaje_saldo', 13, 'Mensaje de WhatsApp: descuento juntado',
    'Se manda desde el ranking de Recomendaciones. {nombre}: el primer nombre, {saldo}: el % que tiene hoy, '
      || '{codigo}: su código, {vence}: último día para usarlo (ej: 30/11).',
    'texto_largo',
    '¡Hola {nombre}! Gracias por recomendar Cinniminies. Ya juntaste {saldo} % de descuento en una Box de 6 o de 12.'
      || E'\n\n' || 'Para usarlo, poné tu código {codigo} cuando hagas tu pedido en cinniminies.emprendeuy.com. '
      || 'Vale hasta el {vence}.')
) as t(clave, orden, etiqueta, ayuda, tipo, valor)
on conflict (clave) do nothing;

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Panel de gestión', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('panel.recomendaciones.ranking_ayuda', 1809, 'texto', 'Recomendaciones · Ayuda del ranking',
    'Debajo del título del ranking.',
    'A la derecha, el descuento que tiene cada uno hoy. Con WhatsApp le mandás cuánto juntó y su código.'),
  ('panel.recomendaciones.ranking_vence', 1809, 'texto', 'Recomendaciones · Hasta cuándo vale el descuento',
    'En cada cliente del ranking que tiene descuento. {fecha}: último día para usarlo (ej: 30/11).',
    'vale hasta el {fecha}')
) as t(clave, orden, tipo, etiqueta, ayuda, valor)
on conflict (clave) do nothing;

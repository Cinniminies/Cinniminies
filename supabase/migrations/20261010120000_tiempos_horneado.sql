-- Calculadora de tiempo del horneado (pedido de Lucio, 03/10): tiempos en minutos, iguales para todos
-- los sabores. Se editan desde /admin → Producción → Plan. El cálculo está en admin/js/tiempos.js.
insert into parametros (clave, valor) values
  ('tiempo_preparacion', '25'),     -- preparar una tanda de masas (20–30 min)
  ('masas_por_preparacion', '2'),   -- cuántas masas salen juntas en esa preparación
  ('tiempo_leudado', '60'),         -- primer leudado
  ('tiempo_estirado', '18'),        -- estirar una tanda (15–20 min), de a una
  ('tiempo_leudado2', '40'),        -- segundo leudado, ya estirada
  ('tiempo_horno', '20'),           -- horno, por tanda
  ('horno_tandas', '1')             -- tandas que entran juntas en el horno
on conflict (clave) do nothing;

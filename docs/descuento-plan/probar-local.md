# Probar el descuento por recomendación en local

Dos entornos en la misma compu, contra la base real pero **aislados**: lo que hagas queda marcado como prueba,
Pia y Lucio no lo ven (ni en /admin, ni en Inicio, ni en el Sheet), no les llega ningún aviso ni mail, y no
toca el stock real.

## Arrancar

```sh
node scripts/servidor-dev.js
```

| Entorno | Dirección | Qué es |
|---|---|---|
| Cliente | http://127.0.0.1:8777/ | La web pública. Abajo a la izquierda aparece un aviso rojo: **Modo prueba**. |
| Admin | http://127.0.0.1:8777/dev/entrar-prueba | Entra a /admin con el usuario de prueba (arriba dice **Modo prueba**). |

Conviene abrirlos en dos ventanas lado a lado. Para hacer de varios clientes, usá celulares inventados:
`091000001`, `091000002`, `091000003`… (el celular es lo que identifica a cada cliente).

> `MODO_PRUEBA=0 node scripts/servidor-dev.js` vuelve al comportamiento de antes: pedidos **reales**.

## Recorrido sugerido

1. **Admin → Recomendaciones → Nueva campaña.** Ej.: "PRUEBA", desde hoy hasta el 31/12, 5 % y tope 30 %.
   Sin campaña, la web no muestra el campo del código.
2. **Cliente:** Ana (`091000001`) pide una Box sin código.
3. **Admin → Pedidos web:** confirmar el pedido → en la venta, **Marcar cobrada**. Aparece
   "Código para recomendar: ANA-XXX" con el botón para mandárselo por WhatsApp (no lo toques si no querés
   que se abra WhatsApp; el mensaje armado se ve en el link).
4. **Cliente:** Bruno (`091000002`) pide con el código de Ana. Debajo del campo dice "Código de Ana ✓".
5. **Admin:** el pedido dice "Vino con el código de Ana: cuenta cuando se pague la venta". Confirmar y cobrar
   → en Recomendaciones, Ana tiene 1 válida.
6. **Cliente:** Ana pide de nuevo con **su** código → "tenés 5 % de descuento en una box (−$23)". El total
   ya viene con el descuento y el WhatsApp lo detalla.
7. Casos para mirar: Bruno usando de nuevo el código de Ana (ya es cliente: no suma), Ana poniendo su código
   sin saldo, una caja personalizada (no lleva descuento), volver a pedir después de usarlo (el descuento sigue: no se gasta),
   marcar pendiente una venta cobrada (la recomendación vuelve a pendiente), llegar al tope de 30 % (la tarjeta
   del descuento se pone naranja y sale confeti, una vez por código y celular).

## Borrar todo

**Admin → Recomendaciones → Borrar datos de prueba.** Borra pedidos, ventas, clientes, códigos y campañas de
prueba (y los comprobantes subidos). Solo lo puede hacer el usuario de prueba.

## Qué no se puede probar en local

- **El cambio de mes:** el saldo es del mes en que se validó la recomendación y se vence a fin de mes. No hay
  forma de adelantar el reloj desde la web; está cubierto por la prueba de `supabase/tests/reglas.sql`.
- **Los avisos al celular y el mail de Web3Forms:** en modo prueba no se mandan, a propósito.

## Antes de lanzar

- Crear la campaña real (1/11 al 31/12) desde /admin con una cuenta de los dueños, y tocar
  **Dar código a los que ya compraron**.
- Mergear la rama a `main` (sin campaña real activa, la web publicada no muestra nada nuevo).
- Borrar los datos de prueba.

# Descuento por recomendación · lógica propuesta

> Diseño a partir de [`idea.md`](idea.md). Es para leer y confirmar: todavía no hay código ni cambios en la base.
> Al final están las **decisiones que faltan** (sección 9).

---

## 1. La idea en una frase

Cada cliente que compra recibe **su código**. Si una persona **nueva** compra usando ese código, el dueño del código
gana **5 % de descuento**, acumulable (5 recomendaciones = 25 %), que usa **en una box** de cada compra
que haga ese mes (no se gasta al usarlo). Corre solo durante una **campaña** con fecha de inicio y de fin.
Además, la **primera Box de 12** que alguien paga en la web durante la campaña le deja **5 % por 30 días**
(sección 10).

---

## 2. Cómo resolvemos las tres limitaciones

### 2.1 A qué va atado el código (que nadie se haga pasar por otro)

**Al celular del cliente**, no al nombre. Ya es lo que identifica a un cliente en la base
(`cliente_por_telefono`, últimos 8 dígitos) y la web ya exige un celular uruguayo válido.

- El código es **para compartir**, no es una contraseña: que otro lo conozca no le sirve de nada,
  porque **el descuento solo se canjea en un pedido hecho con el celular del dueño**.
- Los pedidos se coordinan por WhatsApp con ese número. Si alguien pone tu celular para usar tu descuento,
  Pia y Lucio le escriben a vos, no a él. Esa conversación ya existe hoy, así que no agregamos pasos.
- No hace falta crear cuentas ni login para los clientes.

### 2.2 Uno por persona (que no se armen multicuentas para farmear)

Una recomendación **cuenta** solo si se cumplen todas:

1. La compra está **confirmada y pagada** (no alcanza con mandar el formulario: los pedidos web los confirma
   un admin y hay plata real de por medio).
2. Quien compra es un **cliente nuevo**: su celular no tiene ninguna venta anterior en la base. Se cuenta una
   sola vez en la vida de ese cliente, aunque después use otros códigos.
3. El celular del comprador es **distinto** del del dueño del código (no se puede usar el propio).
4. Hay una campaña **activa** el día de la compra.

Lo que no podemos detectar (que una persona tenga dos celulares) lo frena **la cuenta**: para ganar 5 %
con un celular falso hay que **comprar una box entera a precio de lista**.

| Para "farmear" 5 % | Pagás | Ganás |
|---|---|---|
| Comprás una Box de 6 con otro celular | $250 | $12,50 de descuento |
| Comprás una Box de 12 con otro celular | $450 | hasta $22,50 de descuento |

Nadie gana haciendo trampa. Y si lo hace igual, para nosotros es una venta más con margen.
Si dos amigos se ponen de acuerdo para usar el código del otro, **eso es justamente lo que buscamos**.

### 2.3 Que no sea pérdida y que tenga un sentido

**Qué compramos con el 5 %: un cliente nuevo.** Con los números de hoy (`v_margen_formato`):

| Box | Precio | Margen (peor sabor, Nutella) | Margen (Canela) |
|---|---|---|---|
| Box de 6 | $250 | $101 | $155 |
| Box de 12 | $450 | $184 | $292 |

- **Cada recomendación trae una venta nueva** (en promedio unos $100–290 de margen) y cuesta como máximo
  $22,50 de descuento. Es el canal de clientes nuevos más barato que tenemos.
- **El descuento solo se usa comprando**: cada canje es otra venta del cliente que recomendó (lo hace volver).
  Hoy 21 de 68 clientes compraron más de una vez; esto empuja esa cifra.
- **Tope de 30 % por mes** (6 recomendaciones). Con el tope, la peor box (Box de 6 de Nutella) queda en
  $175 y sigue dejando $26 de margen. Como el descuento no se gasta, se aplica en cada pedido del mes, pero
  siempre a una sola box: ningún pedido se vende a pérdida.
- **Se aplica a una sola box** del pedido, no al total.
- **Se vence a fin de mes**: no se acumula una "deuda" de descuentos de un mes para otro.
- **Campaña con fecha de fin**: es una prueba. Al terminar se mira si trajo clientes (sección 7) y se decide
  si se repite.

---

## 3. Flujo completo

```
Ana compra (paga) ─▶ la base le crea su código: ANA-K7P
                     /admin muestra "Mandar código por WhatsApp" (mensaje armado)
        │
        ▼
Ana se lo pasa a Bruno
        │
        ▼
Bruno pide en la web y escribe ANA-K7P en "¿Te recomendó alguien?"
   - La web valida el código (existe, campaña activa) y le dice "Código de Ana ✓"
   - Bruno paga lo normal (ver decisión 9.1)
        │
        ▼
Admin confirma el pedido de Bruno y lo marca pagado
   - Si Bruno es cliente nuevo → recomendación válida → Ana suma 5 % este mes
   - Bruno, como compró, recibe su propio código: BRUNO-3MX
        │
        ▼
Ana pide de nuevo (con su celular) antes de fin de mes
   - En la web pone su celular + su código en "Tu código" → ve "Tenés 5 % en una box"
   - Al confirmar, la base aplica el 5 % a una box y registra el canje (solo para medir el costo: el 5 %
     le sigue sirviendo para otros pedidos del mes)
```

Las ventas cargadas a mano en `/admin → + Venta` (pedidos por Instagram/WhatsApp) siguen el mismo camino:
un campo opcional "Código de recomendación".

---

## 4. El código

- Formato: **primer nombre (hasta 6 letras, sin tildes) + guion + 3 caracteres**, ej. `ANA-K7P`, `BRUNO-3MX`.
  Fácil de dictar y de recordar. Los 3 caracteres usan el mismo alfabeto que los pedidos (`CM-2026-X7K2`):
  sin 0/O ni 1/I/L.
- **Uno por cliente**, para siempre (no cambia entre campañas). Se crea con la **primera venta pagada**.
- Los clientes que ya compraron antes de la campaña también reciben el suyo al arrancarla (se generan todos de
  una vez), así los clientes actuales pueden empezar a recomendar desde el día 1.
- Al escribirlo no importan mayúsculas ni el guion (`ana k7p` sirve).
- Si se fusionan dos clientes (`fusionar_clientes`), queda el código más viejo y se mueven sus recomendaciones.

---

## 5. Reglas del descuento

| Regla | Valor propuesto |
|---|---|
| Descuento por recomendación válida | 5 % |
| Tope | 25 % por mes (5 recomendaciones) |
| Sobre qué se aplica | una box del pedido, la q elija el cliente |
| Cuándo se gana | cuando la venta del recomendado queda **pagada** |
| Cuándo se puede usar | en cualquier compra del mismo mes calendario |
| Cuántas veces | hasta que termine el mes, no se reseta despues de una compra |
| Envío | no lleva descuento |
| Con precio especial | si una venta ya tiene precio especial, se suma el descuento |
| Se combina con otras promos | no (por ahora no hay otras) |

**Si se anula una venta** (se borra o se rechaza el pedido): la recomendación que generó queda anulada.
Si el dueño ya había usado ese descuento, se absorbe (no se le cobra después): el monto es chico y no vale
la pena el mal momento.

---

## 6. Qué cambia en el sistema

### Base (una migración nueva)

- `campanas_recomendacion`: nombre, desde, hasta, porcentaje (5), tope (25), activa.
- `codigos_recomendacion`: `cliente_id` (único), `codigo` (único), creado_en.
- `recomendaciones`: campaña, código usado, `venta_id` del recomendado (única), `cliente_recomendado_id`
  (**único**: un cliente cuenta una sola vez), mes en que suma, estado (`pendiente` hasta que se paga /
  `valida` / `anulada`).
- `canjes_recomendacion`: cliente, `venta_id`, mes, porcentaje y monto aplicado.
- `pedidos.codigo_recomendacion` (lo que escribió el cliente en la web) y `ventas.descuento_recomendacion`
  (monto, para que los reportes lo muestren aparte del precio especial).
- Funciones:
  - `saldo_recomendacion(cliente, mes)` → % disponible (válidas del mes × 5, con tope; no se descuenta lo
    canjeado: el descuento no se gasta, vuelve a cero cuando cambia el mes).
  - `validar_codigo(codigo)` → nombre del dueño si sirve (para la web; no expone el celular).
  - `calcular_venta` gana un `descuento_recomendacion_pct` que aplica sobre una box.
  - Al marcar una venta como pagada: crear el código del cliente si no tiene y pasar su recomendación a `valida`.
- Todo con RLS como el resto; la web solo llega por `api/` con la service key.

### Web pública

- En el formulario de pedido, dos campos opcionales:
  - **"¿Te recomendó alguien? Código"** → muestra "Código de Ana ✓" o "Ese código no existe".
  - **"Tu código"** → con el celular del pedido, muestra el descuento disponible.
    Pedir los dos (celular + código) evita que cualquiera escriba un celular ajeno y vea su saldo.
- `POST /api/pedidos` guarda el código; `GET /api/recomendacion?codigo=…` valida (con el mismo límite por IP).
- Una sección/aviso editable desde /admin → Web explicando la campaña (fila nueva en `contenido_web`).

### /admin

- Pedido web y + Venta: campo de código de recomendación y, si el cliente tiene saldo, el descuento que se
  aplica (se puede sacar a mano).
- En la venta pagada: botón **"Mandar código por WhatsApp"** (link `wa.me` con el mensaje armado).
- Clientes → ficha: su código, a quién recomendó, saldo del mes.
- Más → **Recomendaciones**: crear/cerrar la campaña y ver el resumen (sección 7).

---

## 7. Cómo sabemos si funcionó

Pantalla de resumen de la campaña (y una vista nueva para el Sheet de análisis):

- Clientes nuevos que llegaron con código, y comparación con los clientes nuevos de los meses anteriores
  (hoy entran unos 8–27 clientes por mes).
- Lo vendido a recomendados y su margen.
- Descuento total entregado (lo que costó).
- **Costo por cliente nuevo** = descuento entregado ÷ clientes nuevos con código.
- Cuántos recomendados volvieron a comprar.
- Ranking de quién más recomendó (para un agradecimiento aparte, si quieren).

Regla para decidir al final: si el costo por cliente nuevo es mucho menor que el margen de su primera compra
(~$100–290), la campaña se pagó sola.

---

## 8. Lo que queda afuera a propósito

- Cuentas de cliente o login: el celular + WhatsApp alcanza.
- Descuentos encadenados (que Ana gane algo cuando Bruno recomienda a otro): complica y abre la puerta al farmeo.
- Pagar en efectivo o regalar rolls en vez de descuento.
- Detectar personas con dos celulares: lo frena el costo (2.2), no un sistema.

---

## 9. Decisiones que faltan

1. **¿El recomendado también recibe algo?** El recomendado no recibe nada mas que su propio codigo que puede compartir para generar descuento.
   *Cambió el 21/10:* si su primera compra es una Box de 12, también arranca con el bono de 5 % (sección 10).
2. **"Durante todo el mes":** la promocion se lanzaria en noviembre, lo generado ese mes se usa hasta el 30 de noviembre, despues en diciembre se hace un reinicio y corre igual.
3. **¿Sobre qué box se aplica?** Se aplica para las box de 12 y las de 6, para los pedidos personalizados no
4. **Tope:** Tope 30%
5. **Duración de la primera campaña:** noviembre y diciembre, que incluye fiestas.
6. **¿Cuenta solo la web o también las ventas por WhatsApp/Instagram?** Solo en la web, para incentivar a las personas a usarla.

---

## 10. Bono por la primera Box de 12 (agregado el 21/10)

Para empujar la venta de Boxes de 12.

| Regla | Valor |
|---|---|
| Quién lo recibe | **Cualquier cliente**, nuevo o no (igual que el código). |
| Con qué compra | Su **primer pedido de la web con una Box de 12** durante la campaña (puede tener otras cajas también). Las ventas cargadas a mano en /admin no lo dan. |
| Cuándo se recibe | Cuando esa venta queda **pagada**: ese día recibe el código (si no lo tenía) **y** el bono. |
| Cuánto | El porcentaje de la campaña: **5 %**. |
| Cuánto dura | **30 días desde que se recibe**, contando ese día y 30 más (pagado el 20/12 → vale hasta el 19/1). **Aunque la campaña termine antes**: terminada la campaña, la web sigue mostrando el campo "Tu código" mientras quede algún bono sin vencer, pero solo sirve para usar el bono propio (ya no se puede recomendar). |
| Cuántas veces | **Uno por cliente y por campaña.** La segunda Box de 12 no da otro. |
| Dónde se usa | Como el resto del saldo: en **una** Box de 6 o de 12 de **cada** pedido web que haga con su código (no se gasta). **No sirve en el mismo pedido que lo genera**: es para la siguiente compra. |
| Con las recomendaciones | **Se suman** y comparten el **tope de 30 %**: bono 5 % + 5 recomendaciones = 30 %. Lo de recomendar sigue volviendo a cero al cambiar el mes; el bono no, dura sus 30 días. |
| Si se anula | Si la venta deja de estar pagada, se borra o cambia de cliente, el bono se va con ella (si se fusionan clientes, queda uno). |

**Cuentas.** La Box de 12 deja $184–292 de margen (sección 2.3); el bono cuesta como mucho $23 por pedido
siguiente (5 % de $450). Con el tope, el peor caso sigue igual que antes: ninguna box se vende a pérdida.

**En el sistema** (migración `20261021120000_bono_box_12.sql`):
- Tabla `bonos_recomendacion` (campaña, cliente, venta, pedido, porcentaje, desde, hasta).
- `privado.evaluar_bono(venta)`: la llaman los mismos triggers que evalúan las recomendaciones.
- `saldo_recomendacion` = recomendaciones del mes × 5 % + bono vigente, con tope.
- `consultar_codigo` devuelve `bono`, `bono_hasta` y `campana` (si la campaña sigue); `campana_web` devuelve
  `solo_canje` cuando terminó pero quedan bonos.
- Textos editables nuevos (/admin → Textos e imágenes): `recomendacion.bono_aviso` (debajo del campo),
  `recomendacion.bono_premio` (en la tarjeta del descuento) y `recomendacion.mensaje_bono` (se agrega al
  WhatsApp con el código).
- /admin: la ficha del cliente muestra el bono y hasta cuándo vale; el resumen de la campaña cuenta los bonos.

**Lo que no hace (a propósito):** si se cambian a mano las cajas de una venta ya pagada (sacar la Box de 12),
el bono no se recalcula; y si se anula la venta que dio el bono, no pasa a la siguiente Box de 12 ya pagada.
Son casos raros y se pueden arreglar a mano.

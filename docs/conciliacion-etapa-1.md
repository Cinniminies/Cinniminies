# Conciliación de la migración (Etapa 1)

Export usado: `cinniminies_gestion` del **24/09/2026**, bajado del Drive, con los arreglos ya
aplicados (VENTAS tiene "Cobro envío ($)" y "Control"). Cargado con
`python3 migracion/importar.py <xlsx> --aplicar`.

## Controles

Verificados **sobre la base** después de cargar (24/09, 19:33), con `v_ventas`, `v_panel`,
`v_produccion_sabor` y `v_costo_sabor`.

| Control | Esperado (planilla) | En la base | Estado |
|---|---|---|---|
| Ventas | 108 | 108 (4 de consumo propio) | ✅ |
| Σ Precio cobrado | $31.130 | $31.130 | ✅ |
| Σ Costo producción | $8.145,16 | $8.191,15 | ✅ +$45,99 por la fila 110 (corrección confirmada) |
| Σ Costo caja | $3.265 | $3.230 | ✅ −$35 por la fila 89 (corrección confirmada) |
| Pendiente de cobro | $900 (2 ventas) | $900 (2 ventas) | ✅ |
| Ventas con envío | 30 → $750 | 30 → $750 | ✅ |
| Total vendido (cobrado + envíos) | — | $31.880 | ✅ |
| Compras | $14.578,87 | $14.578,87 | ✅ |
| Gastos (MERMAS) | $3.771,60 (retiros $2.795) | $3.771,60 (retiros $2.795, ajuste de caja $614,21) | ✅ |
| Tandas | 23 (Canela 12, Oreo 8, DDL 3) | 23 (Canela 12, Oreo 8, DDL 3) | ✅ |
| Costo por tanda al 22/09 | Canela 114,12 · DDL 114,55 · Oreo 180,07 · Nutella 210,51 | igual | ✅ |
| Stock en $ (packaging) | $320,85 | $320,85 | ✅ |
| Stock en $ (ingredientes) | $799,50 | $1.270,50 | ✅ +$471 de Nutella (650 g comprados el 11/09), que la hoja STOCK no tenía |

**Costo de producción (+$45,99):** en la fila 110 ("Box de 12 Canela" con 2/2/2 cargado) la
planilla costeó 2 Canela + 2 DDL + 2 Oreo ($68,12). Se entregó una Box de 12 de Canela, así que se
migra como 12 Canela a $9,5096 por roll ($114,12). 114,12 − 68,12 = 45,99.

**Costo de caja (−$35):** la fila 89 (consumo propio sin formato) tenía $35 de caja, pero no llevó
caja. Se migra con costo de caja $0.

**Otros números del panel con el histórico cargado:** ganancia bruta $20.458,81 · total gastado
$14.941,26 · caja teórica $12.629,53 · capital $14.220,88 · 776 rolls vendidos (472 de ventas viejas
"Sin detalle") y 276 producidos (TANDAS empieza el 25/07).

## Decisiones tomadas en la migración

**Ventas**
- Precio cobrado, costo de producción y costo de caja se congelan como están en la planilla. El
  costo de producción se reparte entre los sabores de la venta en proporción al costo por roll de
  cada uno, así que la suma da exactamente lo de la planilla.
- Cajas sin detalle de sabores (Box de 4/6/10/12 genéricas) → sabor **"Sin detalle"**.
- Personalizado: una sola línea con cantidad 1; los rolls salen de las columnas de sabores.
- Filas 88 y 89 (sin formato) y ventas de origen "Dueña 1" → `consumo_propio`, sin caja. La fila 89
  (12 rolls sin detalle) va como Personalizado de 12 "Sin detalle".
- Caja usada: la de la columna "Caja usada"; si está vacía, la del formato (Box de 4 → caja de 6,
  Box de 10 → caja de 12); en personalizados, por el costo de caja ($25 → caja de 3, $30 → de 6,
  $35 → de 12).

**Clientes:** 65 filas en la libreta → 64 clientes. "Romina Müller" pasa a "Romina Salinas" y se
fusiona con esa fila. El origen de cada cliente es el que más aparece en sus ventas.

**Compras**
- Cajas sin tamaño separadas por precio unitario ($30 de 6, $35 de 12), resolviendo
  `30·a + 35·b = total` con `a + b = cantidad`. Cuando la compra mezcla tamaños, se parte en dos.
- Levadura en sobres ("5", "Pagamos 3") y "Paquete Oreo X3" con cantidad 1 no tienen unidad clara:
  quedan con el total pero **sin cantidad base**, así que no se usan para calcular costos. No afecta
  los costos actuales: hay compras posteriores con cantidad.
- Balanza → equipamiento.

**Mermas → gastos:** Hamburguesas, cine y entradas → `retiro_socios`; "Acomodo de plata" →
`ajuste_caja`; bolsas/EXTRA → `gasto_operativo`; comisión del banco → `comision`; tanda fallida →
`tanda_descartada`; "Cobramos menos de una box de 4" (sin tipo) → `otro`.

**Stock:** conteo inicial con el "Stock real" de cada ingrediente y, para cajas, papel y stickers,
compradas − usadas de la hoja STOCK, con la fecha y hora del export.

## Dudas respondidas por los dueños (24/09)

1. **Compras de cajas que no encajan en $30/$35** (filas 6, 74 y 87) → eran tamaños combinados, sin
   detalle. Quedan como packaging sin tamaño, con esa nota. No afectan el stock: el stock arranca
   del conteo del 24/09.
2. **Fila 100** (personalizado de 3 rolls, caja de $25) → se usó una **caja de 3**. Se agregó el
   insumo "Caja Box de 3" ($25, inactivo) y la venta la descuenta.
3. **Fila 89** → **no llevó caja**. Costo de caja corregido a $0 (ver controles).
4. **MERMAS fila 9**, "Cobramos menos de una box de 6" → sin respuesta; queda como `comision`, como
   dice la planilla.
5. **MERMAS filas 11 y 12** sin fecha → **fecha incierta**. Quedan con la de la fila anterior
   (22/05/2026) y la nota "Fecha incierta" para que se vea en los reportes.
6. **Costo de caja en ventas nuevas** → **sumar el papel manteca y los stickers.** Desde ahora
   `calcular_venta` usa `costo_caja()`: Box de 6 = $30 + $1,98 + $6,67 = **$38,65**; Box de 12 =
   $35 + 2 × $1,98 + $6,67 = **$45,63**. Las ventas migradas no cambian (conservan el costo de la
   planilla). Ojo: durante la carga en paralelo el costo de caja (y la ganancia) de la app va a
   diferir de la planilla en esos $8,65 / $10,63 por caja.

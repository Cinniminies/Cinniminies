# Conciliación de la migración (Etapa 1)

Export usado: `cinniminies_gestion` del **24/09/2026**, bajado del Drive, con los arreglos ya
aplicados (VENTAS tiene "Cobro envío ($)" y "Control"). Salida de
`python3 migracion/importar.py <xlsx>` en modo prueba.

## Controles

| Control | Esperado | Import | Estado |
|---|---|---|---|
| Ventas | 108 | 108 | ✅ |
| Σ Precio cobrado | $31.130 | $31.130 | ✅ |
| Σ Costo producción | $8.145,16 | $8.191,15 | ⚠️ +$45,99, explicado abajo (fila 110) |
| Σ Costo caja | $3.265 | $3.265 | ✅ |
| Pendiente de cobro | $900 | $900 | ✅ |
| Ventas con envío | 30 → $750 | 30 → $750 | ✅ |
| Compras | $14.578,87 | $14.578,87 | ✅ |
| Gastos (MERMAS) | $3.771,60 (retiros $2.795) | $3.771,60 (retiros $2.795) | ✅ |
| Tandas | 23 (Canela 12, Oreo 8, DDL 3) | 23 (Canela 12, Oreo 8, DDL 3) | ✅ |
| Costo por tanda al 22/09 | Canela 114,12 · DDL 114,55 · Oreo 180,07 · Nutella 210,51 | igual (`v_costo_sabor`) | ✅ |

**Diferencia de costo de producción (+$45,99):** en la fila 110 ("Box de 12 Canela" con 2/2/2
cargado) la planilla costeó 2 Canela + 2 DDL + 2 Oreo ($68,12). Los dueños confirmaron que se
entregó una Box de 12 de Canela, así que se migra como 12 Canela a $9,5096 por roll ($114,12).
114,12 − 68,12 = 45,99.

> Cuando los datos estén cargados, los mismos controles se verifican sobre la base con
> `v_panel`, `v_ventas` y `v_produccion_sabor`.

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
  Box de 10 → caja de 12); en personalizados, por el costo de caja ($30 → caja de 6, $35 → de 12).

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

## Para revisar con los dueños

1. **Compras de cajas que no encajan en $30/$35** (quedan sin tamaño, marcadas "REVISAR"):
   fila 6 (9 cajas por $255, "vienen desarmadas"), fila 74 (5 cajas por $210) y fila 87 (7 cajas
   por $234). ¿De qué tamaño eran?
2. **Fila 100** (personalizado de 3 rolls): costo de caja $25, que no corresponde a ninguna caja. Se
   mantiene el costo, pero no descuenta stock de cajas. ¿Qué caja se usó?
3. **Fila 89** (consumo propio sin formato): el handoff dice "sin caja", pero la planilla tiene
   costo de caja $35. Se mantuvo el costo y no descuenta stock. ¿Llevó caja de 12?
4. **MERMAS fila 9**, "Cobramos menos de una box de 6": en la planilla dice tipo "Comisión" (motivo:
   "Mamá nos consiguió 3 ventas"). Se respetó como `comision`; el handoff sugería `otro`.
5. **MERMAS filas 11 y 12** ("Tanda fallida de oreo" y una bolsa) no tienen fecha: se usó la de la
   fila anterior (22/05/2026). Para la tanda de Oreo es poco probable (Oreo se vende desde el
   17/07). ¿Qué fecha fue? Solo cambia en qué mes cae el gasto.
6. **Costo de caja en ventas nuevas:** hoy es solo la caja ($30 / $35), igual que en la planilla,
   para que los números coincidan durante la carga en paralelo. El papel manteca y los stickers sí
   se descuentan del stock. Si quieren sumarlos al costo, es un cambio chico.

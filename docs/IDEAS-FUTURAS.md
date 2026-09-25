# Cinniminies · Ideas para futuras actualizaciones

> Ideas que quedan para más adelante (25/09/2026). Es una lista de ideas, no un plan: no tiene prioridades.
> Las elegidas por los dueños (2.1, 2.2, 2.4, 3.1, 3.2, 6.1, 6.5, 6.6 y 8.2) pasaron a
> [`HANDOFF-fase-2.md`](HANDOFF-fase-2.md), con triage y contexto para implementarlas.
>
> **Esfuerzo:** S = unas horas · M = 1 o 2 sesiones · L = varias sesiones.
> **Costo:** solo se indica si implica pagar algo.

---

## 1. Pendientes que ya sabemos que existen

| # | Qué | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1.1 | **Evitar que Supabase se pause.** El plan gratis se pausa tras 7 días sin actividad. `/api/catalogo` queda en la cache de Vercel, así que las visitas a la web no siempre llegan a la base. | Si se pausa, la app y los pedidos web dejan de andar hasta reactivarlo a mano. Una tarea programada (GitHub Actions o Vercel Cron) que haga una consulta liviana cada 2 o 3 días. | S |
| 1.2 | **Decidir el hosting.** Vercel Hobby no permite uso comercial. | Riesgo de que suspendan el proyecto. Opciones: Vercel Pro (USD 20 por mes) o mover a Netlify o Cloudflare Pages. En ese caso hay que adaptar las 4 funciones de `api/`, que ya son simples a propósito. | M · **Costo** |
| 1.3 | **Copias de seguridad propias.** El plan gratis de Supabase no deja bajar backups. | Si se borra algo por error, no hay forma de recuperarlo. Una tarea programada que exporte la base (`pg_dump` o las vistas a CSV) a un lugar privado, por ejemplo Google Drive. | M |
| 1.4 | **Mails de login.** El SMTP por defecto de Supabase solo manda a miembros de la organización y tiene límites. | Si entra un tercer usuario o se pierde la contraseña, el link puede no llegar. Configurar SMTP propio (Gmail con contraseña de aplicación). Además permite editar la plantilla y mandar un código. | S |
| 1.5 | **Archivar el Apps Script de pedidos** y la web app vieja de la planilla, cuando termine la carga en paralelo de la Etapa 2. | Orden y menos cosas que mantener. | S |
| 1.6 | **Protección de contraseñas filtradas** (el aviso que siempre marca Supabase). | Solo existe en planes pagos. Se resuelve si algún día pasan a Supabase Pro. | S · **Costo** |

---

## 2. Pedidos web

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 2.3 | **Más estados del pedido** | Además de nuevo, confirmado y rechazado: *en preparación*, *listo para retirar* y *entregado*. Sirve para el sábado de reparto. | M |
| 2.5 | **Seguimiento del pedido por código** | Una página `/pedido/CM-2026-XXXX` donde el cliente ve el estado (recibido, confirmado, listo). | M |
| 2.6 | **Pago online** | Link de pago de Mercado Pago (Uruguay) al confirmar, y que el pago se registre solo como "pagado". | L · **Costo** (comisión MP) |
| 2.7 | **Cupones y promociones** | Códigos de descuento ("PRIMERA10") o promos por fecha, aplicadas por la base con `calcular_venta`. | M |
| 2.8 | **Mensajes de WhatsApp prearmados** | Plantillas para "confirmado", "listo para retirar" y "te esperamos", abiertas con un toque desde /admin. Sin API paga: usan `wa.me`. | S |

---

## 3. Producción y stock

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 3.3 | **Merma real contra teórica** | Comparar lo que se consumió (conteos) contra lo que dicen las recetas, para detectar desperdicio o recetas mal cargadas. | M |
| 3.4 | **Historial de precios de insumos** | Gráfico de cómo subió cada insumo y su impacto en el costo por roll. | S |
| 3.5 | **Vencimientos** | Fecha de vencimiento en compras de perecederos (leche, huevos, manteca) y alerta antes de que venzan. | M |

---

## 4. Finanzas y análisis

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 4.1 | **Precio sugerido** | Para cada sabor o caja, el precio que da un margen objetivo (por ejemplo 60 %), a partir del costo actual. | S |
| 4.2 | **Metas mensuales** | Meta de ventas o ganancia del mes con barra de avance en Inicio y en el Tablero del Sheet. | S |
| 4.3 | **Reparto entre socios** | Cuánto le corresponde a cada socio según retiros y ganancia, y el saldo de cada uno. | M |
| 4.4 | **Cierre de mes** | Resumen mensual en PDF o mail automático: vendido, ganancia, mejores clientes y sabores, comparación con el mes anterior. | M |
| 4.5 | **Más vistas en el Sheet** | Por ejemplo `clientes` (frecuencia, última compra) y `pedidos` web (conversión, rechazados), con sus gráficos en el Tablero. | S |

---

## 5. Clientes

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 5.1 | **Clientes dormidos** | Lista de clientes que compraban seguido y hace más de N semanas que no compran, con botón de WhatsApp para escribirles. | S |
| 5.2 | **Programa de fidelidad** | "Cada 10 cajas, una de regalo", calculado con las ventas. Se muestra en la ficha del cliente y al confirmar un pedido. | M |
| 5.3 | **Cumpleaños** | Fecha de cumpleaños en la ficha y recordatorio para mandar un saludo o promo. | S |
| 5.4 | **Completar contactos** | Ayuda para cargar el celular a los 24 clientes que no lo tienen, así los pedidos web se asocian solos. | S |

---

## 6. Web pública

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 6.2 | **Estadísticas de visitas** | Analítica simple y respetuosa de la privacidad (Plausible, Umami o Cloudflare Web Analytics): visitas, de dónde vienen y cuántos llegan a pedir. | S · posible **Costo** |
| 6.3 | **Imágenes más livianas** | Las fotos subidas desde /admin se sirven en un solo tamaño. Generar versiones chicas para celular al subirlas. | M |
| 6.4 | **Carrito que no se pierde** | Guardar el carrito en el navegador si se recarga la página o se cierra sin querer. | S |

---

## 7. App /admin

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 7.1 | **Modo sin conexión** | Poder cargar una venta sin señal y que se envíe sola al volver internet. | L |
| 7.2 | **Usuarios con permisos** | Un rol "ayudante" que carga ventas y tandas pero no ve costos, ganancias ni retiros. | M |
| 7.3 | **Buscador general** | Buscar cliente, venta, pedido o insumo desde un solo lugar. | S |
| 7.4 | **Historial de cambios** | Registro de quién cambió qué y cuándo (ventas editadas, precios, textos de la web). | M |
| 7.5 | **Modo oscuro manual** | Hoy sigue al celular. Agregar un botón para elegirlo. | S |

---

## 8. Calidad y mantenimiento

| # | Qué | Detalle | Esfuerzo |
|---|---|---|---|
| 8.1 | **Pruebas automáticas en cada PR** | GitHub Actions que corra `node --test` y, contra una base de prueba (rama de Supabase), los bloques de `supabase/tests/reglas.sql`. | M · posible **Costo** (ramas de Supabase) |
| 8.3 | **Aviso de errores** | Registrar los errores de la web, /admin y las funciones (por ejemplo Sentry en su plan gratis) para enterarse sin que avise un cliente. | S |
| 8.4 | **Dominio propio** | `cinniminies.uy` o similar, con mails de login desde ese dominio. | S · **Costo** |

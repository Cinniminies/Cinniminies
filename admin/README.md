# /admin: app de gestión

App para cargar ventas, tandas, compras y gastos desde el celular. Es un sitio estático, igual que
la web pública: HTML, CSS y módulos ES, sin nada que compilar. Vercel la sirve tal cual en
`https://cinniminies.vercel.app/admin/`.

- **Datos:** Supabase, con `@supabase/supabase-js` desde jsDelivr. La URL y la clave *publishable*
  están en `js/config.js`: son públicas, y la seguridad la da la RLS (solo los usuarios de
  `usuarios_admin` leen y escriben).
- **Reglas de negocio:** en la base (`supabase/migrations/`). La app llama a `calcular_venta`
  (el resumen en vivo), `registrar_venta`, `actualizar_venta`, `registrar_tanda`,
  `registrar_compra`, `fusionar_clientes`, `guardar_receta`, `guardar_packaging_caja`,
  `fijar_precio`, `registrar_conteo` y `que_comprar`. El navegador no calcula precios ni costos
  que se guarden (solo muestra una estimación en vivo del costo de una receta mientras se edita).
- **PWA:** `manifest.webmanifest`, íconos en `icons/` y un `sw.js` mínimo para que sea instalable.
  No funciona sin conexión.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html`, `app.css` | La estructura (barra, pestañas de abajo) y los estilos, con la paleta de la web app vieja. |
| `js/app.js` | Login, control de acceso y rutas (`#/panel`, `#/venta`, `#/ventas/:id`, …). |
| `js/db.js`, `js/catalogo.js` | Cliente de Supabase y catálogo en memoria (sabores, formatos, insumos). |
| `js/componentes.js` | Selector de cliente con autocompletar y editor de productos (formatos + sabores + caja). |
| `js/util.js` | Formatos (`$1.234,50`, fechas de Montevideo), chips, steppers y avisos. |
| `js/iconos.js` | Íconos de línea (un solo estilo para pestañas, menú y accesos). |
| `js/graficos.js` | Columnas y barras en HTML, sin librerías: acento para lo que importa y gris de contexto (colores validados para daltonismo en los dos temas), detalle al tocar o con teclado y tabla con los números. |
| `js/vistas/*.js` | Una pantalla por archivo. Carga: panel, venta, ventas, tandas, compras, gastos, clientes. Catálogo (etapa 3): catalogo, sabores, insumos, formatos, precios. Stock: stock (con conteos) y comprar ("¿Qué compro?"). |
| `tests/` | Pruebas de los formatos: `node --test admin/tests/*.test.mjs`. |

Las reglas de la base tienen sus pruebas en `supabase/tests/reglas.sql`.

## Navegación

- **Celular:** pestañas abajo: Inicio · Ventas · **+ Venta** · Producción · Más.
  - **Producción** agrupa Tandas, Stock, Compras y ¿Qué compro? con pestañas internas; la pestaña
    vuelve a la última que se usó.
  - **Más**: Clientes, Gastos y retiros, todo el catálogo y la cuenta, cada uno a un toque.
- **Compu y tablet (≥ 900 px):** menú lateral con todo a un clic: "+ Venta" arriba, Inicio, Ventas y
  los grupos Producción (Tandas, Stock, Compras, ¿Qué compro?), Negocio (Clientes, Gastos y retiros) y
  Catálogo (Sabores, Formatos, Precios, Insumos, Costos y márgenes); abajo, **Cuenta** (contraseña y
  salir), que es lo único que queda en "Más". Sin las pestañas internas de Producción ni "←" hacia "Más".
  La lista del menú está en `MENU` (`js/app.js`).
- Toda subpantalla tiene **←** arriba (vuelve a la pantalla de la que depende) y el título en la barra.
- **Inicio**: accesos rápidos, "Para hacer" (cobros pendientes y stock para reponer), resumen del
  período con variación (el mes en curso se compara con el mismo tramo del mes anterior), gráficos de
  vendido por mes y rolls por sabor, y la plata acumulada.

## Probar en local

```sh
python3 -m http.server 8777
# abrir http://localhost:8777/admin/
```

Usa la base real: lo que se cargue en local queda en Supabase.

## Login

Dos formas, en la misma pantalla:

1. **Link por mail:** Supabase manda un link para entrar. Con el mail que trae Supabase por defecto
   la plantilla no se puede editar y trae solo el link (sin código).
2. **Contraseña:** después de entrar la primera vez con el link, cada uno elige su contraseña en
   *Más → Contraseña*.

**En el iPhone:** la app instalada en la pantalla de inicio no comparte la sesión con Safari, y el
link del mail se abre en Safari. Por eso, la primera vez: entrar con el link en Safari, poner una
contraseña en *Más → Contraseña* y, en la app instalada, entrar con email y contraseña. En Android
y en la compu el link funciona directo.

Si más adelante configuran un SMTP propio, se puede editar la plantilla *Magic link or OTP* y sumar
el código (`{{ .Token }}`): la pantalla de login ya tiene el campo para escribirlo.

El registro público está desactivado: solo entran los usuarios creados con
`migracion/crear_admins.py`.

### Configuración de Supabase

- **Authentication → URL Configuration** (hecho el 25/09): *Site URL*
  `https://cinniminies.vercel.app/admin/`; *Redirect URLs* `https://cinniminies.vercel.app/admin/**`
  y `http://localhost:8777/admin/**`.
- **Envío de mails:** el servicio de mail que trae Supabase solo manda a los miembros de la
  organización y tiene un límite bajo por hora. Si a alguien no le llega el link, sumalo a la
  organización de Supabase o configurá un SMTP propio (*Authentication → Emails → SMTP Settings*).

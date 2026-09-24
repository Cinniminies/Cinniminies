# /admin: app de gestión

App para cargar ventas, tandas, compras y gastos desde el celular. Es un sitio estático, igual que
la web pública: HTML, CSS y módulos ES, sin nada que compilar. Vercel la sirve tal cual en
`https://cinniminies.vercel.app/admin/`.

- **Datos:** Supabase, con `@supabase/supabase-js` desde jsDelivr. La URL y la clave *publishable*
  están en `js/config.js`: son públicas, y la seguridad la da la RLS (solo los usuarios de
  `usuarios_admin` leen y escriben).
- **Reglas de negocio:** en la base (`supabase/migrations/`). La app llama a `calcular_venta`
  (el resumen en vivo), `registrar_venta`, `actualizar_venta`, `registrar_tanda`,
  `registrar_compra` y `fusionar_clientes`. El navegador no calcula precios ni costos.
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
| `js/vistas/*.js` | Una pantalla por archivo. |
| `tests/` | Pruebas de los formatos: `node --test admin/tests/*.test.mjs`. |

Las reglas de la base tienen sus pruebas en `supabase/tests/reglas.sql`.

## Probar en local

```sh
python3 -m http.server 8777
# abrir http://localhost:8777/admin/
```

Usa la base real: lo que se cargue en local queda en Supabase.

## Login

Dos formas, en la misma pantalla:

1. **Código por mail:** Supabase manda un código de 6 dígitos (y un link). Se usa el código porque,
   en el iPhone, la app instalada no comparte la sesión con Safari: el link abriría Safari, no la app.
2. **Contraseña:** después de entrar la primera vez con el código, cada uno elige su contraseña en
   *Más → Contraseña*.

El registro público está desactivado: solo entran los usuarios creados con
`migracion/crear_admins.py`.

### Configuración de Supabase (una vez, en el dashboard)

- **Authentication → URL Configuration**
  - *Site URL:* `https://cinniminies.vercel.app/admin/`
  - *Redirect URLs:* `https://cinniminies.vercel.app/admin/**` y `http://localhost:8777/admin/**`
- **Authentication → Emails → Magic Link:** agregar el código al mail, por ejemplo:
  `<p>Tu código para entrar: <strong>{{ .Token }}</strong></p>`
- **Envío de mails:** el servicio de mail que trae Supabase solo manda a los miembros de la
  organización y tiene un límite bajo por hora. Si a alguien no le llega el código, sumalo a la
  organización de Supabase o configurá un SMTP propio (*Project Settings → Auth → SMTP*).

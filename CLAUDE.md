# Cinniminies · Cómo se escribe el código

Reglas para cualquier cambio en este repo (web pública, `/admin`, `api/`, `supabase/`). El código tiene que leerse
como si lo hubiera escrito una sola persona: claro, sin repetirse y sin restos.

## 1. Antes de escribir: buscar lo que ya existe

Antes de crear una función, un componente o una clase CSS, buscar con `grep` si ya hay algo que lo haga. Lo más usado:

| Archivo | Qué tiene |
|---|---|
| `admin/js/util.js` | `h`, `vaciar`, formatos (`pesos`, `numero`, `cantidad`, `plural`, `fechaCorta`, `fechaLarga`, `nombreMes`), fechas (`hoyISO`, `mesISO`, `proximoSabado`, `sumarDias`, `sumarMeses`), `sumar(lista, valorDe)`, controles (`chips`, `stepper`, `campo`, `interruptor`, `campoFecha`), `toast`, `conBoton`, `debounce` |
| `admin/js/db.js` | `sb`, `q` (consulta que tira el error), `rpc`, `contar` |
| `admin/js/catalogo.js` | `catalogo()` en memoria: sabores, formatos, insumos, parámetros |
| `admin/js/componentes.js` | `filaLista({ href, titulo, detalle, derecha })`, `pastilla(clase, texto)`, `monto`, `stat` (tarjeta de un número), `elegirCliente`, `editorLineas`, `seccionPrecios`, `tituloSemana`, `libroCaja` |
| `admin/js/graficos.js` | `linea`, `areas`, `partes`, `pesas`, `composicion`, `puntos`, `variacion` |
| `admin/js/textos.js` | `textoPanel(clave, defecto, vars)` para los textos del panel |
| `api/_lib/supabase.js` | `rpc(nombre, args, conf, { ErrorCliente })`, `metodoPermitido`, `configuracionLista`, `leerCuerpoJson`, `responderJson`, `encabezados` |
| `scripts/_env.js` | `cargarEnvLocal()` para los scripts que leen `.env.local` |

- Si ya existe, se usa. Si casi sirve, se extiende con una opción en vez de copiarlo.
- Si un bloque se repite **dos veces**, va a una función. Si se usa en una sola vista, queda en esa vista; si lo usan dos, sube a `componentes.js` o `util.js`.
- Si un dato no se ve bien con ningún componente existente, se crea uno nuevo (no se fuerza en una tabla genérica).

## 2. Nombres

- **En español rioplatense**, como el resto del código y de la base: `ventasSemana`, `rollsPorHacer`, `elegirMes`.
  Excepción: `cinniminies.js` (la web pública) tiene nombres heredados en inglés (`cart`, `box`, `renderCart`). Lo nuevo va en
  español; al tocar una función vieja no se mezclan idiomas adentro de ella.
- Que digan **qué es**, no cómo está hecho: `pendientes`, no `arr2` ni `listaFiltrada`.
- **Variables** son sustantivos (`total`, `porSabor`); **funciones**, verbos o lo que devuelven (`mostrar`, `registrarVenta`, `tituloSemana`); los **booleanos** se leen como respuesta (`activo`, `esPrueba`, `conPrecio`, `hayStock`).
- Sin abreviaturas inventadas. Las únicas de siempre: `h`, `q`, `sb`, `rpc`, `cat`, `e` (evento o error), `i`/`j` (índices), `d` (el dato en un `map` corto).
- Las unidades van en el nombre cuando no son obvias: `minutos`, `gramos`, `precioPorKg`.
- **Formas:** `camelCase` en JS; `snake_case` en SQL; clases CSS en `kebab-case` **con un prefijo propio del componente** (`graf-`, `disp-`, `sobr-`). Antes de crear una clase, buscar con `grep` que no exista: una `.pendiente` nueva pisó estilos de toda la app.

## 3. Funciones

- Cortas y con un solo trabajo. Si para explicarla hace falta un "y además", son dos funciones.
- Salir temprano (`if (!x) return …`) en vez de anidar `if`.
- Las opciones van en un objeto con valores por defecto: `fn(datos, { formato, titulo } = {})`.
- Sin efectos escondidos: una función que se llama `calcular…` no guarda nada.
- `async`/`await` con `q()` y `rpc()`; los errores se muestran con `mostrarError` o `conBoton`, no se tragan.

## 4. Sin redundancia ni restos

- Al reemplazar algo, **se borra lo viejo** en el mismo cambio: la función, su CSS, sus imports y sus menciones en los README. Después, `grep` para confirmar que no queda ninguna referencia.
- Nada de código comentado, `console.log` de prueba, variables sin usar ni parámetros que nadie pasa.
- Una sola fuente para cada dato: los cálculos que se guardan (precios, costos, stock, descuentos) viven en Postgres. El navegador muestra; no recalcula por su cuenta.
- Los colores salen de los tokens de `admin/app.css` (`var(--marca)`, `var(--serie-1)`), nunca de un hex suelto en el JS o en una regla nueva.
- Los textos visibles de la web van a `contenido_web` (`data-contenido` o `textoWeb`); los del panel, a `textoPanel` con clave `panel.*`.

## 5. Comentarios

- Explican **el porqué** y la regla de negocio, no lo que el código ya dice:
  bien → `// El envío va dentro del total: lo decidieron los dueños el 23/10.`
  mal → `// Suma el envío al total.`
- Arriba de cada función exportada, una o dos líneas: qué hace y la forma de los datos que recibe.
- En español, con tildes, con la misma densidad que el resto del archivo.

## 6. Estilo

- Comillas simples, punto y coma, 2 espacios, coma final en los objetos de varias líneas.
- Líneas de hasta ~130 caracteres; si una llamada no entra, se parte por argumentos.
- Sin dependencias nuevas ni paso de build: módulos ES servidos tal cual.

## 7. Base de datos

- Cada cambio de esquema o de función es una **migración nueva** (`supabase/migrations/AAAAMMDDhhmmss_nombre.sql`). Las migraciones ya aplicadas no se editan.
- Antes de reemplazar una función, compararla con `pg_get_functiondef` para no perder cambios.
- Las reglas nuevas suman su prueba en `supabase/tests/reglas.sql`.

## 8. Antes de abrir el PR

1. `node --check` de cada archivo tocado y `node --test admin/tests/*.test.mjs`.
2. Leer el diff entero buscando repeticiones, nombres poco claros y restos. Pasarle la skill **`simplify`** y aplicar lo que corresponda.
3. Probar la pantalla a 390 px, en claro y en oscuro.
4. Una rama nueva desde `main` actualizado y el PR directo contra `main`.

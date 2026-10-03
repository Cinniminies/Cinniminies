# Instagram en /admin → Redes

Todos los días a las 7 (10:00 UTC, `vercel.json`) Vercel llama a `/api/instagram`, que lee de la API de
Instagram los seguidores, la cuenta y las últimas 50 publicaciones (vistas, alcance, me gusta, comentarios,
guardados, compartidos) y los guarda en `ig_cuenta_dia` e `ig_publicaciones`. /admin → Redes los muestra
con tendencias y sugerencias (`admin/js/redes.js`).

## Conectar (una sola vez)

1. **Cuenta profesional** de Instagram (empresa o creador).
2. En [developers.facebook.com](https://developers.facebook.com): *My Apps → Create app*, caso de uso de
   Instagram ("Administrar mensajes y contenido en Instagram"), tipo **Business**. No hace falta publicarla.
3. En la app: *Instagram → API setup with Instagram login → Generate access tokens → Add account*, entrar con
   la cuenta de Cinniminies, aceptar los permisos (`instagram_business_basic`,
   `instagram_business_manage_insights`) y **Generate token**.
4. Cargar las variables (nunca pegarlas en un chat ni commitearlas):
   - Vercel → *Settings → Environment Variables* (Production):
     - `INSTAGRAM_TOKEN`: el token del paso 3.
     - `CRON_SECRET`: una clave larga al azar (por ejemplo, `openssl rand -hex 32`). Vercel la manda sola
       al llamar al cron; sin ella `/api/instagram` no corre.
   - `.env.local` (para probar en local): `INSTAGRAM_TOKEN=…`.
5. Primera lectura sin esperar al cron: `node scripts/instagram.js` (usa `.env.local`). Hacer un deploy
   después de cargar las variables en Vercel.

## Token

- Dura 60 días. La lectura diaria lo renueva cada 7 días y guarda el nuevo en `ig_config` (solo lo lee el
  servidor; /admin ve el usuario, la última lectura y el último error, nunca el token).
- Si falla (por ejemplo, se cambió la contraseña de Instagram), /admin → Redes muestra el error: generar un
  token nuevo (paso 3), ponerlo en `INSTAGRAM_TOKEN` y redeployar. Si el guardado ya no sirve, se usa el
  de la variable.

## Datos

- `ig_cuenta_dia`: una fila por día (seguidores, seguidos, publicaciones, alcance y vistas del día si la API
  los da). La tendencia de seguidores arranca el día que se conecta: la API no da el historial.
- `ig_publicaciones`: los últimos números de cada publicación (se pisan en cada lectura). Las vistas
  (`views`) son la métrica principal; si la API no las da para alguna publicación, se usa el alcance.
- Pruebas: `node --test api/_tests/instagram.test.js admin/tests/redes.test.mjs`.

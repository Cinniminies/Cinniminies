// Servidor local que imita a Vercel para probar la web, /admin y las funciones de api/ juntas.
// No hace falta instalar nada: solo Node (en esta compu, el portátil del scratchpad).
//
//   node scripts/servidor-dev.js [puerto]        → http://127.0.0.1:8777/
//
// - Sirve los archivos estáticos del repo.
// - /api/<nombre> ejecuta api/<nombre>.js (o api/<carpeta>/[vista].js) con req.query y req.body,
//   como Vercel, usando las variables de .env.local (SUPABASE_SERVICE_ROLE_KEY, EXPORT_KEY…).
// - CONTENIDO_PRUEBA=archivo.json: mezcla ese JSON en `contenido` de /api/catalogo (para probar
//   textos editables sin tocar la base).
// - /dev/entrar-prueba: inicia sesión en /admin con el usuario de prueba (PRUEBA_ADMIN_EMAIL y
//   PRUEBA_ADMIN_PASSWORD de .env.local, los escribe migracion/usuario_prueba.py) y va a /admin/.
//   Así la contraseña no pasa por el chat. Solo existe acá, nunca en Vercel.
// - Modo prueba (por defecto): los pedidos de la web quedan marcados como de prueba (solo los ve el usuario de
//   prueba en /admin, nunca los dueños), no se mandan avisos push ni el mail de Web3Forms, y vale la campaña de
//   recomendaciones de prueba. Para probar contra lo real: MODO_PRUEBA=0 node scripts/servidor-dev.js.
// Ojo: usa la base REAL. Lo que carga el usuario de prueba queda aislado y se borra desde /admin →
// Recomendaciones → Borrar datos de prueba; con MODO_PRUEBA=0, marcar los datos ("PRUEBA…") y borrarlos a mano.
const http = require('http');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const puerto = Number(process.argv[2] || 8777);
const env = path.join(raiz, '.env.local');
if (fs.existsSync(env)) {
  for (const l of fs.readFileSync(env, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (process.env.MODO_PRUEBA === undefined) process.env.MODO_PRUEBA = '1';
const tipos = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

// Página que entra con el usuario de prueba usando el mismo cliente de /admin (misma sesión guardada).
function entrarPrueba(res) {
  const { PRUEBA_ADMIN_EMAIL: email, PRUEBA_ADMIN_PASSWORD: password } = process.env;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!email || !password) {
    res.statusCode = 404;
    return res.end('<p>Falta el usuario de prueba: correr <code>python3 migracion/usuario_prueba.py crear</code>.</p>');
  }
  const datos = JSON.stringify({ email, password }).replace(/</g, '\\u003c');
  res.end(`<!doctype html><meta charset="utf-8"><title>Entrar (prueba)</title><p id="m">Entrando…</p>
<script type="module">
import { sb } from '/admin/js/db.js';
const { error } = await sb.auth.signInWithPassword(${datos});
if (error) document.getElementById('m').textContent = 'No se pudo entrar: ' + error.message;
else location.replace('/admin/#/panel');
</script>`);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/dev/entrar-prueba') return entrarPrueba(res);
  if (u.pathname.startsWith('/api/')) {
    const nombre = u.pathname.slice(5).replace(/\/$/, '');
    req.query = Object.fromEntries(u.searchParams);
    let archivo = path.join(raiz, 'api', `${nombre}.js`);
    if (!fs.existsSync(archivo)) {
      const [carpeta, vista] = nombre.split('/');
      archivo = path.join(raiz, 'api', carpeta, vista ? '[vista].js' : 'index.js');
      if (vista) req.query.vista = vista;
    }
    if (!archivo.startsWith(path.join(raiz, 'api')) || !fs.existsSync(archivo)) {
      res.statusCode = 404;
      return res.end('404');
    }
    let texto = '';
    for await (const parte of req) texto += parte;
    try { req.body = texto ? JSON.parse(texto) : undefined; } catch { req.body = texto; }
    if (nombre === 'catalogo' && process.env.CONTENIDO_PRUEBA) {
      const fin = res.end.bind(res);
      res.end = (c) => {
        const j = JSON.parse(c);
        Object.assign(j.contenido, JSON.parse(fs.readFileSync(process.env.CONTENIDO_PRUEBA, 'utf8')));
        fin(JSON.stringify(j));
      };
    }
    try {
      await require(archivo)(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
    return;
  }
  let f = path.join(raiz, decodeURIComponent(u.pathname));
  // Nada fuera del repo ni archivos ocultos (.env.local, .git).
  if (path.relative(raiz, f).split(path.sep).some((p) => p.startsWith('.'))) { res.statusCode = 403; return res.end('403'); }
  if (f.endsWith(path.sep) || f.endsWith('/')) f = path.join(f, 'index.html');
  fs.readFile(f, (err, datos) => {
    if (err) { res.statusCode = 404; return res.end('404'); }
    res.setHeader('Content-Type', tipos[path.extname(f)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(datos);
  });
}).listen(puerto, '127.0.0.1', () => {
  console.log(`Web:   http://127.0.0.1:${puerto}/`);
  console.log(`Admin: http://127.0.0.1:${puerto}/dev/entrar-prueba (usuario de prueba)`);
  console.log(process.env.MODO_PRUEBA === '1' ? 'Modo prueba: los pedidos solo los ve el usuario de prueba, sin avisos.'
    : 'MODO_PRUEBA=0: los pedidos son REALES (les llegan a los dueños).');
});

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
// Ojo: usa la base REAL. Marcar los datos de prueba ("PRUEBA…") y borrarlos al terminar.
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
const tipos = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
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
  if (!f.startsWith(raiz)) { res.statusCode = 403; return res.end('403'); }
  if (f.endsWith(path.sep) || f.endsWith('/')) f = path.join(f, 'index.html');
  fs.readFile(f, (err, datos) => {
    if (err) { res.statusCode = 404; return res.end('404'); }
    res.setHeader('Content-Type', tipos[path.extname(f)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(datos);
  });
}).listen(puerto, '127.0.0.1', () => console.log(`http://127.0.0.1:${puerto}/`));

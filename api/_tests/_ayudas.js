// Lo que comparten las pruebas de api/: la respuesta falsa de Vercel, Supabase simulado y el entorno de cada prueba.
// No termina en .test.js, así que node --test no la corre sola.

// Respuesta falsa al estilo de Vercel/Node: anota el estado, los encabezados (en minúscula) y el cuerpo.
function respuesta() {
  return {
    statusCode: 200, headers: {}, cuerpo: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(c) { this.cuerpo = c; },
  };
}

// Lo que devuelve fetch: { ok, status, json(), text() }.
const respuestaHttp = (cuerpo, status = 200) => ({
  ok: status < 400, status, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo),
});

// Supabase simulado: cada pedido se anota en `llamadas` ({ url, metodo, cuerpo }) y se contesta con
// `responder(url, op)` (por defecto, 200 con null). `conf` es lo que reciben las funciones de _lib.
function supabaseFalso(responder = () => respuestaHttp(null)) {
  const llamadas = [];
  const fetch = async (url, op = {}) => {
    llamadas.push({ url, metodo: op.method || 'GET', cuerpo: typeof op.body === 'string' ? JSON.parse(op.body) : op.body });
    return responder(url, op);
  };
  return { fetch, llamadas, conf: { url: 'https://x', clave: 'eyJ', fetch } };
}

// Corre `fn` con esas variables de entorno (undefined borra la variable) y, si se pasa, ese fetch global.
// Después deja todo como estaba, aunque la prueba falle.
async function conEntorno({ env = {}, fetch } = {}, fn) {
  const envAntes = { ...process.env };
  const fetchAntes = global.fetch;
  for (const [clave, valor] of Object.entries(env)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  if (fetch) global.fetch = fetch;
  try {
    return await fn();
  } finally {
    for (const clave of Object.keys(process.env)) if (!(clave in envAntes)) delete process.env[clave];
    Object.assign(process.env, envAntes);
    global.fetch = fetchAntes;
  }
}

// Corre `fn` sin los console.error que los handlers dejan para los logs de Vercel. Devuelve lo que se anotó.
async function sinLogs(fn) {
  const antes = console.error;
  const anotados = [];
  console.error = (...partes) => anotados.push(partes.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = antes;
  }
  return anotados;
}

// Corre un handler de api/ con Supabase simulado y esas variables de entorno, sin ensuciar la salida.
// Devuelve la respuesta, el cuerpo (ya parseado si es JSON), las llamadas a la base y los console.error.
async function correrHandler(handler, req, { env = {}, responder } = {}) {
  const base = supabaseFalso(responder);
  const res = respuesta();
  const logs = await sinLogs(() => conEntorno({ env, fetch: base.fetch }, () => handler(req, res)));
  const esJson = String(res.headers['content-type']).startsWith('application/json');
  return { res, cuerpo: esJson ? JSON.parse(res.cuerpo) : res.cuerpo, llamadas: base.llamadas, logs };
}

module.exports = { respuesta, respuestaHttp, supabaseFalso, conEntorno, sinLogs, correrHandler };

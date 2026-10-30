// Visitas de la web (idea 6.2): cada paso de una sesión (entró, abrió el carrito, tocó "Pedir ahora", mandó el
// pedido) se guarda con registrar_visita(). Acá se descartan los bots y lo que no tiene la forma esperada; los
// valores válidos (tipos, orígenes), un paso por sesión y día y el límite por IP están en la base.
const { rpc } = require('./supabase.js');

const MAX_CUERPO = 300; // bytes: un paso ocupa menos de 120

// Los que ejecutan JavaScript y no son personas (buscadores, vistas previas, pruebas automáticas).
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pagespeed|vercel/i;
const esBot = (userAgent) => !userAgent || BOT.test(userAgent);

// Solo los cuatro campos, como texto corto; o null si falta alguno (se ignora sin avisar).
function armarVisita(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const { sesion, tipo, origen, dispositivo } = cuerpo;
  const campos = [sesion, tipo, origen, dispositivo];
  return campos.every((c) => typeof c === 'string' && c.length <= 32) ? { sesion, tipo, origen, dispositivo } : null;
}

const guardarVisita = (visita, ipHash, conf) => rpc('registrar_visita', { p: visita, p_ip_hash: ipHash }, conf);

module.exports = { MAX_CUERPO, esBot, armarVisita, guardarVisita };

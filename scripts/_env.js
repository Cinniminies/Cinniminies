// Carga las variables de .env.local (raíz del repo) sin pisar las que ya vienen del entorno.
const fs = require('fs');
const path = require('path');

function cargarEnvLocal() {
  const archivo = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

module.exports = { cargarEnvLocal };

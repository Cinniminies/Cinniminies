// Genera el par de claves VAPID para los avisos push de /admin (tarea 2.1) y las guarda en .env.local
// como VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY. Solo muestra la pública (va en admin/js/config.js).
// La privada NO se imprime: se copia de .env.local a Vercel (Settings → Environment Variables).
//
//   node scripts/generar-vapid.js           → falla si ya hay claves (cambiarlas corta los avisos activados)
//   node scripts/generar-vapid.js --nuevas  → las reemplaza (después, cada celular tiene que volver a activarlos)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const archivo = path.resolve(__dirname, '..', '.env.local');
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
if (/^VAPID_PRIVATE_KEY=/m.test(texto) && !process.argv.includes('--nuevas')) {
  console.error('Ya hay claves VAPID en .env.local. Para reemplazarlas: node scripts/generar-vapid.js --nuevas');
  process.exit(1);
}

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const b64url = (b) => b.toString('base64url');
const priv = ecdh.getPrivateKey();
const publica = b64url(ecdh.getPublicKey());                                  // 65 bytes, sin comprimir
const privada = b64url(Buffer.concat([Buffer.alloc(32 - priv.length), priv])); // 32 bytes justos

const lineas = texto.split('\n').filter((l) => l && !/^VAPID_(PUBLIC|PRIVATE)_KEY=/.test(l));
lineas.push(`VAPID_PUBLIC_KEY=${publica}`, `VAPID_PRIVATE_KEY=${privada}`);
fs.writeFileSync(archivo, lineas.join('\n') + '\n');
console.log('Claves VAPID guardadas en .env.local.');
console.log(`Pública (se puede compartir): ${publica}`);
console.log('La privada no se muestra: copiala de .env.local (línea VAPID_PRIVATE_KEY) a Vercel.');

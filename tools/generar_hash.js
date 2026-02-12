// tools/generar_hash.js (PBKDF2)
// Genera hashes compatibles con netlify/functions/_lib/auth.js
// Uso: node tools/generar_hash.js "TuPassword"

const crypto = require('crypto');

function hashPassword(password, { iterations = 120000, saltLen = 16 } = {}) {
  const salt = crypto.randomBytes(saltLen);
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const password = process.argv[2];
if (!password) {
  console.log('Uso: node tools/generar_hash.js "tuPassword"');
  process.exit(1);
}

const out = hashPassword(password);
console.log(out);

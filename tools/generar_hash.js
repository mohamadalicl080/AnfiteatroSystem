// Uso: node tools/generar_hash.js "miPassword"
// Imprime el PasswordHash para pegar en la hoja "Usuarios" (columna PasswordHash)

const { hashPassword } = require("../_lib/auth");

const pwd = process.argv[2];
if (!pwd) {
  console.log('Uso: node tools/generar_hash.js "miPassword"');
  process.exit(1);
}

console.log(hashPassword(pwd));

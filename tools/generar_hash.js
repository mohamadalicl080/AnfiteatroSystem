// tools/generar_hash.js
const bcrypt = require("bcryptjs");

const password = process.argv[2];
if (!password) {
  console.log('Uso: node tools/generar_hash.js "tuPassword"');
  process.exit(1);
}

const saltRounds = 10;
bcrypt.hash(password, saltRounds).then((hash) => {
  console.log("Password:", password);
  console.log("Hash:", hash);
});

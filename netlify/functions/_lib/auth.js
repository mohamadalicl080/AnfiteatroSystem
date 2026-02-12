const crypto = require("crypto");

/**
 * JWT + Password hashing sin dependencias externas.
 * PasswordHash format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>
 */

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const s = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64");
}

function signJWT(payload, { secret, expiresInSec = 60 * 60 * 12 } = {}) {
  if (!secret) throw Object.assign(new Error("Falta AUTH_JWT_SECRET en variables de entorno."), { statusCode: 500 });

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  };

  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(body));
  const data = `${h}.${p}`;

  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const s = b64urlEncode(sig);

  return `${data}.${s}`;
}

function verifyJWT(token, { secret } = {}) {
  if (!secret) throw Object.assign(new Error("Falta AUTH_JWT_SECRET en variables de entorno."), { statusCode: 500 });
  if (!token) throw Object.assign(new Error("Token faltante."), { statusCode: 401 });

  const parts = token.split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Token inválido."), { statusCode: 401 });

  const [h, p, s] = parts;
  const data = `${h}.${p}`;

  const expected = b64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
  if (expected !== s) throw Object.assign(new Error("Token inválido."), { statusCode: 401 });

  const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw Object.assign(new Error("Sesión expirada."), { statusCode: 401 });

  return payload;
}

function hashPassword(password, { iterations = 120000, saltLen = 16 } = {}) {
  const salt = crypto.randomBytes(saltLen);
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256");
  return `pbkdf2$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, passwordHash) {
  const ph = String(passwordHash || "");
  if (!ph.startsWith("pbkdf2$")) return false;

  const parts = ph.split("$");
  // pbkdf2$iterations$salt$hash
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1] || 0);
  const salt = Buffer.from(parts[2] || "", "base64");
  const expected = Buffer.from(parts[3] || "", "base64");

  if (!iterations || salt.length === 0 || expected.length === 0) return false;

  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

function getBearerToken(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function requireAuth(event) {
  const token = getBearerToken(event);
  const payload = verifyJWT(token, { secret: process.env.AUTH_JWT_SECRET });

  // Payload esperado: { email, role, name }
  const user = {
    email: payload.email || "",
    role: payload.role || "",
    name: payload.name || payload.email || "",
  };

  if (!user.email || !user.role) throw Object.assign(new Error("Token inválido."), { statusCode: 401 });
  return user;
}

function normEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function assertRole(user, allowedRoles) {
  if (!user || !user.role) throw Object.assign(new Error("No autenticado."), { statusCode: 401 });
  if (!allowedRoles.includes(user.role)) throw Object.assign(new Error("No autorizado."), { statusCode: 403 });
}

module.exports = {
  signJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
  requireAuth,
  normEmail,
  assertRole,
};

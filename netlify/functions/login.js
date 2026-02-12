const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");
const { signJWT, verifyPassword } = require("./_lib/auth");

const SHEET_NAME = process.env.GOOGLE_SHEETS_USUARIOS_SHEET || "Usuarios";
const RANGE = `${SHEET_NAME}!A:Z`;

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  return resp;
}

function safeJsonParse(body) {
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findCol(header, candidates) {
  const h = (header || []).map(norm);
  for (const c of candidates) {
    const i = h.indexOf(norm(c));
    if (i >= 0) return i;
  }
  return -1;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return withCors(json(200, { ok: true }));
    if (event.httpMethod !== "POST") return withCors(json(405, { ok: false, error: "Method not allowed" }));

    // Mantén tu API key si la usas en producción (si está deshabilitada en tu _lib/http, no afecta)
    requireApiKey(event);

    const { email, password } = safeJsonParse(event.body);
    const e = String(email || "").trim().toLowerCase();
    const p = String(password || "");

    if (!e || !p) return withCors(json(400, { ok: false, error: "Debes ingresar email y contraseña." }));

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
    const values = res.data.values || [];
    const [header, ...rows] = values;

    if (!header || header.length === 0) {
      return withCors(json(500, { ok: false, error: `La hoja "${SHEET_NAME}" no tiene encabezados.` }));
    }

    const iEmail = findCol(header, ["Email", "Correo", "Correo Electronico", "Correo electrónico"]);
    const iHash  = findCol(header, ["PasswordHash", "Password Hash", "Hash", "ClaveHash"]);
    const iRol   = findCol(header, ["Rol", "Role"]);
    const iNombre = findCol(header, ["Nombre", "Name"]);
    const iActivo = findCol(header, ["Activo", "Habilitado", "Enabled"]);

    if (iEmail < 0 || iHash < 0 || iRol < 0) {
      return withCors(json(500, { ok: false, error: `La hoja "${SHEET_NAME}" debe tener columnas Email, PasswordHash y Rol.` }));
    }

    const row = rows.find(r => norm(r[iEmail]) === norm(e));
    if (!row) return withCors(json(401, { ok: false, error: "Usuario o contraseña incorrectos." }));

    const activoRaw = iActivo >= 0 ? norm(row[iActivo]) : "true";
    const activo = !(activoRaw === "false" || activoRaw === "0" || activoRaw === "no");
    if (!activo) return withCors(json(403, { ok: false, error: "Usuario desactivado." }));

    const role = (row[iRol] || "").toString().trim();
    const name = (iNombre >= 0 ? row[iNombre] : "") || e;

    const passwordHash = row[iHash] || "";
    const ok = verifyPassword(p, passwordHash);
    if (!ok) return withCors(json(401, { ok: false, error: "Usuario o contraseña incorrectos." }));

    const token = signJWT({ email: e, role, name }, { secret: process.env.AUTH_JWT_SECRET });
    return withCors(json(200, { ok: true, token, user: { email: e, role, name } }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

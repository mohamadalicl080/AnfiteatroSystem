const crypto = require("crypto");
const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
  return resp;
}

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function b64urlDecodeToBuffer(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function b64urlDecodeJson(str) {
  return JSON.parse(b64urlDecodeToBuffer(str).toString("utf8"));
}

function timingSafeEqual(a, b) {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Minimal JWT verifier (HS256) to avoid external deps
function verifyJwtHS256(token) {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET not set");

  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("Invalid token");

  const [h64, p64, s64] = parts;
  const header = b64urlDecodeJson(h64);
  if (!header || header.alg !== "HS256") throw new Error("Unsupported token alg");

  const data = `${h64}.${p64}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const sigB64Url = sig
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!timingSafeEqual(sigB64Url, s64)) throw new Error("Bad signature");

  const payload = b64urlDecodeJson(p64);
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf && now < payload.nbf) throw new Error("Token not active");
  if (payload.exp && now >= payload.exp) throw new Error("Token expired");

  return payload;
}

async function fetchAllSheetsAsAoa() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // list sheets
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties && s.properties.title)
    .filter(Boolean);

  const out = [];
  for (const title of titles) {
    // generous range; Sheets returns only used cells
    const range = `${title}!A:ZZ`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = res.data.values || [];

    if (!values.length) {
      out.push({ title, header: [], rows: [] });
      continue;
    }

    const header = values[0] || [];
    const rows = values.slice(1) || [];
    out.push({ title, header, rows });
  }
  return out;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return withCors({ statusCode: 200, headers: {}, body: "" });
    }
    if (event.httpMethod !== "GET") {
      return withCors(jsonResp(405, { ok: false, error: "METHOD_NOT_ALLOWED" }));
    }

    const token = getBearerToken(event);
    if (!token) return withCors(jsonResp(401, { ok: false, error: "NO_TOKEN" }));

    let payload;
    try {
      payload = verifyJwtHS256(token);
    } catch {
      return withCors(jsonResp(401, { ok: false, error: "BAD_TOKEN" }));
    }

    const role = String(payload.rol || payload.role || "").toLowerCase();
    if (role !== "admin") {
      return withCors(jsonResp(403, { ok: false, error: "FORBIDDEN" }));
    }

    const sheets = await fetchAllSheetsAsAoa();
    return withCors(
      jsonResp(200, { ok: true, exportedAt: new Date().toISOString(), sheets })
    );
  } catch (err) {
    return withCors(
      jsonResp(500, {
        ok: false,
        error: "EXPORT_FAILED",
        message: String(err && err.message ? err.message : err),
      })
    );
  }
};

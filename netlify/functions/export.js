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

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// JWT verify without depending on project auth helper (works with your existing login)
function verifyJwt(token) {
  const jwt = require("jsonwebtoken");
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET not set");
  return jwt.verify(token, secret);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return withCors({ statusCode: 200, headers: {}, body: "" });
    }
    if (event.httpMethod !== "GET") {
      return withCors(json(405, { ok: false, error: "Method not allowed" }));
    }

    const token = getBearerToken(event);
    if (!token) return withCors(json(401, { ok: false, error: "Missing token" }));

    const user = verifyJwt(token);
    const role = user.rol || user.role || "";
    if (String(role).toLowerCase() !== "admin") {
      return withCors(json(403, { ok: false, error: "Forbidden" }));
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // list sheets
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const titles = (meta.data.sheets || [])
      .map(s => s.properties && s.properties.title)
      .filter(Boolean);

    const result = [];
    for (const title of titles) {
      // Pull a generous range; Google Sheets will return only used cells.
      const range = `${title}!A:Z`;
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const values = res.data.values || [];
      const [header, ...rows] = values;
      result.push({ title, header: header || [], rows });
    }

    return withCors(json(200, { ok: true, sheets: result, exportedAt: new Date().toISOString() }));
  } catch (err) {
    return withCors({
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err.message || String(err) }),
    });
  }
};

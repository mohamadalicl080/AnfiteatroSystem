const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");

const SHEET_NAME = process.env.GOOGLE_SHEETS_ACTIVIDAD_SHEET || "Actividad";
const RANGE = `${SHEET_NAME}!A:J`;

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  return resp;
}

function safeJsonParse(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function toRow(a) {
  return [
    a.id || "",
    a.fechaHora || new Date().toISOString(),
    a.usuario || "",
    a.rol || "",
    a.accion || "",
    a.descripcion || "",
    a.ip || "",
    a.dispositivo || "",
    a.estado || "OK",
    a.movimientoId || ""
  ];
}

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return withCors({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ok: true }),
      });
    }

    requireApiKey(event);

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    if (event.httpMethod === "GET") {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;
      return withCors(json(200, { ok: true, header, rows }));
    }

    if (event.httpMethod === "POST") {
      const payload = safeJsonParse(event.body);
      if (!payload.accion || !payload.usuario) {
        return withCors(json(400, { ok: false, error: "Faltan campos requeridos (accion, usuario)." }));
      }
      if (!payload.id) {
        payload.id = `LOG-${Date.now()}`;
      }
      const row = toRow(payload);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return withCors(json(201, { ok: true, id: payload.id }));
    }

    return withCors(json(405, { ok: false, error: "Method not allowed" }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

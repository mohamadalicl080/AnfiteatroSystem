const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");

const SHEET_NAME = process.env.GOOGLE_SHEETS_ACTIVIDAD_SHEET || "Actividad";
const RANGE = `${SHEET_NAME}!A:J`;

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
    a.estado || "Exitoso",
    a.movimientoId || ""
  ];
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    requireApiKey(event);

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    if (event.httpMethod === "GET") {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;
      return json(200, { ok: true, header, rows });
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      if (!payload.accion || !payload.usuario) {
        return json(400, { ok: false, error: "Faltan campos requeridos (accion, usuario)." });
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

      return json(201, { ok: true, id: payload.id });
    }

    return json(405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { ok: false, error: err.message || String(err) });
  }
};

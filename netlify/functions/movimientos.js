const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");

const SHEET_NAME = process.env.GOOGLE_SHEETS_MOVIMIENTOS_SHEET || "Movimientos";
const RANGE = `${SHEET_NAME}!A:Y`; // must cover your columns

function withCors(resp) {
  // resp is what json() returns: { statusCode, headers?, body }
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
  return resp;
}

function toRow(m) {
  // Align to the template columns (A:Y). Missing values become "".
  return [
    m.id || "",
    m.fecha || "",              // yyyy-mm-dd
    m.area || "",
    m.tipo || "",               // Ingreso/Egreso
    m.descripcion || "",
    Number(m.monto || 0),
    m.responsable || "",
    m.local || "",
    m.arrendatario || "",
    m.empleado || "",
    m.proveedor || "",
    m.rut || "",
    m.metodoPago || "",
    m.nComprobante || "",
    m.fechaVencimiento || "",   // yyyy-mm-dd
    m.estadoPago || "",
    m.concepto || "",
    m.periodo || "",            // yyyy-mm
    m.notas || "",
    m.archivoUrl || "",
    m.creadoEn || new Date().toISOString(),
    m.creadoPorEmail || "",
    m.actualizadoEn || "",
    m.actualizadoPorEmail || "",
    "" // Monto_Asignado (lo calcula la hoja con fórmula si quieres)
  ];
}

async function getSheetIdByName(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(s => s.properties && s.properties.title === title);
  if (!sheet) throw new Error(`No encontré la hoja "${title}" en el Spreadsheet`);
  return sheet.properties.sheetId;
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

    // Protege TODO (GET/POST/DELETE) con API Key
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
      const payload = JSON.parse(event.body || "{}");
      if (!payload.fecha || !payload.area || !payload.tipo || !payload.descripcion) {
        return withCors(json(400, { ok: false, error: "Faltan campos requeridos (fecha, area, tipo, descripcion)." }));
      }
      if (!payload.id) {
        const d = payload.fecha.replaceAll("-", "");
        payload.id = `MOV-${d}-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
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

    if (event.httpMethod === "DELETE") {
      // Acepta id por query (?id=...) o por body {id:"..."}
      const qsId = event.queryStringParameters && event.queryStringParameters.id;
      const bodyId = (() => {
        try { return JSON.parse(event.body || "{}").id; } catch { return ""; }
      })();
      const id = (qsId || bodyId || "").trim();

      if (!id) {
        return withCors(json(400, { ok: false, error: "Falta id para eliminar. Usa ?id=... o body {id}." }));
      }

      // Leer datos para ubicar la fila por ID (columna A)
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;

      if (!header || header.length === 0) {
        return withCors(json(404, { ok: false, error: "La hoja no tiene encabezado/datos." }));
      }

      const rowIndexInRows = rows.findIndex(r => (r[0] || "").toString().trim() === id);
      if (rowIndexInRows < 0) {
        return withCors(json(404, { ok: false, error: `No encontré movimiento con id "${id}".` }));
      }

      // En batchUpdate, las filas son 0-indexed contando desde el inicio de la hoja.
      // Como rows excluye el header, hay que sumar 1 para saltar la fila de encabezado.
      const sheetRowIndex = rowIndexInRows + 1;

      const sheetId = await getSheetIdByName(sheets, spreadsheetId, SHEET_NAME);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: sheetRowIndex,
                  endIndex: sheetRowIndex + 1,
                },
              },
            },
          ],
        },
      });

      return withCors(json(200, { ok: true, deletedId: id }));
    }

    return withCors(json(405, { ok: false, error: "Method not allowed" }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

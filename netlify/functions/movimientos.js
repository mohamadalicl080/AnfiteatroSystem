const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");

const SHEET_NAME = process.env.GOOGLE_SHEETS_MOVIMIENTOS_SHEET || "Movimientos";
const RANGE = `${SHEET_NAME}!A:Y`; // must cover your columns

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
    "" // Monto_Signado (lo calcula la hoja con fórmula si quieres)
  ];
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    requireApiKey(event);

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    if (event.httpMethod === "GET") {
      // Simple list (returns raw rows). For production, you'd paginate/filters.
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;
      return json(200, { ok: true, header, rows });
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      if (!payload.fecha || !payload.area || !payload.tipo || !payload.descripcion) {
        return json(400, { ok: false, error: "Faltan campos requeridos (fecha, area, tipo, descripcion)." });
      }
      // Generate ID if missing
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

      return json(201, { ok: true, id: payload.id });
    }

    return json(405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { ok: false, error: err.message || String(err) });
  }
};

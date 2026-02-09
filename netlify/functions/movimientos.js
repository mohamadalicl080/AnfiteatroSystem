const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");

const SHEET_NAME = process.env.GOOGLE_SHEETS_MOVIMIENTOS_SHEET || "Movimientos";
const RANGE = `${SHEET_NAME}!A:Y`; // must cover your columns

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
  return resp;
}

function safeJsonParse(body) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }

function normalizePayload(p) {
  const out = { ...(p || {}) };

  // Compatibilidad: el front envía nombres "bonitos" (como la UI),
  // pero la hoja espera columnas A:Y (local, arrendatario, empleado, proveedor, etc.)
  if (out.numeroLocal != null && out.local == null) out.local = out.numeroLocal;
  if (out.arrendatarioPropietario != null && out.arrendatario == null) out.arrendatario = out.arrendatarioPropietario;
  if (out.nombreEmpleado != null && out.empleado == null) out.empleado = out.nombreEmpleado;
  if (out.proveedorEmpresa != null && out.proveedor == null) out.proveedor = out.proveedorEmpresa;
  if (out.rutIdentificacion != null && out.rut == null) out.rut = out.rutIdentificacion;
  if (out.comprobanteBoleta != null && out.nComprobante == null) out.nComprobante = out.comprobanteBoleta;
  if (out.conceptoCategoria != null && out.concepto == null) out.concepto = out.conceptoCategoria;
  if (out.notasAdicionales != null && out.notas == null) out.notas = out.notasAdicionales;

  return out;
}

}

// Alineado a A:Y (mismo orden que tu Sheet)
function toRow(m) {
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
    "" // Monto_Asignado (si lo calcula la hoja)
  ];
}

// Convierte una fila A:Y a objeto (para no pisar con "" en PUT)
function rowToObj(r = []) {
  return {
    id: r[0] || "",
    fecha: r[1] || "",
    area: r[2] || "",
    tipo: r[3] || "",
    descripcion: r[4] || "",
    monto: Number(r[5] || 0),
    responsable: r[6] || "",
    local: r[7] || "",
    arrendatario: r[8] || "",
    empleado: r[9] || "",
    proveedor: r[10] || "",
    rut: r[11] || "",
    metodoPago: r[12] || "",
    nComprobante: r[13] || "",
    fechaVencimiento: r[14] || "",
    estadoPago: r[15] || "",
    concepto: r[16] || "",
    periodo: r[17] || "",
    notas: r[18] || "",
    archivoUrl: r[19] || "",
    creadoEn: r[20] || "",
    creadoPorEmail: r[21] || "",
    actualizadoEn: r[22] || "",
    actualizadoPorEmail: r[23] || "",
    // r[24] es "Monto_Asignado" calculado
  };
}

async function getSheetIdByName(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets || []).find(
    s => s.properties && s.properties.title === title
  );
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

    // Protege TODO con API Key
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
      const payload = normalizePayload(safeJsonParse(event.body));

      if (!payload.fecha || !payload.area || !payload.tipo || !payload.descripcion) {
        return withCors(json(400, {
          ok: false,
          error: "Faltan campos requeridos (fecha, area, tipo, descripcion)."
        }));
      }

      // Generar ID si no viene
      if (!payload.id) {
        const d = String(payload.fecha).replaceAll("-", "");
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
      const qsId = event.queryStringParameters && event.queryStringParameters.id;
      const body = safeJsonParse(event.body);
      const id = (qsId || body.id || "").trim();

      if (!id) {
        return withCors(json(400, {
          ok: false,
          error: "Falta id para eliminar. Usa ?id=... o body {id}."
        }));
      }

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

      // En batchUpdate: indices 0-based y rows excluye header => +1
      const sheetRowIndex = rowIndexInRows + 1;
      const sheetId = await getSheetIdByName(sheets, spreadsheetId, SHEET_NAME);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1,
              },
            },
          }],
        },
      });

      return withCors(json(200, { ok: true, deletedId: id }));
    }

    if (event.httpMethod === "PUT") {
      const qsId = event.queryStringParameters && event.queryStringParameters.id;
      const payload = normalizePayload(safeJsonParse(event.body));
      const id = (qsId || payload.id || "").trim();

      if (!id) return withCors(json(400, { ok: false, error: "Falta id para editar." }));

      // Leer para encontrar fila + obtener valores actuales
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;

      const rowIndexInRows = rows.findIndex(r => (r[0] || "").toString().trim() === id);
      if (rowIndexInRows < 0) {
        return withCors(json(404, { ok: false, error: `No encontré id "${id}".` }));
      }

      const existingRow = rows[rowIndexInRows] || [];
      const existingObj = rowToObj(existingRow);

      // Mezcla: mantiene lo viejo si no lo mandas desde la web
      const merged = {
        ...existingObj,
        ...payload,
        id,
        monto: payload.monto != null ? Number(payload.monto || 0) : existingObj.monto,
        actualizadoEn: new Date().toISOString(),
      };

      // Validación mínima (igual que POST, porque tu modal siempre manda esto)
      if (!merged.fecha || !merged.area || !merged.tipo || !merged.descripcion) {
        return withCors(json(400, {
          ok: false,
          error: "Faltan campos requeridos (fecha, area, tipo, descripcion) en edición."
        }));
      }

      // Fila real en la hoja (A1 es header)
      const sheetRowNumber = rowIndexInRows + 2; // +1 header +1 por A1
      const updateRange = `${SHEET_NAME}!A${sheetRowNumber}:Y${sheetRowNumber}`;
      const row = toRow(merged);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: updateRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return withCors(json(200, { ok: true, id }));
    }

    return withCors(json(405, { ok: false, error: "Method not allowed" }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

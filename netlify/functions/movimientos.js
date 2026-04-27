const { getSheetsClient, getSpreadsheetId } = require("./_lib/googleSheets");
const { json, requireApiKey } = require("./_lib/http");
const { requireAuth, normEmail } = require("./_lib/auth");

const SHEET_NAME = process.env.GOOGLE_SHEETS_MOVIMIENTOS_SHEET || "Movimientos";
const RANGE = `${SHEET_NAME}!A:AC`; // includes convenio columns // must cover your columns

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, X-Export",
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
}

function looksLikeArchivoUrl(value) {
  const clean = String(value || "").trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  return clean.includes("drive.google.com")
    || clean.includes("docs.google.com")
    || /\.(png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|csv|txt)(\?|#|$)/i.test(clean);
}

function findArchivoUrlInRow(row = []) {
  const found = (row || []).find(looksLikeArchivoUrl);
  return String(found || "").trim();
}

// Alineado a A:AC (incluye columnas de convenio) (mismo orden que tu Sheet)
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
    "" ,                         // Y: Monto_Asignado (si lo calcula la hoja)
    m.convenioId || "",          // Z
    (m.convenioTotal != null ? Number(m.convenioTotal || 0) : ""), // AA
    m.convenioRef || "",         // AB
    m.convenioEstado || ""       // AC
  ];
}

// Convierte una fila A:AC a objeto (para no pisar con "" en PUT)
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
    archivoUrl: r[19] || findArchivoUrlInRow(r),
    creadoEn: r[20] || "",
    creadoPorEmail: r[21] || "",
    actualizadoEn: r[22] || "",
    actualizadoPorEmail: r[23] || "",
    // r[24] es "Monto_Asignado" calculado
    convenioId: r[25] || "",
    convenioTotal: r[26] !== undefined && r[26] !== "" ? Number(r[26] || 0) : "",
    convenioRef: r[27] || "",
    convenioEstado: r[28] || "",
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

function normalizeAppsScriptUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) return "";
  return clean.split("?")[0];
}

function extractDriveFileId(url) {
  const clean = String(url || "").trim();
  if (!clean) return "";

  let match = clean.match(/\/file\/d\/([^/?#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/[?&]id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/\/open\?id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  if (/^[a-zA-Z0-9_-]{20,}$/.test(clean)) return clean;
  return "";
}

function sameDriveFile(a, b) {
  const idA = extractDriveFileId(a);
  const idB = extractDriveFileId(b);
  if (idA && idB) return idA === idB;
  return String(a || "").trim() === String(b || "").trim();
}

function looksLikeOldAppsScriptWithoutDelete(msg) {
  const t = String(msg || "").toLowerCase();
  return t.includes("debes adjuntar un comprobante")
    || t.includes("debes adjuntar un comprobante válido")
    || t.includes("debes adjuntar un comprobante valido")
    || t.includes("script function not found")
    || t.includes("action delete no soportada")
    || t.includes("no autorizado para subir comprobantes");
}

function deleteSupportMessage() {
  return "El endpoint que Netlify está llamando no es el Apps Script v14 correcto o el secret no coincide. Revisa en Netlify que GOOGLE_APPS_SCRIPT_UPLOAD_URL sea la misma URL /exec que probaste, que COMPROBANTES_UPLOAD_SECRET sea exactamente igual al SECRET de Apps Script, y que ambas variables estén configuradas en el contexto Production. Luego publica una New version en Apps Script y redeploy en Netlify.";
}

async function parseAppsScriptResponse(response, contextLabel) {
  const raw = await response.text();
  let data = {};

  try {
    data = JSON.parse(raw || "{}");
  } catch (parseErr) {
    const e = new Error(`${contextLabel}: Apps Script respondió HTML/texto en vez de JSON. Esto casi siempre indica que la URL no es la /exec publicada, que el deployment no quedó público como "Anyone", o que Google devolvió una página de error. Respuesta: ${raw.slice(0, 220)}`);
    e.statusCode = 502;
    throw e;
  }

  return data;
}

async function trashComprobanteByUrl(archivoUrl, { required = false } = {}) {
  const clean = String(archivoUrl || "").trim();
  if (!clean) return { ok: true, skipped: true };

  const uploadUrl = normalizeAppsScriptUrl(process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL);
  const secret = String(process.env.COMPROBANTES_UPLOAD_SECRET || "").trim();
  const fileId = extractDriveFileId(clean);

  if (!uploadUrl || !secret) {
    const msg = "Falta configurar GOOGLE_APPS_SCRIPT_UPLOAD_URL o COMPROBANTES_UPLOAD_SECRET para borrar comprobantes.";
    if (required) {
      const e = new Error(msg);
      e.statusCode = 500;
      throw e;
    }
    return { ok: false, warning: msg };
  }

  try {
    // v14: enviamos el borrado como POST JSON/text/plain, igual que la subida.
    // También repetimos action en la URL para máxima compatibilidad con Apps Script.
    const deleteUrl = `${uploadUrl}?action=delete`;
    const response = await fetch(deleteUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret,
        action: "delete",
        fileId,
        archivoUrl: clean,
      }),
      redirect: "follow",
    });

    const data = await parseAppsScriptResponse(response, "Borrando comprobante");

    if (!response.ok || data.ok === false) {
      const msg = data.error || data.message || `Apps Script HTTP ${response.status}`;
      const finalMsg = looksLikeOldAppsScriptWithoutDelete(msg) ? deleteSupportMessage() : msg;
      const e = new Error(finalMsg);
      e.statusCode = response.ok ? 400 : response.status;
      throw e;
    }

    return data || { ok: true };
  } catch (err) {
    const finalMsg = err.message || String(err);
    if (required) {
      const e = new Error(`No pude borrar el comprobante adjunto: ${finalMsg}`);
      e.statusCode = err.statusCode || 502;
      throw e;
    }
    return { ok: false, warning: `No pude borrar el comprobante anterior: ${finalMsg}` };
  }
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

    const user = requireAuth(event);

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    if (event.httpMethod === "GET") {
      const exportFlag = (event.headers && (event.headers["x-export"] || event.headers["X-Export"])) || (event.queryStringParameters && event.queryStringParameters.export);
      if (exportFlag && user.role !== "admin") return withCors(json(403, { ok: false, error: "⛔ Solo admin puede exportar." }));
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = res.data.values || [];
      const [header, ...rows] = values;
      return withCors(json(200, { ok: true, header, rows }));
    }

    if (event.httpMethod === "POST") {
      const payload = safeJsonParse(event.body);

      // setea creador desde sesión
      payload.creadoPorEmail = user.email;
      if (!payload.responsable) payload.responsable = user.name || user.email;

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

      const existingRow = rows[rowIndexInRows] || [];
      const existingObj = rowToObj(existingRow);

      // Permisos eliminación
      if (user.role === "editor_limited") {
        const creador = normEmail(existingObj.creadoPorEmail || "");
        if (creador && creador !== normEmail(user.email)) {
          return withCors(json(403, { ok: false, error: "⛔ No puedes eliminar movimientos creados por otro usuario." }));
        }
      }
      if (user.role === "editor_limited" || user.role === "editor_full" || user.role === "admin") {
        // ok (limited: solo propios; full/admin: cualquiera)
      } else {
        return withCors(json(403, { ok: false, error: "⛔ No autorizado." }));
      }

      // Borra primero el comprobante asociado para no dejar archivos huérfanos en Drive.
      const deleteArchivoResult = await trashComprobanteByUrl(existingObj.archivoUrl, { required: !!existingObj.archivoUrl });

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

      return withCors(json(200, {
        ok: true,
        deletedId: id,
        comprobanteDeleted: !!deleteArchivoResult.deleted
      }));
    }

    if (event.httpMethod === "PUT") {
      const qsId = event.queryStringParameters && event.queryStringParameters.id;
      const payload = safeJsonParse(event.body);

      // setea creador desde sesión
      payload.creadoPorEmail = user.email;
      if (!payload.responsable) payload.responsable = user.name || user.email;
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

      // Permisos edición
      if (user.role === "editor_limited") {
        const creador = normEmail(existingObj.creadoPorEmail || "");
        if (creador && creador !== normEmail(user.email)) {
          return withCors(json(403, { ok: false, error: "⛔ No puedes editar movimientos creados por otro usuario." }));
        }
      }

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

      const archivoUrlAnterior = String(existingObj.archivoUrl || "").trim();
      const archivoUrlNuevo = String(payload.archivoUrl || "").trim();
      const reemplazaArchivo = !!(archivoUrlAnterior && archivoUrlNuevo && !sameDriveFile(archivoUrlAnterior, archivoUrlNuevo));

      // Fila real en la hoja (A1 es header)
      const sheetRowNumber = rowIndexInRows + 2; // +1 header +1 por A1
      const updateRange = `${SHEET_NAME}!A${sheetRowNumber}:AC${sheetRowNumber}`;
      const row = toRow(merged);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: updateRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      let warning = "";
      if (reemplazaArchivo) {
        const trashResult = await trashComprobanteByUrl(archivoUrlAnterior, { required: false });
        if (trashResult && trashResult.warning) warning = trashResult.warning;
      }

      return withCors(json(200, { ok: true, id, ...(warning ? { warning } : {}) }));
    }

    return withCors(json(405, { ok: false, error: "Method not allowed" }));
  } catch (err) {
    const status = err.statusCode || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

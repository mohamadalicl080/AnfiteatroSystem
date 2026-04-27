const { json, requireApiKey } = require("./_lib/http");
const { requireAuth } = require("./_lib/auth");
const { createResumableUploadSession, finalizeDriveFile } = require("./_lib/googleDrive");

const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024;
const FILE_TOO_LARGE_MSG = "El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.";

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
  try { return JSON.parse(body || "{}"); }
  catch { return {}; }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return withCors({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) });
    }
    if (event.httpMethod !== "POST") {
      return withCors(json(405, { ok: false, error: "Method not allowed" }));
    }

    requireApiKey(event);
    requireAuth(event);

    const payload = safeJsonParse(event.body);
    const action = String(payload.action || "").trim().toLowerCase();

    if (action === "start") {
      const fileName = String(payload.fileName || "comprobante").trim();
      const mimeType = String(payload.mimeType || "application/octet-stream").trim();
      const size = Number(payload.size || 0);
      const movementId = String(payload.movementId || "").trim();

      if (!size || size < 0) return withCors(json(400, { ok: false, error: "El comprobante no tiene tamaño válido." }));
      if (size > MAX_COMPROBANTE_BYTES) return withCors(json(400, { ok: false, error: FILE_TOO_LARGE_MSG }));

      const session = await createResumableUploadSession({ fileName, mimeType, size, movementId });
      return withCors(json(200, { ok: true, ...session }));
    }

    if (action === "finalize") {
      const fileId = String(payload.fileId || "").trim();
      const file = await finalizeDriveFile(fileId);
      return withCors(json(200, {
        ok: true,
        fileId: file.id,
        name: file.name,
        archivoUrl: file.webViewLink || file.webContentLink || `https://drive.google.com/file/d/${file.id}/view`,
      }));
    }

    return withCors(json(400, { ok: false, error: "Acción inválida para comprobante." }));
  } catch (err) {
    const status = err.statusCode || err.code || 500;
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

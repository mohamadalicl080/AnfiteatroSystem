const { json, requireApiKey } = require("./_lib/http");
const { requireAuth } = require("./_lib/auth");
const {
  createResumableUploadSession,
  finalizeDriveFile,
  uploadDriveFileFromBuffer,
} = require("./_lib/googleDrive");

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

function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function parseContentDisposition(value) {
  const out = {};
  for (const piece of String(value || "").split(";")) {
    const [rawKey, ...rawVal] = piece.trim().split("=");
    if (!rawKey || !rawVal.length) continue;
    let val = rawVal.join("=").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[rawKey.toLowerCase()] = val;
  }
  return out;
}

function parseMultipart(event) {
  const contentType = getHeader(event, "content-type");
  const match = contentType.match(/boundary=(?:(?:")([^"]+)(?:")|([^;]+))/i);
  if (!match) {
    const e = new Error("Solicitud inválida: falta boundary multipart.");
    e.statusCode = 400;
    throw e;
  }

  const boundary = match[1] || match[2];
  const body = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "binary");
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    pos += delimiter.length;

    if (body.slice(pos, pos + 2).toString() === "--") break;
    if (body.slice(pos, pos + 2).toString() === "\r\n") pos += 2;

    const next = body.indexOf(delimiter, pos);
    if (next === -1) break;

    let part = body.slice(pos, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const sep = part.indexOf(Buffer.from("\r\n\r\n"));
    if (sep !== -1) {
      const rawHeaders = part.slice(0, sep).toString("utf8");
      const content = part.slice(sep + 4);
      const headers = {};

      for (const line of rawHeaders.split("\r\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }

      const disposition = parseContentDisposition(headers["content-disposition"] || "");
      const name = disposition.name;
      const filename = disposition.filename;

      if (name && filename !== undefined) {
        files.push({
          fieldName: name,
          fileName: filename || "comprobante",
          mimeType: headers["content-type"] || "application/octet-stream",
          buffer: content,
          size: content.length,
        });
      } else if (name) {
        fields[name] = content.toString("utf8");
      }
    }

    pos = next;
  }

  return { fields, files };
}

async function uploadFromMultipart(event) {
  const { fields, files } = parseMultipart(event);
  const file = files.find(f => f.fieldName === "file") || files[0];

  if (!file || !file.size) {
    return json(400, { ok: false, error: "Debes adjuntar un comprobante válido." });
  }

  if (file.size > MAX_COMPROBANTE_BYTES) {
    return json(400, { ok: false, error: FILE_TOO_LARGE_MSG });
  }

  const uploaded = await uploadDriveFileFromBuffer({
    buffer: file.buffer,
    fileName: file.fileName,
    mimeType: file.mimeType,
    movementId: fields.movementId || "",
  });

  return json(200, {
    ok: true,
    fileId: uploaded.id,
    name: uploaded.name,
    archivoUrl: uploaded.webViewLink || uploaded.webContentLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
  });
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

    const contentType = getHeader(event, "content-type");
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      return withCors(await uploadFromMultipart(event));
    }

    const payload = safeJsonParse(event.body);
    const action = String(payload.action || "").trim().toLowerCase();

    // Compatibilidad con la versión anterior.
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

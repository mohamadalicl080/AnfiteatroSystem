const { json, requireApiKey } = require("./_lib/http");
const { requireAuth } = require("./_lib/auth");

const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024;
const FILE_TOO_LARGE_MSG = "El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.";
const DRIVE_FULL_MSG = "Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento.";

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  return resp;
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

function normalizeAppsScriptUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) return "";
  // La URL debe ser la /exec, sin ?secret=. Si viene con parámetros, los quitamos.
  return clean.split("?")[0];
}

function isDriveStorageErrorText(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("storagequotaexceeded") ||
    t.includes("quotaexceeded") ||
    t.includes("storage quota") ||
    t.includes("storage limit") ||
    t.includes("quota") ||
    t.includes("espacio")
  );
}

async function uploadViaAppsScript(file) {
  const uploadUrl = normalizeAppsScriptUrl(process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL);
  const secret = String(process.env.COMPROBANTES_UPLOAD_SECRET || "").trim();

  if (!uploadUrl) {
    const e = new Error("Falta GOOGLE_APPS_SCRIPT_UPLOAD_URL en Netlify.");
    e.statusCode = 500;
    throw e;
  }

  if (!secret) {
    const e = new Error("Falta COMPROBANTES_UPLOAD_SECRET en Netlify.");
    e.statusCode = 500;
    throw e;
  }

  const body = {
    secret,
    fileName: file.fileName || "comprobante",
    mimeType: file.mimeType || "application/octet-stream",
    base64: file.buffer.toString("base64"),
  };

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = JSON.parse(raw || "{}");
  } catch (parseErr) {
    const e = new Error(`Apps Script respondió algo inválido: ${raw.slice(0, 250)}`);
    e.statusCode = 502;
    throw e;
  }

  if (!response.ok || data.ok === false) {
    const msg = data.error || `Apps Script HTTP ${response.status}`;
    const e = new Error(isDriveStorageErrorText(msg) ? DRIVE_FULL_MSG : msg);
    e.statusCode = response.ok ? 400 : response.status;
    throw e;
  }

  return data;
}

async function uploadFromMultipart(event) {
  const { files } = parseMultipart(event);
  const file = files.find(f => f.fieldName === "file") || files[0];

  if (!file || !file.size) {
    return json(400, { ok: false, error: "Debes adjuntar un comprobante válido." });
  }

  if (file.size > MAX_COMPROBANTE_BYTES) {
    return json(400, { ok: false, error: FILE_TOO_LARGE_MSG });
  }

  const uploaded = await uploadViaAppsScript(file);

  return json(200, {
    ok: true,
    fileId: uploaded.fileId || uploaded.id || "",
    name: uploaded.name || file.fileName,
    archivoUrl: uploaded.archivoUrl || uploaded.url || "",
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
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return withCors(json(400, { ok: false, error: "Solicitud inválida: se esperaba multipart/form-data." }));
    }

    return withCors(await uploadFromMultipart(event));
  } catch (err) {
    const status = Number(err.statusCode || err.code || 500);
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

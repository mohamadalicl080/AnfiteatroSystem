const { json } = require("./_lib/http");
const { requireAuth } = require("./_lib/auth");

const ACTAS_FOLDER_NAME = "Actas Administrativas";
const MAX_ACTA_BYTES = 20 * 1024 * 1024;
const FILE_TOO_LARGE_MSG = "El acta supera 20 MB. Comprime el archivo o divide el escaneo.";

function withCors(resp) {
  resp.headers = {
    ...(resp.headers || {}),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
  return resp;
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function cleanName(value, fallback = "acta") {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 160);
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
          fileName: cleanName(filename || "acta"),
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
  return clean ? clean.split("?")[0] : "";
}

function getAppsScriptConfig() {
  const uploadUrl = normalizeAppsScriptUrl(process.env.ACTAS_APPS_SCRIPT_URL || process.env.ACTAS_APPS_SCRIPT_UPLOAD_URL);
  const secret = String(process.env.ACTAS_UPLOAD_SECRET || "").trim();

  if (!uploadUrl) {
    const e = new Error("Falta ACTAS_APPS_SCRIPT_URL en Netlify.");
    e.statusCode = 500;
    throw e;
  }
  if (!secret) {
    const e = new Error("Falta ACTAS_UPLOAD_SECRET en Netlify.");
    e.statusCode = 500;
    throw e;
  }
  return { uploadUrl, secret };
}

async function callActasAppsScript(payload) {
  const { uploadUrl, secret } = getAppsScriptConfig();
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, ...payload }),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (parseErr) {
    const e = new Error(`Apps Script respondió algo inválido: ${raw.slice(0, 250)}`);
    e.statusCode = 502;
    throw e;
  }

  if (!response.ok || data.ok === false) {
    const e = new Error(data.error || `Apps Script HTTP ${response.status}`);
    e.statusCode = response.ok ? 400 : response.status;
    throw e;
  }

  return data;
}

function buildStoredFileName(file, fields) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const numero = cleanName(fields.numero || "", "");
  const fecha = cleanName(fields.fecha || "", "");
  const prefix = ["ACTA", fecha, numero, stamp].filter(Boolean).join("_");
  return cleanName(`${prefix}_${file.fileName || "acta"}`, "acta");
}

async function uploadFromMultipart(event) {
  const { fields, files } = parseMultipart(event);
  const file = files.find(f => f.fieldName === "file") || files[0];

  if (!file || !file.size) {
    return json(400, { ok: false, error: "Debes adjuntar un acta válida." });
  }
  if (file.size > MAX_ACTA_BYTES) {
    return json(400, { ok: false, error: FILE_TOO_LARGE_MSG });
  }

  const description = JSON.stringify({
    numero: fields.numero || "",
    fecha: fields.fecha || "",
    registro: fields.registro || "",
    descripcion: fields.descripcion || "",
    usuario: fields.usuario || "",
    guardadoEn: ACTAS_FOLDER_NAME,
    uploadedAt: new Date().toISOString(),
  });

  const uploaded = await callActasAppsScript({
    action: "upload",
    fileName: buildStoredFileName(file, fields),
    mimeType: file.mimeType || "application/octet-stream",
    base64: file.buffer.toString("base64"),
    description,
    meta: {
      numero: fields.numero || "",
      fecha: fields.fecha || "",
      registro: fields.registro || "",
      descripcion: fields.descripcion || "",
      usuario: fields.usuario || "",
    },
  });

  return json(200, {
    ok: true,
    folderId: uploaded.folderId || "",
    item: uploaded.item || uploaded,
  });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return withCors({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) });
    }

    requireAuth(event);

    if (event.httpMethod === "GET") {
      const data = await callActasAppsScript({ action: "list" });
      return withCors(json(200, {
        ok: true,
        folderId: data.folderId || "",
        folderName: data.folderName || ACTAS_FOLDER_NAME,
        items: data.items || [],
      }));
    }

    if (event.httpMethod === "POST") {
      const contentType = getHeader(event, "content-type");
      if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
        return withCors(json(400, { ok: false, error: "Solicitud inválida: se esperaba multipart/form-data." }));
      }
      return withCors(await uploadFromMultipart(event));
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters && event.queryStringParameters.id) || "";
      if (!id) return withCors(json(400, { ok: false, error: "Falta id del archivo." }));
      await callActasAppsScript({ action: "delete", fileId: id });
      return withCors(json(200, { ok: true }));
    }

    return withCors(json(405, { ok: false, error: "Method not allowed" }));
  } catch (err) {
    const status = Number(err.statusCode || err.code || 500);
    return withCors(json(status, { ok: false, error: err.message || String(err) }));
  }
};

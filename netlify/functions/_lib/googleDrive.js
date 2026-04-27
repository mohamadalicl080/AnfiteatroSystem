const { google } = require("googleapis");
const { Readable } = require("stream");

const DRIVE_FOLDER_ID_ENV = "GOOGLE_DRIVE_FOLDER_ID";
const APPS_SCRIPT_UPLOAD_URL_ENV = "GOOGLE_APPS_SCRIPT_UPLOAD_URL";
const APPS_SCRIPT_SECRET_ENV = "COMPROBANTES_UPLOAD_SECRET";

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getOptionalEnv(name) {
  return String(process.env[name] || "").trim();
}

function getServiceAccountAuth() {
  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let key = getEnv("GOOGLE_PRIVATE_KEY");
  key = key.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

function getOAuthAuth() {
  const clientId = getOptionalEnv("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = getOptionalEnv("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = getOptionalEnv("GOOGLE_DRIVE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function getDriveClient(auth) {
  return google.drive({ version: "v3", auth });
}

function getDriveFolderId() {
  const v = process.env[DRIVE_FOLDER_ID_ENV];
  if (!v) {
    const e = new Error("Falta configurar GOOGLE_DRIVE_FOLDER_ID en Netlify para guardar comprobantes.");
    e.statusCode = 500;
    throw e;
  }
  return v;
}

function safeFilename(name) {
  const cleaned = String(name || "comprobante")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "comprobante").slice(0, 160);
}

function makeDriveFileName({ fileName, movementId }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = movementId ? safeFilename(movementId) : "MOV";
  return `${prefix}_${stamp}_${safeFilename(fileName)}`;
}

function getDriveErrorReason(err) {
  const candidates = [
    err?.errors?.[0]?.reason,
    err?.response?.data?.error?.errors?.[0]?.reason,
    err?.response?.data?.error?.status,
    err?.code,
    err?.message,
  ];
  return candidates.filter(Boolean).join(" ");
}

function friendlyDriveError(err) {
  const reason = getDriveErrorReason(err);
  const raw = JSON.stringify(err?.response?.data || err?.errors || err?.message || err || {}).toLowerCase();
  const haystack = `${String(reason).toLowerCase()} ${raw}`;

  if (haystack.includes("storagequotaexceeded") || haystack.includes("quotaexceeded") || haystack.includes("storage quota") || haystack.includes("storage limit")) {
    const configuredAppsScript = Boolean(getOptionalEnv(APPS_SCRIPT_UPLOAD_URL_ENV));
    const msg = configuredAppsScript
      ? "Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento y vuelve a intentar."
      : "Google Drive rechazó la subida con el Service Account porque no tiene cuota de almacenamiento. Para Gmail personal usa la versión con Apps Script: configura GOOGLE_APPS_SCRIPT_UPLOAD_URL y COMPROBANTES_UPLOAD_SECRET.";
    const e = new Error(msg);
    e.statusCode = 507;
    return e;
  }

  if (haystack.includes("filenotfound") || haystack.includes("not found") || haystack.includes("insufficientfilepermissions") || haystack.includes("permission")) {
    const e = new Error("No pude subir el comprobante: revisa GOOGLE_DRIVE_FOLDER_ID y que la carpeta/endpoint tenga permisos correctos.");
    e.statusCode = 500;
    return e;
  }

  if (haystack.includes("invalid_grant") || haystack.includes("invalid credentials")) {
    const e = new Error("No pude autenticar Google Drive. Revisa GOOGLE_DRIVE_REFRESH_TOKEN o vuelve a autorizar la conexión OAuth.");
    e.statusCode = 401;
    return e;
  }

  const e = new Error(`No pude subir el comprobante a Google Drive: ${err?.message || String(err)}`);
  e.statusCode = err?.code || err?.statusCode || 500;
  return e;
}

async function getAccessToken(auth) {
  const token = await auth.getAccessToken();
  if (typeof token === "string") return token;
  if (token && token.token) return token.token;
  throw new Error("No pude obtener token de Google Drive.");
}

// Se deja esta función por compatibilidad con una versión anterior.
async function createResumableUploadSession({ fileName, mimeType, size, movementId }) {
  const folderId = getDriveFolderId();
  const auth = getOAuthAuth() || getServiceAccountAuth();
  const token = await getAccessToken(auth);
  const name = makeDriveFileName({ fileName, movementId });

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(size || 0),
    },
    body: JSON.stringify({
      name,
      parents: [folderId],
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch {}
    const e = new Error(`Drive upload session failed (${resp.status}): ${detail}`);
    e.code = resp.status;
    throw friendlyDriveError(e);
  }

  const uploadUrl = resp.headers.get("location");
  if (!uploadUrl) {
    const e = new Error("Google Drive no devolvió URL de carga.");
    e.statusCode = 500;
    throw e;
  }

  return { uploadUrl, name };
}

async function makeFileReadableByLink(drive, fileId) {
  if (String(process.env.GOOGLE_DRIVE_SHARE_ANYONE || "true").toLowerCase() === "false") return;

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (err) {
    // Si no se puede publicar el enlace, igual devolvemos el link Drive.
    // El dueño de la carpeta o usuarios con permiso podrán abrirlo.
    console.warn("No pude publicar comprobante con enlace:", err?.message || err);
  }
}

async function uploadViaAppsScript({ buffer, fileName, mimeType, movementId }) {
  const endpoint = getOptionalEnv(APPS_SCRIPT_UPLOAD_URL_ENV);
  if (!endpoint) return null;

  const name = makeDriveFileName({ fileName, movementId });
  const body = {
    secret: getOptionalEnv(APPS_SCRIPT_SECRET_ENV),
    fileName: name,
    mimeType: mimeType || "application/octet-stream",
    movementId: movementId || "",
    base64: Buffer.from(buffer).toString("base64"),
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  let data = {};
  const text = await resp.text().catch(() => "");
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: text }; }

  if (!resp.ok || data.ok === false) {
    const e = new Error(data.error || `Apps Script upload failed (${resp.status})`);
    e.code = resp.status;
    throw friendlyDriveError(e);
  }

  return {
    id: data.fileId || data.id || "",
    name: data.name || name,
    webViewLink: data.archivoUrl || data.webViewLink || data.url || "",
    webContentLink: data.webContentLink || "",
  };
}

async function uploadViaDriveApi({ buffer, fileName, mimeType, movementId }) {
  const folderId = getDriveFolderId();
  const auth = getOAuthAuth() || getServiceAccountAuth();
  const drive = getDriveClient(auth);
  const name = makeDriveFileName({ fileName, movementId });

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: Readable.from(buffer),
    },
    fields: "id,name,webViewLink,webContentLink",
  });

  const fileId = created.data.id;
  await makeFileReadableByLink(drive, fileId);

  const final = await drive.files.get({
    fileId,
    fields: "id,name,webViewLink,webContentLink",
  });

  return final.data;
}

async function uploadDriveFileFromBuffer({ buffer, fileName, mimeType, movementId }) {
  try {
    const viaAppsScript = await uploadViaAppsScript({ buffer, fileName, mimeType, movementId });
    if (viaAppsScript) return viaAppsScript;
    return await uploadViaDriveApi({ buffer, fileName, mimeType, movementId });
  } catch (err) {
    throw friendlyDriveError(err);
  }
}

async function finalizeDriveFile(fileId) {
  if (!fileId) {
    const e = new Error("Falta fileId de Google Drive.");
    e.statusCode = 400;
    throw e;
  }

  const auth = getOAuthAuth() || getServiceAccountAuth();
  const drive = getDriveClient(auth);
  await makeFileReadableByLink(drive, fileId);

  try {
    const res = await drive.files.get({
      fileId,
      fields: "id,name,webViewLink,webContentLink",
    });
    return res.data;
  } catch (err) {
    throw friendlyDriveError(err);
  }
}

module.exports = {
  createResumableUploadSession,
  finalizeDriveFile,
  uploadDriveFileFromBuffer,
  friendlyDriveError,
};

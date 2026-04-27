const { google } = require("googleapis");
const { Readable } = require("stream");

const DRIVE_FOLDER_ID_ENV = "GOOGLE_DRIVE_FOLDER_ID";

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getAuth() {
  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let key = getEnv("GOOGLE_PRIVATE_KEY");
  key = key.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

function getDriveClient() {
  const auth = getAuth();
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
    const e = new Error("Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento y vuelve a intentar.");
    e.statusCode = 507;
    return e;
  }

  if (haystack.includes("filenotfound") || haystack.includes("not found") || haystack.includes("insufficientfilepermissions") || haystack.includes("permission")) {
    const e = new Error("No pude subir el comprobante: revisa GOOGLE_DRIVE_FOLDER_ID y que la carpeta esté compartida con el Service Account.");
    e.statusCode = 500;
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

// Se deja esta función por compatibilidad, pero la app nueva sube por Netlify
// para evitar el error de navegador "Failed to fetch" por CORS hacia Google.
async function createResumableUploadSession({ fileName, mimeType, size, movementId }) {
  const folderId = getDriveFolderId();
  const auth = getAuth();
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

async function uploadDriveFileFromBuffer({ buffer, fileName, mimeType, movementId }) {
  const folderId = getDriveFolderId();
  const drive = getDriveClient();
  const name = makeDriveFileName({ fileName, movementId });

  try {
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

  const drive = getDriveClient();
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

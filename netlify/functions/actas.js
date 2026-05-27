const { Readable } = require("stream");
const { google } = require("googleapis");

const ACTAS_FOLDER_NAME = "Actas Administrativas";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function cleanName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function bufferIndexOf(buf, sub, start = 0) {
  return buf.indexOf(sub, start);
}

function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!boundaryMatch) throw new Error("No se encontró boundary multipart.");
  const boundary = Buffer.from("--" + (boundaryMatch[1] || boundaryMatch[2] || ""));
  const body = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
  const fields = {};
  const files = [];

  let pos = bufferIndexOf(body, boundary);
  while (pos !== -1) {
    let next = bufferIndexOf(body, boundary, pos + boundary.length);
    if (next === -1) break;

    let part = body.slice(pos + boundary.length, next);
    if (part.slice(0, 2).toString() === "--") break;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = bufferIndexOf(part, Buffer.from("\r\n\r\n"));
    if (headerEnd >= 0) {
      const rawHeaders = part.slice(0, headerEnd).toString("utf8");
      const content = part.slice(headerEnd + 4);
      const disp = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
      if (disp) {
        const nameMatch = disp[1].match(/name="([^"]+)"/i);
        const fileMatch = disp[1].match(/filename="([^"]*)"/i);
        const typeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
        const name = nameMatch ? nameMatch[1] : "";
        if (fileMatch && fileMatch[1]) {
          files.push({
            fieldName: name,
            filename: cleanName(fileMatch[1]) || "acta",
            contentType: (typeMatch ? typeMatch[1].trim() : "application/octet-stream"),
            buffer: content
          });
        } else if (name) {
          fields[name] = content.toString("utf8");
        }
      }
    }
    pos = next;
  }

  return { fields, files };
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  }

  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (client_email && private_key) return { client_email, private_key };

  throw new Error("Faltan credenciales Google. Define GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.");
}

async function getDrive() {
  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  return google.drive({ version: "v3", auth });
}

function qEscape(value) {
  return String(value || "").replace(/'/g, "\\'");
}

async function ensureActasFolder(drive) {
  const configured = process.env.ACTAS_DRIVE_FOLDER_ID;
  if (configured) return configured;

  const parentId = process.env.REGISTRO_LEDGER_FOLDER_ID || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || process.env.DRIVE_PARENT_FOLDER_ID || "";
  const parentClause = parentId ? ` and '${qEscape(parentId)}' in parents` : "";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${qEscape(ACTAS_FOLDER_NAME)}' and trashed=false${parentClause}`;

  const found = await drive.files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  if (found.data.files && found.data.files[0]) return found.data.files[0].id;

  const metadata = {
    name: ACTAS_FOLDER_NAME,
    mimeType: "application/vnd.google-apps.folder"
  };
  if (parentId) metadata.parents = [parentId];

  const created = await drive.files.create({
    requestBody: metadata,
    fields: "id",
    supportsAllDrives: true
  });
  return created.data.id;
}

async function listActas(drive, folderId) {
  const res = await drive.files.list({
    q: `'${qEscape(folderId)}' in parents and trashed=false`,
    orderBy: "createdTime desc",
    pageSize: 1000,
    fields: "files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,description)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return res.data.files || [];
}

async function uploadActa(drive, folderId, file, fields) {
  if (!file || !file.buffer || !file.buffer.length) throw new Error("Archivo vacío o no recibido.");
  if (file.buffer.length > MAX_FILE_BYTES) throw new Error("El archivo supera 20 MB.");

  const numero = cleanName(fields.numero || "");
  const fecha = cleanName(fields.fecha || "");
  const prefix = ["Acta", fecha, numero].filter(Boolean).join("_");
  const fileName = cleanName(prefix ? `${prefix}_${file.filename}` : file.filename);

  const description = JSON.stringify({
    numero: fields.numero || "",
    fecha: fields.fecha || "",
    registro: fields.registro || "",
    descripcion: fields.descripcion || "",
    usuario: fields.usuario || "",
    guardadoEn: ACTAS_FOLDER_NAME,
    uploadedAt: new Date().toISOString()
  });

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      description,
      parents: [folderId]
    },
    media: {
      mimeType: file.contentType || "application/octet-stream",
      body: Readable.from(file.buffer)
    },
    fields: "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,description",
    supportsAllDrives: true
  });

  return created.data;
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || "GET";
    const drive = await getDrive();
    const folderId = await ensureActasFolder(drive);

    if (method === "GET") {
      const items = await listActas(drive, folderId);
      return json(200, { ok: true, folderId, folderName: ACTAS_FOLDER_NAME, items });
    }

    if (method === "POST") {
      const { fields, files } = parseMultipart(event);
      const file = files.find(f => f.fieldName === "file") || files[0];
      const item = await uploadActa(drive, folderId, file, fields);
      return json(200, { ok: true, folderId, item });
    }

    if (method === "DELETE") {
      const id = (event.queryStringParameters && event.queryStringParameters.id) || "";
      if (!id) return json(400, { ok: false, error: "Falta id del archivo." });
      await drive.files.update({
        fileId: id,
        requestBody: { trashed: true },
        supportsAllDrives: true
      });
      return json(200, { ok: true });
    }

    return json(405, { ok: false, error: "Método no permitido." });
  } catch (err) {
    console.error("actas error", err);
    return json(500, { ok: false, error: err.message || "Error interno en actas." });
  }
};

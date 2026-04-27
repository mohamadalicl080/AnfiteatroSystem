/**
 * Apps Script para subir, mostrar y eliminar comprobantes/boletas en Google Drive personal.
 *
 * Configuración:
 * 1) Crea una carpeta en Google Drive.
 * 2) Copia el ID de la carpeta y pégalo en FOLDER_ID.
 * 3) Cambia SECRET por una clave larga inventada por ti.
 * 4) Implementa como Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5) Copia la URL /exec y ponla en Netlify como GOOGLE_APPS_SCRIPT_UPLOAD_URL.
 * 6) Pon la misma clave SECRET en Netlify como COMPROBANTES_UPLOAD_SECRET.
 *
 * Versión v14:
 * - Sube archivos por POST con JSON/base64.
 * - Elimina archivos por POST JSON, POST con parámetros URL o form-urlencoded.
 * - doGet sirve para diagnóstico y también permite borrar manualmente si se usa action=delete.
 */

const FOLDER_ID = 'PEGA_AQUI_EL_ID_DE_TU_CARPETA_DRIVE';
const SECRET = 'CAMBIA_ESTA_CLAVE_LARGA_Y_PRIVADA';
const SHARE_ANYONE_WITH_LINK = true;
const MAX_BYTES = 5 * 1024 * 1024;
const SCRIPT_VERSION = 'v14';

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeName_(name) {
  return String(name || 'comprobante')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'comprobante';
}

function parseUrlEncoded_(raw) {
  const out = {};
  String(raw || '').split('&').forEach(function(pair) {
    if (!pair) return;
    const idx = pair.indexOf('=');
    const key = idx >= 0 ? pair.slice(0, idx) : pair;
    const val = idx >= 0 ? pair.slice(idx + 1) : '';
    try {
      out[decodeURIComponent(String(key).replace(/\+/g, ' '))] = decodeURIComponent(String(val).replace(/\+/g, ' '));
    } catch (err) {
      out[String(key)] = String(val);
    }
  });
  return out;
}

function readBody_(e) {
  const params = (e && e.parameter) || {};
  let body = {};

  if (e && e.postData && e.postData.contents) {
    const raw = String(e.postData.contents || '').trim();

    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (jsonErr) {
        body = parseUrlEncoded_(raw);
      }
    }
  }

  // Soporta parámetros en URL y cuerpo. El cuerpo manda sobre URL si ambos existen.
  const merged = {};
  Object.keys(params || {}).forEach(function(k) { merged[k] = params[k]; });
  Object.keys(body || {}).forEach(function(k) { merged[k] = body[k]; });
  return merged;
}

function extractFileId_(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';

  let match = clean.match(/\/file\/d\/([^/?#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/[?&]id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/\/open\?id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  if (/^[a-zA-Z0-9_-]{20,}$/.test(clean)) return clean;

  return '';
}

function fileBelongsToFolder_(file, folderId) {
  const parents = file.getParents();

  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() === folderId) return true;
  }

  return false;
}

function trashFile_(fileIdOrUrl) {
  const fileId = extractFileId_(fileIdOrUrl);

  if (!fileId) {
    return {
      ok: true,
      deleted: false,
      skipped: true,
      version: SCRIPT_VERSION,
      message: 'Sin comprobante para eliminar.'
    };
  }

  const file = DriveApp.getFileById(fileId);

  if (!fileBelongsToFolder_(file, FOLDER_ID)) {
    return {
      ok: false,
      version: SCRIPT_VERSION,
      error: 'Por seguridad no borré el archivo porque no está dentro de la carpeta configurada de comprobantes.'
    };
  }

  file.setTrashed(true);

  return {
    ok: true,
    deleted: true,
    version: SCRIPT_VERSION,
    fileId: fileId,
    name: file.getName()
  };
}

function uploadFile_(body) {
  const rawBase64 = String(body.base64 || '');

  if (!rawBase64) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'Debes adjuntar un comprobante válido.'
    });
  }

  const bytes = Utilities.base64Decode(rawBase64);

  if (bytes.length > MAX_BYTES) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.'
    });
  }

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const fileName = safeName_(body.fileName || 'comprobante');
  const mimeType = String(body.mimeType || 'application/octet-stream');
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);

  if (SHARE_ANYONE_WITH_LINK) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Si tu cuenta no permite enlaces públicos, el archivo igual queda guardado.
    }
  }

  return json_({
    ok: true,
    version: SCRIPT_VERSION,
    fileId: file.getId(),
    name: file.getName(),
    archivoUrl: file.getUrl()
  });
}

function handle_(data) {
  const body = data || {};

  if (SECRET && String(body.secret || '') !== String(SECRET)) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: 'No autorizado para subir o borrar comprobantes. Revisa que COMPROBANTES_UPLOAD_SECRET en Netlify sea exactamente igual al SECRET de Apps Script.'
    });
  }

  const action = String(body.action || 'upload').toLowerCase().trim();

  if (action === 'delete' || action === 'trash' || action === 'remove') {
    return json_(trashFile_(body.fileId || body.archivoUrl || body.url || body.fileUrl));
  }

  return uploadFile_(body);
}

function doPost(e) {
  try {
    return handle_(readBody_(e));
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const lower = msg.toLowerCase();

    if (
      lower.includes('storage') ||
      lower.includes('quota') ||
      lower.includes('espacio')
    ) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento.'
      });
    }

    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: msg,
      stack: String(err && err.stack ? err.stack : '')
    });
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};

    if (SECRET && String(params.secret || '') !== String(SECRET)) {
      return json_({
        ok: false,
        version: SCRIPT_VERSION,
        error: 'No autorizado. Secret incorrecto.'
      });
    }

    const action = String(params.action || 'test').toLowerCase().trim();

    if (action === 'delete' || action === 'trash' || action === 'remove') {
      return json_(trashFile_(params.fileId || params.archivoUrl || params.url || params.fileUrl));
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);

    let storageLimit = null;
    let storageUsed = null;

    try {
      storageLimit = DriveApp.getStorageLimit();
      storageUsed = DriveApp.getStorageUsed();
    } catch (storageErr) {}

    const testBlob = Utilities.newBlob(
      'test comprobantes anfiteatro',
      'text/plain',
      'test-comprobantes-anfiteatro.txt'
    );

    const testFile = folder.createFile(testBlob);
    const testUrl = testFile.getUrl();
    testFile.setTrashed(true);

    return json_({
      ok: true,
      version: SCRIPT_VERSION,
      message: 'Apps Script puede crear archivos y tiene activa la eliminación.',
      folderName: folder.getName(),
      canUpload: true,
      canDelete: true,
      actions: ['upload', 'delete'],
      deleteMethod: 'POST JSON/text/plain, POST URL params o form-urlencoded',
      storageLimit: storageLimit,
      storageUsed: storageUsed,
      testFileCreated: true,
      testFileDeleted: true,
      testFileUrl: testUrl
    });

  } catch (err) {
    return json_({
      ok: false,
      version: SCRIPT_VERSION,
      error: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : '')
    });
  }
}

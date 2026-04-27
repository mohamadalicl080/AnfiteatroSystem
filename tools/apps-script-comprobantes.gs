/**
 * Apps Script para subir comprobantes/boletas a Google Drive personal.
 *
 * Pasos:
 * 1) Crea una carpeta en Google Drive.
 * 2) Copia el ID de la carpeta y pégalo en FOLDER_ID.
 * 3) Cambia SECRET por una clave larga inventada por ti.
 * 4) Implementa como Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5) Copia la URL /exec y ponla en Netlify como GOOGLE_APPS_SCRIPT_UPLOAD_URL.
 * 6) Pon la misma clave SECRET en Netlify como COMPROBANTES_UPLOAD_SECRET.
 *
 * Esta versión también permite enviar action: "delete" por GET o POST para mover a
 * la papelera el comprobante cuando se borra un movimiento o se reemplaza su adjunto.
 */

const FOLDER_ID = 'PEGA_AQUI_EL_ID_DE_TU_CARPETA_DRIVE';
const SECRET = 'CAMBIA_ESTA_CLAVE_LARGA_Y_PRIVADA';
const SHARE_ANYONE_WITH_LINK = true;
const MAX_BYTES = 5 * 1024 * 1024;

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

function extractFileId_(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';

  let match = clean.match(/\/file\/d\/([^/?#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/[?&]id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  match = clean.match(/\/open\?id=([^&#]+)/i);
  if (match && match[1]) return decodeURIComponent(match[1]);

  // Permite recibir el ID directo desde Netlify.
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
      message: 'Sin comprobante para eliminar.'
    };
  }

  const file = DriveApp.getFileById(fileId);

  // Seguridad: evita borrar archivos que no estén en la carpeta de comprobantes.
  if (!fileBelongsToFolder_(file, FOLDER_ID)) {
    return {
      ok: false,
      error: 'Por seguridad no borré el archivo porque no está dentro de la carpeta configurada de comprobantes.'
    };
  }

  file.setTrashed(true);

  return {
    ok: true,
    deleted: true,
    fileId: fileId,
    name: file.getName()
  };
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (SECRET && body.secret !== SECRET) {
      return json_({ ok: false, error: 'No autorizado para subir comprobantes.' });
    }

    const action = String(body.action || 'upload').toLowerCase().trim();

    if (action === 'delete' || action === 'trash') {
      const result = trashFile_(body.fileId || body.archivoUrl || body.url || body.fileUrl);
      return json_(result);
    }

    const rawBase64 = String(body.base64 || '');
    if (!rawBase64) {
      return json_({ ok: false, error: 'Debes adjuntar un comprobante válido.' });
    }

    const bytes = Utilities.base64Decode(rawBase64);
    if (bytes.length > MAX_BYTES) {
      return json_({ ok: false, error: 'El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.' });
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
      fileId: file.getId(),
      name: file.getName(),
      archivoUrl: file.getUrl()
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const lower = msg.toLowerCase();
    if (lower.includes('storage') || lower.includes('quota') || lower.includes('espacio')) {
      return json_({ ok: false, error: 'Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento.' });
    }
    return json_({ ok: false, error: msg });
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const secret = params.secret;

    if (SECRET && secret !== SECRET) {
      return json_({
        ok: false,
        error: 'No autorizado. Secret incorrecto.'
      });
    }

    const action = String(params.action || 'test').toLowerCase().trim();

    if (action === 'delete' || action === 'trash') {
      const result = trashFile_(params.fileId || params.archivoUrl || params.url || params.fileUrl);
      return json_(result);
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
      message: 'Apps Script puede crear archivos en esta carpeta y tiene activada la función para eliminar comprobantes.',
      folderName: folder.getName(),
      canUpload: true,
      canDelete: true,
      actions: ['upload', 'delete'],
      deleteMethod: 'GET',
      storageLimit: storageLimit,
      storageUsed: storageUsed,
      testFileCreated: true,
      testFileUrl: testUrl
    });

  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : '')
    });
  }
}

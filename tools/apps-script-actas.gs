/**
 * Apps Script para subir, listar y eliminar Actas Administrativas en Google Drive personal.
 *
 * Usar como una Web App independiente de comprobantes:
 * 1) Pega el ID de la carpeta "Actas Administrativas" en ACTAS_FOLDER_ID.
 * 2) Cambia ACTAS_SECRET por una clave larga inventada por ti.
 * 3) Implementa como Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4) Copia la URL terminada en /exec y ponla en Netlify como ACTAS_APPS_SCRIPT_URL.
 * 5) Pon la misma clave ACTAS_SECRET en Netlify como ACTAS_UPLOAD_SECRET.
 */

const ACTAS_FOLDER_ID = 'PEGA_AQUI_EL_ID_DE_LA_CARPETA_ACTAS_ADMINISTRATIVAS';
const ACTAS_SECRET = 'CAMBIA_ESTA_CLAVE_LARGA_Y_PRIVADA';
const SHARE_ANYONE_WITH_LINK = true;
const MAX_BYTES = 20 * 1024 * 1024;

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeName_(name) {
  return String(name || 'acta')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'acta';
}

function requireSecret_(body) {
  if (ACTAS_SECRET && (!body || body.secret !== ACTAS_SECRET)) {
    throw new Error('No autorizado para gestionar actas administrativas.');
  }
}

function fileToItem_(file) {
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: String(file.getSize()),
    createdTime: file.getDateCreated() ? file.getDateCreated().toISOString() : '',
    modifiedTime: file.getLastUpdated() ? file.getLastUpdated().toISOString() : '',
    webViewLink: file.getUrl(),
    webContentLink: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(file.getId()),
    thumbnailLink: '',
    description: file.getDescription() || ''
  };
}

function listActas_() {
  const folder = DriveApp.getFolderById(ACTAS_FOLDER_ID);
  const files = folder.getFiles();
  const items = [];

  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed()) items.push(fileToItem_(file));
  }

  items.sort(function(a, b) {
    return String(b.createdTime || '').localeCompare(String(a.createdTime || ''));
  });

  return {
    ok: true,
    folderId: ACTAS_FOLDER_ID,
    folderName: folder.getName(),
    items: items
  };
}

function uploadActa_(body) {
  const rawBase64 = String(body.base64 || '');
  if (!rawBase64) throw new Error('Debes adjuntar un acta válida.');

  const bytes = Utilities.base64Decode(rawBase64);
  if (bytes.length > MAX_BYTES) {
    throw new Error('El acta supera 20 MB. Comprime el archivo o divide el escaneo.');
  }

  const folder = DriveApp.getFolderById(ACTAS_FOLDER_ID);
  const fileName = safeName_(body.fileName || 'acta');
  const mimeType = String(body.mimeType || 'application/octet-stream');
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);

  if (body.description) {
    try { file.setDescription(String(body.description)); } catch (descErr) {}
  }

  if (SHARE_ANYONE_WITH_LINK) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Si tu cuenta no permite enlaces públicos, el archivo igual queda guardado.
    }
  }

  return {
    ok: true,
    folderId: ACTAS_FOLDER_ID,
    folderName: folder.getName(),
    item: fileToItem_(file),
    fileId: file.getId(),
    name: file.getName(),
    archivoUrl: file.getUrl()
  };
}

function deleteActa_(body) {
  const fileId = String(body.fileId || body.id || '').trim();
  if (!fileId) throw new Error('Falta id del archivo.');

  const file = DriveApp.getFileById(fileId);
  file.setTrashed(true);
  return { ok: true, fileId: fileId };
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireSecret_(body);

    const action = String(body.action || 'upload').toLowerCase();
    if (action === 'list') return json_(listActas_());
    if (action === 'delete') return json_(deleteActa_(body));
    if (action === 'upload') return json_(uploadActa_(body));

    return json_({ ok: false, error: 'Acción no válida.' });
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
    const secret = e && e.parameter && e.parameter.secret;
    if (ACTAS_SECRET && secret !== ACTAS_SECRET) {
      return json_({ ok: false, error: 'No autorizado. Secret incorrecto.' });
    }

    const folder = DriveApp.getFolderById(ACTAS_FOLDER_ID);
    const testBlob = Utilities.newBlob(
      'test actas administrativas anfiteatro',
      'text/plain',
      'test-actas-administrativas.txt'
    );
    const testFile = folder.createFile(testBlob);
    const testUrl = testFile.getUrl();
    testFile.setTrashed(true);

    return json_({
      ok: true,
      message: 'Apps Script puede crear archivos en la carpeta Actas Administrativas.',
      folderId: ACTAS_FOLDER_ID,
      folderName: folder.getName(),
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

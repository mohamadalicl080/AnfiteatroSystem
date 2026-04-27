# Anfiteatro System - Netlify + Google Sheets

App conectada a Google Sheets como base de datos de movimientos.

## Cambio agregado

- Adjuntar comprobante / boleta al crear o editar un movimiento.
- Límite máximo por archivo: 5 MB.
- Formatos permitidos desde la app: imagen, PDF, Word, Excel, CSV o TXT.
- Se eliminó el uso visible de los campos Período Correspondiente y Estado de Pago en el formulario de movimiento.

## Importante para Gmail personal

Si usas Google Drive personal, no uses Service Account para subir archivos a Drive. Google puede devolver `storageQuotaExceeded` aunque tu cuenta tenga espacio, porque el Service Account no tiene cuota de almacenamiento propia.

La solución recomendada incluida en esta versión es subir los comprobantes mediante Google Apps Script, ejecutado como tu usuario Gmail personal.

La conexión actual con Google Sheets queda igual y no debes cambiarla.

## Variables de entorno existentes que NO debes cambiar si ya funcionan

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `AUTH_JWT_SECRET`
- `API_KEY`, si la usas

## Variables nuevas para comprobantes con Google Apps Script

Agrega en Netlify:

- `GOOGLE_APPS_SCRIPT_UPLOAD_URL`
- `COMPROBANTES_UPLOAD_SECRET`

`GOOGLE_DRIVE_FOLDER_ID` ya no es necesario si usas Apps Script, porque el ID de carpeta queda dentro del script de Google.

## Apps Script

El archivo listo para copiar está en:

`tools/apps-script-comprobantes.gs`

### Pasos rápidos

1. Crea una carpeta en tu Google Drive personal, por ejemplo `Comprobantes Anfiteatro`.
2. Copia el ID de esa carpeta desde la URL.
3. Entra a https://script.google.com/ y crea un proyecto nuevo.
4. Pega el contenido de `tools/apps-script-comprobantes.gs`.
5. Cambia `FOLDER_ID` por el ID de tu carpeta.
6. Cambia `SECRET` por una clave larga inventada por ti.
7. Clic en Deploy > New deployment.
8. Tipo: Web app.
9. Execute as: Me.
10. Who has access: Anyone.
11. Copia la URL que termina en `/exec`.
12. En Netlify crea `GOOGLE_APPS_SCRIPT_UPLOAD_URL` con esa URL.
13. En Netlify crea `COMPROBANTES_UPLOAD_SECRET` con la misma clave que pusiste en `SECRET`.
14. Redespliega Netlify.

## Prueba

1. Crea un movimiento nuevo.
2. Adjunta una imagen o PDF menor a 5 MB.
3. Guarda.
4. Revisa la carpeta de Drive: debe aparecer el comprobante.

Si subes un archivo mayor a 5 MB, la app mostrará:

`❌ Error guardando: El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.`

Si Drive personal realmente está sin espacio, la app mostrará:

`❌ Error guardando: Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento.`

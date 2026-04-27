# Anfiteatro System - Netlify + Google Sheets

App conectada a Google Sheets como base de datos de movimientos.

## Funciones agregadas

- Adjuntar comprobante / boleta al crear o editar un movimiento.
- Límite máximo por archivo: 5 MB.
- Formatos permitidos desde la app: imagen, PDF, Word, Excel, CSV o TXT.
- El comprobante se muestra en el detalle/ticket del movimiento.
- Si eliminas un movimiento, su comprobante se mueve a la papelera de Google Drive.
- Si editas un movimiento y reemplazas el comprobante, el comprobante anterior se mueve a la papelera.
- Se eliminó el uso visible de los campos Período Correspondiente y Estado de Pago en el formulario de movimiento.

## Importante para Gmail personal

Si usas Google Drive personal, no uses Service Account para subir archivos a Drive. Google puede devolver `storageQuotaExceeded` aunque tu cuenta tenga espacio, porque el Service Account no tiene cuota de almacenamiento propia.

La solución incluida usa Google Apps Script, ejecutado como tu usuario Gmail personal.

La conexión actual con Google Sheets queda igual y no debes cambiarla.

## Variables de entorno existentes que NO debes cambiar si ya funcionan

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `AUTH_JWT_SECRET`
- `API_KEY`, si la usas

## Variables para comprobantes con Google Apps Script

En Netlify deben existir:

- `GOOGLE_APPS_SCRIPT_UPLOAD_URL`
- `COMPROBANTES_UPLOAD_SECRET`

`GOOGLE_DRIVE_FOLDER_ID` ya no es necesario para comprobantes si usas Apps Script, porque el ID de carpeta queda dentro del script de Google.

## Apps Script

El archivo listo para copiar está en:

`tools/apps-script-comprobantes.gs`

### Pasos para actualizar Apps Script

1. Abre tu proyecto en https://script.google.com/.
2. Reemplaza TODO el código por el contenido actualizado de `tools/apps-script-comprobantes.gs`.
3. Mantén tus valores reales en estas líneas:

```javascript
const FOLDER_ID = 'tu_id_real';
const SECRET = 'tu_clave_real';
```

4. Guarda.
5. Ve a **Deploy > Manage deployments**.
6. Clic en el lápiz del deployment actual.
7. En **Version**, selecciona **New version**.
8. Clic en **Deploy**.
9. No cambies la URL `/exec` en Netlify si sigue siendo la misma.
10. Redespliega Netlify con el código nuevo.

### Verificación

Abre en el navegador:

`TU_URL_DE_APPS_SCRIPT/exec?secret=TU_SECRET`

Debe mostrar:

```json
"version": "v14",
"canDelete": true,
"deleteMethod": "POST JSON/text/plain, POST URL params o form-urlencoded"
```

## Netlify

Después de subir esta versión:

1. Entra a **Deploys**.
2. Clic en **Trigger deploy**.
3. Clic en **Deploy project**.
4. Abre la app y recarga con `Ctrl + F5`.

## Pruebas recomendadas

1. Crea un movimiento nuevo con una imagen pequeña o PDF menor a 5 MB.
2. Abre el detalle/ticket y confirma que se ve el comprobante.
3. Edita el movimiento y reemplaza el comprobante.
4. Revisa en Drive que el comprobante anterior quede en la papelera.
5. Elimina el movimiento.
6. Revisa en Drive que el comprobante del movimiento eliminado quede en la papelera.

## Errores comunes

Si aparece un error de autorización al borrar, revisa:

- Que `COMPROBANTES_UPLOAD_SECRET` en Netlify sea exactamente igual al `SECRET` del Apps Script.
- Que `GOOGLE_APPS_SCRIPT_UPLOAD_URL` sea la URL `/exec` correcta.
- Que esas variables estén configuradas en el contexto **Production** de Netlify.
- Que hayas publicado una **New version** del Apps Script después de pegar el código nuevo.
- Que hayas hecho un nuevo deploy en Netlify.

Si subes un archivo mayor a 5 MB, la app mostrará:

`❌ Error guardando: El comprobante supera 5 MB. Comprime el archivo o usa uno más liviano.`

Si Drive personal realmente está sin espacio, la app mostrará:

`❌ Error guardando: Espacio lleno en Google Drive. Libera espacio o actualiza tu plan de almacenamiento.`

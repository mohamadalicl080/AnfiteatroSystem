# Anfiteatro (Google Sheets como BD) + Netlify Functions

Este starter expone endpoints para **Movimientos** y **Actividad** usando Google Sheets como "base de datos".

## Endpoints (Netlify)
Netlify publica automáticamente:
- `/.netlify/functions/health`
- `/.netlify/functions/movimientos`
- `/.netlify/functions/actividad`

## Variables de entorno (Netlify Site settings → Environment variables)
- `GOOGLE_SHEETS_SPREADSHEET_ID` = ID del Google Sheet
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` = email del Service Account (…@….iam.gserviceaccount.com)
- `GOOGLE_PRIVATE_KEY` = private key del JSON (ojo con los saltos de línea)
- (opcional) `API_KEY` = una clave simple para exigir `x-api-key` en requests
- (opcional) `GOOGLE_SHEETS_MOVIMIENTOS_SHEET` = nombre pestaña movimientos (default `Movimientos`)
- (opcional) `GOOGLE_SHEETS_ACTIVIDAD_SHEET` = nombre pestaña actividad (default `Actividad`)

> Nota: variables definidas en `netlify.toml` NO quedan disponibles para Functions; ponlas en el UI/CLI de Netlify.

## Google Cloud (Service Account)
1) Habilita Google Sheets API en tu proyecto.
2) Crea un Service Account y una key JSON.
3) Abre tu Google Sheet → Share → agrega el email del Service Account como **Editor**.

## Front-end (ejemplo rápido)
```js
await fetch('/.netlify/functions/movimientos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'TU_API_KEY' },
  body: JSON.stringify({
    fecha: '2026-02-06',
    area: 'Arriendos',
    tipo: 'Ingreso',
    descripcion: 'Pago arriendo Local 12 - Febrero',
    monto: 450000,
    responsable: 'Admin',
    periodo: '2026-02'
  })
});
```

## Correr local
- Instala Netlify CLI y ejecuta `netlify dev` (Netlify Dev puede cargar variables desde Netlify o `.env` local).

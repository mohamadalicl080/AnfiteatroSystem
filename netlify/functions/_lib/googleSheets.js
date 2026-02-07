const { google } = require("googleapis");

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getAuth() {
  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let key = getEnv("GOOGLE_PRIVATE_KEY");
  // Netlify UI variables usually store \n as literal; convert to real newlines.
  key = key.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

function getSpreadsheetId() {
  return getEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

module.exports = { getSheetsClient, getSpreadsheetId };

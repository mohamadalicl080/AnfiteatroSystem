function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function requireApiKey(event) {
  const expected = process.env.API_KEY;
  if (!expected) return; // Optional: if not set, skip check.
  const got = event.headers["x-api-key"] || event.headers["X-Api-Key"];
  if (got !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

module.exports = { json, requireApiKey };
